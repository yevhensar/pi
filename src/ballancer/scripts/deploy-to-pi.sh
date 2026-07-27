#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CONFIG_FILE=
REMOTE_HOST=
SSH_HOST=
SSH_USER=
SSH_PASSWORD=
SUDO_PASSWORD=
SSH_PORT=22
CLIENT_ID=
FC_DEVICE=auto
FC_PROTOCOL=auto
FC_BAUD=115200
FC_ENABLED=true
REPLACE_CONFIG=false
SKIP_BUILD=false
CHECK_CONFIG=false
LOCAL_TMP=
REMOTE_TMP=

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-to-pi.sh --config config/pi-client.json [options]
  ./scripts/deploy-to-pi.sh --host USER@HOST --client-id ID [options]

Options:
  --config FILE       Read deployment settings from JSON.
  --host USER@HOST    SSH destination.
  --client-id ID      Stable fleet client identifier.
  --ssh-port PORT     SSH port (default: 22).
  --skip-build        Reuse the already validated source tree.
  --replace-config    Replace the deployed balancer YAML.
  --check-config      Validate without connecting or deploying.
EOF
}

for ((argument_index = 1; argument_index <= $#; argument_index++)); do
  if [[ ${!argument_index} == --config ]]; then
    value_index=$((argument_index + 1))
    CONFIG_FILE=${!value_index:-}
  fi
done

if [[ -n $CONFIG_FILE ]]; then
  command -v jq >/dev/null ||
    { echo "Error: jq is required for JSON configuration." >&2; exit 1; }
  [[ -r $CONFIG_FILE ]] ||
    { echo "Error: cannot read config: $CONFIG_FILE" >&2; exit 1; }
  jq -e 'type == "object"' "$CONFIG_FILE" >/dev/null ||
    { echo "Error: config must contain one JSON object." >&2; exit 1; }

  SSH_HOST=$(jq -r '.host // empty' "$CONFIG_FILE")
  SSH_USER=$(jq -r '.ssh_user // empty' "$CONFIG_FILE")
  SSH_PASSWORD=$(jq -r '.ssh_password // empty' "$CONFIG_FILE")
  SUDO_PASSWORD=$(jq -r '.sudo_password // empty' "$CONFIG_FILE")
  SSH_PORT=$(jq -r '.ssh_port // 22' "$CONFIG_FILE")
  CLIENT_ID=$(jq -r '.client_id // empty' "$CONFIG_FILE")
  FC_DEVICE=$(jq -r '.flight_controller.device // "auto"' "$CONFIG_FILE")
  FC_PROTOCOL=$(jq -r '.flight_controller.protocol // "auto"' "$CONFIG_FILE")
  FC_BAUD=$(jq -r '.flight_controller.baud // 115200' "$CONFIG_FILE")
  FC_ENABLED=$(jq -r '.flight_controller.enabled // true' "$CONFIG_FILE")
  REPLACE_CONFIG=$(jq -r '.ballancer.replace_config // false' "$CONFIG_FILE")
  ROLE=$(jq -r '.role // "client"' "$CONFIG_FILE")

  [[ $ROLE == client ]] ||
    { echo "Error: role must be \"client\"." >&2; exit 1; }
  [[ -n $SSH_HOST && -n $SSH_USER ]] ||
    { echo "Error: config requires host and ssh_user." >&2; exit 1; }
  REMOTE_HOST="$SSH_USER@$SSH_HOST"

  config_mode=$(stat -c '%a' "$CONFIG_FILE" 2>/dev/null || true)
  if [[ -n $SSH_PASSWORD || -n $SUDO_PASSWORD ]] &&
    [[ $config_mode != 600 && $config_mode != 400 ]]; then
    echo "Warning: protect credential config with: chmod 600 '$CONFIG_FILE'" >&2
  fi
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) shift 2 ;;
    --host) REMOTE_HOST=${2:-}; shift 2 ;;
    --client-id) CLIENT_ID=${2:-}; shift 2 ;;
    --ssh-port) SSH_PORT=${2:-}; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --replace-config) REPLACE_CONFIG=true; shift ;;
    --check-config) CHECK_CONFIG=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ $REMOTE_HOST =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] ||
  { echo "Error: host must be USER@HOST." >&2; exit 1; }
[[ $CLIENT_ID =~ ^[A-Za-z0-9._-]+$ ]] ||
  { echo "Error: invalid client ID." >&2; exit 1; }
[[ $SSH_PORT =~ ^[0-9]+$ ]] && (( SSH_PORT >= 1 && SSH_PORT <= 65535 )) ||
  { echo "Error: invalid SSH port." >&2; exit 1; }
[[ $FC_DEVICE == auto || $FC_DEVICE =~ ^/dev/[A-Za-z0-9._/-]+$ ]] ||
  { echo "Error: invalid flight-controller device." >&2; exit 1; }
