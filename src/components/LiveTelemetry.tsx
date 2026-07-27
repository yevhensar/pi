import type { DeviceState } from "../types";
import { bytes, duration, shortTime, timeAgo } from "../utils";

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
