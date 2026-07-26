#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE_HOST=
SSH_HOST=
SSH_USER=
SSH_PASSWORD=
SUDO_PASSWORD=
SERVER_URL=
DEVICE_ID=
WIFI_INTERFACE=
FLIGHT_CONTROLLER_ENABLED=true
FLIGHT_CONTROLLER_DEVICE=auto
FLIGHT_CONTROLLER_PROTOCOL=auto
FLIGHT_CONTROLLER_BAUD=115200
MOTOR_TEST_ENABLED=false
MOTOR_TEST_OUTPUT=1050
MOTOR_TEST_DURATION_MS=2000
OBJECT_DETECTION_ENABLED=false
OBJECT_DETECTION_INTERVAL_MS=1000
OBJECT_DETECTION_OBJECT_TYPE=car
CAMERA_STREAM_ENABLED=true
CAMERA_STREAM_PUBLISH_URL=
CAMERA_STREAM_WIDTH=1280
CAMERA_STREAM_HEIGHT=720
CAMERA_STREAM_FPS=20
CAMERA_STREAM_BITRATE=2500000
MESSAGE_TOKEN=
SSH_PORT=22
SKIP_BUILD=false
CHECK_CONFIG=false
CONFIG_FILE=
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LOCAL_TMP=
REMOTE_TMP=

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-to-pi.sh --config config/pi-client.json [--server-url URL]
  ./scripts/deploy-to-pi.sh --host USER@HOST --server-url URL --device-id ID [options]

Options:
  --config FILE          Read host, credentials, client ID, and interface from JSON
  --host USER@HOST       SSH destination (overrides ssh_user and host from JSON)
  --server-url URL       Health-monitor server (or use server_url in JSON)
  --device-id ID         Client ID (overrides client_id from JSON)
  --ssh-port PORT        SSH port (default: 22)
  --wifi-interface NAME  Pi network interface, such as wlan0
  --skip-build           Reuse an existing compiled agent
  --check-config         Validate and show non-secret settings without deploying
EOF
}

