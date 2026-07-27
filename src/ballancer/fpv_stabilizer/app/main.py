from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path

from fpv_stabilizer.config import AppConfig, load_config
from fpv_stabilizer.flight_controller.base import FlightControllerInterface
from fpv_stabilizer.flight_controller.betaflight import BetaflightMspInterface
from fpv_stabilizer.flight_log import CsvFlightLogger
from fpv_stabilizer.model import ControlCycle
from fpv_stabilizer.simulation import SCENARIOS, SimulatedFlightController
from fpv_stabilizer.stabilizer import Stabilizer


def _display(cycle: ControlCycle, output_enabled: bool) -> None:
    velocity = cycle.state.velocity_ned_mps
    print(
        "\033[2J\033[H"
        f"MODE: {'ASSIST' if cycle.assistance_enabled else 'PASSIVE'} ({cycle.reason})\n"
        f"ARMED: {'YES' if cycle.state.armed else 'NO'}  OUTPUT: "
        f"{'BENCH' if output_enabled else 'DRY RUN'}\n\n"
        f"RC       roll {cycle.pilot.roll:+.3f}  pitch {cycle.pilot.pitch:+.3f}  "
        f"yaw {cycle.pilot.yaw:+.3f}  throttle {cycle.pilot.throttle:.3f}\n"
        f"VELOCITY north {velocity.x if velocity else 0:+.2f} m/s  "
        f"east {velocity.y if velocity else 0:+.2f} m/s\n"
        f"CORRECT  roll {cycle.correction.roll:+.3f}  "
        f"pitch {cycle.correction.pitch:+.3f}\n"
        f"OUTPUT   roll {cycle.output.roll:+.3f}  pitch {cycle.output.pitch:+.3f}\n"
        f"TELEMETRY AGE {cycle.state.age_seconds() * 1000:.1f} ms\n"
        f"LOOP DT {cycle.loop_dt_s * 1000:.1f} ms  EXEC {cycle.execution_ms:.2f} ms",
        flush=True,
    )


def _real_interface(config: AppConfig, bench_output: bool) -> BetaflightMspInterface:
    if bench_output and not config.allow_disarmed_output:
        raise ValueError("Bench output also requires output.allow_disarmed_output: true")
    return BetaflightMspInterface(
        config.serial.port,
        config.serial.baudrate,
        config.serial.timeout_s,
        allow_disarmed_output=bench_output,
        command_timeout_s=config.command_timeout_s,
    )


def run(
    config: AppConfig,
    interface: FlightControllerInterface,
    *,
    output_enabled: bool,
    cycles: int | None = None,
) -> int:
    stabilizer = Stabilizer(config)
    logger = CsvFlightLogger(config.log_path)
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    period = 1.0 / config.loop_hz
    previous = time.monotonic()
    deadline = previous
    completed = 0
    try:
        interface.connect()
        while not stopping and (cycles is None or completed < cycles):
            started = time.monotonic()
            dt_s = max(1e-6, started - previous)
            previous = started
            try:
                state = interface.read_state()
                pilot = interface.read_rc_input()
                cycle = stabilizer.compute(state, pilot, dt_s, started)
                if output_enabled:
                    command_age_s = time.monotonic() - started
                    if command_age_s > config.command_timeout_s:
                        raise TimeoutError(
                            f"command deadline exceeded ({command_age_s * 1000:.1f} ms)"
                        )
                    interface.send_control_command(cycle.output)
                logger.write(cycle)
                if completed % max(1, round(config.loop_hz / 2)) == 0:
                    _display(cycle, output_enabled)
            except Exception as error:  # noqa: BLE001 - every cycle must fail passive
                # Fail passive: never reuse or resend a previous command.
                print(f"control cycle disabled: {error}", file=sys.stderr)
                if output_enabled:
                    return 2
            completed += 1
            deadline += period
            delay = deadline - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            elif -delay > period * 2:
                deadline = time.monotonic()
        return 0
    finally:
        logger.close()
        interface.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser(description="Safety-first Betaflight companion stabilizer")
    parser.add_argument("--config", type=Path, default=Path("config/config.yaml"))
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--simulation", choices=(*SCENARIOS, "gps_loss", "telemetry_loss", "pilot_override"))
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--bench-output", action="store_true")
    parser.add_argument("--cycles", type=int)
    args = parser.parse_args()
    config = load_config(args.config)
    interface: FlightControllerInterface = (
        SimulatedFlightController(args.simulation)
        if args.simulation
        else _real_interface(config, args.bench_output)
    )
    raise SystemExit(
        run(
            config,
            interface,
            output_enabled=bool(args.bench_output),
            cycles=args.cycles,
        )
    )


if __name__ == "__main__":
    main()
