// dashboard/src/lib/socket.ts
import { io, Socket } from "socket.io-client";
import { getToken } from "@/lib/auth";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

// We build the socket lazily so the auth token (which only exists post-login)
// is read at connect time, not at module-load time. The hook calls
// connectSocket() which (re)creates the instance with the current token.
let _socket: Socket | null = null;

function build(): Socket {
  return io(`${SOCKET_URL}/dashboard`, {
    autoConnect: false,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    auth: { token: getToken() ?? "" },
  });
}

export function getSocket(): Socket {
  if (_socket === null) _socket = build();
  return _socket;
}

// Backwards-compat export — returns the (lazy) singleton
export const dashboardSocket: Socket = new Proxy({} as Socket, {
  get(_target, prop) {
    return (getSocket() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export function connectSocket(): void {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
}

export function disconnectSocket(): void {
  const s = getSocket();
  if (s.connected) {
    s.disconnect();
  }
}

export function resetSocket(): void {
  // Force a fresh socket the next time getSocket() is called — used after
  // login/logout so the new auth token is sent in the handshake.
  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
  }
  _socket = null;
}
