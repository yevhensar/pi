#!/usr/bin/env python3
"""Read a compact, read-only MAVLink health snapshot from a USB flight controller."""

import argparse
import glob
import json
import math
import os
import struct
import sys
import time

MSP_API_VERSION = 1
MSP_FC_VARIANT = 2
MSP_FC_VERSION = 3
MSP_BOARD_INFO = 4
MSP_STATUS = 101
MSP_RAW_GPS = 106
MSP_ATTITUDE = 108
MSP_ALTITUDE = 109
MSP_ANALOG = 110
MSP_BOXIDS = 119
MSP_BATTERY_STATE = 130


def result(status, **values):
    return {
        "status": status,
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "vehicleConnected": False,
        "preArmFailures": [],
        **values,
    }


def emit(payload):
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def finite(value):
    return value if isinstance(value, (int, float)) and math.isfinite(value) else None


def enum_label(mavlink, enum_name, value):
    try:
        return mavlink.enums[enum_name][int(value)].name
    except (KeyError, TypeError, ValueError):
        return str(value) if value is not None else None


def gps_fix_label(value):
    labels = {
        0: "NO_GPS",
        1: "NO_FIX",
        2: "FIX_2D",
        3: "FIX_3D",
        4: "DGPS",
        5: "RTK_FLOAT",
        6: "RTK_FIXED",
    }
    return labels.get(int(value or 0), f"FIX_{value}")


def msp_gps_fix_label(value):
    if int(value or 0) >= 2:
        return "FIX_3D"
    if int(value or 0) == 1:
        return "FIX_2D"
    return "NO_FIX"


def autodetect_device():
    candidates = (
        sorted(glob.glob("/dev/serial/by-id/*"))
        + sorted(glob.glob("/dev/ttyACM*"))
        + sorted(glob.glob("/dev/ttyUSB*"))
    )
    return candidates[0] if candidates else None


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="auto")
    parser.add_argument("--protocol", choices=("auto", "mavlink", "msp"), default="auto")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--timeout", type=float, default=8)
    return parser.parse_args()


class MspError(RuntimeError):
    pass


class MspClient:
    def __init__(self, device, baud, timeout):
        try:
            import serial
        except ImportError as error:
            raise MspError("pyserial is not installed") from error
        self.serial = serial.Serial(device, baudrate=baud, timeout=min(timeout, 2))

    def close(self):
        self.serial.close()

    def command(self, code, timeout=2):
        checksum = code
        self.serial.write(b"$M<" + bytes([0, code, checksum]))
        self.serial.flush()
        deadline = time.monotonic() + min(timeout, 2)

        while time.monotonic() < deadline:
            if self.serial.read(1) != b"$" or self.serial.read(1) != b"M":
                continue
            direction = self.serial.read(1)
            if direction not in (b">", b"!"):
                continue
            header = self.serial.read(2)
            if len(header) != 2:
                continue
            size, response_code = header
            payload = self.serial.read(size)
            response_checksum = self.serial.read(1)
            if len(payload) != size or len(response_checksum) != 1:
                continue
            calculated = size ^ response_code
            for byte in payload:
                calculated ^= byte
            if calculated != response_checksum[0] or response_code != code:
                continue
            if direction == b"!":
                raise MspError(f"MSP command {code} returned an error")
            return payload
        raise MspError(f"MSP command {code} timed out")


def unpack(fmt, payload, offset=0):
    size = struct.calcsize(fmt)
    if len(payload) < offset + size:
        return None
    return struct.unpack_from(fmt, payload, offset)


def clean_ascii(value):
    return value.decode("ascii", errors="ignore").rstrip("\x00").strip()


def read_pstring(payload, offset):
    if offset >= len(payload):
        return None, offset
    length = payload[offset]
    offset += 1
    if offset + length > len(payload):
        return None, offset
    return clean_ascii(payload[offset : offset + length]), offset + length


def optional_command(client, code):
    try:
        return client.command(code)
    except MspError:
        return b""


