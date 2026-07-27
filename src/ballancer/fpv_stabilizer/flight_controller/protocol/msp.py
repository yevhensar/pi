from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Protocol

MSP_API_VERSION = 1
MSP_FC_VARIANT = 2
MSP_FC_VERSION = 3
MSP_STATUS = 101
MSP_RAW_IMU = 102
MSP_RC = 105
MSP_RAW_GPS = 106
MSP_ATTITUDE = 108
MSP_ALTITUDE = 109
MSP_ANALOG = 110
MSP_BOXIDS = 119
MSP_SET_RAW_RC = 200


class SerialPort(Protocol):
    def read(self, size: int = 1) -> bytes: ...
    def write(self, data: bytes) -> int | None: ...
    def flush(self) -> None: ...
    def close(self) -> None: ...


class MspProtocolError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class MspResponse:
    command: int
    payload: bytes


def encode_v1(command: int, payload: bytes = b"") -> bytes:
    if not 0 <= command <= 255 or len(payload) > 255:
        raise ValueError("MSP v1 command and payload must fit in one byte")
    checksum = len(payload) ^ command
    for value in payload:
        checksum ^= value
    return b"$M<" + bytes((len(payload), command)) + payload + bytes((checksum,))


class MspV1Client:
    def __init__(self, serial_port: SerialPort, timeout_s: float = 1.0) -> None:
        self._serial = serial_port
        self._timeout_s = timeout_s

    def command(self, command: int, payload: bytes = b"") -> bytes:
        self._serial.write(encode_v1(command, payload))
        self._serial.flush()
        deadline = monotonic() + self._timeout_s
        while monotonic() < deadline:
            if self._serial.read(1) != b"$":
                continue
            if self._serial.read(1) != b"M":
                continue
            direction = self._serial.read(1)
            header = self._serial.read(2)
            if direction not in (b">", b"!") or len(header) != 2:
                continue
            size, response_command = header
            response_payload = self._serial.read(size)
            checksum_bytes = self._serial.read(1)
            if len(response_payload) != size or len(checksum_bytes) != 1:
                continue
            checksum = size ^ response_command
            for value in response_payload:
                checksum ^= value
            if checksum != checksum_bytes[0]:
                continue
            if response_command != command:
                continue
            if direction == b"!":
                raise MspProtocolError(f"Betaflight rejected MSP command {command}")
            return response_payload
        raise MspProtocolError(f"MSP command {command} timed out")
