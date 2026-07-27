from __future__ import annotations

from dataclasses import replace
from time import monotonic

from fpv_stabilizer.flight_controller.base import FlightControllerInterface
from fpv_stabilizer.model import ControlCommand, DroneState, PilotCommand, Vector3

SCENARIOS: dict[str, Vector3] = {
    "no_drift": Vector3(),
    "right_drift": Vector3(0.0, 2.0, 0.0),
    "left_drift": Vector3(0.0, -2.0, 0.0),
    "forward_drift": Vector3(2.0, 0.0, 0.0),
    "backward_drift": Vector3(-2.0, 0.0, 0.0),
}


class SimulatedFlightController(FlightControllerInterface):
    def __init__(self, scenario: str) -> None:
        if scenario not in (*SCENARIOS, "gps_loss", "telemetry_loss", "pilot_override"):
            raise ValueError(f"Unknown simulation scenario: {scenario}")
        self.scenario = scenario
        self._connected = False
        self._cycles = 0
        self.sent_commands: list[ControlCommand] = []

    @property
    def is_connected(self) -> bool:
        return self._connected

    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def read_state(self) -> DroneState:
        self._cycles += 1
        velocity = SCENARIOS.get(self.scenario, Vector3(0.0, 2.0, 0.0))
        state = DroneState(
            monotonic_time=monotonic(),
            velocity_ned_mps=velocity,
            gps_fix=self.scenario != "gps_loss",
            gps_satellites=10 if self.scenario != "gps_loss" else 0,
            rc_channels_us=(1500, 1500, 1500, 1500, 2000),
            fc_variant="SIM",
            fc_version="simulation",
        )
        if self.scenario == "telemetry_loss" and self._cycles > 2:
            return replace(state, monotonic_time=monotonic() - 10)
        return state

    def read_rc_input(self) -> PilotCommand:
        roll = 0.9 if self.scenario == "pilot_override" else 0.0
        return PilotCommand(roll=roll, throttle=0.5, aux=(1.0,))

    def send_control_command(self, command: ControlCommand) -> None:
        self.sent_commands.append(command)

    def heartbeat(self) -> bool:
        return self._connected