# Find the configuration file first so explicit CLI options can override it
# regardless of argument order.
for ((argument_index = 1; argument_index <= $#; argument_index++)); do
  if [[ ${!argument_index} == --config ]]; then
    value_index=$((argument_index + 1))
    CONFIG_FILE=${!value_index:-}
  fi
done

if [[ -n $CONFIG_FILE ]]; then
  command -v jq >/dev/null ||
    { echo "Error: jq is required when using --config." >&2; exit 1; }
  [[ -r $CONFIG_FILE ]] || { echo "Error: cannot read config: $CONFIG_FILE" >&2; exit 1; }
  jq -e 'type == "object"' "$CONFIG_FILE" >/dev/null ||
    { echo "Error: config must contain one JSON object." >&2; exit 1; }

  SSH_HOST=$(jq -r '.host // empty' "$CONFIG_FILE")
  SSH_USER=$(jq -r '.ssh_user // empty' "$CONFIG_FILE")
  SSH_PASSWORD=$(jq -r '.ssh_password // empty' "$CONFIG_FILE")
  SUDO_PASSWORD=$(jq -r '.sudo_password // empty' "$CONFIG_FILE")
  SERVER_URL=$(jq -r '.server_url // empty' "$CONFIG_FILE")
  DEVICE_ID=$(jq -r '.client_id // empty' "$CONFIG_FILE")
  WIFI_INTERFACE=$(jq -r '.wifi_interface // empty' "$CONFIG_FILE")
  FLIGHT_CONTROLLER_ENABLED=$(jq -r '.flight_controller.enabled // true' "$CONFIG_FILE")
  FLIGHT_CONTROLLER_DEVICE=$(jq -r '.flight_controller.device // "auto"' "$CONFIG_FILE")
  FLIGHT_CONTROLLER_PROTOCOL=$(jq -r '.flight_controller.protocol // "auto"' "$CONFIG_FILE")
  FLIGHT_CONTROLLER_BAUD=$(jq -r '.flight_controller.baud // 115200' "$CONFIG_FILE")
  MOTOR_TEST_ENABLED=$(jq -r '.flight_controller.motor_test.enabled // false' "$CONFIG_FILE")
  MOTOR_TEST_OUTPUT=$(jq -r '.flight_controller.motor_test.output // 1050' "$CONFIG_FILE")
  MOTOR_TEST_DURATION_MS=$(jq -r '.flight_controller.motor_test.duration_ms // 2000' "$CONFIG_FILE")
  OBJECT_DETECTION_ENABLED=$(jq -r '.object_detection.enabled // false' "$CONFIG_FILE")
  OBJECT_DETECTION_INTERVAL_MS=$(jq -r '.object_detection.interval_ms // 1000' "$CONFIG_FILE")
  OBJECT_DETECTION_OBJECT_TYPE=$(jq -r '.object_detection.object_type // "car"' "$CONFIG_FILE")
  CAMERA_STREAM_ENABLED=$(jq -r '.camera_stream.enabled // true' "$CONFIG_FILE")
  CAMERA_STREAM_PUBLISH_URL=$(jq -r '.camera_stream.publish_url // empty' "$CONFIG_FILE")
  CAMERA_STREAM_WIDTH=$(jq -r '.camera_stream.width // 1280' "$CONFIG_FILE")
  CAMERA_STREAM_HEIGHT=$(jq -r '.camera_stream.height // 720' "$CONFIG_FILE")
  CAMERA_STREAM_FPS=$(jq -r '.camera_stream.fps // 20' "$CONFIG_FILE")
  CAMERA_STREAM_BITRATE=$(jq -r '.camera_stream.bitrate // 2500000' "$CONFIG_FILE")
  MESSAGE_TOKEN=$(jq -r '.message_token // empty' "$CONFIG_FILE")
  SSH_PORT=$(jq -r '.ssh_port // 22' "$CONFIG_FILE")
  ROLE=$(jq -r '.role // "client"' "$CONFIG_FILE")

  [[ $ROLE == client ]] ||
    { echo "Error: deploy-to-pi requires role \"client\", got \"$ROLE\"." >&2; exit 1; }
  [[ -n $SSH_HOST && -n $SSH_USER ]] ||
    { echo "Error: config requires non-empty host and ssh_user." >&2; exit 1; }
  REMOTE_HOST="$SSH_USER@$SSH_HOST"

  config_mode=$(stat -c '%a' "$CONFIG_FILE" 2>/dev/null || true)
  if [[ -n $SSH_PASSWORD || -n $SUDO_PASSWORD ]] && [[ $config_mode != 600 && $config_mode != 400 ]]; then
    echo "Warning: $CONFIG_FILE contains credentials; protect it with: chmod 600 '$CONFIG_FILE'" >&2
  fi
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) shift 2 ;;
    --host) REMOTE_HOST=${2:-}; shift 2 ;;
    --server-url) SERVER_URL=${2:-}; shift 2 ;;
    --device-id) DEVICE_ID=${2:-}; shift 2 ;;
    --ssh-port) SSH_PORT=${2:-}; shift 2 ;;
    --wifi-interface) WIFI_INTERFACE=${2:-}; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --check-config) CHECK_CONFIG=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z $MESSAGE_TOKEN ]]; then
  if [[ $CHECK_CONFIG == true && ! -f $ROOT_DIR/config/message-token.json ]]; then
    MESSAGE_TOKEN=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
  else
    node "$ROOT_DIR/scripts/message-token.mjs" --init --quiet
    MESSAGE_TOKEN=$(node "$ROOT_DIR/scripts/message-token.mjs" --show)
  fi
fi

[[ -n $REMOTE_HOST && -n $SERVER_URL && -n $DEVICE_ID ]] ||
  { echo "Error: --host, --server-url, and --device-id are required." >&2; usage; exit 1; }
