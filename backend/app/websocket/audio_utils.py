"""Audio conversion utilities for Twilio <-> OpenAI Real-Time.

Twilio sends/receives: G.711 mu-law, 8 kHz, mono
OpenAI Real-Time:     PCM16 LE,   24 kHz, mono

audioop (stdlib on Python < 3.13) handles both the G.711 codec and sample-rate
conversion via ratecv, avoiding any scipy/numpy dependency in the hot audio path.
"""
try:
    import audioop  # stdlib on Python < 3.13
except ModuleNotFoundError:  # Python 3.13+ — audioop removed from stdlib
    import audioop_lts as audioop  # type: ignore[no-redef]

# ratecv state is None for one-shot conversions (stateless per-chunk)
_RATECV_STATE: None = None


def mulaw_to_pcm16(data: bytes) -> bytes:
    """Decode G.711 mu-law bytes to signed 16-bit PCM bytes."""
    return audioop.ulaw2lin(data, 2)


def pcm16_to_mulaw(data: bytes) -> bytes:
    """Encode signed 16-bit PCM bytes to G.711 mu-law bytes."""
    return audioop.lin2ulaw(data, 2)


def resample_pcm16(data: bytes, from_rate: int, to_rate: int) -> bytes:
    """Resample signed 16-bit mono PCM between sample rates using audioop.ratecv."""
    if from_rate == to_rate:
        return data
    resampled, _ = audioop.ratecv(data, 2, 1, from_rate, to_rate, None)
    return resampled
