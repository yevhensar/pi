Here’s a ready-to-use prompt for a coding agent such as Codex, Claude Code, Cursor, or ChatGPT.

Create a simple full-stack application for monitoring Raspberry Pi 5 devices on a local network.

## Goal

Build one application that can run in two modes:

1. **Ubuntu server mode**

   * Runs an Express.js backend.
   * Serves a React frontend.
   * Receives health-check messages from Raspberry Pi 5 devices.
   * Shows device status in real time in the React UI.
   * Uses Socket.IO between Express and React for live updates.

2. **Raspberry Pi client mode**

   * Runs a lightweight Node.js health-check agent.
   * Sends a health-check message to the Ubuntu server every 60 seconds.
   * Automatically reconnects after network or server failures.
   * Can be installed remotely over SSH using an installation script.

The system must work entirely on a local network without internet access after dependencies have been installed.

## Technology

Use:

* Node.js 22 or current LTS
* TypeScript
* React
* Vite
* Express.js
* Socket.IO
* Socket.IO Client
* npm workspaces
* systemd for running services
* Bash installation scripts

Do not use Docker.

## Project structure

Create a monorepo with this structure:

```text
pi-health-monitor/
├── package.json
├── README.md
├── shared/
│   ├── package.json
│   └── src/
│       └── types.ts
├── server/
│   ├── package.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── device-store.ts
│   │   └── config.ts
│   └── tsconfig.json
├── web/
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── socket.ts
│   │   └── types.ts
│   └── tsconfig.json
├── agent/
│   ├── package.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── health.ts
│   │   └── config.ts
│   └── tsconfig.json
└── scripts/
    ├── install-server.sh
    ├── install-pi.sh
    └── deploy-to-pi.sh
```

## Raspberry Pi health-check agent

The Pi agent must send a health-check every 60 seconds.

Send the health check immediately after connecting, then every minute.

Each health-check message should contain:

```ts
type HealthCheck = {
  deviceId: string;
  hostname: string;
  timestamp: string;
  uptimeSeconds: number;
  loadAverage: number[];
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  platform: string;
  architecture: string;
  appVersion: string;
  ipAddresses: string[];
};
```

Use Node.js built-in APIs such as:

* `os.hostname()`
* `os.uptime()`
* `os.loadavg()`
* `os.totalmem()`
* `os.freemem()`
* `os.networkInterfaces()`

The agent should connect to the Ubuntu server using Socket.IO Client.

The server URL must be configurable with an environment variable:

```text
SERVER_URL=http://192.168.1.50:3000
```

The device ID must be configurable:

```text
DEVICE_ID=pi-5-01
```

When `DEVICE_ID` is not provided, use the machine hostname.

Configure Socket.IO Client with:

* automatic reconnection
* infinite reconnection attempts
* reasonable reconnect delays
* connection error logging
* transport fallback support

The agent must emit this event:

```text
device:health
```

The server must acknowledge receipt.

The agent should log:

* successful connection
* disconnection
* connection errors
* every health-check transmission
* acknowledgement from the server

## Express server

The Express server must:

* Listen on `0.0.0.0`
* Use port `3000` by default
* Allow configuration through `PORT`
* Host the Socket.IO server
* Receive `device:health` events
* Keep the latest health information for every device in memory
* Record the server-side receive time
* Broadcast updates to connected React clients
* Serve the built React app in production

Use a device state like:

```ts
type DeviceState = {
  health: HealthCheck;
  receivedAt: string;
  socketConnected: boolean;
};
```

Identify devices by `deviceId`.

Maintain a mapping between Socket.IO connection IDs and device IDs.

When a Pi disconnects:

* mark its `socketConnected` value as `false`
* keep its last known health information
* broadcast the updated device state to the UI

Add these REST endpoints:

```text
GET /api/health
GET /api/devices
GET /api/devices/:deviceId
```

`GET /api/health` should return:

```json
{
  "status": "ok",
  "timestamp": "ISO_DATE",
  "connectedDevices": 1
}
```

`GET /api/devices` should return all known devices.

Return `404` when a device does not exist.

## Socket.IO events

Use these events:

### Pi agent to server

```text
device:health
```

Payload:

```ts
HealthCheck
```

Acknowledgement:

```ts
{
  success: boolean;
  receivedAt: string;
  error?: string;
}
```

### Server to React UI

```text
devices:snapshot
```

Sent immediately when a browser connects. Contains all devices.

```text
device:updated
```

Sent whenever a health check is received or a device disconnects.

## React interface

Create a simple dashboard.

The UI must show:

* application title
* Socket.IO server connection state
* number of known devices
* number of online devices
* number of offline devices
* last UI update time

Show devices in a table or responsive card layout.

For each device show:

* device ID
* hostname
* online/offline status
* last health-check time
* time since last health check
* uptime
* CPU load averages
* used and total memory
* IP addresses
* platform and architecture
* agent application version

Device status rules:

* `Online`: Socket.IO connection is active and the last health check is no more than 90 seconds old.
* `Stale`: connected, but the last health check is more than 90 seconds old.
* `Offline`: Socket.IO connection is not active.

Update the displayed “time since last health check” periodically in the browser.

The UI must receive initial state through `devices:snapshot` and subsequent changes through `device:updated`.

The browser should connect to Socket.IO through the same Express host. Do not hardcode an IP address in the React application.

Keep the styling simple, readable, and responsive. Do not add a large UI framework.

## Production build

Configure the project so that:

```bash
npm install
npm run build
npm start
```

will:

1. Build the shared package.
2. Build the Pi agent.
3. Build the React application.
4. Build the Express server.
5. Start Express.
6. Serve the React production files from Express.