[[ $SERVER_URL =~ ^https?://[^[:space:]]+$ && $SERVER_URL != *"'"* && $SERVER_URL != *'"'* ]] ||
  { echo "Error: invalid server URL." >&2; exit 1; }
[[ $SSH_PORT =~ ^[0-9]+$ ]] && (( SSH_PORT >= 1 && SSH_PORT <= 65535 )) ||
  { echo "Error: invalid SSH port." >&2; exit 1; }
[[ $DEVICE_ID =~ ^[A-Za-z0-9._-]+$ ]] ||
  { echo "Error: invalid device ID." >&2; exit 1; }
[[ $MESSAGE_TOKEN =~ ^[A-Za-z0-9_-]{43}$ ]] ||
  { echo "Error: message token must be a 32-byte base64url value." >&2; exit 1; }
[[ -z $WIFI_INTERFACE || $WIFI_INTERFACE =~ ^[A-Za-z0-9._:-]+$ ]] ||
  { echo "Error: invalid Wi-Fi interface." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_ENABLED == true || $FLIGHT_CONTROLLER_ENABLED == false ]] ||
  { echo "Error: flight_controller.enabled must be true or false." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_DEVICE == auto || $FLIGHT_CONTROLLER_DEVICE =~ ^/dev/[A-Za-z0-9._/-]+$ ]] ||
  { echo "Error: flight_controller.device must be auto or a /dev path." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_PROTOCOL == auto || $FLIGHT_CONTROLLER_PROTOCOL == mavlink || $FLIGHT_CONTROLLER_PROTOCOL == msp ]] ||
  { echo "Error: flight_controller.protocol must be auto, mavlink, or msp." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_BAUD =~ ^[0-9]+$ ]] &&
  (( FLIGHT_CONTROLLER_BAUD >= 1200 && FLIGHT_CONTROLLER_BAUD <= 4000000 )) ||
  { echo "Error: invalid flight-controller baud." >&2; exit 1; }
[[ $MOTOR_TEST_ENABLED == true || $MOTOR_TEST_ENABLED == false ]] ||
  { echo "Error: flight_controller.motor_test.enabled must be true or false." >&2; exit 1; }
[[ $MOTOR_TEST_OUTPUT =~ ^[0-9]+$ ]] &&
  (( MOTOR_TEST_OUTPUT >= 1000 && MOTOR_TEST_OUTPUT <= 1075 )) ||
  { echo "Error: motor-test output must be between 1000 and 1075." >&2; exit 1; }
[[ $MOTOR_TEST_DURATION_MS =~ ^[0-9]+$ ]] &&
  (( MOTOR_TEST_DURATION_MS >= 500 && MOTOR_TEST_DURATION_MS <= 3000 )) ||
  { echo "Error: motor-test duration_ms must be between 500 and 3000." >&2; exit 1; }
[[ $OBJECT_DETECTION_ENABLED == true || $OBJECT_DETECTION_ENABLED == false ]] ||
  { echo "Error: object_detection.enabled must be true or false." >&2; exit 1; }
[[ $OBJECT_DETECTION_INTERVAL_MS =~ ^[0-9]+$ ]] &&
  (( OBJECT_DETECTION_INTERVAL_MS >= 250 && OBJECT_DETECTION_INTERVAL_MS <= 3600000 )) ||
  { echo "Error: object_detection.interval_ms must be between 250 and 3600000." >&2; exit 1; }
[[ $OBJECT_DETECTION_OBJECT_TYPE =~ ^[A-Za-z0-9._-]+$ ]] ||
  { echo "Error: invalid object_detection.object_type." >&2; exit 1; }
[[ $CAMERA_STREAM_ENABLED == true || $CAMERA_STREAM_ENABLED == false ]] ||
  { echo "Error: camera_stream.enabled must be true or false." >&2; exit 1; }
[[ $CAMERA_STREAM_WIDTH =~ ^[0-9]+$ ]] && (( CAMERA_STREAM_WIDTH >= 320 )) &&
[[ $CAMERA_STREAM_HEIGHT =~ ^[0-9]+$ ]] && (( CAMERA_STREAM_HEIGHT >= 240 )) &&
[[ $CAMERA_STREAM_FPS =~ ^[0-9]+$ ]] && (( CAMERA_STREAM_FPS >= 1 && CAMERA_STREAM_FPS <= 60 )) &&
[[ $CAMERA_STREAM_BITRATE =~ ^[0-9]+$ ]] && (( CAMERA_STREAM_BITRATE >= 100000 )) ||
  { echo "Error: invalid camera_stream video settings." >&2; exit 1; }
