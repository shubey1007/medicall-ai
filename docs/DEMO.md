# MediCall AI — Demo Script

A 5-minute live walkthrough for judges. Practice the timing once or twice
before going on stage. Every step has a fallback in case something fails.

---

## Pre-flight checklist (run **15 minutes before** going on stage)

```bash
# 1. All containers up?
docker compose ps                # postgres, backend, dashboard all "Up"

# 2. ngrok URL still alive?
curl -s https://YOUR-NGROK.ngrok-free.app/health
# → {"status":"ok"}

# 3. Every external service reachable?
curl -s https://YOUR-NGROK.ngrok-free.app/api/health/deep | python -m json.tool
# → "overall": "ok"; every service "ok"
# If anything is "error" or "unset" — fix BEFORE going on stage.

# 4. Twilio webhook URL matches the current ngrok URL?
#    Check the Twilio console > Phone Numbers > your number > Voice config.

# 5. Login works?
#    Visit https://localhost:5173/login → enter DASHBOARD_PASSWORD → land on /

# 6. Dashboard sees Qdrant as "qdrant_ready" in backend logs?
docker compose logs backend --tail=30 | grep qdrant_ready

# 7. Pre-seed at least one patient + one doctor so the UI isn't empty.
```

---

## Demo runbook (≈5 minutes)

### Slide → Browser handoff (00:00)
> *"Let me show you what we built."*

Open the dashboard in a browser tab that's **already logged in** (so judges
don't watch a login screen). Verify:
- Dashboard page is visible
- Active Calls section is empty (or has only your test data)
- Stats tiles show real numbers

### Beat 1 — Inbound phone call (00:30)
> *"A patient calls our clinic's number."*

Pick up your phone, dial the Twilio number. Within 3 seconds:
- Call appears in **Active Calls** with patient name + agent badge
- Live transcript starts populating

Say (into the phone):
> *"Hi, I'm having chest pain since this morning. Should I come in?"*

Watch the dashboard:
- Triage agent assesses → routes to **Emergency** or **Scheduling** depending on phrasing
- Transcript shows the agent reply in real time
- Agent badge changes mid-call when routing happens

> *"Notice — speech-to-text, GPT-4o reasoning, text-to-speech, all in one
> WebSocket. Latency under 800ms."*

End the call from the phone. Within 5 seconds:
- Call disappears from Active Calls
- A summary row appears in **Call History**
- An SMS arrives on your phone

**If Twilio fails:** skip directly to Beat 2 (browser demo).

### Beat 2 — Browser demo (02:00)
> *"For audiences without a phone — same backend, different transport."*

Click **Try Demo** in the sidebar. Click **Start Demo Call**.

Say:
> *"What does ibuprofen do?"*

The Medication agent answers using the Qdrant knowledge base. Show the
live transcript panel updating.

Click **End Call**.

### Beat 3 — Patient memory (03:00)
> *"The AI remembers patients across calls."*

Click **Patients** in the sidebar → click the patient who just called.

Show the **Call History** section — your call from Beat 1 is there with
the AI summary, urgency tag, and full transcript link.

Show the **Medical Context** card — symptoms extracted automatically
into Qdrant.

> *"Next time this patient calls, the AI starts the conversation already
> knowing their history. No more 'please verify your details for the
> seventh time.'"*

### Beat 4 — Architecture flash (03:30)
> *"How is this built?"*

Click **Docs** in the sidebar → click **Architecture**.

Point at the diagram for 10 seconds. Don't read it aloud — just say:

> *"FastAPI async backend, OpenAI Realtime API, Twilio Media Streams,
> Vapi for the browser demo, Qdrant for semantic memory, Postgres for
> structured data, Socket.IO for live dashboard. Every sponsor product
> is in production use here."*

### Beat 5 — Settings UI (04:00 — optional, skip if running long)
> *"And it's deploy-ready: every credential is configurable from the UI,
> stored in Postgres, with a redacted GET so a publicly-reachable backend
> doesn't leak keys."*

Click **Settings** → scroll to OpenAI section → show the green DB / .env
badges and the masked password fields.

### Close (04:30)
> *"That's MediCall AI. The repo is at github.com/shubey1007/medicall-ai
> — deploy with `docker compose up`. Thanks!"*

---

## Recovery scripts

| Failure | Recovery |
|---|---|
| Twilio call won't connect | Verify webhook URL in Twilio console matches current ngrok URL; restart backend |
| OpenAI returns 429 | Switch to Beat 2 (browser demo uses Vapi-managed OpenAI quota) |
| Vapi browser demo "Meeting ended" | Check VITE_VAPI_PUBLIC_KEY in dashboard build; rebuild |
| Active Calls panel empty after refresh | Hit `/api/calls/active` directly to verify backend; otherwise just keep going |
| Login page won't accept password | `docker compose logs backend \| grep dashboard_password` to confirm `.env` loaded |
| Dashboard shows blank screen | Browser cache; hard reload (Ctrl+Shift+R) |

---

## After the demo

```bash
# Stop demo data from polluting analytics
# (Or just leave it — judges may want to inspect)

# Reset call history if needed:
docker compose exec postgres psql -U medicall -d medicall -c \
  "DELETE FROM transcript_entries; DELETE FROM call_summaries; DELETE FROM calls;"
```
