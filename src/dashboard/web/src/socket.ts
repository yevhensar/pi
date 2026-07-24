import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToSocketEvents
} from "@pi-health/shared";

export const socket: Socket<ServerToSocketEvents, ClientToServerEvents> = io({
  autoConnect: false,
  transports: ["websocket", "polling"]
});
