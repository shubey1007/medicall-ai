# Debugging Stories

Real bugs hit while building MediCall AI. Each one taught a lesson worth remembering.

## 1. Audio Silence on Phone Calls

**Symptom:** Caller dialed the Twilio number, heard nothing — silence — but the dashboard showed the AI was actually speaking. Transcripts were being captured (proving OpenAI was responding) but the audio never made it to the caller's ear.

**Root cause:** The audio resampling step used `scipy.signal.resample_poly`, which returns a `numpy.float64` array. We were doing `np.clip(...).astype("<i2")` to convert back to int16 PCM, but the conversion produced bytes that Twilio's mu-law encoder accepted but rendered as silence (likely DC offset or alignment issues).

**Fix:** Replaced the entire scipy + numpy pipeline with `audioop.ratecv(data, 2, 1, from_rate, to_rate, None)` which stays in 16-bit integer space throughout. No float64 intermediate, no conversion artifacts.

**Lesson:** When dealing with audio formats, prefer codecs that operate in the native sample type. Don't bounce through float unless you actually need DSP.

## 2. AI Responded in Spanish

**Symptom:** Test call to the Twilio number → AI greeting was "Hola, gracias por llamar a MediCall AI. ¿En qué puedo ayudarle hoy?" The patient was an English speaker and the system was meant to respond in English.

**Root cause:** None of the agent system prompts explicitly specified the response language. OpenAI auto-detected based on some signal (possibly call locale) and defaulted to Spanish.

**Fix:** Added `"Always respond in English, regardless of the language the caller uses."` as the second line of every agent's system prompt.

**Lesson:** Never assume LLMs default to the language you expect. Be explicit about every behavior you care about, especially for multi-region deployments.

## 3. Vapi "Meeting Has Ended / Ejected"

**Symptom:** Browser demo call connected via the Vapi Web SDK, then immediately disconnected with a Daily.co error: `{type: 'daily-error', errorMsg: 'Meeting has ended', error: {type: 'ejected'}}`. Console showed Vapi accepted the WebSocket but rejected the assistant config.

**Root cause:** Three things were wrong with the assistant config:
1. Used `systemPrompt: "..."` — Vapi's current API uses `messages: [{role: "system", content: "..."}]`
2. Voice was `playht / jennifer` — not available on free tier
3. Transcriber was `nova-2` with `language: "multi"` — multilingual mode requires `nova-3`

**Fix:** Updated the config to use the `messages` array format, switched voice to `11labs / burt`, and switched transcriber to `language: "en-US"` (single-language mode).

**Lesson:** When integrating a third-party voice platform, validate the assistant config against their current docs before debugging audio. The Daily.co eject error is generic — the actual rejection happens at the Vapi API layer.

## 4. Partial Transcripts Spamming the UI

**Symptom:** During a Vapi browser demo, the live transcript pane was flooded with lines like:
```
You: Yeah. Can you
You: Yeah. Can you
You: Yeah. Can you help me
```
Each interim Deepgram update was being appended as a new transcript row.

**Root cause:** The `vapi.on("message", ...)` handler appended every transcript message to state, regardless of whether it was a partial or final transcript. Deepgram streams partial transcripts continuously as the user speaks.

**Fix:** Filter on `msg.transcriptType === "final"` before appending.

**Lesson:** Streaming STT APIs always emit partial + final events. UI consumers should always filter to final unless they specifically want to show live in-progress text.

## 5. DetachedInstanceError in summary_svc

**Symptom:** Post-call summary generation occasionally failed with `sqlalchemy.exc.DetachedInstanceError: Instance <Call ...> is not bound to a Session`.

**Root cause:** `summary_svc.generate_summary()` opened a `db_session` block to load the Call, then closed it, then made an OpenAI call. After the OpenAI call, it opened a *second* `db_session` block to insert the CallSummary — but accessed `call.patient_id` on the now-detached `call` object. With `expire_on_commit=True`, the attribute had been expired and could not be lazily loaded outside a session.

**Fix:** Capture `patient_id = call.patient_id` *inside* the first `db_session` block before it closes. Then use the local `patient_id` variable in the second block.

**Lesson:** With async SQLAlchemy, never rely on lazy attribute access on objects loaded in one session and used in another. Capture scalar values before the session closes.

## 6. Python 3.13 Removed audioop From Stdlib

**Symptom:** `import audioop` failed with `ModuleNotFoundError` after upgrading the dev environment to Python 3.13.

**Root cause:** [PEP 594](https://peps.python.org/pep-0594/) removed several "dead batteries" from the Python standard library, including `audioop`, in Python 3.13. The stdlib G.711 mu-law codec was simply gone.

**Fix:** Added a try/except fallback to the third-party `audioop-lts` package which is API-compatible:

```python
try:
    import audioop  # stdlib on Python < 3.13
except ModuleNotFoundError:
    import audioop_lts as audioop  # type: ignore[no-redef]
```

**Lesson:** Python's stdlib is shrinking. Watch PEP 594 and similar deprecations when planning upgrades. For codecs and other niche modules, having a third-party fallback is cheap insurance.
