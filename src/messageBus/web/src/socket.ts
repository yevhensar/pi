import { io, type Socket } from "socket.io-client";
import type {
  AgentToServerEvents,
  ServerToClientEvents
} from "@pi-health/shared";

export const socket: Socket<ServerToClientEvents, AgentToServerEvents> = io({
  autoConnect: true,
  transports: ["websocket", "polling"]
});
