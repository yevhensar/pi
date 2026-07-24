# Pi Health Monitor

A local-first dashboard and health agent for Raspberry Pi fleets. One Ubuntu
machine runs the server and dashboard. Any number of Raspberry Pis run an
independent, reconnecting client agent. After dependencies are installed, the
system needs no internet connection.

## Deployment topology

```text
                         local network
┌──────────────────────┐                 ┌──────────────────────┐
│ Ubuntu server (one)  │◀── Socket.IO ───│ Pi client: pi-5-01  │
│ Express + dashboard  │◀── Socket.IO ───│ Pi client: pi-5-02  │
│ port 3000            │◀── Socket.IO ───│ Pi client: pi-5-03  │
└──────────────────────┘                 └──────────────────────┘
```

There is only one server service. Every Pi has its own `pi-health-agent`
systemd service and must use a unique `DEVICE_ID`. All clients can point to the
same server URL, and Socket.IO reconnects them automatically after network or
server interruptions.

## Requirements

- Node.js 20 or newer (Node.js 22 LTS recommended)
- npm
- Linux with systemd for production installation
- SSH and SCP for remote deployment

## Run locally

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`. To start a test agent in another terminal:

```bash
SERVER_URL=http://127.0.0.1:3000 DEVICE_ID=pi-test npm run dev:agent
```

Development commands:

```bash
npm run dev          # Express + Vite
npm run dev:server
npm run dev:web
npm run dev:agent
npm run typecheck
```

Vite serves the UI at `http://localhost:5173` and proxies API and Socket.IO
traffic to port 3000.

## API and events

- `GET /api/health`
- `GET /api/devices`
- `GET /api/devices/:deviceId`
- agent event: `device:health`
- browser events: `devices:snapshot`, `device:updated`
- browser command: `device:command`
- server-to-agent command: `agent:command`

Device health is intentionally held in memory. Restarting the server clears
the known-device list.

Clicking a device card opens `/devices/:deviceId`, which shows expanded
telemetry and a remote diagnostic console. The console supports a strict
allowlist of non-destructive commands:

- system and kernel information
- disk usage
- network interface status
- top processes by CPU usage

Commands are executed directly without a shell, time out after 10 seconds, and
return their output to the requesting dashboard. Arbitrary shell commands are
not accepted.

### Flight-controller health

The Pi detail page includes a full-width flight-controller health section. The
agent auto-detects a controller under `/dev/serial/by-id/*`, `/dev/ttyACM*`, or
`/dev/ttyUSB*`. Protocol `auto` recognizes Betaflight USB identities and probes
them with MSP serial; other controllers are probed with MAVLink, with fallback
to the other protocol when the first probe does not answer. It reports:

- MAVLink heartbeat, autopilot, vehicle type, mode, and armed state
- battery percentage and voltage
- GPS fix and satellite count
- EKF/navigation health
- position and relative altitude when available
- ArduPilot `PreArm:` status messages observed during the probe

Configure shared fleet defaults or override them on an individual client:

```json
{
  "flight_controller": {
    "enabled": true,
    "device": "auto",
    "protocol": "auto",
    "baud": 115200
  }
}
```

Use a stable `/dev/serial/by-id/...` path instead of `auto` when more than one
serial device is connected. During deployment, the installer creates a Python
virtual environment, installs `pymavlink` and `pyserial`, and adds
`pi-health-agent` to the Linux `dialout` group. The first dependency
installation requires internet access; subsequent probes are local.

## Install the Ubuntu server

The Ubuntu server is installed on the local machine, not over SSH. Create its
configuration:

```bash
cp config/server.example.json config/server.json
```

```json
{
  "role": "server",
  "port": 3000
}
```

Validate and install through npm:

```bash
npm run deploy:server -- --config config/server.json --check-config
npm run deploy:server -- --config config/server.json
```