Also provide development commands:

```bash
npm run dev
npm run dev:server
npm run dev:web
npm run dev:agent
```

In development, configure Vite to proxy:

```text
/api
/socket.io
```

to the Express development server.

## Server installation script

Create:

```text
scripts/install-server.sh
```

The script must:

* Require root or use `sudo`
* Accept the application source directory or archive
* Verify that Node.js is installed
* Install dependencies
* Build the application
* Install it under:

```text
/opt/pi-health-monitor
```

* Create a dedicated system user:

```text
pi-health-monitor
```

* Create an environment file:

```text
/etc/pi-health-monitor/server.env
```

* Create a systemd service:

```text
/etc/systemd/system/pi-health-monitor-server.service
```

* Start the service automatically at boot
* Restart the service on failure
* Show the final service status
* Print the local dashboard URL

The service should run:

```text
node /opt/pi-health-monitor/server/dist/index.js
```

Use secure file ownership and permissions.

## Raspberry Pi installation script

Create:

```text
scripts/install-pi.sh
```

The script runs on the Pi and must support:

```bash
sudo ./install-pi.sh \
  --server-url http://192.168.1.50:3000 \
  --device-id pi-5-01
```

The script must:

* Validate required arguments
* Verify that Node.js is installed
* Install the agent under:

```text
/opt/pi-health-agent
```

* Copy only files required by the agent
* Install production dependencies
* Create a dedicated system user:

```text
pi-health-agent
```

* Create:

```text
/etc/pi-health-agent/agent.env
```

Containing:

```text
SERVER_URL=http://192.168.1.50:3000
DEVICE_ID=pi-5-01
HEALTH_INTERVAL_MS=60000
```

* Create:

```text
/etc/systemd/system/pi-health-agent.service
```

* Enable the service at boot
* Restart it automatically on failure
* Start the service
* Print useful commands for checking logs and status

The service should use:

```text
EnvironmentFile=/etc/pi-health-agent/agent.env
```

and run:

```text
node /opt/pi-health-agent/dist/index.js
```

## SSH deployment script

Create:

```text
scripts/deploy-to-pi.sh
```

Usage:

```bash
./scripts/deploy-to-pi.sh \
  --host pi@192.168.1.60 \
  --server-url http://192.168.1.50:3000 \
  --device-id pi-5-01
```

The deployment script must:

1. Parse command-line arguments.
2. Build the Pi agent locally.
3. Create a temporary deployment archive containing:

   * compiled agent files
   * package metadata
   * lock file
   * Pi installation script
4. Copy the archive to the Pi using `scp`.
5. Connect to the Pi using `ssh`.
6. Extract the archive.
7. Run the Pi installation script with `sudo`.
8. Remove temporary files from both machines.
9. Exit immediately when a command fails.
10. Print clear progress and error messages.

Support an optional SSH port:

```bash
--ssh-port 22
```

Do not embed passwords. Assume SSH keys or normal interactive SSH authentication.

Make all scripts idempotent so they can safely be run again to upgrade the application.

## systemd requirements

Use:

```ini
Restart=always
RestartSec=5
```

Set suitable service hardening options where they do not prevent Node.js from working, including:

```ini
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
```

Ensure the services can read their environment files and application directories.

## Validation and security

Validate incoming health-check payloads on the Express server.

At minimum:

* require a non-empty `deviceId`
* require a valid timestamp
* reject excessively large strings or arrays
* reject malformed payloads without crashing
* return a failed acknowledgement for invalid messages

Use one configurable 32-byte base64url token for authenticated application
message encryption.

Server environment:

```text
MESSAGE_TOKEN=43-character-base64url-token
```

Pi environment:

```text
MESSAGE_TOKEN=43-character-base64url-token
```

Encrypt health reports, acknowledgements, snapshots, updates, commands,
command results, and API JSON responses with AES-256-GCM. Use a fresh random
96-bit nonce for every message, authenticate the event/direction as additional
data, and reject repeated encrypted message IDs. The browser must ask the user
for the same token and retain it only in session storage for the current tab.
Never send the token itself through Socket.IO or an HTTP endpoint.

Generate the ignored `config/message-token.json` file automatically during
deployment, install it into protected systemd environment files, and provide a
separate rotation command. Static assets and Socket.IO framing are outside the
application envelope; HTTPS/WSS may be added when transport metadata also
needs protection.

## Error handling

Add proper handling for:

* invalid environment variables
* unavailable server
* malformed messages
* duplicate device IDs
* Socket.IO connection failures
* failed installation commands
* missing build artifacts
* process shutdown signals

Handle `SIGINT` and `SIGTERM` gracefully in both the server and agent.

## Documentation

Write a complete `README.md` containing:

* architecture overview
* prerequisites
* development setup
* production build instructions
* Ubuntu server installation
* Raspberry Pi SSH deployment
* environment variables
* firewall instructions
* troubleshooting
* systemd commands
* log commands
* upgrade procedure
* uninstall procedure

Include example commands such as:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
```

```bash
systemctl status pi-health-monitor-server
journalctl -u pi-health-monitor-server -f
```

```bash
systemctl status pi-health-agent
journalctl -u pi-health-agent -f
```

## Expected result

Produce all project files with complete, working code.

Do not provide pseudocode or omit implementation details.

After generating the files:

1. Display the complete project tree.
2. Explain how to run it locally.
3. Explain how to install the Ubuntu server.
4. Explain how to deploy to one Raspberry Pi over SSH.
5. Provide a short end-to-end verification checklist.
6. Mention any assumptions made.

A useful first iteration can keep device state in memory; persistent storage can be added later without changing the Pi-to-server message flow.
