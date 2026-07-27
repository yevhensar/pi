import type { DeviceState } from "../types";
import { bytes, duration, shortTime, statusFor, timeAgo } from "../utils";

export function DeviceCard({
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
