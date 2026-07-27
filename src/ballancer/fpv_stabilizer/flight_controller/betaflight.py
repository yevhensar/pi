from __future__ import annotations

import glob
import math
import os
import struct
from time import monotonic
from typing import Any

from fpv_stabilizer.flight_controller.base import (
    FlightControllerError,
    FlightControllerInterface,
)
from fpv_stabilizer.flight_controller.protocol.msp import (
    MSP_ALTITUDE,
    MSP_ANALOG,
    MSP_API_VERSION,
    MSP_ATTITUDE,
    MSP_BOXIDS,
    MSP_FC_VARIANT,
    MSP_FC_VERSION,
    MSP_RAW_GPS,
    MSP_RAW_IMU,
    MSP_RC,
    MSP_SET_RAW_RC,
    MSP_STATUS,
    MspProtocolError,
    MspV1Client,
)
from fpv_stabilizer.model import ControlCommand, DroneState, PilotCommand, Vector3


def autodetect_serial_device() -> str | None:
    candidates = (
        sorted(glob.glob("/dev/serial/by-id/*"))
        + sorted(glob.glob("/dev/ttyACM*"))
        + sorted(glob.glob("/dev/ttyUSB*"))
    )
    return candidates[0] if candidates else None


def _unpack(fmt: str, payload: bytes) -> tuple[Any, ...] | None:
    size = struct.calcsize(fmt)
    return struct.unpack_from(fmt, payload) if len(payload) >= size else None


def _normalize_axis(value: int) -> float:
    return max(-1.0, min(1.0, (value - 1500) / 500))


def _normalize_throttle(value: int) -> float:
    return max(0.0, min(1.0, (value - 1000) / 1000))


def _to_rc(command: ControlCommand) -> tuple[int, ...]:
    def axis(value: float) -> int:
        return round(1500 + max(-1.0, min(1.0, value)) * 500)

    throttle = round(1000 + max(0.0, min(1.0, command.throttle)) * 1000)
    return (axis(command.roll), axis(command.pitch), throttle, axis(command.yaw), 1000, 1000, 1000, 1000)


