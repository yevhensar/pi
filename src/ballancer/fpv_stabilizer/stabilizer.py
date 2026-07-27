from __future__ import annotations

from time import monotonic

from fpv_stabilizer.config import AppConfig
from fpv_stabilizer.control.blending import blend
from fpv_stabilizer.control.velocity import VelocityHoldController
from fpv_stabilizer.model import ControlCommand, ControlCycle, DroneState, FlightMode, PilotCommand
from fpv_stabilizer.safety.guard import assistance_allowed


class Stabilizer:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self._velocity = VelocityHoldController(config.north_pid, config.east_pid)

    def compute(
        self,
        state: DroneState,
        pilot: PilotCommand,
        dt_s: float,
        started_at: float | None = None,
    ) -> ControlCycle:
        start = monotonic() if started_at is None else started_at
        allowed, reason = assistance_allowed(state, pilot, self.config.mode, self.config.safety)
        correction = ControlCommand()
        if allowed and self.config.mode is FlightMode.VELOCITY_HOLD:
            correction = self._velocity.update(state, dt_s)
        else:
            self._velocity.reset()
        output = blend(
            pilot,
            correction,
            full_below=self.config.override_full_below,
            zero_above=self.config.override_zero_above,
        )
        return ControlCycle(
            state=state,
            pilot=pilot,
            correction=correction,
            output=output,
            assistance_enabled=allowed,
            reason=reason,
            loop_dt_s=dt_s,
            execution_ms=(monotonic() - start) * 1000,
        )
