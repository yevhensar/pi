import { useEffect, useState } from "react";
import type {
  DeviceCommandResult,
  EncryptedEnvelope,
  MessageCipher
} from "@pi-health/shared";
import { messageContexts } from "@pi-health/shared";
import { socket } from "../socket";
import type { DeviceState } from "../types";

type AttitudeSample = {
  rollDeg: number;
  pitchDeg: number;
  headingDeg?: number;
  sampledAt: string;
};

function shortTime(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(date));
}

export function HorizonBalance({
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
