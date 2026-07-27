import { useEffect, useRef, useState } from "react";
import type {
  CameraCapture,
  CameraHealth,
  DeviceCommandResult,
  EncryptedEnvelope,
  MessageCipher,
  ObjectDetectionHealth
} from "@pi-health/shared";
import { messageContexts } from "@pi-health/shared";
import { socket } from "../socket";
import type { DeviceState } from "../types";
import { bytes, shortTime } from "../utils";
import { WhepVideoSession } from "../webrtc";

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


export function PiCamera({
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
