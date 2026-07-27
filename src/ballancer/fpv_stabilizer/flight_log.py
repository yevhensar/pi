from __future__ import annotations

import csv
from pathlib import Path
from typing import TextIO

from fpv_stabilizer.model import ControlCycle


class CsvFlightLogger:
    FIELDS = (
        "monotonic_time",
        "mode_reason",
        "assistance_enabled",
        "armed",
        "gps_fix",
        "gps_satellites",
        "telemetry_age_ms",
        "north_velocity_mps",
        "east_velocity_mps",
        "pilot_roll",
        "pilot_pitch",
        "pilot_yaw",
        "pilot_throttle",
        "correction_roll",
        "correction_pitch",
        "correction_yaw",
        "correction_throttle",
        "output_roll",
        "output_pitch",
        "output_yaw",
        "output_throttle",
        "loop_dt_ms",
        "execution_ms",
    )

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._file: TextIO = path.open("a", newline="", encoding="utf8")
        self._writer = csv.DictWriter(self._file, fieldnames=self.FIELDS)
        if path.stat().st_size == 0:
            self._writer.writeheader()

    def write(self, cycle: ControlCycle) -> None:
        velocity = cycle.state.velocity_ned_mps
        self._writer.writerow(
            {
                "monotonic_time": cycle.state.monotonic_time,
                "mode_reason": cycle.reason,
                "assistance_enabled": cycle.assistance_enabled,
                "armed": cycle.state.armed,
                "gps_fix": cycle.state.gps_fix,
                "gps_satellites": cycle.state.gps_satellites,
                "telemetry_age_ms": cycle.state.age_seconds() * 1000,
                "north_velocity_mps": velocity.x if velocity else "",
                "east_velocity_mps": velocity.y if velocity else "",
                "pilot_roll": cycle.pilot.roll,
                "pilot_pitch": cycle.pilot.pitch,
                "pilot_yaw": cycle.pilot.yaw,
                "pilot_throttle": cycle.pilot.throttle,
                "correction_roll": cycle.correction.roll,
                "correction_pitch": cycle.correction.pitch,
                "correction_yaw": cycle.correction.yaw,
                "correction_throttle": cycle.correction.throttle,
                "output_roll": cycle.output.roll,
                "output_pitch": cycle.output.pitch,
                "output_yaw": cycle.output.yaw,
                "output_throttle": cycle.output.throttle,
                "loop_dt_ms": cycle.loop_dt_s * 1000,
                "execution_ms": cycle.execution_ms,
            }
        )
        self._file.flush()

    def close(self) -> None:
        self._file.close()
