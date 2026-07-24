import importlib.util
import os
import struct
import unittest
from unittest.mock import patch


MODULE_PATH = os.path.join(os.path.dirname(__file__), "flight_controller_health.py")
SPEC = importlib.util.spec_from_file_location("flight_controller_health", MODULE_PATH)
health = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(health)


class FakeMspClient:
    def __init__(self, _device, _baud, _timeout):
        self.responses = {
            health.MSP_API_VERSION: bytes([1, 46, 0]),
            health.MSP_FC_VARIANT: b"BTFL",
            health.MSP_FC_VERSION: bytes([4, 5, 1]),
            health.MSP_BOARD_INFO: (
                b"S405"
                + struct.pack("<HBB", 1, 0, 0)
                + bytes([7])
                + b"TARGET1"
                + bytes([8])
                + b"F405PRO"
            ),
            health.MSP_STATUS: struct.pack(
                "<HHHIBH",
                125,
                0,
                (1 << 0) | (1 << 3) | (1 << 5),
                1,
                0,
                14,
            ),
            health.MSP_BOXIDS: bytes([0, 1]),
            health.MSP_RAW_GPS: struct.pack(
                "<BBiiHHH", 2, 10, 377749000, -1224194000, 15, 0, 0
            ),
            health.MSP_BATTERY_STATE: (
                bytes([4])
                + struct.pack("<H", 1500)
                + bytes([0])
                + struct.pack("<HhB", 200, 125, 0)
                + struct.pack("<H", 1625)
            ),
            health.MSP_ATTITUDE: struct.pack("<hhh", 12, -8, 90),
            health.MSP_ALTITUDE: struct.pack("<ih", 1234, -5),
        }

    def command(self, code, timeout=2):
        del timeout
        if code not in self.responses:
            raise health.MspError("unsupported")
        return self.responses[code]

    def close(self):
        pass


class FlightControllerHealthTest(unittest.TestCase):
    def test_betaflight_msp_snapshot(self):
        with patch.object(health, "MspClient", FakeMspClient):
            snapshot = health.read_msp_health("/dev/ttyACM0", 115200, 2)

        self.assertEqual(snapshot["status"], "healthy")
        self.assertTrue(snapshot["vehicleConnected"])
        self.assertEqual(snapshot["protocol"], "msp")
        self.assertEqual(snapshot["autopilot"], "Betaflight (BTFL)")
        self.assertEqual(snapshot["firmwareVersion"], "4.5.1")
        self.assertEqual(snapshot["boardIdentifier"], "S405")
        self.assertTrue(snapshot["armed"])
        self.assertEqual(snapshot["flightMode"], "ACRO")
        self.assertEqual(snapshot["gpsFixType"], "FIX_3D")
        self.assertTrue(snapshot["gpsHealthy"])
        self.assertEqual(snapshot["satelliteCount"], 10)
        self.assertAlmostEqual(snapshot["batteryVoltageV"], 16.25)
        self.assertAlmostEqual(snapshot["relativeAltitudeM"], 12.34)
        self.assertTrue(snapshot["gyroPresent"])
        self.assertTrue(snapshot["accelerometerPresent"])
        self.assertTrue(snapshot["gpsPresent"])

    def test_missing_device_is_disconnected(self):
        snapshot = health.read_health("/dev/definitely-missing", 115200, 1, "auto")
        self.assertEqual(snapshot["status"], "disconnected")
        self.assertFalse(snapshot["vehicleConnected"])


if __name__ == "__main__":
    unittest.main()
