"""Simulate a Twilio Media Stream connection to test the local pipeline.

This does NOT make a real phone call. It connects a WebSocket to the local
backend, sends a simulated "start" event followed by synthetic audio chunks,
and prints any events received from the backend.
"""
import asyncio
import base64
import json
import math
import struct
import sys
import uuid
from pathlib import Path

import websockets

BACKEND_WS = "ws://localhost:8000/media-stream"


def generate_silence_mulaw(duration_ms: int, sample_rate: int = 8000) -> bytes:
    n_samples = int(sample_rate * duration_ms / 1000)
    return bytes([0xFF] * n_samples)  # mulaw silence


def generate_tone_mulaw(freq: int, duration_ms: int, sample_rate: int = 8000) -> bytes:
    """Simple sine wave tone encoded to mulaw for testing."""
    n_samples = int(sample_rate * duration_ms / 1000)
    samples = []
    for i in range(n_samples):
        pcm = int(16000 * math.sin(2 * math.pi * freq * i / sample_rate))
        samples.append(pcm)
    pcm_bytes = struct.pack(f"<{n_samples}h", *samples)

    # Reuse backend's mulaw encoder
    sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
    from app.websocket.audio_utils import pcm16_to_mulaw
    return pcm16_to_mulaw(pcm_bytes)


async def simulate_call(
    call_sid: str = "CA_simulated_001",
    patient_phone: str = "+15550009999",
    db_call_id: str | None = None,
    patient_id: str | None = None,
) -> None:
    if db_call_id is None:
        db_call_id = str(uuid.uuid4())
    if patient_id is None:
        patient_id = str(uuid.uuid4())

    async with websockets.connect(BACKEND_WS) as ws:
        print(f"[ok] Connected to {BACKEND_WS}")

        # Send "connected" event
        await ws.send(json.dumps({"event": "connected", "protocol": "Call", "version": "1.0.0"}))

        # Send "start" event
        await ws.send(json.dumps({
            "event": "start",
            "start": {
                "streamSid": "MZ_simulated_stream",
                "callSid": call_sid,
                "customParameters": {
                    "callSid": call_sid,
                    "patientPhone": patient_phone,
                    "dbCallId": db_call_id,
                    "patientId": patient_id,
                },
            },
        }))
        print("[ok] Sent start event")

        # Send 3 seconds of silence (simulate user listening to greeting)
        chunk_ms = 20
        total_ms = 3000
        for _ in range(total_ms // chunk_ms):
            mulaw = generate_silence_mulaw(chunk_ms)
            await ws.send(json.dumps({
                "event": "media",
                "streamSid": "MZ_simulated_stream",
                "media": {"payload": base64.b64encode(mulaw).decode("ascii")},
            }))
            await asyncio.sleep(chunk_ms / 1000)

        print("[ok] Sent 3s of silence")

        # Send stop event
        await ws.send(json.dumps({"event": "stop", "streamSid": "MZ_simulated_stream"}))
        print("[ok] Sent stop event")

        # Wait briefly for any trailing responses
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=2)
                print(f"<- {msg[:200]}")
        except asyncio.TimeoutError:
            pass
        except websockets.ConnectionClosed:
            pass

    print("[ok] Simulation complete")


if __name__ == "__main__":
    asyncio.run(simulate_call())
