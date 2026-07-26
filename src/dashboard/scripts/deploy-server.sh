#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CONFIG_FILE=
CHECK_CONFIG=false
MESSAGE_TOKEN_FILE="$ROOT_DIR/config/message-token.json"
MEDIA_TLS_KEY_FILE="$ROOT_DIR/config/media-server.key"
MEDIA_TLS_CERT_FILE="$ROOT_DIR/config/media-server.crt"

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-server.sh --config config/server.json [--check-config]

Installs the server on this Ubuntu machine. The JSON object requires role
"server" and may set port (default: 3000).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_FILE=${2:-}; shift 2 ;;
    --check-config) CHECK_CONFIG=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

command -v jq >/dev/null || { echo "Error: jq is required." >&2; exit 1; }
[[ -r $CONFIG_FILE ]] || { echo "Error: --config must name a readable JSON file." >&2; exit 1; }
jq -e 'type == "object"' "$CONFIG_FILE" >/dev/null ||
  { echo "Error: server config must contain one JSON object." >&2; exit 1; }

ROLE=$(jq -r '.role // empty' "$CONFIG_FILE")
SERVER_PORT=$(jq -r '.port // 3000' "$CONFIG_FILE")
MEDIA_HOST=$(jq -r '.media_host // empty' "$CONFIG_FILE")
[[ $ROLE == server ]] || { echo "Error: role must be \"server\"." >&2; exit 1; }
[[ $SERVER_PORT =~ ^[0-9]+$ ]] && (( SERVER_PORT >= 1 && SERVER_PORT <= 65535 )) ||
  { echo "Error: invalid dashboard port." >&2; exit 1; }

echo "Server configuration is valid."
echo "Install target: this Ubuntu machine"
echo "Dashboard port: $SERVER_PORT"
if [[ $CHECK_CONFIG == true ]]; then
  exit 0
fi

node "$ROOT_DIR/scripts/message-token.mjs" --file "$MESSAGE_TOKEN_FILE" --init
command -v openssl >/dev/null || { echo "Error: openssl is required." >&2; exit 1; }
if [[ -z $MEDIA_HOST ]]; then
  MEDIA_HOST=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
[[ $MEDIA_HOST =~ ^[A-Za-z0-9.-]+$ ]] ||
  { echo "Error: media_host must be an IP address or DNS hostname." >&2; exit 1; }
if [[ ! -s $MEDIA_TLS_KEY_FILE || ! -s $MEDIA_TLS_CERT_FILE ]]; then
  echo "Generating the local MediaMTX TLS identity..."
  if [[ $MEDIA_HOST =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    MEDIA_SAN="IP:$MEDIA_HOST"
  else
    MEDIA_SAN="DNS:$MEDIA_HOST"
  fi
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
    -keyout "$MEDIA_TLS_KEY_FILE" \
    -out "$MEDIA_TLS_CERT_FILE" \
    -subj "/CN=$MEDIA_HOST" \
    -addext "subjectAltName=$MEDIA_SAN"
  chmod 0600 "$MEDIA_TLS_KEY_FILE"
  chmod 0644 "$MEDIA_TLS_CERT_FILE"
fi
echo "Installing the local server (sudo may prompt)..."
exec "$ROOT_DIR/scripts/install-server.sh" \
  --source "$ROOT_DIR" \
  --port "$SERVER_PORT" \
  --message-token-file "$MESSAGE_TOKEN_FILE" \
  --media-key-file "$MEDIA_TLS_KEY_FILE" \
  --media-cert-file "$MEDIA_TLS_CERT_FILE"
