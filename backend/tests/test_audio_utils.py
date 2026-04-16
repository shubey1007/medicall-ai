import numpy as np
from app.websocket.audio_utils import (
    mulaw_to_pcm16, pcm16_to_mulaw, resample_pcm16,
)


def test_mulaw_pcm16_roundtrip():
    silence = bytes([0xFF] * 160)  # mulaw silence
    pcm = mulaw_to_pcm16(silence)
    assert isinstance(pcm, bytes)
    assert len(pcm) == 320  # 2 bytes per sample

    back = pcm16_to_mulaw(pcm)
    assert len(back) == 160
    # mulaw encode/decode is not exact — allow ±1 bit difference
    assert all(abs(a - b) <= 1 for a, b in zip(silence, back))


def test_resample_upsample_3x():
    pcm8k = np.zeros(80, dtype=np.int16).tobytes()
    pcm24k = resample_pcm16(pcm8k, from_rate=8000, to_rate=24000)
    assert len(pcm24k) == 480  # 240 samples * 2 bytes


def test_resample_downsample_3x():
    pcm24k = np.zeros(240, dtype=np.int16).tobytes()
    pcm8k = resample_pcm16(pcm24k, from_rate=24000, to_rate=8000)
    assert len(pcm8k) == 160  # 80 samples * 2 bytes
