#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
exec "$ROOT_DIR/scripts/service-fleet.sh" stop \
  --config "$ROOT_DIR/config/pi-fleet.json" "$@"
