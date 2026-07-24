#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE_HOST=
SERVER_URL=
DEVICE_ID=
SSH_PORT=22
SKIP_BUILD=false
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LOCAL_TMP=
REMOTE_TMP=

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-to-pi.sh --host USER@HOST --server-url URL --device-id ID [--ssh-port PORT] [--skip-build]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) REMOTE_HOST=${2:-}; shift 2 ;;
    --server-url) SERVER_URL=${2:-}; shift 2 ;;
    --device-id) DEVICE_ID=${2:-}; shift 2 ;;
    --ssh-port) SSH_PORT=${2:-}; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n $REMOTE_HOST && -n $SERVER_URL && -n $DEVICE_ID ]] ||
  { echo "Error: --host, --server-url, and --device-id are required." >&2; usage; exit 1; }
[[ $SERVER_URL =~ ^https?://[A-Za-z0-9._:\[\]-]+(/[^[:space:]\'\"]*)?$ ]] ||
  { echo "Error: invalid server URL." >&2; exit 1; }
[[ $SSH_PORT =~ ^[0-9]+$ ]] && (( SSH_PORT >= 1 && SSH_PORT <= 65535 )) ||
  { echo "Error: invalid SSH port." >&2; exit 1; }
[[ $DEVICE_ID =~ ^[A-Za-z0-9._-]+$ ]] ||
  { echo "Error: invalid device ID." >&2; exit 1; }

cleanup() {
  [[ -z ${LOCAL_TMP:-} ]] || rm -rf "$LOCAL_TMP"
  if [[ -n ${REMOTE_TMP:-} ]]; then
    ssh -p "$SSH_PORT" "$REMOTE_HOST" "rm -rf '$REMOTE_TMP'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR"
if [[ $SKIP_BUILD == false ]]; then
  echo "[1/5] Building agent..."
  npm run build -w @pi-health/shared
  npm run build -w @pi-health/agent
else
  echo "[1/5] Using existing agent build..."
  [[ -f agent/dist/index.js ]] ||
    { echo "Error: agent build missing; run without --skip-build first." >&2; exit 1; }
fi

echo "[2/5] Preparing deployment archive..."
LOCAL_TMP=$(mktemp -d)
mkdir -p "$LOCAL_TMP/bundle/agent" "$LOCAL_TMP/bundle/scripts"
cp -a agent/dist "$LOCAL_TMP/bundle/agent/dist"
cp agent/package.production.json "$LOCAL_TMP/bundle/agent/package.json"
cp package-lock.json "$LOCAL_TMP/bundle/package-lock.json"
cp scripts/install-pi.sh "$LOCAL_TMP/bundle/scripts/install-pi.sh"
cp -a node_modules "$LOCAL_TMP/bundle/node_modules"
tar -czf "$LOCAL_TMP/pi-health-agent.tar.gz" -C "$LOCAL_TMP/bundle" .

echo "[3/5] Creating remote workspace..."
REMOTE_TMP=$(ssh -p "$SSH_PORT" "$REMOTE_HOST" 'mktemp -d /tmp/pi-health-deploy.XXXXXX')
[[ $REMOTE_TMP =~ ^/tmp/pi-health-deploy\.[A-Za-z0-9]+$ ]] ||
  { echo "Error: remote host returned an invalid temporary path." >&2; exit 1; }

echo "[4/5] Uploading agent..."
scp -P "$SSH_PORT" "$LOCAL_TMP/pi-health-agent.tar.gz" "$REMOTE_HOST:$REMOTE_TMP/"

echo "[5/5] Installing service..."
ssh -t -p "$SSH_PORT" "$REMOTE_HOST" \
  "tar -xzf '$REMOTE_TMP/pi-health-agent.tar.gz' -C '$REMOTE_TMP' && sudo '$REMOTE_TMP/scripts/install-pi.sh' --server-url '$SERVER_URL' --device-id '$DEVICE_ID' --source-dir '$REMOTE_TMP'"

echo "Deployment complete: $DEVICE_ID → $SERVER_URL"
