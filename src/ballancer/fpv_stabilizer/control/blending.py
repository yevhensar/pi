from __future__ import annotations

from fpv_stabilizer.model import ControlCommand, PilotCommand


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def assistance_weight(stick: float, full_below: float, zero_above: float) -> float:
    magnitude = abs(stick)
    if magnitude <= full_below:
        return 1.0
    if magnitude >= zero_above:
        return 0.0
    position = (magnitude - full_below) / (zero_above - full_below)
    smooth = position * position * (3 - 2 * position)
    return 1.0 - smooth


def blend(
    pilot: PilotCommand,
    correction: ControlCommand,
    *,
    full_below: float,
    zero_above: float,
) -> ControlCommand:
    return ControlCommand(
        roll=_clamp(
            pilot.roll + correction.roll * assistance_weight(pilot.roll, full_below, zero_above),
            -1.0,
            1.0,
        ),
        pitch=_clamp(
            pilot.pitch
            + correction.pitch * assistance_weight(pilot.pitch, full_below, zero_above),
            -1.0,
            1.0,
        ),
        yaw=_clamp(
            pilot.yaw + correction.yaw * assistance_weight(pilot.yaw, full_below, zero_above),
            -1.0,
            1.0,
        ),
        throttle=_clamp(
            pilot.throttle
            + correction.throttle
            * assistance_weight(pilot.throttle - 0.5, full_below, zero_above),
            0.0,
            1.0,
        ),
    )