def read_msp_health(device, baud, timeout):
    try:
        client = MspClient(device, baud, timeout)
    except PermissionError:
        return result(
            "error",
            device=device,
            baud=baud,
            protocol="msp",
            error="Permission denied opening serial device; ensure pi-health-agent is in the dialout group",
        )
    except Exception as error:
        return result("disconnected", device=device, baud=baud, protocol="msp", error=str(error))

    try:
        api = client.command(MSP_API_VERSION)
        payload = result(
            "healthy",
            device=device,
            baud=baud,
            protocol="msp",
            vehicleConnected=True,
            autopilot="Betaflight",
            vehicleType="Multirotor",
        )
        if len(api) >= 3:
            payload["apiVersion"] = f"{api[0]}.{api[1]}.{api[2]}"

        variant = optional_command(client, MSP_FC_VARIANT)
        if variant:
            variant_name = clean_ascii(variant)
            payload["autopilot"] = (
                f"Betaflight ({variant_name})" if variant_name == "BTFL" else variant_name
            ) or "Betaflight"

        version = optional_command(client, MSP_FC_VERSION)
        if len(version) >= 3:
            payload["firmwareVersion"] = f"{version[0]}.{version[1]}.{version[2]}"

        board = optional_command(client, MSP_BOARD_INFO)
        if len(board) >= 8:
            payload["boardIdentifier"] = clean_ascii(board[:4])
            target_name, offset = read_pstring(board, 8)
            board_name, _ = read_pstring(board, offset)
            if target_name:
                payload["targetName"] = target_name
            if board_name:
                payload["boardName"] = board_name

        status = optional_command(client, MSP_STATUS)
        mode_flags = 0
        if len(status) >= 11:
            cycle_time, i2c_errors, sensor_flags = unpack("<HHH", status)
            mode_flags = unpack("<I", status, 6)[0]
            payload["systemLoadPercent"] = (
                unpack("<H", status, 11)[0] if len(status) >= 13 else None
            )
            payload["gyroPresent"] = bool(sensor_flags & (1 << 5))
            payload["accelerometerPresent"] = bool(sensor_flags & (1 << 0))
            payload["barometerPresent"] = bool(sensor_flags & (1 << 1))
            payload["magnetometerPresent"] = bool(sensor_flags & (1 << 2))
            payload["gpsPresent"] = bool(sensor_flags & (1 << 3))
            if i2c_errors:
                payload["error"] = f"{i2c_errors} I2C errors reported"
                payload["status"] = "warning"

        box_ids = list(optional_command(client, MSP_BOXIDS))
        if 0 in box_ids:
            payload["armed"] = bool(mode_flags & (1 << box_ids.index(0)))
        active_modes = []
        mode_names = {1: "ANGLE", 2: "HORIZON", 5: "MAG", 28: "AIR MODE", 27: "FAILSAFE"}
        for permanent_id, label in mode_names.items():
            if permanent_id in box_ids and mode_flags & (1 << box_ids.index(permanent_id)):
                active_modes.append(label)
        payload["flightMode"] = " + ".join(active_modes) or "ACRO"

        raw_gps = optional_command(client, MSP_RAW_GPS)
        gps = unpack("<BBiiHHH", raw_gps)
        if gps:
            fix_type, satellites, latitude, longitude, altitude_m, _, _ = gps
            payload["gpsFixType"] = msp_gps_fix_label(fix_type)
            payload["satelliteCount"] = satellites
            payload["gpsHealthy"] = fix_type >= 2 and satellites >= 5
            payload["latitude"] = latitude / 10_000_000
            payload["longitude"] = longitude / 10_000_000
        elif payload.get("gpsPresent") is False:
            payload["gpsHealthy"] = False

        battery = optional_command(client, MSP_BATTERY_STATE)
        if len(battery) >= 11:
            legacy_voltage = battery[3] / 10
            voltage = unpack("<H", battery, 9)[0] / 100
            payload["batteryVoltageV"] = voltage if voltage > 0 else legacy_voltage
        else:
            analog = optional_command(client, MSP_ANALOG)
            if analog and analog[0] > 0:
                payload["batteryVoltageV"] = analog[0] / 10

        attitude = unpack("<hhh", optional_command(client, MSP_ATTITUDE))
        if attitude:
            payload["rollDeg"] = attitude[0] / 10
            payload["pitchDeg"] = attitude[1] / 10

        altitude = unpack("<ih", optional_command(client, MSP_ALTITUDE))
        if altitude:
            payload["relativeAltitudeM"] = altitude[0] / 100

        if payload.get("gpsHealthy") is False and payload.get("gpsPresent"):
            payload["status"] = "warning"
            payload["error"] = "GPS is present but does not have a healthy fix"
        return {key: value for key, value in payload.items() if value is not None}
    except MspError as error:
        return result("disconnected", device=device, baud=baud, protocol="msp", error=str(error))
    finally:
        client.close()


