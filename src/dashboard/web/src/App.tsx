import { useEffect, useMemo, useState } from "react";
import type { MessageCipher } from "@pi-health/shared";
import { createMessageCipher } from "@pi-health/shared";
import { DeviceDetail } from "./components/DeviceDetail";
import { TokenGate } from "./components/TokenGate";
import { useDeviceSocket } from "./hooks/useDeviceSocket";
import type { DeviceState, DeviceStatus } from "./types";
import { socket } from "./socket";

const STALE_AFTER_MS = 90_000;
const TOKEN_STORAGE_KEY = "pi-health-message-token";

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

export default function App() {
  const [devices, setDevices] = useState<Map<string, DeviceState>>(new Map());
  const [cipher, setCipher] = useState<MessageCipher | null>(null);
  const [unlockError, setUnlockError] = useState("");
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const storedToken = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedToken) void unlockToken(storedToken);
  }, []);

  async function unlockToken(token: string) {
    try {
      const nextCipher = await createMessageCipher(token.trim());
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
      setUnlockError("");
      setCipher(nextCipher);
    } catch (error) {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      setUnlockError(error instanceof Error ? error.message : "Invalid message token");
      throw error;
    }
  }

  function lockDashboard() {
    socket.disconnect();
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setDevices(new Map());
    setConnected(false);
    setCipher(null);
  }

  useDeviceSocket(cipher, {
    setCipher,
    setConnected,
    setDevices,
    setLastUpdate,
    setUnlockError
  });

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

  if (!cipher) {
    return <TokenGate error={unlockError} onUnlock={unlockToken} />;
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Pi Health Monitor home">
          <span className="brand-icon">π</span>
          <span>Pi Health <b>Monitor</b></span>
        </a>
        <div className="topbar-actions">
          <div className={`server-state ${connected ? "is-connected" : ""}`}>
            <i />
            {connected ? "Encrypted connection" : "Reconnecting"}
          </div>
          <button className="lock-button" onClick={lockDashboard}>Lock</button>
        </div>
      </header>

      {detailDeviceId ? (
        <DeviceDetail
          cipher={cipher}
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