The install command invokes `sudo` when needed.
The service is installed under `/opt/pi-health-monitor`; configuration lives
at `/etc/pi-health-monitor/server.env`.

## Install an agent directly on a Pi

Build first, copy the project to the Pi, then run:

```bash
sudo ./scripts/install-pi.sh \
  --server-url http://192.168.1.50:3000 \
  --device-id pi-5-01
```

## Deploy one client over SSH

### JSON configuration

Create a private configuration from the safe example:

```bash
cp config/pi-client.example.json config/pi-client.json
chmod 600 config/pi-client.json
```

```json
{
  "host": "192.168.1.60",
  "ssh_user": "pi",
  "ssh_password": "",
  "sudo_password": "",
  "ssh_port": 22,
  "role": "client",
  "client_id": "pi-5-01",
  "wifi_interface": "wlan0",
  "server_url": "http://192.168.1.50:3000"
}
```

Validate without connecting or exposing passwords:

```bash
./scripts/deploy-to-pi.sh \
  --config config/pi-client.json \
  --check-config
```

Deploy:

```bash
npm run deploy:client -- --config config/pi-client.json
```

`server_url` may be omitted from JSON and supplied as
`--server-url http://192.168.1.50:3000`. Explicit command-line options override
JSON values. When `wifi_interface` is set, the agent reports addresses from
that interface; leave it empty to report all active interfaces.

Password fields are optional. Empty values use SSH keys or normal interactive
authentication and passwordless/interactive sudo. A non-empty `ssh_password`
uses the local `sshpass` utility when available. Without `sshpass`, deployment
falls back to a normal interactive SSH password prompt instead of failing.
Install it with `sudo apt install sshpass` for unattended password-based
deployment. Real `config/*.json` files are ignored by Git; keep them mode `600`
because they contain plaintext credentials.

The Pi installer checks the remote Node.js version. If Node.js 20 or newer is
missing, it installs Node.js 22 through the NodeSource Debian repository before
installing the agent. This first installation requires internet access from the
Pi; subsequent agent operation is entirely local.

### Command-line configuration

```bash
./scripts/deploy-to-pi.sh \
  --host pi@192.168.1.60 \
  --server-url http://192.168.1.50:3000 \
  --device-id pi-5-01 \
  --ssh-port 22
```

Authentication uses your normal SSH configuration or interactive login. No
password is stored by the scripts.

The command is idempotent: run it again to update that Pi while preserving its
role as a client.

## Deploy many clients over SSH

Copy the JSON fleet example:

```bash
cp config/pi-fleet.example.json config/pi-fleet.json
chmod 600 config/pi-fleet.json
```

Shared settings belong at the root and may be overridden by any client:

```json
{
  "server_url": "http://192.168.1.50:3000",
  "ssh_user": "pi",
  "ssh_password": "",
  "sudo_password": "",
  "ssh_port": 22,
  "wifi_interface": "wlan0",
  "clients": [
    {
      "host": "192.168.1.60",
      "role": "client",
      "client_id": "pi-5-01"
    },
    {
      "host": "192.168.1.61",
      "role": "client",
      "client_id": "pi-5-02"
    }
  ]
}
```

Validate every entry without connecting:

```bash
./scripts/deploy-fleet.sh \
  --config config/pi-fleet.json \
  --check-config
```

Deploy the entire fleet:

```bash
npm run deploy:clients
```

The npm command uses the private `config/pi-fleet.json` file automatically.
Validate the same file without deploying:

```bash
npm run deploy:clients -- --check-config
```

The client is built once and then deployed sequentially. Deployment stops on
the first failure so a partial rollout is visible and safe to resume. Re-run
the same command after resolving the failed host; already installed clients
are upgraded safely.

## Service operations

```bash
sudo systemctl status pi-health-monitor-server
sudo journalctl -u pi-health-monitor-server -f
sudo systemctl status pi-health-agent
sudo journalctl -u pi-health-agent -f
```

The source specification is retained in `setup.md`.
