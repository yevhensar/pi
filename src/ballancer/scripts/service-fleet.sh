#!/usr/bin/env bash
set -Eeuo pipefail

ACTION=${1:-}
CONFIG_FILE=
CHECK_CONFIG=false
CONFIG_TMP=
SUCCEEDED=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/service-fleet.sh start|stop --config config/pi-fleet.json [--check-config]

Runs the installed local safety wrapper on each configured Pi over SSH.
EOF
}

[[ $ACTION == start || $ACTION == stop ]] ||
  { echo "Error: action must be start or stop." >&2; usage; exit 1; }
shift

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
  unset SSHPASS
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
      client_id: ($client.client_id // "")
    }
  ' "$CONFIG_FILE" > "$client_file"
  chmod 600 "$client_file"

  host=$(jq -r '.host' "$client_file")
  ssh_user=$(jq -r '.ssh_user' "$client_file")
  ssh_port=$(jq -r '.ssh_port' "$client_file")
  client_id=$(jq -r '.client_id' "$client_file")
  role=$(jq -r '.role' "$client_file")
  remote_host="$ssh_user@$host"

  [[ $role == client ]] ||
    { echo "Error: client $client_index role must be client." >&2; exit 1; }
  [[ $remote_host =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] ||
    { echo "Error: client $client_index has an invalid SSH target." >&2; exit 1; }
  [[ $ssh_port =~ ^[0-9]+$ ]] && (( ssh_port >= 1 && ssh_port <= 65535 )) ||
    { echo "Error: client $client_index has an invalid SSH port." >&2; exit 1; }
  [[ $client_id =~ ^[A-Za-z0-9._-]+$ ]] ||
    { echo "Error: client $client_index has an invalid client_id." >&2; exit 1; }
  [[ -z ${SEEN_IDS[$client_id]+present} ]] ||
    { echo "Error: duplicate client_id: $client_id" >&2; exit 1; }
  SEEN_IDS[$client_id]=1
  CLIENT_CONFIGS+=("$client_file")
done

echo "Fleet service action: $ACTION"
echo "Validated ${#CLIENT_CONFIGS[@]} unique clients from $CONFIG_FILE."
if [[ $CHECK_CONFIG == true ]]; then
  for client_file in "${CLIENT_CONFIGS[@]}"; do
    jq -r '"  \(.client_id): \(.ssh_user)@\(.host):\(.ssh_port)"' "$client_file"
  done
  exit 0
fi

for client_file in "${CLIENT_CONFIGS[@]}"; do
  host=$(jq -r '.host' "$client_file")
  ssh_user=$(jq -r '.ssh_user' "$client_file")
  ssh_password=$(jq -r '.ssh_password' "$client_file")
  sudo_password=$(jq -r '.sudo_password' "$client_file")
  ssh_port=$(jq -r '.ssh_port' "$client_file")
  client_id=$(jq -r '.client_id' "$client_file")
  remote_host="$ssh_user@$host"
  ssh_command=(ssh -p "$ssh_port")

  unset SSHPASS
  if [[ -n $ssh_password ]]; then
    if command -v sshpass >/dev/null; then
      export SSHPASS="$ssh_password"
      ssh_command=(sshpass -e ssh -p "$ssh_port")
    else
      echo "Warning: sshpass is missing; $client_id may prompt interactively." >&2
    fi
  fi

  echo
  echo "$ACTION $client_id on $remote_host..."
  remote_script="/opt/fpv-stabilizer/bin/${ACTION}-local.sh"
  if [[ -n $sudo_password ]]; then
    printf '%s\n' "$sudo_password" |
      "${ssh_command[@]}" -T "$remote_host" "sudo -S -p '' '$remote_script'"
  else
    "${ssh_command[@]}" -T "$remote_host" "sudo '$remote_script'"
  fi
  ((SUCCEEDED += 1))
done

echo
echo "Fleet $ACTION complete: $SUCCEEDED/${#CLIENT_CONFIGS[@]} clients."
