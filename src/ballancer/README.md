# FPV Ballancer

Safety-first Raspberry Pi 5 companion stabilization prototype for Betaflight.
The directory name follows the requested `src/ballancer`; the installed daemon
and Python package are named `fpv_stabilizer`.

> This phase is not flight-ready. It implements telemetry, simulation, dry-run,
> and disarmed bench output. It intentionally refuses command output whenever
> Betaflight reports `armed`.

## Architecture

```text
Betaflight telemetry / pilot RC
              │ MSP
              ▼
        Raspberry Pi 5
  state validity + outer-loop PID
  pilot blending + strict limits
              │ normalized RC target
              ▼
       MSP channel override
              │
              ▼
 Betaflight gyro/PID/mixer/failsafe
              │
              ▼
           ESCs/motors
```

The Pi never calculates or transmits individual motor values. Betaflight keeps
the real-time gyro, PID, mixing, arming, motor, and failsafe responsibilities.

## Interface decision

The initial adapter uses MSP v1 over USB serial or a hardware UART:

- telemetry: `MSP_API_VERSION`, `MSP_FC_VARIANT`, `MSP_FC_VERSION`,
  `MSP_STATUS`, `MSP_BOXIDS`, `MSP_RC`, `MSP_ATTITUDE`, with optional IMU,
  GPS, altitude, and analog messages;
- command prototype: `MSP_SET_RAW_RC`;
- physical-receiver integration: Betaflight's MSP Override mode and
  `msp_override_channels_mask`.

This is preferable to replacing the receiver with `RX_MSP`: the physical ELRS
receiver remains Betaflight's normal input and configured channels are
overridden only while MSP Override is active. MAVLink is not used because
Betaflight is not a MAVLink flight-control target.

Betaflight currently defines `MSP_SET_RAW_RC` as command 200 and documents both
MSP receiver input and MSP channel override. Firmware capabilities are still
checked at runtime; the telemetry tool prints the actual FC variant and version.
Do not assume a development mock or another aircraft's version is the target.

References:

