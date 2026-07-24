export type HealthCheck = {
  deviceId: string;
  hostname: string;
  timestamp: string;
  uptimeSeconds: number;
  loadAverage: number[];
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  platform: string;
  architecture: string;
  appVersion: string;
  ipAddresses: string[];
};

export type DeviceState = {
  health: HealthCheck;
  receivedAt: string;
  socketConnected: boolean;
};

export type HealthAcknowledgement = {
  success: boolean;
  receivedAt: string;
  error?: string;
};

export interface AgentToServerEvents {
  "device:health": (
    health: HealthCheck,
    acknowledge: (result: HealthAcknowledgement) => void
  ) => void;
}

export interface ServerToClientEvents {
  "devices:snapshot": (devices: DeviceState[]) => void;
  "device:updated": (device: DeviceState) => void;
}
