from __future__ import annotations

import struct

import pytest

import fpv_stabilizer.flight_controller.betaflight as betaflight_module
from fpv_stabilizer.flight_controller.base import FlightControllerError
from fpv_stabilizer.flight_controller.betaflight import BetaflightMspInterface
from fpv_stabilizer.flight_controller.protocol.msp import MSP_SET_RAW_RC
from fpv_stabilizer.model import ControlCommand, DroneState


class FakeBetaflight(BetaflightMspInterface):
    def __init__(self, state: DroneState, *, output_enabled: bool = True) -> None:
        super().__init__("fake", 115200, 0.1, allow_disarmed_output=output_enabled)
        self.state = state
        self.sent: tuple[int, bytes] | None = None

    def read_state(self) -> DroneState:
        return self.state

    def _command(self, command: int, payload: bytes = b"") -> bytes:
        self.sent = (command, payload)
        return b""


def test_disarmed_bench_output_sends_rc_channels() -> None:
    interface = FakeBetaflight(DroneState(armed=False))

    interface.send_control_command(ControlCommand(roll=0.1, pitch=-0.2, throttle=0.3, yaw=0.4))

    assert interface.sent is not None
    command, payload = interface.sent
    assert command == MSP_SET_RAW_RC
    assert struct.unpack("<8H", payload) == (1550, 1400, 1300, 1700, 1000, 1000, 1000, 1000)


def test_armed_state_refuses_output() -> None:
    interface = FakeBetaflight(DroneState(armed=True))

    with pytest.raises(FlightControllerError, match="armed"):
        interface.send_control_command(ControlCommand())

    assert interface.sent is None


def test_output_requires_explicit_bench_enable() -> None:
    interface = FakeBetaflight(DroneState(armed=False), output_enabled=False)

    with pytest.raises(FlightControllerError, match="disabled"):
        interface.send_control_command(ControlCommand())

    assert interface.sent is None


def test_slow_final_state_verification_refuses_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    timestamps = iter((10.0, 10.3))
    monkeypatch.setattr(betaflight_module, "monotonic", lambda: next(timestamps))
    interface = FakeBetaflight(DroneState(armed=False))

    with pytest.raises(FlightControllerError, match="slow FC verification"):
        interface.send_control_command(ControlCommand())

    assert interface.sent is None
