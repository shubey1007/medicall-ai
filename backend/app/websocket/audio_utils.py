"""Audio conversion utilities for Twilio <-> OpenAI Real-Time.

Twilio sends/receives: G.711 mu-law, 8 kHz, mono
OpenAI Real-Time:     PCM16 LE,   24 kHz, mono

audioop-lts provides the same API as the stdlib audioop module (removed in
Python 3.13) and implements the ITU-T G.711 codec correctly.
scipy.signal.resample_poly handles the 8 kHz <-> 24 kHz conversion.
"""
import audioop
from math import gcd

import numpy as np
from scipy.signal import resample_poly


def mulaw_to_pcm16(data: bytes) -> bytes:
    """Decode G.711 mu-law bytes to signed 16-bit PCM bytes."""
    return audioop.ulaw2lin(data, 2)


def pcm16_to_mulaw(data: bytes) -> bytes:
    """Encode signed 16-bit PCM bytes to G.711 mu-law bytes."""
    return audioop.lin2ulaw(data, 2)


def resample_pcm16(data: bytes, from_rate: int, to_rate: int) -> bytes:
    """Resample PCM16 LE mono audio between sample rates using polyphase filter."""
    if from_rate == to_rate:
        return data
    samples = np.frombuffer(data, dtype="<i2")
    g = gcd(to_rate, from_rate)
    up, down = to_rate // g, from_rate // g
    resampled = resample_poly(samples, up, down)
    return np.clip(resampled, -32768, 32767).astype("<i2").tobytes()
