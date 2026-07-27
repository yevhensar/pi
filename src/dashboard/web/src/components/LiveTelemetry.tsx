import type { DeviceState } from "../types";

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

export function LiveTelemetry({
  device,
  now
}: {
  device: DeviceState;
  now: number;
}) {
  const usedMemory = device.health.totalMemoryBytes - device.health.freeMemoryBytes;
  const memoryPercent = Math.round((usedMemory / device.health.totalMemoryBytes) * 100);

  return (
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
  );
}
