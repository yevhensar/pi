#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/pi-health-monitor
ENV_DIR=/etc/pi-health-monitor
SERVICE_FILE=/etc/systemd/system/pi-health-monitor-server.service
SERVICE_USER=pi-health-monitor
SOURCE_PATH=$(pwd)
SERVER_PORT=3000

usage() {
  echo "Usage: sudo $0 [--source DIRECTORY_OR_ARCHIVE] [--port PORT]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE_PATH=${2:-}; shift 2 ;;
    --port) SERVER_PORT=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      # Backward compatibility with the original positional source argument.
      if [[ $# -eq 1 && $1 != --* ]]; then SOURCE_PATH=$1; shift; else
        echo "Error: unknown argument: $1" >&2; usage; exit 1
      fi
      ;;
  esac
done

[[ $SERVER_PORT =~ ^[0-9]+$ ]] && (( SERVER_PORT >= 1 && SERVER_PORT <= 65535 )) ||
  { echo "Error: invalid port." >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  exec sudo -- "$0" --source "$SOURCE_PATH" --port "$SERVER_PORT"
fi

command -v node >/dev/null || { echo "Error: Node.js 20 or newer is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "Error: npm is required." >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' ||
  { echo "Error: Node.js 20 or newer is required." >&2; exit 1; }

SOURCE_PATH=$(realpath "$SOURCE_PATH")
STAGING_DIR=$(mktemp -d)
trap 'rm -rf "$STAGING_DIR"' EXIT

if [[ -f $SOURCE_PATH ]]; then
  echo "Extracting application archive..."
  tar -xf "$SOURCE_PATH" -C "$STAGING_DIR"
  SOURCE_PATH=$(find "$STAGING_DIR" -name package.json -not -path '*/node_modules/*' -printf '%h\n' | head -n1)
fi

[[ -f $SOURCE_PATH/package.json ]] ||
  { echo "Error: source must be a project directory or archive." >&2; exit 1; }

echo "Installing Pi Health Monitor from $SOURCE_PATH..."
id -u "$SERVICE_USER" >/dev/null 2>&1 ||
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$APP_DIR"
find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a "$SOURCE_PATH"/. "$APP_DIR"/
rm -rf "$APP_DIR/node_modules"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "Installing dependencies and building..."
runuser -u "$SERVICE_USER" -- bash -c "cd '$APP_DIR' && npm ci && npm run build && npm prune --omit=dev"

install -d -o root -g "$SERVICE_USER" -m 0750 "$ENV_DIR"
printf 'PORT=%s\nNODE_ENV=production\n' "$SERVER_PORT" > "$ENV_DIR/server.env"
chown root:"$SERVICE_USER" "$ENV_DIR/server.env"
chmod 0640 "$ENV_DIR/server.env"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Pi Health Monitor server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_DIR/server.env
ExecStart=$(command -v node) $APP_DIR/server/dist/index.js
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
systemctl enable --now pi-health-monitor-server.service
systemctl restart pi-health-monitor-server.service

HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
systemctl --no-pager --full status pi-health-monitor-server.service || true
echo
echo "Dashboard: http://${HOST_IP:-localhost}:$SERVER_PORT"
