from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from fpv_stabilizer.control.pid import PidConfig
from fpv_stabilizer.model import FlightMode
from fpv_stabilizer.safety.guard import SafetyConfig


@dataclass(frozen=True, slots=True)
class SerialConfig:
    port: str
    baudrate: int
    timeout_s: float


@dataclass(frozen=True, slots=True)
class AppConfig:
    serial: SerialConfig
    loop_hz: float
    command_timeout_s: float
    mode: FlightMode
    north_pid: PidConfig
    east_pid: PidConfig
    safety: SafetyConfig
    override_full_below: float
    override_zero_above: float
    allow_disarmed_output: bool
    log_path: Path


def _pid(value: dict[str, Any]) -> PidConfig:
    return PidConfig(
        kp=float(value["kp"]),
        ki=float(value["ki"]),
        kd=float(value["kd"]),
        output_min=float(value["output_min"]),
        output_max=float(value["output_max"]),
        integral_limit=float(value["integral_limit"]),
        derivative_filter=float(value["derivative_filter"]),
    )


def load_config(path: Path) -> AppConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf8"))
    if not isinstance(raw, dict):
        raise TypeError("Configuration must be a YAML mapping")
    serial = raw["serial"]
    control = raw["control"]
    velocity = raw["velocity_hold"]
    safety = raw["safety"]
    override = raw["pilot_override"]
    output = raw["output"]
    loop_hz = float(control["loop_hz"])
    if not 5 <= loop_hz <= 200:
        raise ValueError("control.loop_hz must be between 5 and 200")
    command_timeout_s = float(safety["command_timeout_ms"]) / 1000
    if command_timeout_s <= 0:
        raise ValueError("safety.command_timeout_ms must be positive")
    full_below = float(override["full_below"])
    zero_above = float(override["zero_above"])
    if not 0 <= full_below < zero_above <= 1:
        raise ValueError("pilot override thresholds must satisfy 0 <= full < zero <= 1")
    return AppConfig(
        serial=SerialConfig(
            port=str(serial["port"]),
            baudrate=int(serial["baudrate"]),
            timeout_s=float(serial["timeout_s"]),
        ),
        loop_hz=loop_hz,
        command_timeout_s=command_timeout_s,
        mode=FlightMode(str(control["mode"])),
        north_pid=_pid(velocity["north"]),
        east_pid=_pid(velocity["east"]),
        safety=SafetyConfig(
            telemetry_timeout_s=float(safety["telemetry_timeout_ms"]) / 1000,
            aux_channel_index=int(override["aux_channel_index"]),
            aux_enabled_threshold=float(override["enabled_threshold"]),
        ),
        override_full_below=full_below,
        override_zero_above=zero_above,
        allow_disarmed_output=bool(output["allow_disarmed_output"]),
        log_path=Path(str(raw["logging"]["csv_path"])),
    )
