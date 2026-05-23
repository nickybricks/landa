#!/usr/bin/env python3
"""Bake final WAVs from tuner settings — mirrors the tuner's Web Audio chain exactly:
   pitch-glide resample (detune ramp) -> resonant lowpass (blob) -> attack/fade envelope * volume."""
import numpy as np, subprocess, wave, math, os, json, sys

SR = 44100
SRC = "/System/Library/Sounds/Tink.aiff"

# Decode the real Tink to mono float PCM (same source the tuner embeds)
raw = subprocess.check_output(
    ["ffmpeg","-loglevel","error","-i",SRC,"-ac","1","-ar",str(SR),"-f","s16le","-c:a","pcm_s16le","pipe:1"])
SRCPCM = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0


def resample_glide(pitchHi, pitchLo, length):
    """Variable-rate read = Web Audio detune ramp (cents linear hi->lo over length)."""
    n = int(SR * length)
    t = np.arange(n) / SR
    cents = pitchHi * 100 + (pitchLo - pitchHi) * 100 * (t / length)
    rate = 2.0 ** (cents / 1200.0)              # playback rate from detune
    pos = np.concatenate(([0.0], np.cumsum(rate)[:-1]))  # source sample index
    idx = np.floor(pos).astype(int); frac = pos - idx
    out = np.zeros(n)
    valid = idx < len(SRCPCM) - 1
    out[valid] = (SRCPCM[idx[valid]] * (1 - frac[valid])
                  + SRCPCM[idx[valid] + 1] * frac[valid])
    return out


def biquad_lowpass(x, f0, Q):
    """RBJ cookbook lowpass — matches Web Audio BiquadFilterNode 'lowpass'."""
    w0 = 2 * math.pi * f0 / SR; cw = math.cos(w0); sw = math.sin(w0)
    alpha = sw / (2 * Q)
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    b0, b1, b2 = b0 / a0, b1 / a0, b2 / a0; a1, a2 = a1 / a0, a2 / a0
    y = np.zeros_like(x); x1 = x2 = y1 = y2 = 0.0
    for i in range(len(x)):
        xi = x[i]
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, xi; y2, y1 = y1, yi; y[i] = yi
    return y


def envelope(n, length, attack, volume):
    t = np.arange(n) / SR
    atk = min(attack, length * 0.5)
    g = np.full(n, volume)
    g = np.where(t < atk, volume * (t / atk), g)            # linear attack
    fo = length - 0.018
    g = np.where(t > fo, volume * np.clip((length - t) / 0.018, 0, 1), g)  # fade out
    return g


def bake(name, p):
    sig = resample_glide(p["pitchHi"], p["pitchLo"], p["length"])
    Q = 0.4 + p["blob"] * 7.6
    sig = biquad_lowpass(sig, p["cutoff"], Q)
    sig *= envelope(len(sig), p["length"], p["attack"], p["volume"])
    sig = np.clip(sig, -1, 1)
    data = (sig * 32767).astype("<i2")
    with wave.open(f"/tmp/landa_sounds/{name}.wav", "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
    print(f"{name}: {len(data)/SR*1000:.0f}ms  peak={np.max(np.abs(sig)):.2f}")


if __name__ == "__main__":
    cfg = json.load(open(sys.argv[1]))
    for name, p in cfg.items():
        bake(name, p)
