# Recording feedback sounds

The five WAVs in `assets/sounds/` (`start`, `stop`, `cancel`, `hold`, `resume`) are the
fixed, bundled recording-feedback sounds. They are **derived from the macOS "Tink"**
system sound (pitched down with a glide, smoothed, and shaped) — no third-party audio,
no licensing. They ship via `extraResources` (unpacked) so the OS players can read them
(`afplay` on macOS, PowerShell `SoundPlayer` on Windows). There is no in-app picker; the
only user control is "Mute all sounds".

## Files here (not shipped — for reproducibility only)

- `bake.py` — renders the final WAVs from `settings.json`. Mirrors the tuner's audio
  chain exactly: pitch-glide resample → resonant low-pass ("blob") → attack/fade envelope.
- `settings.json` — the locked parameters for `start`, `stop`, `cancel`. (`hold` is a copy
  of `stop`, `resume` a copy of `start`.)
- `build_tuner.py` / `build_stop_tuner.py` — generate the interactive browser tuners that
  were used to dial the sounds in by ear.

## Regenerate the WAVs

```bash
cd tools/sounds
python3 bake.py settings.json          # writes start/stop/cancel into /tmp/landa_sounds
cp /tmp/landa_sounds/stop.wav  /tmp/landa_sounds/hold.wav     # hold   = stop
cp /tmp/landa_sounds/start.wav /tmp/landa_sounds/resume.wav   # resume = start
cp /tmp/landa_sounds/{start,stop,cancel,hold,resume}.wav ../../assets/sounds/
```

Requires `ffmpeg` and `numpy`.

## Re-tune by ear

```bash
python3 build_stop_tuner.py && open /tmp/landa_sounds/stop_tuner.html
```

Drag the sliders, copy the printed settings into `settings.json`, then re-bake.
