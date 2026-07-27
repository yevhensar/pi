#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME=fpv-stabilizer.service

if [[ $# -gt 0 ]]; then
  echo "Usage: $0" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  exec sudo -- "$0"
fi

command -v systemctl >/dev/null ||
  { echo "Error: systemd is required." >&2; exit 1; }
systemctl cat "$SERVICE_NAME" >/dev/null 2>&1 ||
  { echo "Error: $SERVICE_NAME is not installed." >&2; exit 1; }

if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "Stopping FPV ballancer..."
  systemctl stop "$SERVICE_NAME"
fi

if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "Error: FPV ballancer is still active." >&2
  exit 1
fi
echo "FPV ballancer is stopped."
