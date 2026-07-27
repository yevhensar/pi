#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CONFIG_FILE=
CHECK_CONFIG=false
SUCCEEDED=0
CONFIG_TMP=

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-fleet.sh --config config/pi-fleet.json [--check-config]

The JSON format matches dashboard/config/pi-fleet.json. Shared root values are
merged with each object in clients. Optional balancer settings:
  "ballancer": {"replace_config": false}
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

[[ -n $CONFIG_FILE && -r $CONFIG_FILE ]] ||
  { echo "Error: a readable --config FILE is required." >&2; exit 1; }
command -v jq >/dev/null ||
  { echo "Error: jq is required for JSON configuration." >&2; exit 1; }
jq -e '
  type == "object" and
  (.clients | type == "array" and length > 0) and
  all(.clients[]; type == "object")
' "$CONFIG_FILE" >/dev/null ||
  { echo "Error: JSON config requires a non-empty clients array." >&2; exit 1; }

cleanup() {
  [[ -z ${CONFIG_TMP:-} ]] || rm -rf "$CONFIG_TMP"
}
trap cleanup EXIT

CONFIG_TMP=$(mktemp -d)
declare -a CLIENT_CONFIGS=()
declare -A SEEN_IDS=()
CLIENT_COUNT=$(jq '.clients | length' "$CONFIG_FILE")

for ((client_index = 0; client_index < CLIENT_COUNT; client_index++)); do
  client_file="$CONFIG_TMP/client-$client_index.json"
  jq '
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
      flight_controller: ($client.flight_controller // $root.flight_controller // {
        enabled: true,
        device: "auto",
        protocol: "auto",
        baud: 115200
      }),
      ballancer: ($client.ballancer // $root.ballancer // {
        replace_config: false
      })
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

echo "Validating ${#CLIENT_CONFIGS[@]} ballancer client configurations..."
for client_file in "${CLIENT_CONFIGS[@]}"; do
  "$ROOT_DIR/scripts/deploy-to-pi.sh" --config "$client_file" --check-config
done

if [[ $CHECK_CONFIG == true ]]; then
  echo "Fleet configuration is valid: ${#CLIENT_CONFIGS[@]} unique clients."
  exit 0
fi

echo "Building the ballancer once for ${#CLIENT_CONFIGS[@]} devices..."
(cd "$ROOT_DIR" && npm run build:check)

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
