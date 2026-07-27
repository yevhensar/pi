from __future__ import annotations

import pytest

from fpv_stabilizer.control.pid import PidConfig, PIDController


def controller() -> PIDController:
    return PIDController(PidConfig(1.0, 1.0, 0.0, -0.2, 0.2, 0.1, 0.2))


def test_pid_output_and_integral_are_bounded() -> None:
    pid = controller()
    for _ in range(100):
        assert pid.update(10.0, 0.1) == pytest.approx(0.2)
    assert pid.update(-10.0, 0.1) == pytest.approx(-0.2)


def test_pid_rejects_nonpositive_dt() -> None:
    with pytest.raises(ValueError):
        controller().update(1.0, 0.0)
