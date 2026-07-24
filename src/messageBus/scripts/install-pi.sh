#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/pi-health-agent
ENV_DIR=/etc/pi-health-agent
SERVICE_FILE=/etc/systemd/system/pi-health-agent.service
SERVICE_USER=pi-health-agent
SERVER_URL=
DEVICE_ID=
WIFI_INTERFACE=
FLIGHT_CONTROLLER_ENABLED=true
FLIGHT_CONTROLLER_DEVICE=auto
FLIGHT_CONTROLLER_PROTOCOL=auto
FLIGHT_CONTROLLER_BAUD=115200
SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

usage() {
  echo "Usage: sudo $0 --server-url URL --device-id ID [--source-dir DIR] [--wifi-interface NAME]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url) SERVER_URL=${2:-}; shift 2 ;;
    --device-id) DEVICE_ID=${2:-}; shift 2 ;;
    --source-dir) SOURCE_DIR=${2:-}; shift 2 ;;
    --wifi-interface) WIFI_INTERFACE=${2:-}; shift 2 ;;
    --flight-controller-enabled) FLIGHT_CONTROLLER_ENABLED=${2:-}; shift 2 ;;
    --flight-controller-device) FLIGHT_CONTROLLER_DEVICE=${2:-}; shift 2 ;;
    --flight-controller-protocol) FLIGHT_CONTROLLER_PROTOCOL=${2:-}; shift 2 ;;
    --flight-controller-baud) FLIGHT_CONTROLLER_BAUD=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ $SERVER_URL =~ ^https?://[^[:space:]]+$ && $SERVER_URL != *"'"* && $SERVER_URL != *'"'* ]] ||
  { echo "Error: --server-url must be an http(s) URL." >&2; exit 1; }
[[ $DEVICE_ID =~ ^[A-Za-z0-9._-]+$ ]] ||
  { echo "Error: --device-id may contain letters, digits, dots, underscores, and dashes." >&2; exit 1; }
