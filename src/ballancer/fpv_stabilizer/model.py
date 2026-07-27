from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from time import monotonic


class FlightMode(StrEnum):
    PASS_THROUGH = "PASS_THROUGH"
    VELOCITY_HOLD = "VELOCITY_HOLD"


@dataclass(frozen=True, slots=True)
class Vector3:
    """Right-handed vector. Body: X forward, Y right, Z down. Navigation: NED."""

    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


@dataclass(frozen=True, slots=True)
class PilotCommand:
    roll: float = 0.0
    pitch: float = 0.0
    yaw: float = 0.0
    throttle: float = 0.0
    aux: tuple[float, ...] = ()


@dataclass(frozen=True, slots=True)
class ControlCommand:
    """Normalized axes: roll/pitch/yaw [-1,1], throttle [0,1]."""

    roll: float = 0.0
    pitch: float = 0.0
    yaw: float = 0.0
    throttle: float = 0.0


@dataclass(frozen=True, slots=True)
class DroneState:
    monotonic_time: float = field(default_factory=monotonic)
    armed: bool = False
    failsafe: bool = False
    attitude_deg: Vector3 = field(default_factory=Vector3)
    angular_velocity_dps: Vector3 | None = None
    acceleration: Vector3 | None = None
    latitude_deg: float | None = None
    longitude_deg: float | None = None
    altitude_m: float | None = None
    velocity_ned_mps: Vector3 | None = None
    battery_voltage_v: float | None = None
    gps_fix: bool = False
    gps_satellites: int = 0
    rc_channels_us: tuple[int, ...] = ()
    fc_variant: str = ""
    fc_version: str = ""

    def age_seconds(self, now: float | None = None) -> float:
        return (monotonic() if now is None else now) - self.monotonic_time


@dataclass(frozen=True, slots=True)
class ControlCycle:
    state: DroneState
    pilot: PilotCommand
    correction: ControlCommand
    output: ControlCommand
    assistance_enabled: bool
    reason: str
    loop_dt_s: float
    execution_ms: float
