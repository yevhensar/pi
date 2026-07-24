#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CONFIG_FILE=
CHECK_CONFIG=false
MESSAGE_TOKEN_FILE="$ROOT_DIR/config/message-token.json"

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
echo "Installing the local server (sudo may prompt)..."
exec "$ROOT_DIR/scripts/install-server.sh" \
  --source "$ROOT_DIR" \
  --port "$SERVER_PORT" \
  --message-token-file "$MESSAGE_TOKEN_FILE"
