from __future__ import annotations

from fpv_stabilizer.control.pid import PidConfig, PIDController
from fpv_stabilizer.model import ControlCommand, DroneState


class VelocityHoldController:
    def __init__(self, north: PidConfig, east: PidConfig) -> None:
        self._north = PIDController(north)
        self._east = PIDController(east)

    def reset(self) -> None:
        self._north.reset()
        self._east.reset()

    def update(self, state: DroneState, dt_s: float) -> ControlCommand:
        if state.velocity_ned_mps is None:
            raise ValueError("Velocity hold requires NED velocity")
        # Target velocity is zero. Positive east (right) produces negative roll;
        # positive north (forward) produces negative pitch with these conventions.
        pitch = self._north.update(-state.velocity_ned_mps.x, dt_s)
        roll = self._east.update(-state.velocity_ned_mps.y, dt_s)
        return ControlCommand(roll=roll, pitch=pitch)