- [Betaflight MSP protocol constants](https://github.com/betaflight/betaflight/blob/master/src/main/msp/msp_protocol.h)
- [Betaflight receiver documentation](https://betaflight.com/docs/wiki/guides/current/Rx)
- [Betaflight MSP override settings](https://betaflight.com/docs/wiki/guides/current/Cli#msp-override)

## Coordinate and command conventions

- Body frame: X forward, Y right, Z down.
- Navigation frame: NED—X north, Y east, Z down.
- Positive east/right drift must produce a negative/left roll correction.
- Positive north/forward drift currently produces a negative pitch correction.
- Internal roll, pitch, and yaw commands are normalized to `[-1, +1]`.
- Internal throttle is normalized to `[0, 1]`.
- MSP output converts axes to 1000–2000 μs centered at 1500 μs.
- MSP RC order is roll, pitch, throttle, yaw, AUX1…AUX4.

The pitch, roll, and yaw signs must be confirmed on the Receiver tab and on a
propeller-free bench for the exact radio/FC configuration.

## Development setup

```bash
cd src/ballancer
npm run build:check
```

Without `--check`, the build script installs only runtime dependencies. It
requires Python 3.11 or newer and explains how to install `python3-venv` when
that Raspberry Pi OS package is missing.

## Simulation

Simulation never opens a serial port or sends commands:

```bash
.venv/bin/fpv-stabilizer --config config/config.yaml \
  --simulation right_drift --cycles 20
```

Available scenarios:

- `no_drift`
- `right_drift`
- `left_drift`
- `forward_drift`
- `backward_drift`
- `gps_loss`
- `telemetry_loss`
- `pilot_override`

Expected `right_drift` result: bounded negative roll correction. Expected
`pilot_override` result: the large pilot roll is preserved and automated roll
correction has zero blending weight.

## Telemetry-only prototype

Connect over USB first:

```bash
.venv/bin/fpv-telemetry --config config/config.yaml
```

Expected output is one JSON snapshot containing `fc_variant: "BTFL"`, the
actual firmware version, attitude, RC channels, arming state, and whatever
optional sensors the FC supplies.

Failure modes:

- no serial device: set `serial.port` to a stable `/dev/serial/by-id/...` path;
- permission denied: add the service account to `dialout`, then log in again;
- timeout: verify the selected port has MSP enabled and baud rate matches;
- rejected optional sensor command: the field remains unavailable;
- wrong device: connection is refused unless `MSP_FC_VARIANT` is `BTFL`.

## Dry run with real telemetry

Dry-run calculates and logs corrections but never calls the command method:

```bash
.venv/bin/fpv-stabilizer --config config/config.yaml --dry-run
```

Start here, record several manual flights, and inspect `var/flight.csv`.
Telemetry older than 200 ms, GPS loss, Betaflight failsafe, a missing AUX switch,
or a disabled AUX switch resets the PID and produces zero correction.

## Disarmed bench output

1. Remove every propeller.
2. Secure the frame.
3. Keep the physical transmitter powered and connected.
4. Confirm Betaflight reports `ARMED: NO`.
5. Confirm the Receiver tab channel directions and ranges.
6. Configure MSP on the Pi-connected USB/UART.
7. Configure only the desired override channels:

   ```text
   set msp_override_channels_mask = 3
   set msp_override_failsafe = OFF
   save
   ```

   Mask `3` means roll and pitch only. Do not initially override throttle, yaw,
   AUX arming, or the kill/enable switch.
8. Assign the `MSP OVERRIDE` mode to a dedicated physical AUX range.
9. Change `output.allow_disarmed_output` to `true`.
10. Run:

   ```bash
   .venv/bin/fpv-stabilizer --config config/config.yaml --bench-output
   ```

There are two independent gates: configuration plus `--bench-output`.
Immediately before every `MSP_SET_RAW_RC`, the adapter reads FC state again and
refuses output if armed. Any command exception terminates bench output instead
of repeating the last command.

Validate the complete chain in the Receiver tab. Software reporting that a
packet was sent is not sufficient evidence that Betaflight interpreted it
correctly.

## Wiring

USB is recommended for initial work. For UART:

- Pi TX → FC RX on the selected UART;
- Pi RX ← FC TX;
- Pi GND ↔ FC GND;
- use 3.3 V logic;
- do not connect incompatible 5 V UART logic;
- power the Pi and FC through an appropriate shared-ground power design;
- enable MSP on that UART, not Serial RX;
- do not enable MSP and Serial RX on the same UART.

Use a real hardware UART, not SoftSerial, for the control/telemetry connection.

## Installation

After simulation and manual dry-run validation:

```bash
npm run build:check
npm run install:pi
sudoedit /etc/fpv-stabilizer/config.yaml
npm start
sudo journalctl -u fpv-stabilizer -f
npm stop
```

The installed systemd service always starts with `--dry-run`. Changing it to
bench or future flight output is deliberately a separate manual engineering
decision. Re-running `npm run install:pi` upgrades the application without
overwriting the deployed configuration. Run
`npm run install:pi -- --replace-config` only when the repository default should
intentionally replace it. The service is deliberately not enabled at boot;
start it explicitly after checking serial-port ownership.

The dashboard's `pi-health-agent` and this service must not read the same
flight-controller serial port concurrently. `start.sh` detects the normal
dashboard configuration and refuses to start while its flight-controller
telemetry is active. Disable that telemetry first, while leaving the rest of
the dashboard agent available. The serial adapter also requests an exclusive
OS-level lock as a second guard against accidental concurrent access.

## Fleet deployment

The remote deployment scripts use the same root-defaults plus per-client JSON
format as the dashboard. All fleet commands use `config/pi-fleet.json`:

```bash
# Validate all merged client settings without SSH connections.
npm run deploy:fleet:check
npm run start:check
npm run stop:check

# Install or upgrade every configured Pi. Services remain stopped.
npm run deploy:fleet

# Start or stop the installed service on every configured Pi over SSH.
npm start
npm stop
```

Deploy only one client with a compatible JSON object:

```bash
cp config/pi-client.example.json config/pi-client.json
chmod 600 config/pi-client.json
npm run deploy:client -- --config config/pi-client.json
```

See `config/pi-fleet.example.json` for balancer-specific defaults. The optional
`ballancer.replace_config` flag controls whether deployment replaces the YAML
on that Pi. Fleet deployment never starts the service automatically; disable
the dashboard agent's flight-controller telemetry before running `npm start`.
When operating directly on a Pi, use `npm run start:local` and
`npm run stop:local`.

## Tuning sequence

The YAML gains are conservative placeholders, not final values and not
Betaflight PID values.

1. Validate signs in simulation.
2. Collect dry-run GPS velocity and pilot data.
3. Tune proportional gain in replay/simulation until correction direction and
   magnitude are plausible.
4. Verify one axis with props removed.
5. Add derivative filtering only if the measured velocity is noisy.
6. Add integral slowly and verify anti-windup.
7. Keep correction limits very small.
8. Do not proceed to armed output until a separately reviewed phase implements
   heartbeat expiry and the exact Betaflight override behavior has been observed
   on the target firmware.

## Safety checklist

- [ ] Actual Betaflight version recorded with `fpv-telemetry`
- [ ] Props removed for every command-output test
- [ ] Physical receiver remains Betaflight's primary receiver
- [ ] MSP Override has a dedicated physical enable switch
- [ ] Override mask excludes throttle, arming, and kill switch initially
- [ ] `msp_override_failsafe` remains OFF
- [ ] Betaflight failsafe tested without the Pi
- [ ] Telemetry timeout tested
- [ ] GPS loss tested
- [ ] AUX disable tested
- [ ] Pilot stick override tested per axis
- [ ] All correction signs verified in the Receiver tab
- [ ] CSV logs reviewed before changing gains

## Current boundary

Closed-loop armed output is intentionally not implemented. The next phase must
first verify the target Betaflight version, measure MSP update latency/jitter,
confirm timeout behavior when packets stop, and design a reviewed transition
from disarmed-only output to an armed MSP Override session. Until then, the
project is a telemetry, simulation, dry-run, and prop-free bench tool.