[[ -z $WIFI_INTERFACE || $WIFI_INTERFACE =~ ^[A-Za-z0-9._:-]+$ ]] ||
  { echo "Error: invalid Wi-Fi interface." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_ENABLED == true || $FLIGHT_CONTROLLER_ENABLED == false ]] ||
  { echo "Error: invalid flight-controller enabled value." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_DEVICE == auto || $FLIGHT_CONTROLLER_DEVICE =~ ^/dev/[A-Za-z0-9._/-]+$ ]] ||
  { echo "Error: invalid flight-controller device." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_PROTOCOL == auto || $FLIGHT_CONTROLLER_PROTOCOL == mavlink || $FLIGHT_CONTROLLER_PROTOCOL == msp ]] ||
  { echo "Error: invalid flight-controller protocol." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_BAUD =~ ^[0-9]+$ ]] &&
  (( FLIGHT_CONTROLLER_BAUD >= 1200 && FLIGHT_CONTROLLER_BAUD <= 4000000 )) ||
  { echo "Error: invalid flight-controller baud." >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  sudo_arguments=("$0" --server-url "$SERVER_URL" --device-id "$DEVICE_ID" --source-dir "$SOURCE_DIR")
  [[ -z $WIFI_INTERFACE ]] || sudo_arguments+=(--wifi-interface "$WIFI_INTERFACE")
  sudo_arguments+=(
    --flight-controller-enabled "$FLIGHT_CONTROLLER_ENABLED"
    --flight-controller-device "$FLIGHT_CONTROLLER_DEVICE"
    --flight-controller-protocol "$FLIGHT_CONTROLLER_PROTOCOL"
    --flight-controller-baud "$FLIGHT_CONTROLLER_BAUD"
  )
  exec sudo -- "${sudo_arguments[@]}"
fi

node_is_supported() {
  command -v node >/dev/null 2>&1 &&
    command -v npm >/dev/null 2>&1 &&
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
      >/dev/null 2>&1
}

install_nodejs() {
  command -v apt-get >/dev/null ||
    { echo "Error: Node.js is missing and apt-get is unavailable." >&2; exit 1; }

  echo "Node.js 20+ was not found; installing Node.js 22..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl

  NODE_SETUP=$(mktemp)
  trap 'rm -f "${NODE_SETUP:-}"' EXIT
  curl --fail --silent --show-error --location \
    https://deb.nodesource.com/setup_22.x \
    --output "$NODE_SETUP"
  bash "$NODE_SETUP"
  apt-get install -y nodejs
  rm -f "$NODE_SETUP"

  node_is_supported ||
    { echo "Error: Node.js 22 installation did not complete successfully." >&2; exit 1; }
  echo "Installed Node.js $(node --version)."
}

node_is_supported || install_nodejs

SOURCE_DIR=$(realpath "$SOURCE_DIR")
[[ -d $SOURCE_DIR/agent/dist && -f $SOURCE_DIR/agent/package.json ]] ||
  { echo "Error: compiled agent not found in $SOURCE_DIR. Run npm run build first." >&2; exit 1; }

echo "Installing Pi health agent..."
id -u "$SERVICE_USER" >/dev/null 2>&1 ||
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$APP_DIR"
find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name venv -exec rm -rf -- {} +
cp -a "$SOURCE_DIR/agent/dist" "$APP_DIR/dist"
cp -a "$SOURCE_DIR/agent/python" "$APP_DIR/python"
cp "$SOURCE_DIR/agent/package.json" "$APP_DIR/package.json"

if [[ $FLIGHT_CONTROLLER_ENABLED == true ]]; then
  echo "Installing flight-controller telemetry runtime..."
  if [[ ! -x $APP_DIR/venv/bin/python ]]; then
    apt-get update
    apt-get install -y python3 python3-venv
    python3 -m venv "$APP_DIR/venv"
  fi
  if ! "$APP_DIR/venv/bin/python" -c 'import pymavlink' >/dev/null 2>&1; then
    "$APP_DIR/venv/bin/pip" install --no-cache-dir pymavlink pyserial
  elif ! "$APP_DIR/venv/bin/python" -c 'import serial' >/dev/null 2>&1; then
    "$APP_DIR/venv/bin/pip" install --no-cache-dir pyserial
  fi
  usermod -a -G dialout "$SERVICE_USER"
fi

if [[ -d $SOURCE_DIR/node_modules/socket.io-client ]]; then
  cp -a "$SOURCE_DIR/node_modules" "$APP_DIR/node_modules"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  runuser -u "$SERVICE_USER" -- bash -c "cd '$APP_DIR' && npm prune --omit=dev"
else
  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  runuser -u "$SERVICE_USER" -- bash -c "cd '$APP_DIR' && npm install --omit=dev --ignore-scripts"
fi

install -d -o root -g "$SERVICE_USER" -m 0750 "$ENV_DIR"
{
  printf 'SERVER_URL=%s\n' "$SERVER_URL"
  printf 'DEVICE_ID=%s\n' "$DEVICE_ID"
  printf 'HEALTH_INTERVAL_MS=60000\n'
  printf 'NODE_ENV=production\n'
  [[ -z $WIFI_INTERFACE ]] || printf 'WIFI_INTERFACE=%s\n' "$WIFI_INTERFACE"
  printf 'FLIGHT_CONTROLLER_ENABLED=%s\n' "$FLIGHT_CONTROLLER_ENABLED"
  printf 'FLIGHT_CONTROLLER_DEVICE=%s\n' "$FLIGHT_CONTROLLER_DEVICE"
  printf 'FLIGHT_CONTROLLER_PROTOCOL=%s\n' "$FLIGHT_CONTROLLER_PROTOCOL"
  printf 'FLIGHT_CONTROLLER_BAUD=%s\n' "$FLIGHT_CONTROLLER_BAUD"
} > "$ENV_DIR/agent.env"
chown root:"$SERVICE_USER" "$ENV_DIR/agent.env"
chmod 0640 "$ENV_DIR/agent.env"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Pi health-check agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_DIR/agent.env
ExecStart=$(command -v node) $APP_DIR/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pi-health-agent.service
systemctl restart pi-health-agent.service

echo "Pi health agent installed for $DEVICE_ID."
echo "Status: sudo systemctl status pi-health-agent"
echo "Logs:   sudo journalctl -u pi-health-agent -f"
