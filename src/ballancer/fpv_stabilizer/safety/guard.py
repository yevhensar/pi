from __future__ import annotations

from dataclasses import dataclass

from fpv_stabilizer.model import DroneState, FlightMode, PilotCommand


@dataclass(frozen=True, slots=True)
class SafetyConfig:
    telemetry_timeout_s: float
    aux_channel_index: int
    aux_enabled_threshold: float


def assistance_allowed(
    state: DroneState,
    pilot: PilotCommand,
    mode: FlightMode,
    config: SafetyConfig,
) -> tuple[bool, str]:
    if mode is FlightMode.PASS_THROUGH:
        return False, "pass-through mode"
    if state.age_seconds() > config.telemetry_timeout_s:
        return False, "stale telemetry"
    if state.failsafe:
        return False, "Betaflight failsafe active"
    if config.aux_channel_index >= len(pilot.aux):
        return False, "pilot enable switch unavailable"
    if pilot.aux[config.aux_channel_index] < config.aux_enabled_threshold:
        return False, "pilot enable switch off"
    if mode is FlightMode.VELOCITY_HOLD and (
        not state.gps_fix or state.velocity_ned_mps is None
    ):
        return False, "valid GPS velocity unavailable"
    return True, "assistance enabled"
