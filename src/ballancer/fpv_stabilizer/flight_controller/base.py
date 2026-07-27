from __future__ import annotations

from abc import ABC, abstractmethod

from fpv_stabilizer.model import ControlCommand, DroneState, PilotCommand


class FlightControllerError(RuntimeError):
    pass


class FlightControllerInterface(ABC):
    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def disconnect(self) -> None: ...

    @abstractmethod
    def read_state(self) -> DroneState: ...

    @abstractmethod
    def read_rc_input(self) -> PilotCommand: ...

    @abstractmethod
    def send_control_command(self, command: ControlCommand) -> None: ...

    @abstractmethod
    def heartbeat(self) -> bool: ...

    @property
    @abstractmethod
    def is_connected(self) -> bool: ...
