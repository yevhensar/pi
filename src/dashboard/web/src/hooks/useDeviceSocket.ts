import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  DeviceState as SharedDeviceState,
  EncryptedEnvelope,
  MessageCipher
} from "@pi-health/shared";
import { messageContexts } from "@pi-health/shared";
import { socket } from "../socket";
import type { DeviceState } from "../../../../types";

type DeviceSocketSetters = {
  setCipher: Dispatch<SetStateAction<MessageCipher | null>>;
  setConnected: Dispatch<SetStateAction<boolean>>;
  setDevices: Dispatch<SetStateAction<Map<string, DeviceState>>>;
  setLastUpdate: Dispatch<SetStateAction<Date | null>>;
  setUnlockError: Dispatch<SetStateAction<string>>;
};

export function useDeviceSocket(
  cipher: MessageCipher | null,
  {
    setCipher,
    setConnected,
    setDevices,
    setLastUpdate,
    setUnlockError
  }: DeviceSocketSetters
) {
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
        socket.disconnect();
        window.sessionStorage.removeItem("pi-health-message-token");
        setDevices(new Map());
        setConnected(false);
        setCipher(null);
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
  }, [
    cipher,
    setCipher,
    setConnected,
    setDevices,
    setLastUpdate,
    setUnlockError
  ]);
}
