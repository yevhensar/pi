#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FLEET_FILE=
SERVER_URL=
SUCCEEDED=0

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-fleet.sh --fleet FILE --server-url URL

Fleet file format (CSV):
  ssh_host,device_id,ssh_port

Blank lines and lines beginning with # are ignored. ssh_port defaults to 22.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fleet) FLEET_FILE=${2:-}; shift 2 ;;
    --server-url) SERVER_URL=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -f $FLEET_FILE && -n $SERVER_URL ]] ||
  { echo "Error: --fleet FILE and --server-url URL are required." >&2; usage; exit 1; }

mapfile -t FLEET_LINES < <(sed -e 's/\r$//' -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "$FLEET_FILE")
(( ${#FLEET_LINES[@]} > 0 )) || { echo "Error: fleet file has no devices." >&2; exit 1; }

declare -A SEEN_IDS=()
for line in "${FLEET_LINES[@]}"; do
  IFS=',' read -r ssh_host device_id ssh_port extra <<< "$line"
  ssh_host=${ssh_host//[[:space:]]/}
  device_id=${device_id//[[:space:]]/}
  ssh_port=${ssh_port//[[:space:]]/}
  [[ -n $ssh_host && $device_id =~ ^[A-Za-z0-9._-]+$ && -z ${extra:-} ]] ||
    { echo "Error: invalid fleet row: $line" >&2; exit 1; }
  [[ -z ${SEEN_IDS[$device_id]+present} ]] ||
    { echo "Error: duplicate device ID: $device_id" >&2; exit 1; }
  SEEN_IDS[$device_id]=1
  [[ -z $ssh_port || $ssh_port =~ ^[0-9]+$ ]] ||
    { echo "Error: invalid SSH port for $device_id." >&2; exit 1; }
done

echo "Building the Pi client once for ${#FLEET_LINES[@]} devices..."
cd "$ROOT_DIR"
npm run build -w @pi-health/shared
npm run build -w @pi-health/agent

for line in "${FLEET_LINES[@]}"; do
  IFS=',' read -r ssh_host device_id ssh_port _ <<< "$line"
  ssh_host=${ssh_host//[[:space:]]/}
  device_id=${device_id//[[:space:]]/}
  ssh_port=${ssh_port//[[:space:]]/}
  ssh_port=${ssh_port:-22}

  echo
  echo "Deploying $device_id to $ssh_host..."
  "$ROOT_DIR/scripts/deploy-to-pi.sh" \
    --host "$ssh_host" \
    --server-url "$SERVER_URL" \
    --device-id "$device_id" \
    --ssh-port "$ssh_port" \
    --skip-build
  ((SUCCEEDED += 1))
done

echo
echo "Fleet deployment complete: $SUCCEEDED/${#FLEET_LINES[@]} clients installed."
