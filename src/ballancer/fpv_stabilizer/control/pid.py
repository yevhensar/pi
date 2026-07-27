from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PidConfig:
    kp: float
    ki: float
    kd: float
    output_min: float
    output_max: float
    integral_limit: float
    derivative_filter: float


class PIDController:
    def __init__(self, config: PidConfig) -> None:
        self.config = config
        self.reset()

    def reset(self) -> None:
        self._integral = 0.0
        self._previous_error: float | None = None
        self._filtered_derivative = 0.0

    def update(self, error: float, dt_s: float) -> float:
        if dt_s <= 0:
            raise ValueError("PID dt_s must be positive")
        raw_derivative = (
            0.0 if self._previous_error is None else (error - self._previous_error) / dt_s
        )
        alpha = max(0.0, min(1.0, self.config.derivative_filter))
        self._filtered_derivative += alpha * (raw_derivative - self._filtered_derivative)
        candidate_integral = max(
            -self.config.integral_limit,
            min(self.config.integral_limit, self._integral + error * dt_s),
        )
        unclamped = (
            self.config.kp * error
            + self.config.ki * candidate_integral
            + self.config.kd * self._filtered_derivative
        )
        output = max(self.config.output_min, min(self.config.output_max, unclamped))
        # Conditional integration: do not wind farther into saturation.
        if output == unclamped or (output == self.config.output_max and error < 0) or (
            output == self.config.output_min and error > 0
        ):
            self._integral = candidate_integral
        self._previous_error = error
        return output
