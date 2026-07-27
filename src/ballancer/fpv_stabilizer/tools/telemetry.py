from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from fpv_stabilizer.config import load_config
from fpv_stabilizer.flight_controller.betaflight import BetaflightMspInterface


def main() -> None:
    parser = argparse.ArgumentParser(description="Read one Betaflight MSP telemetry snapshot")
    parser.add_argument("--config", type=Path, default=Path("config/config.yaml"))
    args = parser.parse_args()
    config = load_config(args.config)
    interface = BetaflightMspInterface(
        config.serial.port,
        config.serial.baudrate,
        config.serial.timeout_s,
    )
    try:
        interface.connect()
        state = interface.read_state()
        print(json.dumps(asdict(state), indent=2))
    finally:
        interface.disconnect()


if __name__ == "__main__":
    main()
