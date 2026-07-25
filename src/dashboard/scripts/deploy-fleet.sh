#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CONFIG_FILE=
SERVER_URL=
CHECK_CONFIG=false
SUCCEEDED=0
CONFIG_TMP=
MESSAGE_TOKEN_FILE="$ROOT_DIR/config/message-token.json"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-fleet.sh --config config/pi-fleet.json [--server-url URL]

Options:
  --config FILE     JSON object with a clients array
  --server-url URL  Override the shared JSON server_url
  --check-config    Validate every client without connecting or deploying

JSON supports shared defaults at the root and per-client overrides:
  {"server_url":"http://server:3000","clients":[{...},{...}]}
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG_FILE=${2:-}; shift 2 ;;
    --server-url) SERVER_URL=${2:-}; shift 2 ;;
    --check-config) CHECK_CONFIG=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n $CONFIG_FILE ]] ||
  { echo "Error: --config FILE is required." >&2; usage; exit 1; }

cleanup() {
  [[ -z ${CONFIG_TMP:-} ]] || rm -rf "$CONFIG_TMP"
}
trap cleanup EXIT

declare -a CLIENT_CONFIGS=()
declare -A SEEN_IDS=()

command -v jq >/dev/null || { echo "Error: jq is required for JSON configuration." >&2; exit 1; }
[[ -r $CONFIG_FILE ]] || { echo "Error: cannot read config: $CONFIG_FILE" >&2; exit 1; }
jq -e '
  type == "object" and
  (.clients | type == "array" and length > 0) and
  all(.clients[]; type == "object")
' "$CONFIG_FILE" >/dev/null ||
  { echo "Error: JSON config requires a non-empty clients array." >&2; exit 1; }

JSON_SERVER_URL=$(jq -r '.server_url // empty' "$CONFIG_FILE")
SERVER_URL=${SERVER_URL:-$JSON_SERVER_URL}
[[ -n $SERVER_URL ]] ||
  { echo "Error: server_url is required in JSON or via --server-url." >&2; exit 1; }

if [[ $CHECK_CONFIG == true && ! -f $MESSAGE_TOKEN_FILE ]]; then
  echo "Message encryption: token will be initialized during deployment."
else
  node "$ROOT_DIR/scripts/message-token.mjs" --file "$MESSAGE_TOKEN_FILE" --init --quiet
  echo "Message encryption: shared token loaded."
fi

CONFIG_TMP=$(mktemp -d)
CLIENT_COUNT=$(jq '.clients | length' "$CONFIG_FILE")
for ((client_index = 0; client_index < CLIENT_COUNT; client_index++)); do
  client_file="$CONFIG_TMP/client-$client_index.json"
  jq --arg server_url "$SERVER_URL" '
    . as $root |
    .clients['"$client_index"'] as $client |
    {
      host: ($client.host // $root.host // ""),
      ssh_user: ($client.ssh_user // $root.ssh_user // ""),
      ssh_password: ($client.ssh_password // $root.ssh_password // ""),
      sudo_password: ($client.sudo_password // $root.sudo_password // ""),
      ssh_port: ($client.ssh_port // $root.ssh_port // 22),
      role: ($client.role // "client"),
      client_id: ($client.client_id // ""),
      wifi_interface: ($client.wifi_interface // $root.wifi_interface // ""),
      flight_controller: ($client.flight_controller // $root.flight_controller // {
        enabled: true,
        device: "auto",
        protocol: "auto",
        baud: 115200,
        motor_test: {
          enabled: false,
          output: 1050,
          duration_ms: 2000
        }
      }),
      object_detection: ($client.object_detection // $root.object_detection // {
        enabled: false,
        interval_ms: 1000,
        object_type: "car"
      }),
      server_url: ($client.server_url // $server_url)
    }
  ' "$CONFIG_FILE" > "$client_file"
  chmod 600 "$client_file"

  client_id=$(jq -r '.client_id // empty' "$client_file")
  [[ $client_id =~ ^[A-Za-z0-9._-]+$ ]] ||
    { echo "Error: client $client_index has an invalid client_id." >&2; exit 1; }
  [[ -z ${SEEN_IDS[$client_id]+present} ]] ||
    { echo "Error: duplicate client_id: $client_id" >&2; exit 1; }
  SEEN_IDS[$client_id]=1
  CLIENT_CONFIGS+=("$client_file")
done

echo "Validating ${#CLIENT_CONFIGS[@]} Pi client configurations..."
for client_file in "${CLIENT_CONFIGS[@]}"; do
  "$ROOT_DIR/scripts/deploy-to-pi.sh" --config "$client_file" --check-config
done

if [[ $CHECK_CONFIG == true ]]; then
  echo "Fleet configuration is valid: ${#CLIENT_CONFIGS[@]} unique clients."
  exit 0
fi

echo "Building the Pi client once for ${#CLIENT_CONFIGS[@]} devices..."
cd "$ROOT_DIR"
npm run build -w @pi-health/shared
npm run build -w @pi-health/agent

for client_file in "${CLIENT_CONFIGS[@]}"; do
  client_id=$(jq -r '.client_id' "$client_file")
  ssh_host=$(jq -r '"\(.ssh_user)@\(.host)"' "$client_file")
  echo
  echo "Deploying $client_id to $ssh_host..."
  "$ROOT_DIR/scripts/deploy-to-pi.sh" --config "$client_file" --skip-build
  ((SUCCEEDED += 1))
done

echo
echo "Fleet deployment complete: $SUCCEEDED/${#CLIENT_CONFIGS[@]} clients installed."
