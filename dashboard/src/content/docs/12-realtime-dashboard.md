# Real-Time Dashboard

How the React dashboard stays in sync with live calls via Socket.IO.

## Architecture

```
Backend (FastAPI)                      Frontend (React)
─────────────────                      ────────────────
Twilio "start" event                   useSocket() hook
   │                                       │
   ▼                                       ▼
emit_call_started(payload)             socket.on("call:started")
   │                                       │
   ▼                                       ▼
Socket.IO /dashboard namespace ──────▶ dispatch(callStarted(payload))
                                           │
                                           ▼
                                       Redux store updated
                                           │
                                           ▼
                                       Dashboard.tsx re-renders
```

## Backend: dashboard_ws.py

**File:** `backend/app/websocket/dashboard_ws.py`

Defines an `AsyncServer` from `python-socketio` mounted at `/dashboard`. Exposes async helper functions:
- `emit_call_started(payload)`
- `emit_call_ended(payload)`
- `emit_call_agent_changed(payload)`
- `emit_transcript(payload)`

Each helper does `await sio.emit(event_name, payload, namespace="/dashboard")`. There's no per-client filtering — every connected dashboard sees every event (this is a single-tenant clinic system).

## Events Emitted

| Event | When | Payload |
|-------|------|---------|
| `call:started` | Twilio `start` event accepted | `{callSid, patientPhone, patientName, agent, startedAt}` |
| `call:ended` | Call status flipped to COMPLETED | `{callSid, durationSeconds, endedAt}` |
| `call:agent_changed` | route_to_agent tool fired | `{callSid, fromAgent, toAgent}` |
| `call:transcript` | New TranscriptEntry persisted | `{callSid, role, content, agentName?, timestamp}` |

## Frontend: useSocket Hook

**File:** `dashboard/src/hooks/useSocket.ts`

A React hook that:
1. Connects to `http://localhost:8000/dashboard` namespace on mount
2. Subscribes to all 4 events above
3. Dispatches Redux actions on each event
4. Disconnects on unmount

The hook is used inside `MainLayout.tsx` so every dashboard page has live updates without rewiring per-page.

## Redux: callSlice

**File:** `dashboard/src/store/callSlice.ts`

The slice holds an `activeCalls: Record<string, ActiveCall>` keyed by `callSid`. Reducers:
- `callStarted` — adds a new entry with empty transcript array
- `callEnded` — removes the entry
- `agentChanged` — updates the `agent` field of the matching entry
- `transcriptAppended` — pushes a new transcript line into the matching entry's transcript array

This keeps the dashboard "live" — patient and agent speech appear as they arrive, agent handoffs flash, and call cards disappear when the call ends.

## Components Wired to Live State

- **Dashboard.tsx** — renders one `ActiveCallCard` per entry in `activeCalls`. Cards appear and disappear automatically as calls start and end.
- **ActiveCallCard.tsx** — shows live patient name, current agent, duration counter, and rolling transcript pane.

## Why Socket.IO Over Raw WebSockets?

Three reasons:
1. **Auto-reconnect** — if the dashboard browser tab loses connectivity, Socket.IO transparently reconnects without the app having to manage retry logic.
2. **Namespace support** — we can have separate namespaces (`/dashboard`, future `/admin`, etc.) on the same connection without colliding events.
3. **JSON event names** — `socket.on("call:started", ...)` is more readable than parsing raw WS frames.

The cost is a slightly heavier wire format, but for dashboard events (a few per second at peak) it's negligible.

## Dashboard Doesn't Persist Live State

`activeCalls` is purely client-side ephemeral state. If you refresh the page, the dashboard reloads the active calls list from `GET /api/calls?status=active` and re-subscribes via Socket.IO. There's no client-side caching — the source of truth is always the backend.
