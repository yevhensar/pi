import { useEffect, useMemo, useState } from "react";
import type { MessageCipher } from "@pi-health/shared";
import { createMessageCipher } from "@pi-health/shared";
import { DeviceCard } from "./components/DeviceCard";
import { DeviceDetail } from "./components/DeviceDetail";
import { TokenGate } from "./components/TokenGate";
import { useDeviceSocket } from "./hooks/useDeviceSocket";
import type { DeviceState } from "./types";
import { shortTime, statusFor } from "./utils";
import { socket } from "./socket";

const TOKEN_STORAGE_KEY = "pi-health-message-token";

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
