import { useEffect, useState } from "react";
import type {
  DeviceCommandResult,
  EncryptedEnvelope,
  MessageCipher
} from "@pi-health/shared";
import { messageContexts } from "@pi-health/shared";
import { socket } from "../dashboard/web/src/socket";
import type { DeviceState } from "../types";
import { shortTime } from "../utils";
import { ArtificialHorizon } from "./ArtificialHorizon";

type AttitudeSample = {
  rollDeg: number;
  pitchDeg: number;
  headingDeg?: number;
  sampledAt: string;
};

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

      <ArtificialHorizon
        hasSample={sample !== null}
        pitchDeg={sample?.pitchDeg ?? 0}
        rollDeg={sample?.rollDeg ?? 0}
        sampleLabel={sample ? shortTime(sample.sampledAt) : undefined}
      />

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
