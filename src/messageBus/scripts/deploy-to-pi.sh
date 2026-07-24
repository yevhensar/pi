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

[[ -n $REMOTE_HOST && -n $SERVER_URL && -n $DEVICE_ID ]] ||
  { echo "Error: --host, --server-url, and --device-id are required." >&2; usage; exit 1; }
[[ $SERVER_URL =~ ^https?://[^[:space:]]+$ && $SERVER_URL != *"'"* && $SERVER_URL != *'"'* ]] ||
  { echo "Error: invalid server URL." >&2; exit 1; }
[[ $SSH_PORT =~ ^[0-9]+$ ]] && (( SSH_PORT >= 1 && SSH_PORT <= 65535 )) ||
  { echo "Error: invalid SSH port." >&2; exit 1; }
[[ $DEVICE_ID =~ ^[A-Za-z0-9._-]+$ ]] ||
  { echo "Error: invalid device ID." >&2; exit 1; }
[[ -z $WIFI_INTERFACE || $WIFI_INTERFACE =~ ^[A-Za-z0-9._:-]+$ ]] ||
  { echo "Error: invalid Wi-Fi interface." >&2; exit 1; }

if [[ $CHECK_CONFIG == true ]]; then
  echo "Configuration is valid."
  echo "SSH target: $REMOTE_HOST:$SSH_PORT"
  echo "Role: client"
  echo "Client ID: $DEVICE_ID"
  echo "Server URL: $SERVER_URL"
  echo "Wi-Fi interface: ${WIFI_INTERFACE:-all interfaces}"
  echo "SSH authentication: $([[ -n $SSH_PASSWORD ]] && echo password || echo keys/interactive)"
  echo "sudo authentication: $([[ -n $SUDO_PASSWORD ]] && echo configured || echo passwordless/interactive)"
  exit 0
fi

SSH_COMMAND=(ssh -p "$SSH_PORT")
SCP_COMMAND=(scp -P "$SSH_PORT")
if [[ -n $SSH_PASSWORD ]]; then
  command -v sshpass >/dev/null ||
    { echo "Error: sshpass is required when ssh_password is configured." >&2; exit 1; }
  export SSHPASS="$SSH_PASSWORD"
  SSH_COMMAND=(sshpass -e ssh -p "$SSH_PORT")
  SCP_COMMAND=(sshpass -e scp -P "$SSH_PORT")
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
  [[ -f agent/dist/index.js ]] ||
    { echo "Error: agent build missing; run without --skip-build first." >&2; exit 1; }
fi

echo "[2/5] Preparing deployment archive..."
LOCAL_TMP=$(mktemp -d)
mkdir -p "$LOCAL_TMP/bundle/agent" "$LOCAL_TMP/bundle/scripts"
cp -a agent/dist "$LOCAL_TMP/bundle/agent/dist"
cp agent/package.production.json "$LOCAL_TMP/bundle/agent/package.json"
cp package-lock.json "$LOCAL_TMP/bundle/package-lock.json"
cp scripts/install-pi.sh "$LOCAL_TMP/bundle/scripts/install-pi.sh"
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
if [[ -n $WIFI_INTERFACE ]]; then
  INSTALL_COMMAND+=" --wifi-interface '$WIFI_INTERFACE'"
fi

if [[ -n $SUDO_PASSWORD ]]; then
  printf '%s\n' "$SUDO_PASSWORD" | "${SSH_COMMAND[@]}" -t "$REMOTE_HOST" "$INSTALL_COMMAND"
else
  "${SSH_COMMAND[@]}" -t "$REMOTE_HOST" "$INSTALL_COMMAND"
fi

echo "Deployment complete: $DEVICE_ID → $SERVER_URL"
