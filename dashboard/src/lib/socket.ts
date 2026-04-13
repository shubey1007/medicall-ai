// dashboard/src/lib/socket.ts
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

export const dashboardSocket: Socket = io(`${SOCKET_URL}/dashboard`, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});

export function connectSocket(): void {
  if (!dashboardSocket.connected) {
    dashboardSocket.connect();
  }
}

export function disconnectSocket(): void {
  if (dashboardSocket.connected) {
    dashboardSocket.disconnect();
  }
}
