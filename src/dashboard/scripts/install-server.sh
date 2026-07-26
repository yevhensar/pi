#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/pi-health-monitor
ENV_DIR=/etc/pi-health-monitor
SERVICE_FILE=/etc/systemd/system/pi-health-monitor-server.service
DETECTOR_SERVICE_FILE=/etc/systemd/system/pi-object-detector-api.service
MEDIAMTX_SERVICE_FILE=/etc/systemd/system/pi-mediamtx.service
MEDIAMTX_CONFIG_FILE=/etc/pi-health-monitor/mediamtx.yml
MEDIAMTX_VERSION=1.18.2
SERVICE_USER=pi-health-monitor
SOURCE_PATH=$(pwd)
SERVER_PORT=3000
MESSAGE_TOKEN_FILE=
MESSAGE_TOKEN=
MEDIA_KEY_FILE=
MEDIA_CERT_FILE=

usage() {
  echo "Usage: sudo $0 [--source DIRECTORY_OR_ARCHIVE] [--port PORT] --message-token-file FILE"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE_PATH=${2:-}; shift 2 ;;
    --port) SERVER_PORT=${2:-}; shift 2 ;;
    --message-token-file) MESSAGE_TOKEN_FILE=${2:-}; shift 2 ;;
    --media-key-file) MEDIA_KEY_FILE=${2:-}; shift 2 ;;
    --media-cert-file) MEDIA_CERT_FILE=${2:-}; shift 2 ;;
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
[[ -r $MESSAGE_TOKEN_FILE ]] ||
  { echo "Error: --message-token-file must name a readable file." >&2; exit 1; }
command -v jq >/dev/null || { echo "Error: jq is required." >&2; exit 1; }
MESSAGE_TOKEN=$(jq -r '.token // empty' "$MESSAGE_TOKEN_FILE")
[[ $MESSAGE_TOKEN =~ ^[A-Za-z0-9_-]{43}$ ]] ||
  { echo "Error: invalid message token." >&2; exit 1; }
[[ -r $MEDIA_KEY_FILE && -r $MEDIA_CERT_FILE ]] ||
  { echo "Error: readable MediaMTX key and certificate files are required." >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  exec sudo -- "$0" \
    --source "$SOURCE_PATH" \
    --port "$SERVER_PORT" \
    --message-token-file "$MESSAGE_TOKEN_FILE" \
    --media-key-file "$MEDIA_KEY_FILE" \
    --media-cert-file "$MEDIA_CERT_FILE"
fi

command -v node >/dev/null || { echo "Error: Node.js 20 or newer is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "Error: npm is required." >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' ||
  { echo "Error: Node.js 20 or newer is required." >&2; exit 1; }
command -v curl >/dev/null || {
  apt-get update
  apt-get install -y ca-certificates curl
}
command -v openssl >/dev/null || {
  apt-get update
  apt-get install -y openssl
}

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
OBJECT_DETECTOR_SOURCE=$(realpath "$SOURCE_PATH/../objectDetector")
[[ -f $OBJECT_DETECTOR_SOURCE/pyproject.toml &&
   -f $OBJECT_DETECTOR_SOURCE/outputs/fasterrcnn/checkpoints/last.ckpt ]] ||
  { echo "Error: objectDetector source or trained checkpoint is missing." >&2; exit 1; }

echo "Installing Pi Health Monitor from $SOURCE_PATH..."
id -u "$SERVICE_USER" >/dev/null 2>&1 ||
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$APP_DIR"
find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name detector-venv -exec rm -rf -- {} +
cp -a "$SOURCE_PATH"/. "$APP_DIR"/
install -d "$APP_DIR/object-detector/model"
cp -a "$OBJECT_DETECTOR_SOURCE/src" "$APP_DIR/object-detector/src"
cp "$OBJECT_DETECTOR_SOURCE/pyproject.toml" "$APP_DIR/object-detector/pyproject.toml"
cp "$OBJECT_DETECTOR_SOURCE/outputs/fasterrcnn/checkpoints/last.ckpt" \
  "$APP_DIR/object-detector/model/last.ckpt"
rm -rf "$APP_DIR/node_modules"
rm -rf "$APP_DIR/.git"
if [[ -d $APP_DIR/config ]]; then
  find "$APP_DIR/config" -maxdepth 1 -type f -name '*.json' ! -name '*.example.json' -delete
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "Installing dependencies and building..."
runuser -u "$SERVICE_USER" -- bash -c "cd '$APP_DIR' && npm ci && npm run build && npm prune --omit=dev"

echo "Installing Ubuntu object-detector API..."
if [[ ! -x $APP_DIR/detector-venv/bin/python ]]; then
  apt-get update
  apt-get install -y python3 python3-venv
  runuser -u "$SERVICE_USER" -- python3 -m venv "$APP_DIR/detector-venv"
fi
runuser -u "$SERVICE_USER" -- "$APP_DIR/detector-venv/bin/pip" install --no-cache-dir \
  --index-url https://download.pytorch.org/whl/cpu \
  "torch==2.12.0+cpu" "torchvision==0.27.0+cpu"
runuser -u "$SERVICE_USER" -- "$APP_DIR/detector-venv/bin/pip" install --no-cache-dir \
  "$APP_DIR/object-detector[api]"

echo "Installing MediaMTX WebRTC gateway..."
case "$(dpkg --print-architecture)" in
  amd64) MEDIAMTX_ARCH=amd64 ;;
  arm64) MEDIAMTX_ARCH=arm64 ;;
  armhf) MEDIAMTX_ARCH=armv7 ;;
  *) echo "Error: unsupported MediaMTX architecture." >&2; exit 1 ;;
