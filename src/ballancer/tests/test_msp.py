from __future__ import annotations

from fpv_stabilizer.flight_controller.protocol.msp import encode_v1


def test_msp_v1_encoding() -> None:
    assert encode_v1(1) == b"$M<\x00\x01\x01"
    assert encode_v1(200, b"\xdc\x05") == b"$M<\x02\xc8\xdc\x05\x13"
