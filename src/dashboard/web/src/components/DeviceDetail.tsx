import type { MessageCipher } from "@pi-health/shared";
import { HorizonBalance } from "./HorizonBalance";
import { LiveTelemetry } from "./LiveTelemetry";
import { PiCamera } from "./PiCamera";
import {
  commandOptions,
  RemoteDiagnostics,
  useRemoteDiagnostics
} from "./RemoteDiagnostics";
import type { DeviceState } from "../types";
import { shortTime, statusFor } from "../utils";

function FlightControllerPanel({ device }: { device: DeviceState }) {
  const controller = device.health.flightController;
  const status = controller?.status ?? "disconnected";
  const battery =
    controller?.batteryPercent !== undefined ? `${controller.batteryPercent}%` : "Unknown";

  return (
    <section className={`detail-panel flight-controller fc-${status}`}>
      <div className="fc-heading">
        <div className="fc-identity">
          <span className="fc-icon" aria-hidden="true">✦</span>
          <div>
            <p className="eyebrow">Flight controller</p>
            <h2>{controller?.autopilot ?? "Waiting for flight controller"}</h2>
            <p>
              {controller?.vehicleType ?? "No vehicle identified"}
              {controller?.device ? ` · ${controller.device}` : ""}
            </p>
          </div>
        </div>
        <span className={`fc-status fc-status-${status}`}>
          <i />
          {status === "disconnected" ? "Not connected" : status}
        </span>
      </div>

      <div className="fc-metrics">
        <div>
          <span>Vehicle link</span>
          <strong>
            {controller?.vehicleConnected
              ? `${(controller.protocol ?? "serial").toUpperCase()} active`
              : "No controller response"}
          </strong>
          <small>{controller?.baud ? `${controller.baud.toLocaleString()} baud` : "USB serial auto-detect"}</small>
        </div>
        <div>
          <span>Flight state</span>
          <strong>
            {controller?.armed === undefined
              ? "Unknown"
              : controller.armed ? "Armed" : "Disarmed"}
          </strong>
          <small>{controller?.flightMode ?? "Mode unavailable"}</small>
        </div>
        <div>
          <span>Battery</span>
          <strong>{battery}</strong>
          <small>
            {controller?.batteryVoltageV !== undefined
              ? `${controller.batteryVoltageV.toFixed(2)} V`
              : "Voltage unavailable"}
          </small>
        </div>
        <div>
          <span>GPS</span>
          <strong>
            {controller?.gpsPresent === false
              ? "Not installed"
              : controller?.gpsFixType ?? "Unknown"}
          </strong>
          <small>
            {controller?.gpsPresent === false
              ? "Controller reports no GPS sensor"
              : controller?.satelliteCount !== undefined
              ? `${controller.satelliteCount} satellites`
              : "Satellite count unavailable"}
          </small>
        </div>
        <div>
          <span>Navigation health</span>
          <strong>
            {controller?.ekfHealthy === undefined
              ? "Unknown"
              : controller.ekfHealthy ? "EKF healthy" : "EKF warning"}
          </strong>
          <small>
            {controller?.gpsHealthy === undefined
              ? "GPS health unknown"
              : controller.gpsPresent === false ? "GPS not installed"
              : controller.gpsHealthy ? "GPS healthy" : "GPS needs attention"}
          </small>
        </div>
      </div>

      {controller?.vehicleConnected && (
        <div className="fc-secondary">
          <div>
            <span>Firmware</span>
            <strong>{controller.firmwareVersion ?? "Unknown"}</strong>
          </div>
          <div>
            <span>Board</span>
            <strong>
              {controller.boardName ?? controller.targetName ?? controller.boardIdentifier ?? "Unknown"}
            </strong>
          </div>
          <div>
            <span>Sensors</span>
            <strong>
              {[
                controller.gyroPresent && "Gyro",
                controller.accelerometerPresent && "Accel",
                controller.barometerPresent && "Baro",
                controller.magnetometerPresent && "Mag",
                controller.gpsPresent && "GPS"
              ].filter(Boolean).join(" · ") || "Not reported"}
            </strong>
          </div>
          <div>
            <span>Controller load</span>
            <strong>
              {controller.systemLoadPercent !== undefined
                ? `${controller.systemLoadPercent}%`
                : "Unknown"}
            </strong>
          </div>
        </div>
      )}

      {(controller?.error || (controller?.preArmFailures.length ?? 0) > 0) && (
        <div className="fc-advisories">
          <div>
            <span>!</span>
            <div>
              <strong>Attention needed</strong>
              {controller?.error && <p>{controller.error}</p>}
              {controller?.preArmFailures.map((failure) => <p key={failure}>{failure}</p>)}
            </div>
          </div>
        </div>
      )}

      {!controller && (
        <div className="fc-empty">
          Flight-controller telemetry will appear after the updated agent reports its first probe.
        </div>
      )}

      <footer className="fc-footer">
        <span>
          {controller?.checkedAt
            ? `Checked ${shortTime(controller.checkedAt)}`
            : "No probe received"}
        </span>
        <span>Read-only telemetry · {(controller?.protocol ?? "auto").toUpperCase()}</span>
      </footer>
    </section>
  );
}

export function DeviceDetail({
  device,
  cipher,
  now,
  onBack
}: {
  device?: DeviceState;
  cipher: MessageCipher;
  now: number;
  onBack: () => void;
}) {
  const diagnostics = useRemoteDiagnostics(device, cipher);

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
        <LiveTelemetry device={device} now={now} />

        <RemoteDiagnostics
          device={device}
          pending={diagnostics.pending}
          runCommand={diagnostics.runCommand}
          status={status}
        />
      </div>

      <FlightControllerPanel device={device} />
      <HorizonBalance device={device} cipher={cipher} online={status === "online"} />
      <PiCamera device={device} cipher={cipher} online={status === "online"} />

      <section className="detail-panel command-history">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Responses</p>
            <h2>Command history</h2>
          </div>
          {diagnostics.results.length > 0 && (
            <button onClick={diagnostics.clearResults}>Clear</button>
          )}
        </div>
        {diagnostics.results.length === 0 ? (
          <div className="console-empty">Run a diagnostic command to see its response.</div>
        ) : diagnostics.results.map((result) => (
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