esac
MEDIAMTX_ARCHIVE="mediamtx_v${MEDIAMTX_VERSION}_linux_${MEDIAMTX_ARCH}.tar.gz"
curl --fail --location --retry 3 \
  "https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}/${MEDIAMTX_ARCHIVE}" \
  --output "$STAGING_DIR/$MEDIAMTX_ARCHIVE"
curl --fail --location --retry 3 \
  "https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}/checksums.sha256" \
  --output "$STAGING_DIR/checksums.sha256"
(
  cd "$STAGING_DIR"
  grep "[ *]${MEDIAMTX_ARCHIVE}\$" checksums.sha256 | sha256sum --check
)
tar -xzf "$STAGING_DIR/$MEDIAMTX_ARCHIVE" -C "$STAGING_DIR" mediamtx
install -o root -g root -m 0755 "$STAGING_DIR/mediamtx" /usr/local/bin/mediamtx

install -d -o root -g "$SERVICE_USER" -m 0750 "$ENV_DIR"
{
  printf 'PORT=%s\n' "$SERVER_PORT"
  printf 'NODE_ENV=production\n'
  printf 'MESSAGE_TOKEN=%s\n' "$MESSAGE_TOKEN"
  printf 'OBJECT_DETECTION_API_URL=http://127.0.0.1:8000/api/detect\n'
} > "$ENV_DIR/server.env"
chown root:"$SERVICE_USER" "$ENV_DIR/server.env"
chmod 0640 "$ENV_DIR/server.env"

HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
MEDIA_TLS_KEY="$ENV_DIR/media-server.key"
MEDIA_TLS_CERT="$ENV_DIR/media-server.crt"
install -o root -g "$SERVICE_USER" -m 0640 "$MEDIA_KEY_FILE" "$MEDIA_TLS_KEY"
install -o root -g "$SERVICE_USER" -m 0644 "$MEDIA_CERT_FILE" "$MEDIA_TLS_CERT"
chown root:"$SERVICE_USER" "$MEDIA_TLS_KEY" "$MEDIA_TLS_CERT"
chmod 0640 "$MEDIA_TLS_KEY"
chmod 0644 "$MEDIA_TLS_CERT"
cat > "$MEDIAMTX_CONFIG_FILE" <<EOF
logLevel: info
authMethod: http
authHTTPAddress: http://127.0.0.1:$SERVER_PORT/api/media/auth
authHTTPExclude: []
rtsp: true
rtspTransports: [tcp]
rtspEncryption: strict
rtspsAddress: :8322
rtspServerKey: $MEDIA_TLS_KEY
rtspServerCert: $MEDIA_TLS_CERT
rtmp: false
hls: false
srt: false
webrtc: true
webrtcAddress: :8889
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :8189
webrtcAdditionalHosts: [${HOST_IP:-127.0.0.1}]
api: false
metrics: false
playback: false
paths:
  all_others:
EOF
chown root:"$SERVICE_USER" "$MEDIAMTX_CONFIG_FILE"
chmod 0640 "$MEDIAMTX_CONFIG_FILE"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Pi Health Monitor server
After=network-online.target pi-object-detector-api.service pi-mediamtx.service
Wants=network-online.target pi-object-detector-api.service pi-mediamtx.service

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

cat > "$MEDIAMTX_SERVICE_FILE" <<EOF
[Unit]
Description=Pi camera MediaMTX WebRTC gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
ExecStart=/usr/local/bin/mediamtx $MEDIAMTX_CONFIG_FILE
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

cat > "$DETECTOR_SERVICE_FILE" <<EOF
[Unit]
Description=Pi object-detector API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR/object-detector
Environment=MODEL_PATH=$APP_DIR/object-detector/model/last.ckpt
Environment=DEVICE=cpu
Environment=CLASS_NAMES=car
Environment=CONFIDENCE=0.25
Environment=SLICE_SIZE=800
Environment=SLICE_OVERLAP=0.2
Environment=MPLCONFIGDIR=/tmp/matplotlib
ExecStart=$APP_DIR/detector-venv/bin/uvicorn object_detector.api.app:app --host 127.0.0.1 --port 8000
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
systemctl enable --now pi-object-detector-api.service
systemctl restart pi-object-detector-api.service
systemctl enable --now pi-mediamtx.service
systemctl restart pi-mediamtx.service
systemctl enable --now pi-health-monitor-server.service
systemctl restart pi-health-monitor-server.service

echo
systemctl --no-pager --full status pi-health-monitor-server.service || true
echo
echo "Dashboard: http://${HOST_IP:-localhost}:$SERVER_PORT"
echo "Authenticated WebRTC gateway: http://${HOST_IP:-localhost}:8889"