[[ $FC_PROTOCOL == auto || $FC_PROTOCOL == msp ]] ||
  { echo "Error: ballancer supports only MSP flight-controller configurations." >&2; exit 1; }
[[ $FC_ENABLED == true ]] ||
  { echo "Error: ballancer deployment requires flight_controller.enabled=true." >&2; exit 1; }
[[ $FC_BAUD =~ ^[0-9]+$ ]] && (( FC_BAUD >= 1200 && FC_BAUD <= 4000000 )) ||
  { echo "Error: invalid flight-controller baud." >&2; exit 1; }
[[ $REPLACE_CONFIG == true || $REPLACE_CONFIG == false ]] ||
  { echo "Error: ballancer.replace_config must be true or false." >&2; exit 1; }

if [[ $CHECK_CONFIG == true ]]; then
  echo "Configuration is valid."
  echo "SSH target: $REMOTE_HOST:$SSH_PORT"
  echo "Client ID: $CLIENT_ID"
  echo "Flight controller: MSP on $FC_DEVICE at $FC_BAUD baud"
  echo "Replace deployed config: $REPLACE_CONFIG"
  echo "Automatic service start: disabled"
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
    echo "Warning: sshpass is missing; SSH may prompt interactively." >&2
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

if [[ $SKIP_BUILD == false ]]; then
  echo "[1/5] Validating ballancer build..."
  (cd "$ROOT_DIR" && npm run build:check)
else
  echo "[1/5] Using existing validated build..."
fi

echo "[2/5] Preparing deployment archive..."
LOCAL_TMP=$(mktemp -d)
mkdir -p "$LOCAL_TMP/bundle/config" "$LOCAL_TMP/bundle/scripts" "$LOCAL_TMP/bundle/systemd"
cp -a "$ROOT_DIR/fpv_stabilizer" "$LOCAL_TMP/bundle/fpv_stabilizer"
cp "$ROOT_DIR/pyproject.toml" "$LOCAL_TMP/bundle/pyproject.toml"
cp "$ROOT_DIR/config/config.yaml" "$LOCAL_TMP/bundle/config/config.yaml"
cp "$ROOT_DIR/systemd/fpv-stabilizer.service" \
  "$LOCAL_TMP/bundle/systemd/fpv-stabilizer.service"
cp "$ROOT_DIR/scripts/install-pi.sh" "$LOCAL_TMP/bundle/scripts/install-pi.sh"
cp "$ROOT_DIR/scripts/start-local.sh" "$LOCAL_TMP/bundle/scripts/start-local.sh"
cp "$ROOT_DIR/scripts/stop-local.sh" "$LOCAL_TMP/bundle/scripts/stop-local.sh"
tar -czf "$LOCAL_TMP/fpv-ballancer.tar.gz" -C "$LOCAL_TMP/bundle" .

echo "[3/5] Creating remote workspace..."
REMOTE_TMP=$("${SSH_COMMAND[@]}" "$REMOTE_HOST" 'mktemp -d /tmp/fpv-ballancer.XXXXXX')
[[ $REMOTE_TMP =~ ^/tmp/fpv-ballancer\.[A-Za-z0-9]+$ ]] ||
  { echo "Error: remote host returned an invalid temporary path." >&2; exit 1; }

echo "[4/5] Uploading ballancer to $CLIENT_ID..."
"${SCP_COMMAND[@]}" "$LOCAL_TMP/fpv-ballancer.tar.gz" "$REMOTE_HOST:$REMOTE_TMP/"

echo "[5/5] Installing dry-run service..."
INSTALL_COMMAND="tar -xzf '$REMOTE_TMP/fpv-ballancer.tar.gz' -C '$REMOTE_TMP' && sudo"
if [[ -n $SUDO_PASSWORD ]]; then
  INSTALL_COMMAND+=" -S -p ''"
fi
INSTALL_COMMAND+=" '$REMOTE_TMP/scripts/install-pi.sh'"
INSTALL_COMMAND+=" --flight-controller-device '$FC_DEVICE'"
INSTALL_COMMAND+=" --flight-controller-baud '$FC_BAUD'"
[[ $REPLACE_CONFIG == false ]] || INSTALL_COMMAND+=" --replace-config"

if [[ -n $SUDO_PASSWORD ]]; then
  printf '%s\n' "$SUDO_PASSWORD" | "${SSH_COMMAND[@]}" -T "$REMOTE_HOST" "$INSTALL_COMMAND"
else
  "${SSH_COMMAND[@]}" -T "$REMOTE_HOST" "$INSTALL_COMMAND"
fi

echo "Deployment complete: $CLIENT_ID ($REMOTE_HOST)"
echo "Service remains stopped. Disable dashboard FC telemetry before starting it."
