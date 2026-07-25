import type { EncryptedEnvelope } from "./crypto.js";
export { createMessageCipher, MessageCipher, messageContexts } from "./crypto.js";
export type { EncryptedEnvelope } from "./crypto.js";

export type FlightControllerStatus = "healthy" | "warning" | "error" | "disconnected";

export type CameraHealth = {
  status: "healthy" | "busy" | "missing" | "error";
  checkedAt: string;
  available: boolean;
  backend?: "rpicam-still" | "libcamera-still";
  model?: string;
  details?: string;
  error?: string;
};

export type CameraCapture = {
  success: true;
  capturedAt: string;
  backend: "rpicam-still" | "libcamera-still";
  mimeType: "image/jpeg";
  width: number;
  height: number;
  sizeBytes: number;
  imageBase64: string;
};

export type FlightControllerHealth = {
  status: FlightControllerStatus;
  checkedAt: string;
  device?: string;
  baud?: number;
  protocol?: "mavlink" | "msp";
  vehicleConnected: boolean;
  autopilot?: string;
  vehicleType?: string;
  systemStatus?: string;
  flightMode?: string;
  armed?: boolean;
  batteryPercent?: number;
  batteryVoltageV?: number;
  gpsFixType?: string;
  satelliteCount?: number;
  gpsHealthy?: boolean;
  ekfHealthy?: boolean;
  latitude?: number;
  longitude?: number;
  relativeAltitudeM?: number;
  rollDeg?: number;
  pitchDeg?: number;
  firmwareVersion?: string;
  boardIdentifier?: string;
  boardName?: string;
  targetName?: string;
  apiVersion?: string;
  systemLoadPercent?: number;
  gyroPresent?: boolean;
  accelerometerPresent?: boolean;
  barometerPresent?: boolean;
  magnetometerPresent?: boolean;
  gpsPresent?: boolean;
  motorCount?: number;
  motorTestEnabled?: boolean;
  preArmFailures: string[];
  error?: string;
};

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
  flightController?: FlightControllerHealth;
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
  "processes.top",
  "camera.health",
  "camera.capture",
  "camera.preview",
  "flight-controller.attitude",
  "flight-controller.motor-test.start",
  "flight-controller.motor-test.stop"
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
    message: EncryptedEnvelope,
    acknowledge: (message: EncryptedEnvelope) => void
  ) => void;
}

export interface BrowserToServerEvents {
  "device:command": (
    message: EncryptedEnvelope,
    acknowledge: (message: EncryptedEnvelope) => void
  ) => void;
}

export interface ServerToClientEvents {
  "devices:snapshot": (message: EncryptedEnvelope) => void;
  "device:updated": (message: EncryptedEnvelope) => void;
}

export interface ServerToAgentEvents {
  "agent:command": (
    message: EncryptedEnvelope,
    acknowledge: (message: EncryptedEnvelope) => void
  ) => void;
}

export type ClientToServerEvents = AgentToServerEvents & BrowserToServerEvents;
export type ServerToSocketEvents = ServerToClientEvents & ServerToAgentEvents;
