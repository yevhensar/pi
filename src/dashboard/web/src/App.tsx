import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CameraCapture,
  CameraHealth,
  DeviceCommandName,
  DeviceCommandResult,
  DeviceState as SharedDeviceState,
  EncryptedEnvelope,
  MessageCipher,
  ObjectDetectionHealth
} from "@pi-health/shared";
import { createMessageCipher, messageContexts } from "@pi-health/shared";
import type { DeviceState, DeviceStatus } from "./types";
import { socket } from "./socket";
import { WhepVideoSession } from "./webrtc";

const STALE_AFTER_MS = 90_000;
const TOKEN_STORAGE_KEY = "pi-health-message-token";

type CameraStreamState = {
  status: "disabled" | "stopped" | "starting" | "live" | "error";
  width: number;
  height: number;
  fps: number;
  startedAt?: string;
  error?: string;
  viewerToken?: string;
};

function SecureWebRtcVideo({
  url,
  token,
  onError
}: {
  url: string;
  token: string;
  onError: (error: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stopped = false;
    let session: WhepVideoSession | undefined;
    let retryTimer: number | undefined;

    const connect = async () => {
      if (stopped || !videoRef.current) return;
      session?.close();
      session = new WhepVideoSession(url, token);
      try {
        await session.connect(videoRef.current, () => {
          if (!stopped) retryTimer = window.setTimeout(() => void connect(), 2_000);
        });
        if (!stopped) onError("");
      } catch (error) {
        if (stopped) return;
        onError(error instanceof Error ? error.message : "Secure WebRTC connection failed");
        retryTimer = window.setTimeout(() => void connect(), 2_000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      session?.close();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onError, token, url]);

  return <video autoPlay muted playsInline ref={videoRef} />;
}

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

function TokenGate({
  error,
  onUnlock
}: {
  error: string;
  onUnlock: (token: string) => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  return (
    <main className="unlock-page">
      <form
        className="unlock-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setUnlocking(true);
          try {
            await onUnlock(token);
          } catch {
            // The parent renders the validation error.
          } finally {
            setUnlocking(false);
          }
        }}
      >
        <span className="brand-icon">π</span>
        <p className="eyebrow">Encrypted fleet</p>
        <h1>Unlock the dashboard</h1>
        <p>
          Enter the shared message token. It is retained only for this browser tab.
        </p>
        <label>
          Message token
          <input
            autoComplete="off"
            autoFocus
            onChange={(event) => setToken(event.target.value)}
            placeholder="43-character token"
            spellCheck={false}
            type="password"
            value={token}
          />
        </label>
        {error && <div className="unlock-error">{error}</div>}
        <button disabled={unlocking || !token.trim()} type="submit">
          {unlocking ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}

const commandOptions: {
  command: DeviceCommandName;
  label: string;
  description: string;
  kind?: "motor-start" | "motor-stop";
}[] = [
  { command: "system.info", label: "System info", description: "Kernel, OS, and architecture" },
  { command: "disk.usage", label: "Disk usage", description: "Mounted filesystem capacity" },
  { command: "network.interfaces", label: "Network", description: "Interface and address status" },
  { command: "processes.top", label: "Top processes", description: "Processes ranked by CPU use" },
  {
    command: "flight-controller.motor-test.start",
    label: "Start motor test",
    description: "Fixed low output with an automatic 3-second maximum cutoff",
    kind: "motor-start"
  },
  {
    command: "flight-controller.motor-test.stop",
    label: "Stop motor test",
    description: "Reset all detected Betaflight motor-test outputs to minimum",
    kind: "motor-stop"
  }
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

type AttitudeSample = {
  rollDeg: number;
  pitchDeg: number;
  headingDeg?: number;
  sampledAt: string;
};

function HorizonBalance({
  device,
  cipher,
  online
}: {
  device: DeviceState;
  cipher: MessageCipher;
  online: boolean;
}) {
  const controller = device.health.flightController;
  const supported =
    online &&
    controller?.vehicleConnected === true &&
    controller.protocol === "msp";
  const [sample, setSample] = useState<AttitudeSample | null>(
    controller?.rollDeg !== undefined && controller.pitchDeg !== undefined
      ? {
          rollDeg: controller.rollDeg,
          pitchDeg: controller.pitchDeg,
          sampledAt: controller.checkedAt
        }
      : null
  );
  const [monitorState, setMonitorState] = useState<"connecting" | "live" | "paused" | "error">(
    supported ? "connecting" : "paused"
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    if (!supported) {
      setMonitorState("paused");
      setError("");
      return () => undefined;
    }

    async function requestSample() {
      if (stopped) return;
      const requestId = crypto.randomUUID();
      try {
        const encryptedRequest = await cipher.encrypt(messageContexts.browserCommand, {
          requestId,
          deviceId: device.health.deviceId,
          command: "flight-controller.attitude"
        });
        socket.timeout(5_000).emit(
          "device:command",
          encryptedRequest,
          async (socketError: Error | null, message?: EncryptedEnvelope) => {
            if (stopped) return;
            try {
              if (socketError || !message) {
                throw socketError ?? new Error("Pi did not answer");
              }
              const result = await cipher.decrypt<DeviceCommandResult>(
                messageContexts.browserCommandResult,
                message
              );
              if (!result.success) throw new Error(result.error ?? "Attitude sample failed");
              const next = JSON.parse(result.output) as AttitudeSample;
              if (!Number.isFinite(next.rollDeg) || !Number.isFinite(next.pitchDeg)) {
                throw new Error("Pi returned invalid attitude data");
              }
              setSample(next);
              setMonitorState("live");
              setError("");
            } catch (failure) {
              setMonitorState("error");
              setError(failure instanceof Error ? failure.message : "Attitude sample failed");
            } finally {
              if (!stopped) timer = window.setTimeout(requestSample, 1_000);
            }
          }
        );
      } catch (failure) {
        if (stopped) return;
        setMonitorState("error");
        setError(failure instanceof Error ? failure.message : "Could not request attitude");
        timer = window.setTimeout(requestSample, 1_000);
      }
    }

    setMonitorState("connecting");
    void requestSample();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [cipher, device.health.deviceId, supported]);

  const roll = Math.max(-180, Math.min(180, sample?.rollDeg ?? 0));
  const pitch = Math.max(-90, Math.min(90, sample?.pitchDeg ?? 0));
  const balanceMagnitude = Math.hypot(roll, pitch);
  const level = balanceMagnitude <= 2;

  return (
    <section className="detail-panel horizon-panel">
      <div className="panel-heading horizon-heading">
        <div>
          <p className="eyebrow">Betaflight attitude</p>
          <h2>Balance to horizon</h2>
        </div>
        <span className={`horizon-state horizon-${monitorState}`}>
          <i />
          {monitorState}
        </span>
      </div>

      <div className="horizon-layout">
        <div
          className="artificial-horizon"
          aria-label={`Roll ${roll.toFixed(1)} degrees, pitch ${pitch.toFixed(1)} degrees`}
          role="img"
        >
          <div
            className="horizon-world"
            style={{ transform: `translateY(${pitch * 2}px) rotate(${-roll}deg)` }}
          >
            <div className="horizon-sky" />
            <div className="horizon-line" />
            <div className="horizon-ground" />
          </div>
          <div className="pitch-mark pitch-mark-up"><span>10</span></div>
          <div className="pitch-mark pitch-mark-center" />
          <div className="pitch-mark pitch-mark-down"><span>10</span></div>
          <div className="aircraft-reference"><i /><b /><i /></div>
          <div className="roll-pointer">▼</div>
        </div>

        <div className="attitude-readout">
          <div>
            <span>Roll</span>
            <strong>{sample ? `${roll.toFixed(1)}°` : "—"}</strong>
          </div>
          <div>
            <span>Pitch</span>
            <strong>{sample ? `${pitch.toFixed(1)}°` : "—"}</strong>
          </div>
          <div>
            <span>Level state</span>
            <strong className={level && sample ? "is-level" : ""}>
              {!sample ? "Waiting" : level ? "Level" : "Offset"}
            </strong>
          </div>
          <div>
            <span>Sample</span>
            <strong>{sample ? shortTime(sample.sampledAt) : "No sample"}</strong>
          </div>
        </div>
      </div>

      <p className="horizon-note">
        {error
          ? error
          : !online
          ? "Monitoring is paused while the Pi is offline."
          : controller?.protocol !== "msp"
          ? "This monitor currently supports Betaflight over MSP only."
          : "Read-only roll and pitch samples are requested from Betaflight through this Pi."}
      </p>
    </section>
  );
}

function CameraPanel({
  device,
  cipher,
  online
}: {
  device: DeviceState;
  cipher: MessageCipher;
  online: boolean;
}) {
  const [health, setHealth] = useState<CameraHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [capture, setCapture] = useState<CameraCapture | null>(null);
  const [liveView, setLiveView] = useState(false);
  const liveViewRef = useRef(false);
  const [stream, setStream] = useState<CameraStreamState | null>(null);
  const [streamChanging, setStreamChanging] = useState(false);
  const [streamError, setStreamError] = useState("");
  const [detection, setDetection] = useState<ObjectDetectionHealth | null>(
    device.health.objectDetection ?? null
  );
  const [resumingDetection, setResumingDetection] = useState(false);

  async function sendCameraCommand(
    command:
      | "camera.health"
      | "camera.capture"
      | "camera.stream.start"
      | "camera.stream.stop"
      | "camera.stream.status"
      | "object-detection.latest"
      | "object-detection.resume",
    timeout: number
  ): Promise<DeviceCommandResult> {
    const requestId = crypto.randomUUID();
    const encryptedRequest = await cipher.encrypt(messageContexts.browserCommand, {
      requestId,
      deviceId: device.health.deviceId,
      command
    });
    return new Promise((resolve, reject) => {
      socket.timeout(timeout).emit(
        "device:command",
        encryptedRequest,
        async (error: Error | null, message?: EncryptedEnvelope) => {
          if (error || !message) {
            reject(error ?? new Error("Pi did not answer"));
            return;
          }
          try {
            resolve(
              await cipher.decrypt<DeviceCommandResult>(
                messageContexts.browserCommandResult,
                message
              )
            );
          } catch (failure) {
            reject(failure);
          }
        }
      );
    });
  }

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let failures = 0;

    async function checkCamera() {
      if (stopped || !online || liveView || document.hidden) return;
      setChecking(true);
      try {
        const result = await sendCameraCommand("camera.health", 8_000);
        if (!result.success) throw new Error(result.error ?? "Camera health check failed");
        const next = JSON.parse(result.output) as CameraHealth;
        if (!next.checkedAt || typeof next.available !== "boolean") {
          throw new Error("Pi returned invalid camera health data");
        }
        failures = 0;
        setHealth(next);
        setHealthError("");
      } catch (failure) {
        failures += 1;
        if (failures >= 3) {
          setHealthError(
            failure instanceof Error ? failure.message : "Camera health check failed"
          );
        }
      } finally {
        if (!stopped) {
          setChecking(false);
          if (!liveView) timer = window.setTimeout(checkCamera, 5_000);
        }
      }
    }

    function handleVisibility() {
      if (document.hidden || stopped || !online || liveView) return;
      if (timer !== undefined) window.clearTimeout(timer);
      void checkCamera();
    }

    if (online && !liveView) void checkCamera();
    else {
      setChecking(false);
      setHealthError("");
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [cipher, device.health.deviceId, liveView, online]);

  useEffect(() => {
    liveViewRef.current = liveView;
  }, [liveView]);

  useEffect(() => () => {
    if (!liveViewRef.current) return;
    void (async () => {
      const encryptedRequest = await cipher.encrypt(messageContexts.browserCommand, {
        requestId: crypto.randomUUID(),
        deviceId: device.health.deviceId,
        command: "camera.stream.stop"
      });
      socket.timeout(5_000).emit("device:command", encryptedRequest, () => undefined);
    })();
  }, [cipher, device.health.deviceId]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    async function updateDetection() {
      if (stopped || !online || document.hidden) return;
      try {
        const result = await sendCameraCommand("object-detection.latest", 5_000);
        if (!result.success) throw new Error(result.error ?? "Detector status failed");
        const next = JSON.parse(result.output) as ObjectDetectionHealth;
        if (!next.status || !Array.isArray(next.detections)) {
          throw new Error("Pi returned invalid detector status");
        }
        setDetection(next);
      } catch {
        // Retain the last detector result through transient polling failures.
      } finally {
        if (!stopped) timer = window.setTimeout(updateDetection, 1_000);
      }
    }

    if (online) void updateDetection();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [cipher, device.health.deviceId, online]);

  async function takePicture() {
    if (capturing || !health?.available) return;
    setCapturing(true);
    setCaptureError("");
    try {
      const result = await sendCameraCommand("camera.capture", 15_000);
      if (!result.success) throw new Error(result.error ?? "Picture capture failed");
      const next = JSON.parse(result.output) as CameraCapture;
      if (
        next.mimeType !== "image/jpeg" ||
        !next.imageBase64 ||
        !Number.isFinite(next.sizeBytes)
      ) {
        throw new Error("Pi returned invalid picture data");
      }
      setCapture(next);
    } catch (failure) {
      setCaptureError(failure instanceof Error ? failure.message : "Picture capture failed");
    } finally {
      setCapturing(false);
    }
  }

  async function changeLiveView(enabled: boolean) {
    if (streamChanging) return;
    setStreamChanging(true);
    setStreamError("");
    if (enabled) {
      setLiveView(true);
      setStream((current) => ({
        status: "starting",
        width: current?.width ?? 1280,
        height: current?.height ?? 720,
        fps: current?.fps ?? 20
      }));
    }
    try {
      const result = await sendCameraCommand(
        enabled ? "camera.stream.start" : "camera.stream.stop",
        12_000
      );
      if (!result.success) throw new Error(result.error ?? "Camera stream command failed");
      const next = JSON.parse(result.output) as CameraStreamState;
      if (!next.status || !Number.isFinite(next.width) || !Number.isFinite(next.height)) {
        throw new Error("Pi returned invalid camera stream status");
      }
      setStream(next);
      setLiveView(enabled && next.status === "live");
    } catch (failure) {
      setLiveView(false);
      setStreamError(failure instanceof Error ? failure.message : "Camera stream failed");
    } finally {
      setStreamChanging(false);
    }
  }

  async function proceedMonitoring() {
    if (resumingDetection) return;
    setResumingDetection(true);
    try {
      const result = await sendCameraCommand("object-detection.resume", 8_000);
      if (!result.success) throw new Error(result.error ?? "Could not resume monitoring");
      setDetection((current) => current ? {
        ...current,
        status: "starting",
        objectPresent: false,
        count: 0,
        detections: [],
        frame: undefined,
        error: undefined
      } : current);
    } catch (failure) {
      setDetection((current) => current ? {
        ...current,
        error: failure instanceof Error ? failure.message : "Could not resume monitoring"
      } : current);
    } finally {
      setResumingDetection(false);
    }
  }

  const status = !online
    ? "offline"
    : healthError
    ? "error"
    : health?.status ?? (checking ? "checking" : "unknown");
  const detectionFrame = detection?.status === "paused" ? detection.frame : undefined;
  const displayedCapture = detectionFrame ?? capture;
  const streamUrl = `${window.location.protocol}//${window.location.hostname}:8889/${encodeURIComponent(device.health.deviceId)}-camera/whep`;

  return (
    <section className="detail-panel camera-panel">
      <div className="panel-heading camera-heading">
        <div>
          <p className="eyebrow">Pi camera</p>
          <h2>Camera health and capture</h2>
        </div>
        <span className={`camera-status camera-${status}`}>
          <i />
          {status}
        </span>
      </div>

      <div className="camera-layout">
        <div className="camera-overview">
          <div className="camera-lens" aria-hidden="true">
            <i><b /></i>
          </div>
          <div className="camera-facts">
            <div>
              <span>Camera</span>
              <strong>{health?.model ?? (health?.available ? "Detected camera" : "Not detected")}</strong>
            </div>
            <div>
              <span>Backend</span>
              <strong>{health?.backend ?? "Waiting for Pi"}</strong>
            </div>
            <div>
              <span>Health check</span>
              <strong>{health?.checkedAt ? shortTime(health.checkedAt) : "No check received"}</strong>
            </div>
            <div>
              <span>Capture profile</span>
              <strong>1280 × 720 JPEG</strong>
            </div>
          </div>
          <button
            className="capture-button"
            disabled={!online || !health?.available || capturing}
            onClick={() => void takePicture()}
          >
            <span aria-hidden="true">●</span>
            {capturing ? "Capturing…" : "Take picture"}
          </button>
          <label className={`live-preview-toggle ${liveView ? "is-active" : ""}`}>
            <input
              checked={liveView}
              disabled={!online || !health?.available}
              onChange={(event) => void changeLiveView(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>{streamChanging ? "Changing stream…" : "Live WebRTC video"}</strong>
              <small>Real-time 1280 × 720 H.264 from this Pi</small>
            </span>
          </label>
          {(healthError || health?.error || captureError || streamError || stream?.error) && (
            <div className="camera-error-message">
              {captureError || streamError || stream?.error || healthError || health?.error}
            </div>
          )}
          {!online && <p className="camera-help">Camera checks pause while the Pi is offline.</p>}
          {online && health?.status === "missing" && (
            <p className="camera-help">{health.details ?? "No CSI camera was reported."}</p>
          )}
          <div className={`detector-status detector-${detection?.status ?? "starting"}`}>
            <div>
              <span>On-device detector</span>
              <strong>
                {detection?.status === "disabled"
                  ? "Disabled"
                  : detection?.objectPresent
                  ? `${detection.count} car${detection.count === 1 ? "" : "s"} detected`
                  : detection?.status === "healthy"
                  ? "No cars detected"
                  : detection?.status ?? "Starting"}
              </strong>
            </div>
            <small>
              {detection?.inferenceMs !== undefined
                ? `${detection.inferenceMs.toLocaleString()} ms inference`
                : `Target interval ${detection?.intervalMs ?? 1000} ms`}
            </small>
            {detection?.error && <p>{detection.error}</p>}
            {detection?.status === "paused" && (
              <button
                className="proceed-monitoring"
                disabled={resumingDetection}
                onClick={() => void proceedMonitoring()}
              >
                {resumingDetection ? "Resuming…" : "Proceed monitoring"}
              </button>
            )}
          </div>
        </div>

        <div className={`camera-preview ${displayedCapture || liveView ? "has-capture" : ""}`}>
          {liveView ? (
            <>
              <div className="camera-video-stage">
                {stream?.viewerToken ? (
                  <SecureWebRtcVideo
                    onError={setStreamError}
                    token={stream.viewerToken}
                    url={streamUrl}
                  />
                ) : (
                  <div className="camera-stream-connecting">Authorizing secure video…</div>
                )}
                {detection?.detections.map((item, index) => (
                  <div
                    className="detection-box"
                    key={`${item.box.x1}-${item.box.y1}-${index}`}
                    style={{
                      left: `${(item.box.x1 / (detectionFrame?.width ?? 1280)) * 100}%`,
                      top: `${(item.box.y1 / (detectionFrame?.height ?? 720)) * 100}%`,
                      width: `${((item.box.x2 - item.box.x1) / (detectionFrame?.width ?? 1280)) * 100}%`,
                      height: `${((item.box.y2 - item.box.y1) / (detectionFrame?.height ?? 720)) * 100}%`
                    }}
                  >
                    <span>{item.class} {(item.confidence * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              <div className="capture-meta">
                <div>
                  <strong>{detection?.status === "paused" ? "Car detected · monitoring paused" : "Live WebRTC video"}</strong>
                  <span>{stream?.width ?? 1280} × {stream?.height ?? 720} · {stream?.fps ?? 20} fps</span>
                </div>
              </div>
            </>
          ) : displayedCapture ? (
            <>
              <div className="camera-image-stage">
                <img
                  alt={`${detectionFrame ? "Car detection" : "Captured"} by ${device.health.deviceId} at ${shortTime(displayedCapture.capturedAt)}`}
                  src={`data:${displayedCapture.mimeType};base64,${displayedCapture.imageBase64}`}
                />
                {detectionFrame && detection!.detections.map((item, index) => (
                  <div
                    className="detection-box"
                    key={`${item.box.x1}-${item.box.y1}-${index}`}
                    style={{
                      left: `${(item.box.x1 / detectionFrame.width) * 100}%`,
                      top: `${(item.box.y1 / detectionFrame.height) * 100}%`,
                      width: `${((item.box.x2 - item.box.x1) / detectionFrame.width) * 100}%`,
                      height: `${((item.box.y2 - item.box.y1) / detectionFrame.height) * 100}%`
                    }}
                  >
                    <span>{item.class} {(item.confidence * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              <div className="capture-meta">
                <div>
                  <strong>
                    {detectionFrame
                      ? "Car detected · monitoring paused"
                      : shortTime(displayedCapture.capturedAt)}
                  </strong>
                  <span>
                    {displayedCapture.width} × {displayedCapture.height} · {bytes(displayedCapture.sizeBytes)}
                  </span>
                </div>
                <div>
                  <a
                    download={`${device.health.deviceId}-${displayedCapture.capturedAt.replace(/[:.]/g, "-")}.jpg`}
                    href={`data:${displayedCapture.mimeType};base64,${displayedCapture.imageBase64}`}
                  >
                    Download
                  </a>
                  <button
                    onClick={() => {
                      setCapture(null);
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="preview-empty">
              <span aria-hidden="true">▣</span>
              <strong>No picture captured</strong>
              <p>Pictures remain in this browser tab until dismissed or the page is closed.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DeviceDetail({
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
  const controller = device.health.flightController;
  const motorStartReady =
    status !== "offline" &&
    controller?.vehicleConnected === true &&
    controller.protocol === "msp" &&
    controller.armed === false &&
    controller.motorTestEnabled === true;
  const motorStopReady =
    status !== "offline" &&
    controller?.vehicleConnected === true &&
    controller.protocol === "msp" &&
    controller.armed === false;

  async function runCommand(command: DeviceCommandName) {
    if (!device || pending) return;
    if (
      command === "flight-controller.motor-test.start" &&
      !window.confirm(
        "Remove all propellers and clear the area before continuing.\n\n" +
        "This will command every detected motor at low output. The Pi will " +
        "automatically return output to minimum after the configured duration.\n\n" +
        "Continue with the motor test?"
      )
    ) {
      return;
    }
    setPending(command);
    const requestId = crypto.randomUUID();
    const encryptedRequest = await cipher.encrypt(messageContexts.browserCommand, {
      requestId,
      deviceId: device.health.deviceId,
      command
    });
    socket.timeout(17_000).emit(
      "device:command",
      encryptedRequest,
      async (error: Error | null, message?: EncryptedEnvelope) => {
        setPending(null);
        const timestamp = new Date().toISOString();
        let result: DeviceCommandResult | undefined;
        let decryptionError: string | undefined;
        try {
          if (message) {
            result = await cipher.decrypt<DeviceCommandResult>(
              messageContexts.browserCommandResult,
              message
            );
          }
        } catch (failure) {
          decryptionError =
            failure instanceof Error ? failure.message : "Encrypted response rejected";
        }
        const completed: DeviceCommandResult = result ?? {
          requestId,
          deviceId: device.health.deviceId,
          command,
          success: false,
          output: "",
          startedAt: timestamp,
          completedAt: timestamp,
          error: decryptionError ?? error?.message ?? "Server did not answer"
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
          {controller?.protocol === "msp" && !motorStartReady && (
            <div className="motor-lock">
              <strong>Motor test locked</strong>
              <span>
                {controller.armed
                  ? "Disarm the flight controller before testing."
                  : controller.motorTestEnabled !== true
                  ? "Enable flight_controller.motor_test in the client config, then redeploy."
                  : "The Betaflight connection must be online and report a disarmed state."}
              </span>
            </div>
          )}
          <div className="command-grid">
            {commandOptions.map((option) => {
              const motorDisabled =
                option.kind === "motor-start"
                  ? !motorStartReady
                  : option.kind === "motor-stop"
                  ? !motorStopReady
                  : false;
              return (
                <button
                  className={option.kind ?? ""}
                  key={option.command}
                  disabled={status === "offline" || pending !== null || motorDisabled}
                  onClick={() => runCommand(option.command)}
                >
                  <span>{pending === option.command ? "Running…" : option.label}</span>
                  <small>{option.description}</small>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <FlightControllerPanel device={device} />
      <HorizonBalance device={device} cipher={cipher} online={status === "online"} />
      <CameraPanel device={device} cipher={cipher} online={status === "online"} />

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

  useEffect(() => {
    if (!cipher) return;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onSnapshot = async (message: EncryptedEnvelope) => {
      try {
        const snapshot = await cipher.decrypt<SharedDeviceState[]>(
          messageContexts.deviceSnapshot,
          message
        );
        setDevices(new Map(snapshot.map((device) => [device.health.deviceId, device])));
        setLastUpdate(new Date());
        setUnlockError("");
      } catch {
        setUnlockError("The server rejected this token or returned an invalid encrypted message.");
        lockDashboard();
      }
    };
    const onUpdate = async (message: EncryptedEnvelope) => {
      try {
        const device = await cipher.decrypt<SharedDeviceState>(
          messageContexts.deviceUpdate,
          message
        );
        setDevices((current) => {
          const next = new Map(current);
          next.set(device.health.deviceId, device);
          return next;
        });
        setLastUpdate(new Date());
      } catch {
        setUnlockError("An encrypted device update could not be authenticated.");
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("devices:snapshot", onSnapshot);
    socket.on("device:updated", onUpdate);
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("devices:snapshot", onSnapshot);
      socket.off("device:updated", onUpdate);
      socket.disconnect();
    };
  }, [cipher]);

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