class BetaflightMspInterface(FlightControllerInterface):
    """MSP v1 telemetry and disarmed-only MSP channel output.

    Output is deliberately incapable of operating while armed in this phase.
    Betaflight must also be configured with MSP Override and a limited channel
    mask before it will interpret MSP_SET_RAW_RC as an override.
    """

    def __init__(
        self,
        port: str,
        baudrate: int,
        timeout_s: float,
        *,
        allow_disarmed_output: bool = False,
        command_timeout_s: float = 0.2,
    ) -> None:
        if command_timeout_s <= 0:
            raise ValueError("command_timeout_s must be positive")
        self._configured_port = port
        self._baudrate = baudrate
        self._timeout_s = timeout_s
        self._allow_disarmed_output = allow_disarmed_output
        self._command_timeout_s = command_timeout_s
        self._serial: Any | None = None
        self._client: MspV1Client | None = None
        self._last_state: DroneState | None = None

    @property
    def is_connected(self) -> bool:
        return self._client is not None

    def connect(self) -> None:
        if self.is_connected:
            return
        port = autodetect_serial_device() if self._configured_port == "auto" else self._configured_port
        if not port or not os.path.exists(port):
            raise FlightControllerError("No Betaflight serial device was found")
        try:
            import serial

            self._serial = serial.Serial(
                port,
                self._baudrate,
                timeout=self._timeout_s,
                exclusive=True,
            )
            self._client = MspV1Client(self._serial, self._timeout_s)
            api = self._client.command(MSP_API_VERSION)
            variant = self._client.command(MSP_FC_VARIANT)
            if len(api) < 3 or variant != b"BTFL":
                raise FlightControllerError("Connected device is not a verified Betaflight MSP target")
        except Exception as error:
            self.disconnect()
            if isinstance(error, FlightControllerError):
                raise
            raise FlightControllerError(f"Could not connect to Betaflight: {error}") from error

    def disconnect(self) -> None:
        if self._serial is not None:
            self._serial.close()
        self._serial = None
        self._client = None
        self._last_state = None

    def _command(self, command: int, payload: bytes = b"") -> bytes:
        if self._client is None:
            raise FlightControllerError("Betaflight is not connected")
        try:
            return self._client.command(command, payload)
        except MspProtocolError as error:
            raise FlightControllerError(str(error)) from error

    def _optional(self, command: int) -> bytes:
        try:
            return self._command(command)
        except FlightControllerError:
            return b""

    def read_state(self) -> DroneState:
        sample_started = monotonic()
        self._command(MSP_API_VERSION)
        variant = self._command(MSP_FC_VARIANT).decode("ascii", errors="replace")
        version = self._command(MSP_FC_VERSION)
        status = self._command(MSP_STATUS)
        box_ids = list(self._command(MSP_BOXIDS))
        attitude = _unpack("<hhh", self._command(MSP_ATTITUDE))
        imu = _unpack("<hhhhhhhhh", self._optional(MSP_RAW_IMU))
        gps = _unpack("<BBiiHHH", self._optional(MSP_RAW_GPS))
        altitude = _unpack("<ih", self._optional(MSP_ALTITUDE))
        analog = self._optional(MSP_ANALOG)
        rc_payload = self._command(MSP_RC)
        rc_channels = (
            struct.unpack("<" + "H" * (len(rc_payload) // 2), rc_payload)
            if len(rc_payload) >= 8 and len(rc_payload) % 2 == 0
            else ()
        )

        mode_flags = struct.unpack_from("<I", status, 6)[0] if len(status) >= 10 else 0
        armed = 0 in box_ids and bool(mode_flags & (1 << box_ids.index(0)))
        failsafe = 27 in box_ids and bool(mode_flags & (1 << box_ids.index(27)))
        velocity = None
        if gps:
            _, _, _, _, _, speed_cms, course_decideg = gps
            course_rad = math.radians(course_decideg / 10)
            speed = speed_cms / 100
            velocity = Vector3(speed * math.cos(course_rad), speed * math.sin(course_rad), 0.0)
        state = DroneState(
            # The sample age includes the complete batch of serial requests.
            monotonic_time=sample_started,
            armed=armed,
            failsafe=failsafe,
            attitude_deg=Vector3(
                attitude[0] / 10 if attitude else 0.0,
                attitude[1] / 10 if attitude else 0.0,
                float(attitude[2]) if attitude else 0.0,
            ),
            acceleration=Vector3(*map(float, imu[:3])) if imu else None,
            latitude_deg=gps[2] / 10_000_000 if gps else None,
            longitude_deg=gps[3] / 10_000_000 if gps else None,
            altitude_m=altitude[0] / 100 if altitude else None,
            velocity_ned_mps=velocity,
            battery_voltage_v=analog[0] / 10 if analog else None,
            gps_fix=bool(gps and gps[0] >= 2),
            gps_satellites=gps[1] if gps else 0,
            rc_channels_us=tuple(rc_channels),
            fc_variant=variant,
            fc_version=".".join(str(value) for value in version[:3]),
        )
        self._last_state = state
        return state

    def read_rc_input(self) -> PilotCommand:
        channels = self._last_state.rc_channels_us if self._last_state else ()
        if len(channels) < 4:
            state = self.read_state()
            channels = state.rc_channels_us
        if len(channels) < 4:
            raise FlightControllerError("Betaflight did not return four RC channels")
        # Betaflight MSP order is roll, pitch, throttle, yaw.
        return PilotCommand(
            roll=_normalize_axis(channels[0]),
            pitch=_normalize_axis(channels[1]),
            yaw=_normalize_axis(channels[3]),
            throttle=_normalize_throttle(channels[2]),
            aux=tuple(_normalize_axis(value) for value in channels[4:]),
        )

    def send_control_command(self, command: ControlCommand) -> None:
        if not self._allow_disarmed_output:
            raise FlightControllerError("Command output is disabled; use explicit bench-output mode")
        verification_started = monotonic()
        state = self.read_state()
        if state.armed:
            raise FlightControllerError("Command output refused because Betaflight is armed")
        verification_age_s = monotonic() - verification_started
        if verification_age_s > self._command_timeout_s:
            raise FlightControllerError(
                f"Command output refused after slow FC verification "
                f"({verification_age_s * 1000:.1f} ms)"
            )
        payload = struct.pack("<8H", *_to_rc(command))
        self._command(MSP_SET_RAW_RC, payload)

    def heartbeat(self) -> bool:
        try:
            return len(self._command(MSP_API_VERSION)) >= 3
        except FlightControllerError:
            return False
