#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME=fpv-stabilizer.service
DASHBOARD_ENV=/etc/pi-health-agent/agent.env

if [[ $# -gt 0 ]]; then
  echo "Usage: $0" >&2
  echo "The installed service always starts in telemetry-only dry-run mode." >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  exec sudo -- "$0"
fi

command -v systemctl >/dev/null ||
  { echo "Error: systemd is required." >&2; exit 1; }
systemctl cat "$SERVICE_NAME" >/dev/null 2>&1 ||
  {
    echo "Error: $SERVICE_NAME is not installed." >&2
    echo "Run npm run install:pi first." >&2
    exit 1
  }

if systemctl is-active --quiet pi-health-agent.service; then
  if [[ ! -r $DASHBOARD_ENV ]] ||
    grep -qx 'FLIGHT_CONTROLLER_ENABLED=true' "$DASHBOARD_ENV"; then
    echo "Error: pi-health-agent is already using flight-controller telemetry." >&2
    echo "Two processes must not issue MSP requests on the same serial port." >&2
    echo "Disable flight-controller telemetry in the dashboard agent before starting." >&2
    exit 1
  fi
fi

echo "Starting FPV ballancer in dry-run mode..."
systemctl start "$SERVICE_NAME"
if systemctl is-active --quiet "$SERVICE_NAME"; then
  systemctl --no-pager --full status "$SERVICE_NAME"
else
  systemctl --no-pager --full status "$SERVICE_NAME" || true
  echo "Error: FPV ballancer did not remain active." >&2
  echo "Inspect logs with: sudo journalctl -u fpv-stabilizer -n 100" >&2
  exit 1
fi