def read_mavlink_health(device, baud, timeout):
    try:
        from pymavlink import mavutil
    except ImportError:
        return result("error", device=device, baud=baud, protocol="mavlink", error="pymavlink is not installed")

    try:
        connection = mavutil.mavlink_connection(
            device,
            baud=baud,
            autoreconnect=False,
            source_system=255,
        )
        heartbeat = connection.wait_heartbeat(timeout=timeout)
    except PermissionError:
        return result(
            "error",
            device=device,
            baud=baud,
            protocol="mavlink",
            error="Permission denied opening serial device; ensure pi-health-agent is in the dialout group",
        )
    except Exception as error:
        return result("disconnected", device=device, baud=baud, protocol="mavlink", error=str(error))

    if heartbeat is None:
        return result(
            "disconnected",
            device=device,
            baud=baud,
            protocol="mavlink",
            error=f"No MAVLink heartbeat received within {timeout:g} seconds",
        )

    payload = result(
        "healthy",
        device=device,
        baud=baud,
        protocol="mavlink",
        vehicleConnected=True,
        autopilot=enum_label(mavutil.mavlink, "MAV_AUTOPILOT", getattr(heartbeat, "autopilot", None)),
        vehicleType=enum_label(mavutil.mavlink, "MAV_TYPE", getattr(heartbeat, "type", None)),
        systemStatus=enum_label(
            mavutil.mavlink, "MAV_STATE", getattr(heartbeat, "system_status", None)
        ),
        flightMode=mavutil.mode_string_v10(heartbeat),
        armed=bool(
            getattr(heartbeat, "base_mode", 0)
            & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
        ),
    )

    deadline = time.monotonic() + min(max(timeout, 2), 12)
    prearm = []
    ekf_flags = None
    wanted = {
        "HEARTBEAT",
        "SYS_STATUS",
        "BATTERY_STATUS",
        "GPS_RAW_INT",
        "EKF_STATUS_REPORT",
        "GLOBAL_POSITION_INT",
        "STATUSTEXT",
    }

    while time.monotonic() < deadline:
        message = connection.recv_match(type=list(wanted), blocking=True, timeout=0.5)
        if message is None:
            continue
        message_type = message.get_type()

        if message_type == "HEARTBEAT":
            payload["flightMode"] = mavutil.mode_string_v10(message)
            payload["armed"] = bool(
                getattr(message, "base_mode", 0)
                & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
            )
        elif message_type == "SYS_STATUS":
            voltage = getattr(message, "voltage_battery", -1)
            remaining = getattr(message, "battery_remaining", -1)
            if voltage and voltage > 0 and voltage != 65535:
                payload["batteryVoltageV"] = round(voltage / 1000, 2)
            if remaining is not None and remaining >= 0:
                payload["batteryPercent"] = int(remaining)
        elif message_type == "BATTERY_STATUS":
            remaining = getattr(message, "battery_remaining", -1)
            if remaining is not None and remaining >= 0:
                payload["batteryPercent"] = int(remaining)
        elif message_type == "GPS_RAW_INT":
            fix_type = int(getattr(message, "fix_type", 0))
            payload["gpsFixType"] = gps_fix_label(fix_type)
            payload["satelliteCount"] = int(getattr(message, "satellites_visible", 0))
            payload["gpsHealthy"] = fix_type >= 3
        elif message_type == "EKF_STATUS_REPORT":
            ekf_flags = int(getattr(message, "flags", 0))
        elif message_type == "GLOBAL_POSITION_INT":
            latitude = finite(getattr(message, "lat", None))
            longitude = finite(getattr(message, "lon", None))
            relative_altitude = finite(getattr(message, "relative_alt", None))
            if latitude is not None:
                payload["latitude"] = latitude / 1e7
            if longitude is not None:
                payload["longitude"] = longitude / 1e7
            if relative_altitude is not None:
                payload["relativeAltitudeM"] = round(relative_altitude / 1000, 2)
        elif message_type == "STATUSTEXT":
            text = str(getattr(message, "text", "")).strip("\x00 ")
            if text.lower().startswith("prearm:") and text not in prearm:
                prearm.append(text)

    if ekf_flags is not None:
        required_flags = (
            mavutil.mavlink.ESTIMATOR_ATTITUDE
            | mavutil.mavlink.ESTIMATOR_VELOCITY_HORIZ
            | mavutil.mavlink.ESTIMATOR_POS_HORIZ_REL
        )
        payload["ekfHealthy"] = (ekf_flags & required_flags) == required_flags
    payload["preArmFailures"] = prearm[:12]

    issues = []
    if payload.get("batteryPercent") is not None and payload["batteryPercent"] < 30:
        issues.append("Battery below 30%")
    if payload.get("gpsHealthy") is False:
        issues.append("GPS does not have a 3D fix")
    if payload.get("ekfHealthy") is False:
        issues.append("EKF is not healthy")
    if prearm:
        issues.append("Flight controller reports pre-arm failures")
    if issues:
        payload["status"] = "warning"
        payload["error"] = "; ".join(issues)

    try:
        connection.close()
    except Exception:
        pass
    return payload


def read_health(device, baud, timeout, protocol):
    resolved_device = autodetect_device() if device == "auto" else device
    if not resolved_device:
        return result(
            "disconnected",
            error="No flight controller found under /dev/serial/by-id, /dev/ttyACM*, or /dev/ttyUSB*",
        )
    if not os.path.exists(resolved_device):
        return result("disconnected", device=resolved_device, baud=baud, error="Serial device does not exist")

    if protocol == "msp":
        return read_msp_health(resolved_device, baud, timeout)
    if protocol == "mavlink":
        return read_mavlink_health(resolved_device, baud, timeout)

    looks_like_betaflight = "betaflight" in resolved_device.lower()
    readers = (
        (read_msp_health, read_mavlink_health)
        if looks_like_betaflight
        else (read_mavlink_health, read_msp_health)
    )
    first = readers[0](resolved_device, baud, min(timeout, 3))
    if first.get("vehicleConnected"):
        return first
    second = readers[1](resolved_device, baud, timeout)
    if second.get("vehicleConnected"):
        return second
    return first


def main():
    args = parse_args()
    if args.baud < 1200 or args.baud > 4_000_000:
        emit(result("error", error="Baud must be between 1200 and 4000000"))
        return
    emit(read_health(args.device, args.baud, max(1, args.timeout), args.protocol))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit(result("error", error=str(error)))
        sys.exit(0)
