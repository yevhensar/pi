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

Device health is intentionally held in memory. Restarting the server clears
the known-device list.

## Install the Ubuntu server

From the repository root:

```bash
sudo ./scripts/install-server.sh .
```

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

Copy the example fleet file and list each Pi with a unique device ID:

```bash
cp config/fleet.example.csv config/fleet.csv
```

```csv
# ssh_host,device_id,ssh_port
pi@192.168.1.60,pi-5-01,22
pi@192.168.1.61,pi-5-02,22
pi@192.168.1.62,pi-5-03,22
```

Deploy the entire fleet:

```bash
./scripts/deploy-fleet.sh \
  --fleet config/fleet.csv \
  --server-url http://192.168.1.50:3000
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
