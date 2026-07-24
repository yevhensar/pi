import { useEffect, useMemo, useState } from "react";
import type {
  DeviceCommandName,
  DeviceCommandResult
} from "@pi-health/shared";
import type { DeviceState, DeviceStatus } from "./types";
import { socket } from "./socket";

const STALE_AFTER_MS = 90_000;

function statusFor(device: DeviceState, now: number): DeviceStatus {
  if (!device.socketConnected) return "offline";
  return now - Date.parse(device.receivedAt) > STALE_AFTER_MS ? "stale" : "online";
}

function timeAgo(date: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(date)) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function duration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function bytes(value: number): string {
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** unit).toFixed(unit > 2 ? 1 : 0)} ${units[unit]}`;
}

function shortTime(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(date));
}

const commandOptions: { command: DeviceCommandName; label: string; description: string }[] = [
  { command: "system.info", label: "System info", description: "Kernel, OS, and architecture" },
  { command: "disk.usage", label: "Disk usage", description: "Mounted filesystem capacity" },
  { command: "network.interfaces", label: "Network", description: "Interface and address status" },
  { command: "processes.top", label: "Top processes", description: "Processes ranked by CPU use" }
];

function DeviceCard({
  device,
  now,
  onOpen
}: {
  device: DeviceState;
  now: number;
  onOpen: () => void;
}) {
  const status = statusFor(device, now);
  const usedMemory = device.health.totalMemoryBytes - device.health.freeMemoryBytes;
  const memoryPercent = Math.min(
    100,
    Math.round((usedMemory / device.health.totalMemoryBytes) * 100)
  );

  return (
    <article
      className="device-card is-clickable"
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
      aria-label={`View details for ${device.health.deviceId}`}
    >
      <div className="device-head">
        <div className="device-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="device-title">
          <h2>{device.health.deviceId}</h2>
          <p>{device.health.hostname}</p>
        </div>
        <span className={`status status-${status}`}>
          <i />
          {status}
        </span>
      </div>

      <dl className="device-facts">
        <div>
          <dt>Last signal</dt>
          <dd title={shortTime(device.receivedAt)}>{timeAgo(device.receivedAt, now)}</dd>
        </div>
        <div>
          <dt>Uptime</dt>
          <dd>{duration(device.health.uptimeSeconds)}</dd>
        </div>
        <div>
          <dt>System</dt>
          <dd>{device.health.platform} · {device.health.architecture}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>v{device.health.appVersion}</dd>
        </div>
      </dl>

      <div className="metric">
        <div className="metric-label">
          <span>Memory</span>
          <strong>{bytes(usedMemory)} / {bytes(device.health.totalMemoryBytes)}</strong>
        </div>
        <div className="progress" aria-label={`${memoryPercent}% memory used`}>
          <span style={{ width: `${memoryPercent}%` }} />
        </div>
      </div>

      <div className="load-row">
        <span>CPU load</span>
        <div>
          {device.health.loadAverage.map((load, index) => (
            <span className="load-chip" key={index}>{load.toFixed(2)}</span>
          ))}
        </div>
      </div>

      <div className="network">
        <span>Network</span>
        <div>
          {device.health.ipAddresses.length ? device.health.ipAddresses.map((ip) => (
            <code key={ip}>{ip}</code>
          )) : <em>No external address</em>}
        </div>
      </div>
      <div className="open-device">
        <span>Open device</span>
        <span aria-hidden="true">→</span>
      </div>
    </article>
  );
}

function DeviceDetail({
  device,
  now,
  onBack
}: {
  device?: DeviceState;
  now: number;
  onBack: () => void;
}) {
  const [pending, setPending] = useState<DeviceCommandName | null>(null);
  const [results, setResults] = useState<DeviceCommandResult[]>([]);

  if (!device) {
    return (
      <section className="detail-shell">
        <button className="back-button" onClick={onBack}>← Back to fleet</button>
        <div className="empty-state">
          <h2>Device not found</h2>
          <p>This Pi has not reported to the server during the current session.</p>
        </div>
      </section>
    );
  }

  const status = statusFor(device, now);
  const usedMemory = device.health.totalMemoryBytes - device.health.freeMemoryBytes;
  const memoryPercent = Math.round((usedMemory / device.health.totalMemoryBytes) * 100);

  function runCommand(command: DeviceCommandName) {
    if (!device || pending) return;
    setPending(command);
    const requestId = crypto.randomUUID();
    socket.timeout(17_000).emit(
      "device:command",
      { requestId, deviceId: device.health.deviceId, command },
      (error: Error | null, result?: DeviceCommandResult) => {
        setPending(null);
        const timestamp = new Date().toISOString();
        const completed = result ?? {
          requestId,
          deviceId: device.health.deviceId,
          command,
          success: false,
          output: "",
          startedAt: timestamp,
          completedAt: timestamp,
          error: error?.message ?? "Server did not answer"
        };
        setResults((current) => [completed, ...current].slice(0, 10));
      }
    );
  }

  return (
    <section className="detail-shell">
      <button className="back-button" onClick={onBack}>← Back to fleet</button>

      <div className="detail-heading">
        <div>
          <p className="eyebrow">Device control</p>
          <h1>{device.health.deviceId}</h1>
          <p>{device.health.hostname} · {device.health.platform}/{device.health.architecture}</p>
        </div>
        <span className={`status detail-status status-${status}`}><i />{status}</span>
      </div>

      <div className="detail-grid">
        <section className="detail-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live telemetry</p>
              <h2>System health</h2>
            </div>
            <span>{timeAgo(device.receivedAt, now)}</span>
          </div>
          <div className="detail-metrics">
            <div><span>Uptime</span><strong>{duration(device.health.uptimeSeconds)}</strong></div>
            <div><span>Memory used</span><strong>{memoryPercent}%</strong></div>
            <div><span>Free memory</span><strong>{bytes(device.health.freeMemoryBytes)}</strong></div>
            <div><span>Agent version</span><strong>v{device.health.appVersion}</strong></div>
          </div>
          <div className="metric detail-memory">
            <div className="metric-label">
              <span>Memory</span>
              <strong>{bytes(usedMemory)} / {bytes(device.health.totalMemoryBytes)}</strong>
            </div>
            <div className="progress"><span style={{ width: `${memoryPercent}%` }} /></div>
          </div>
          <div className="detail-list">
            <div>
              <span>CPU load averages</span>
              <strong>{device.health.loadAverage.map((load) => load.toFixed(2)).join(" · ")}</strong>
            </div>
            <div>
              <span>IP addresses</span>
              <strong>{device.health.ipAddresses.join(", ") || "None reported"}</strong>
            </div>
            <div>
              <span>Last agent sample</span>
              <strong>{shortTime(device.health.timestamp)}</strong>
            </div>
            <div>
              <span>Server received</span>
              <strong>{shortTime(device.receivedAt)}</strong>
            </div>
          </div>
        </section>

        <section className="detail-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Remote diagnostics</p>
              <h2>Send a command</h2>
            </div>
            <span>Allowlisted</span>
          </div>
          <p className="panel-copy">
            Commands run on this Pi through its agent and return their output here.
          </p>
          <div className="command-grid">
            {commandOptions.map((option) => (
              <button
                key={option.command}
                disabled={status === "offline" || pending !== null}
                onClick={() => runCommand(option.command)}
              >
                <span>{pending === option.command ? "Running…" : option.label}</span>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="detail-panel command-history">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Responses</p>
            <h2>Command history</h2>
          </div>
          {results.length > 0 && <button onClick={() => setResults([])}>Clear</button>}
        </div>
        {results.length === 0 ? (
          <div className="console-empty">Run a diagnostic command to see its response.</div>
        ) : results.map((result) => (
          <article className="command-result" key={result.requestId}>
            <header>
              <strong>{commandOptions.find((item) => item.command === result.command)?.label}</strong>
              <span className={result.success ? "result-ok" : "result-error"}>
                {result.success ? "Completed" : "Failed"}
              </span>
              <time>{shortTime(result.completedAt)}</time>
            </header>
            <pre>{result.success ? result.output || "(no output)" : result.error}</pre>
          </article>
        ))}
      </section>
    </section>
  );
}

export default function App() {
  const [devices, setDevices] = useState<Map<string, DeviceState>>(new Map());
  const [connected, setConnected] = useState(socket.connected);
  const [now, setNow] = useState(Date.now());
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onSnapshot = (snapshot: DeviceState[]) => {
      setDevices(new Map(snapshot.map((device) => [device.health.deviceId, device])));
      setLastUpdate(new Date());
    };
    const onUpdate = (device: DeviceState) => {
      setDevices((current) => {
        const next = new Map(current);
        next.set(device.health.deviceId, device);
        return next;
      });
      setLastUpdate(new Date());
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("devices:snapshot", onSnapshot);
    socket.on("device:updated", onUpdate);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("devices:snapshot", onSnapshot);
      socket.off("device:updated", onUpdate);
    };
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextPath: string) {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const list = useMemo(
    () => [...devices.values()].sort((a, b) => a.health.deviceId.localeCompare(b.health.deviceId)),
    [devices]
  );
  const counts = list.reduce(
    (result, device) => {
      result[statusFor(device, now)] += 1;
      return result;
    },
    { online: 0, stale: 0, offline: 0 }
  );
  const detailMatch = path.match(/^\/devices\/([^/]+)$/);
  const detailDeviceId = detailMatch ? decodeURIComponent(detailMatch[1]) : null;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Pi Health Monitor home">
          <span className="brand-icon">π</span>
          <span>Pi Health <b>Monitor</b></span>
        </a>
        <div className={`server-state ${connected ? "is-connected" : ""}`}>
          <i />
          {connected ? "Live connection" : "Reconnecting"}
        </div>
      </header>

      {detailDeviceId ? (
        <DeviceDetail
          device={devices.get(detailDeviceId)}
          now={now}
          onBack={() => navigate("/")}
        />
      ) : <>
      <section className="hero">
        <div>
          <p className="eyebrow">Local fleet overview</p>
          <h1>Your Pis, at a glance.</h1>
          <p className="intro">
            Live vitals from every Raspberry Pi on your network, with no cloud required.
          </p>
        </div>
        <div className="update-time">
          <span>Last dashboard update</span>
          <strong>{lastUpdate ? shortTime(lastUpdate.toISOString()) : "Waiting for data…"}</strong>
        </div>
      </section>

      <section className="summary" aria-label="Device summary">
        <div className="summary-card total">
          <span className="summary-icon">⌁</span>
          <div><strong>{list.length}</strong><span>Known devices</span></div>
        </div>
        <div className="summary-card online">
          <span className="summary-icon">↑</span>
          <div><strong>{counts.online}</strong><span>Online</span></div>
        </div>
        <div className="summary-card stale">
          <span className="summary-icon">~</span>
          <div><strong>{counts.stale}</strong><span>Stale</span></div>
        </div>
        <div className="summary-card offline">
          <span className="summary-icon">×</span>
          <div><strong>{counts.offline}</strong><span>Offline</span></div>
        </div>
      </section>

      <section className="fleet">
        <div className="section-title">
          <div>
            <p className="eyebrow">Fleet</p>
            <h2>Device health</h2>
          </div>
          <span>{list.length} {list.length === 1 ? "device" : "devices"}</span>
        </div>

        {list.length ? (
          <div className="device-grid">
            {list.map((device) => (
              <DeviceCard
                key={device.health.deviceId}
                device={device}
                now={now}
                onOpen={() => navigate(`/devices/${encodeURIComponent(device.health.deviceId)}`)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="radar"><span /></div>
            <h2>Listening for your first Pi</h2>
            <p>Start an agent on the network and it will appear here automatically.</p>
            <code>SERVER_URL=http://this-server:3000 npm run dev:agent</code>
          </div>
        )}
      </section>
      </>}

      <footer>
        <span>Pi Health Monitor</span>
        <span>Local network · Private by design</span>
      </footer>
    </main>
  );
}
