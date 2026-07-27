#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP_DIR=/opt/fpv-stabilizer
CONFIG_DIR=/etc/fpv-stabilizer
LOG_DIR=/var/log/fpv-stabilizer
SERVICE_FILE=/etc/systemd/system/fpv-stabilizer.service
SERVICE_USER=fpv-stabilizer
REPLACE_CONFIG=false
FLIGHT_CONTROLLER_DEVICE=auto
FLIGHT_CONTROLLER_BAUD=115200

usage() {
  cat <<EOF
Usage: sudo $0 [options]

Install or upgrade the FPV ballancer systemd service.
  --replace-config            Replace the deployed configuration.
  --flight-controller-device  Serial device or auto (default: auto).
  --flight-controller-baud    Serial baud rate (default: 115200).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --replace-config) REPLACE_CONFIG=true; shift ;;
    --flight-controller-device) FLIGHT_CONTROLLER_DEVICE=${2:-}; shift 2 ;;
    --flight-controller-baud) FLIGHT_CONTROLLER_BAUD=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  arguments=("$0")
  [[ $REPLACE_CONFIG == false ]] || arguments+=(--replace-config)
  arguments+=(
    --flight-controller-device "$FLIGHT_CONTROLLER_DEVICE"
    --flight-controller-baud "$FLIGHT_CONTROLLER_BAUD"
  )
  exec sudo -- "${arguments[@]}"
fi

command -v python3 >/dev/null || { echo "Python 3 is required." >&2; exit 1; }
python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 11))' ||
  { echo "Python 3.11 or newer is required." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_DEVICE == auto ||
   $FLIGHT_CONTROLLER_DEVICE =~ ^/dev/[A-Za-z0-9._/-]+$ ]] ||
  { echo "Invalid flight-controller device." >&2; exit 1; }
[[ $FLIGHT_CONTROLLER_BAUD =~ ^[0-9]+$ ]] &&
  (( FLIGHT_CONTROLLER_BAUD >= 1200 && FLIGHT_CONTROLLER_BAUD <= 4000000 )) ||
  { echo "Invalid flight-controller baud rate." >&2; exit 1; }
id -u "$SERVICE_USER" >/dev/null 2>&1 ||
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
usermod -a -G dialout "$SERVICE_USER"
install -d -o root -g root -m 0755 "$APP_DIR"
install -d -o root -g root -m 0755 "$APP_DIR/bin"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$LOG_DIR"
install -d -o root -g "$SERVICE_USER" -m 0750 "$CONFIG_DIR"
if [[ ! -x $APP_DIR/.venv/bin/python ]]; then
  python3 -m venv "$APP_DIR/.venv"
fi
"$APP_DIR/.venv/bin/pip" install --no-cache-dir --upgrade "$SOURCE_DIR"
install -o root -g root -m 0755 \
  "$SOURCE_DIR/scripts/start-local.sh" "$APP_DIR/bin/start-local.sh"
install -o root -g root -m 0755 \
  "$SOURCE_DIR/scripts/stop-local.sh" "$APP_DIR/bin/stop-local.sh"
if [[ ! -e $CONFIG_DIR/config.yaml || $REPLACE_CONFIG == true ]]; then
  install -o root -g "$SERVICE_USER" -m 0640 \
    "$SOURCE_DIR/config/config.yaml" "$CONFIG_DIR/config.yaml"
  sed -i "s#var/flight.csv#$LOG_DIR/flight.csv#" "$CONFIG_DIR/config.yaml"
  sed -i "s#^  port:.*#  port: $FLIGHT_CONTROLLER_DEVICE#" "$CONFIG_DIR/config.yaml"
  sed -i "s#^  baudrate:.*#  baudrate: $FLIGHT_CONTROLLER_BAUD#" "$CONFIG_DIR/config.yaml"
else
  echo "Preserving existing configuration: $CONFIG_DIR/config.yaml"
fi
install -o root -g root -m 0644 \
  "$SOURCE_DIR/systemd/fpv-stabilizer.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl disable fpv-stabilizer.service >/dev/null 2>&1 || true
echo "Installed in dry-run mode. Start only after completing the README safety checklist:"
echo "  npm start"
