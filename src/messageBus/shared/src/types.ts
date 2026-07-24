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

export const deviceCommandNames = [
  "system.info",
  "disk.usage",
  "network.interfaces",
  "processes.top"
] as const;

export type DeviceCommandName = (typeof deviceCommandNames)[number];

export type DeviceCommand = {
  requestId: string;
  command: DeviceCommandName;
};

export type DeviceCommandRequest = DeviceCommand & {
  deviceId: string;
};

export type DeviceCommandResult = DeviceCommandRequest & {
  success: boolean;
  output: string;
  startedAt: string;
  completedAt: string;
  error?: string;
};

export interface AgentToServerEvents {
  "device:health": (
    health: HealthCheck,
    acknowledge: (result: HealthAcknowledgement) => void
  ) => void;
}

export interface BrowserToServerEvents {
  "device:command": (
    request: DeviceCommandRequest,
    acknowledge: (result: DeviceCommandResult) => void
  ) => void;
}

export interface ServerToClientEvents {
  "devices:snapshot": (devices: DeviceState[]) => void;
  "device:updated": (device: DeviceState) => void;
}

export interface ServerToAgentEvents {
  "agent:command": (
    command: DeviceCommand,
    acknowledge: (result: DeviceCommandResult) => void
  ) => void;
}

export type ClientToServerEvents = AgentToServerEvents & BrowserToServerEvents;
export type ServerToSocketEvents = ServerToClientEvents & ServerToAgentEvents;
