import type { DeviceState, HealthCheck } from "@pi-health/shared";

export class DeviceStore {
  private readonly devices = new Map<string, DeviceState>();
  private readonly deviceIdsBySocket = new Map<string, Set<string>>();
  private readonly socketIdByDevice = new Map<string, string>();

  update(socketId: string, health: HealthCheck, receivedAt: string): DeviceState {
    const previousSocketId = this.socketIdByDevice.get(health.deviceId);
    if (previousSocketId && previousSocketId !== socketId) {
      const previousSocketDevices = this.deviceIdsBySocket.get(previousSocketId);
      previousSocketDevices?.delete(health.deviceId);
      if (previousSocketDevices?.size === 0) {
        this.deviceIdsBySocket.delete(previousSocketId);
      }
    }

    const previousSocketDevices = this.deviceIdsBySocket.get(socketId) ?? new Set<string>();
    previousSocketDevices.add(health.deviceId);
    this.deviceIdsBySocket.set(socketId, previousSocketDevices);
    this.socketIdByDevice.set(health.deviceId, socketId);

    const state: DeviceState = { health, receivedAt, socketConnected: true };
    this.devices.set(health.deviceId, state);
    return state;
  }

  disconnect(socketId: string): DeviceState[] {
    const deviceIds = this.deviceIdsBySocket.get(socketId);
    if (!deviceIds) return [];

    const changed: DeviceState[] = [];
    for (const deviceId of deviceIds) {
      if (this.socketIdByDevice.get(deviceId) !== socketId) continue;

      const current = this.devices.get(deviceId);
      if (current) {
        const offline = { ...current, socketConnected: false };
        this.devices.set(deviceId, offline);
        this.socketIdByDevice.delete(deviceId);
        changed.push(offline);
      }
    }
    this.deviceIdsBySocket.delete(socketId);
    return changed;
  }

  get(deviceId: string): DeviceState | undefined {
    return this.devices.get(deviceId);
  }

  all(): DeviceState[] {
    return [...this.devices.values()].sort((a, b) =>
      a.health.deviceId.localeCompare(b.health.deviceId)
    );
  }

  connectedCount(): number {
    return [...this.devices.values()].filter((device) => device.socketConnected).length;
  }
}