if [[ $CAMERA_STREAM_ENABLED == true && -z $CAMERA_STREAM_PUBLISH_URL ]]; then
  server_host=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$SERVER_URL")
  CAMERA_STREAM_PUBLISH_URL="rtsp://$server_host:8554/$DEVICE_ID-camera"
fi
[[ $CAMERA_STREAM_ENABLED == false || $CAMERA_STREAM_PUBLISH_URL =~ ^rtsp://[^[:space:]\'\"]+$ ]] ||
  { echo "Error: camera_stream.publish_url must be an RTSP URL." >&2; exit 1; }

if [[ $CHECK_CONFIG == true ]]; then
  echo "Configuration is valid."
  echo "SSH target: $REMOTE_HOST:$SSH_PORT"
  echo "Role: client"
  echo "Client ID: $DEVICE_ID"
  echo "Server URL: $SERVER_URL"
  echo "Message encryption: configured"
  echo "Wi-Fi interface: ${WIFI_INTERFACE:-all interfaces}"
  echo "Flight controller: $([[ $FLIGHT_CONTROLLER_ENABLED == true ]] && echo "$FLIGHT_CONTROLLER_PROTOCOL on $FLIGHT_CONTROLLER_DEVICE at $FLIGHT_CONTROLLER_BAUD baud" || echo disabled)"
  echo "Motor test: $([[ $MOTOR_TEST_ENABLED == true ]] && echo "enabled ($MOTOR_TEST_OUTPUT for ${MOTOR_TEST_DURATION_MS}ms)" || echo disabled)"
  echo "Object detection frames: $([[ $OBJECT_DETECTION_ENABLED == true ]] && echo "$OBJECT_DETECTION_OBJECT_TYPE every ${OBJECT_DETECTION_INTERVAL_MS}ms" || echo disabled)"
  echo "WebRTC source: $([[ $CAMERA_STREAM_ENABLED == true ]] && echo "${CAMERA_STREAM_WIDTH}x${CAMERA_STREAM_HEIGHT} at ${CAMERA_STREAM_FPS}fps → $CAMERA_STREAM_PUBLISH_URL" || echo disabled)"
  echo "SSH authentication: $([[ -n $SSH_PASSWORD ]] && echo password || echo keys/interactive)"
  echo "sudo authentication: $([[ -n $SUDO_PASSWORD ]] && echo configured || echo passwordless/interactive)"
  exit 0
fi

SSH_COMMAND=(ssh -p "$SSH_PORT")
SCP_COMMAND=(scp -P "$SSH_PORT")
if [[ -n $SSH_PASSWORD ]]; then
  if command -v sshpass >/dev/null; then
    export SSHPASS="$SSH_PASSWORD"
    SSH_COMMAND=(sshpass -e ssh -p "$SSH_PORT")
    SCP_COMMAND=(sshpass -e scp -P "$SSH_PORT")
  else
    echo "Warning: sshpass is not installed; SSH will prompt for the password interactively." >&2
    echo "For unattended deployment, install it with: sudo apt install sshpass" >&2
  fi
fi

cleanup() {
  [[ -z ${LOCAL_TMP:-} ]] || rm -rf "$LOCAL_TMP"
  if [[ -n ${REMOTE_TMP:-} ]]; then
    "${SSH_COMMAND[@]}" "$REMOTE_HOST" "rm -rf '$REMOTE_TMP'" >/dev/null 2>&1 || true
  fi
  unset SSHPASS SSH_PASSWORD SUDO_PASSWORD
}
trap cleanup EXIT

cd "$ROOT_DIR"
if [[ $SKIP_BUILD == false ]]; then
  echo "[1/5] Building agent..."
  npm run build -w @pi-health/shared
  npm run build -w @pi-health/agent
else
  echo "[1/5] Using existing agent build..."
  [[ -f agent/dist/index.js && -f shared/dist/types.js ]] ||
    { echo "Error: agent build missing; run without --skip-build first." >&2; exit 1; }
fi

echo "[2/5] Preparing deployment archive..."
LOCAL_TMP=$(mktemp -d)
mkdir -p "$LOCAL_TMP/bundle/agent" "$LOCAL_TMP/bundle/scripts" "$LOCAL_TMP/bundle/shared"
cp -a agent/dist "$LOCAL_TMP/bundle/agent/dist"
cp -a agent/python "$LOCAL_TMP/bundle/agent/python"
cp agent/package.production.json "$LOCAL_TMP/bundle/agent/package.json"
cp -a shared/dist "$LOCAL_TMP/bundle/shared/dist"
cp shared/package.json "$LOCAL_TMP/bundle/shared/package.json"
cp package-lock.json "$LOCAL_TMP/bundle/package-lock.json"
cp scripts/install-pi.sh "$LOCAL_TMP/bundle/scripts/install-pi.sh"
printf '%s\n' "$MESSAGE_TOKEN" > "$LOCAL_TMP/bundle/message-token"
chmod 600 "$LOCAL_TMP/bundle/message-token"
cp -a node_modules "$LOCAL_TMP/bundle/node_modules"
tar -czf "$LOCAL_TMP/pi-health-agent.tar.gz" -C "$LOCAL_TMP/bundle" .

echo "[3/5] Creating remote workspace..."
REMOTE_TMP=$("${SSH_COMMAND[@]}" "$REMOTE_HOST" 'mktemp -d /tmp/pi-health-deploy.XXXXXX')
[[ $REMOTE_TMP =~ ^/tmp/pi-health-deploy\.[A-Za-z0-9]+$ ]] ||
  { echo "Error: remote host returned an invalid temporary path." >&2; exit 1; }

echo "[4/5] Uploading agent..."
"${SCP_COMMAND[@]}" "$LOCAL_TMP/pi-health-agent.tar.gz" "$REMOTE_HOST:$REMOTE_TMP/"

echo "[5/5] Installing service..."
INSTALL_COMMAND="tar -xzf '$REMOTE_TMP/pi-health-agent.tar.gz' -C '$REMOTE_TMP' && sudo"
if [[ -n $SUDO_PASSWORD ]]; then
  INSTALL_COMMAND+=" -S -p ''"
fi
INSTALL_COMMAND+=" '$REMOTE_TMP/scripts/install-pi.sh' --server-url '$SERVER_URL' --device-id '$DEVICE_ID' --source-dir '$REMOTE_TMP'"
INSTALL_COMMAND+=" --message-token-file '$REMOTE_TMP/message-token'"
if [[ -n $WIFI_INTERFACE ]]; then
  INSTALL_COMMAND+=" --wifi-interface '$WIFI_INTERFACE'"
fi
INSTALL_COMMAND+=" --flight-controller-enabled '$FLIGHT_CONTROLLER_ENABLED' --flight-controller-device '$FLIGHT_CONTROLLER_DEVICE' --flight-controller-protocol '$FLIGHT_CONTROLLER_PROTOCOL' --flight-controller-baud '$FLIGHT_CONTROLLER_BAUD'"
INSTALL_COMMAND+=" --motor-test-enabled '$MOTOR_TEST_ENABLED' --motor-test-output '$MOTOR_TEST_OUTPUT' --motor-test-duration-ms '$MOTOR_TEST_DURATION_MS'"
INSTALL_COMMAND+=" --object-detection-enabled '$OBJECT_DETECTION_ENABLED' --object-detection-interval-ms '$OBJECT_DETECTION_INTERVAL_MS' --object-detection-object-type '$OBJECT_DETECTION_OBJECT_TYPE'"
INSTALL_COMMAND+=" --camera-stream-enabled '$CAMERA_STREAM_ENABLED' --camera-stream-publish-url '$CAMERA_STREAM_PUBLISH_URL' --camera-stream-width '$CAMERA_STREAM_WIDTH' --camera-stream-height '$CAMERA_STREAM_HEIGHT' --camera-stream-fps '$CAMERA_STREAM_FPS' --camera-stream-bitrate '$CAMERA_STREAM_BITRATE'"

if [[ -n $SUDO_PASSWORD ]]; then
  printf '%s\n' "$SUDO_PASSWORD" | "${SSH_COMMAND[@]}" -T "$REMOTE_HOST" "$INSTALL_COMMAND"
else
  "${SSH_COMMAND[@]}" -T "$REMOTE_HOST" "$INSTALL_COMMAND"
fi

echo "Deployment complete: $DEVICE_ID → $SERVER_URL"
