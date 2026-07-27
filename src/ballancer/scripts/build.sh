#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
VENV_DIR="$PROJECT_DIR/.venv"
WITH_CHECKS=false

usage() {
  cat <<EOF
Usage: $0 [--check]

Build the FPV ballancer Python environment on the Raspberry Pi.
  --check  Install development tools and run lint, type, and unit checks.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) WITH_CHECKS=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Error: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

command -v python3 >/dev/null ||
  { echo "Error: Python 3 is required." >&2; exit 1; }
python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 11))' ||
  { echo "Error: Python 3.11 or newer is required." >&2; exit 1; }

if [[ ! -x $VENV_DIR/bin/python ]]; then
  echo "Creating virtual environment in $VENV_DIR..."
  python3 -m venv "$VENV_DIR" ||
    {
      echo "Error: could not create the virtual environment." >&2
      echo "On Raspberry Pi OS, install it with: sudo apt install python3-venv" >&2
      exit 1
    }
fi

echo "Installing FPV ballancer..."
if [[ $WITH_CHECKS == true ]]; then
  "$VENV_DIR/bin/pip" install --disable-pip-version-check --upgrade -e "$PROJECT_DIR[dev]"
  "$VENV_DIR/bin/ruff" check "$PROJECT_DIR/fpv_stabilizer" "$PROJECT_DIR/tests"
  "$VENV_DIR/bin/mypy" "$PROJECT_DIR/fpv_stabilizer"
  "$VENV_DIR/bin/pytest" -q "$PROJECT_DIR/tests"
else
  "$VENV_DIR/bin/pip" install --disable-pip-version-check --upgrade -e "$PROJECT_DIR"
fi

"$VENV_DIR/bin/python" -m compileall -q "$PROJECT_DIR/fpv_stabilizer"
echo "Build complete: $VENV_DIR/bin/fpv-stabilizer"
