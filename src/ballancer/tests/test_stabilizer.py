from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from time import monotonic

from fpv_stabilizer.config import AppConfig, SerialConfig
from fpv_stabilizer.control.pid import PidConfig
from fpv_stabilizer.model import DroneState, FlightMode, PilotCommand, Vector3
from fpv_stabilizer.safety.guard import SafetyConfig
from fpv_stabilizer.stabilizer import Stabilizer


def config() -> AppConfig:
    pid = PidConfig(0.1, 0.0, 0.0, -0.2, 0.2, 0.1, 0.2)
    return AppConfig(
        serial=SerialConfig("auto", 115200, 0.5),
        loop_hz=20,
        command_timeout_s=0.2,
        mode=FlightMode.VELOCITY_HOLD,
        north_pid=pid,
        east_pid=pid,
        safety=SafetyConfig(0.2, 0, 0.4),
        override_full_below=0.1,
        override_zero_above=0.5,
        allow_disarmed_output=False,
        log_path=Path("/tmp/test-flight.csv"),
    )


def state(velocity: Vector3) -> DroneState:
    return DroneState(velocity_ned_mps=velocity, gps_fix=True)


def enabled_pilot(**changes: float) -> PilotCommand:
    return replace(PilotCommand(throttle=0.5, aux=(1.0,)), **changes)


def test_no_drift_has_no_correction() -> None:
    cycle = Stabilizer(config()).compute(state(Vector3()), enabled_pilot(), 0.05)
    assert cycle.assistance_enabled
    assert cycle.correction.roll == 0
    assert cycle.correction.pitch == 0


def test_right_drift_produces_left_roll() -> None:
    cycle = Stabilizer(config()).compute(state(Vector3(y=2.0)), enabled_pilot(), 0.05)
    assert cycle.correction.roll < 0


def test_left_drift_produces_right_roll() -> None:
    cycle = Stabilizer(config()).compute(state(Vector3(y=-2.0)), enabled_pilot(), 0.05)
    assert cycle.correction.roll > 0


def test_stale_telemetry_disables_correction() -> None:
    stale = replace(state(Vector3(y=2.0)), monotonic_time=monotonic() - 1)
    cycle = Stabilizer(config()).compute(stale, enabled_pilot(), 0.05)
    assert not cycle.assistance_enabled
    assert cycle.correction.roll == 0


def test_gps_loss_disables_velocity_hold() -> None:
    invalid = replace(state(Vector3(y=2.0)), gps_fix=False)
    assert not Stabilizer(config()).compute(invalid, enabled_pilot(), 0.05).assistance_enabled


def test_large_pilot_input_overrides_roll_assistance() -> None:
    cycle = Stabilizer(config()).compute(
        state(Vector3(y=2.0)),
        enabled_pilot(roll=0.9),
        0.05,
    )
    assert cycle.output.roll == 0.9


def test_aux_switch_disables_assistance() -> None:
    cycle = Stabilizer(config()).compute(
        state(Vector3(y=2.0)),
        PilotCommand(throttle=0.5, aux=(-1.0,)),
        0.05,
    )
    assert not cycle.assistance_enabled
