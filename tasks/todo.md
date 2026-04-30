# Recording Window — Classic / Mini / None

## Goal
A floating, always-on-top indicator that appears while recording is active. User can choose between three styles (`classic`, `mini`, `none`) from settings.

This is purely a visual indicator. No streaming text, no click-to-stop, no audio levels (yet) — those are separate follow-ups.

## Spec

### Window properties
- Frameless, transparent, `alwaysOnTop` at `screen-saver` level
- `focusable: false`, `skipTaskbar: true`, `resizable: false`, `hasShadow: false`
- Visible on all workspaces / fullscreen on macOS
- Positioned bottom-center of the display under the cursor (so it appears on the screen the user is working on)
- Sized per style:
  - **Classic**: ~280 × 56, larger pill, animated waveform bars
  - **Mini**: ~140 × 36, small pill, dot/bar pulse
- Window is created lazily on first recording, kept hidden between recordings (cheaper than recreating each time)

### Behavior
- Show when `setRecordingState(true)`; hide when `setRecordingState(false)`
- When `isOnHold` toggles, swap to a paused state (dimmer color, no animation)
- `style: 'none'` → never show the window
- Style change in settings → close existing window, recreate with new size next time

### Config schema
Add to `~/.landa/config.json`:
```json
"recording_window_style": "mini"   // "classic" | "mini" | "none"
```
Default: `"mini"`. Backend just needs to round-trip the field — no logic.

### Settings UI
New "Recording window" section in the Configuration tab (above or near Keyboard Shortcuts), with three buttons styled like Superwhisper's segmented selector. Selected one gets the primary-blue ring. No "Always show" toggle for now.

## Plan
1. **Backend** (`backend/landa_core.py`) → add `recording_window_style` to default config + persist round-trip. Verify: `GET /config` returns the field, `POST /config` saves it.
2. **Renderer files** → create `renderer/recording.html` + `recording.css` + `recording.js`. Two layouts toggled by a CSS class on `<body>`. Verify: open the file directly in a browser and the bars/pulse animate.
3. **Main process** (`main.js`) → `createRecordingWindow()`, `showRecordingWindow()`, `hideRecordingWindow()`. Wire into `setRecordingState()`. Verify: trigger hotkey → window appears, hotkey again → window hides.
4. **Settings UI** (`renderer/settings.html` + `.js` + `.css`) → segmented selector that calls `patchConfig({ recording_window_style: ... })`. Verify: choose "None" → window stops showing. Choose "Classic" → next recording shows the larger style.
5. **Cross-platform check** → confirm window properties behave the same on Windows (especially `alwaysOnTop` level and focus stealing).

## Open Questions (need user answer before coding)
1. **Animation source** — pure CSS animation now, or wire up real audio levels from the backend? Real levels need a new IPC channel + audio-level sampling in `_audio_callback`. Recommend: ship CSS-only first, add real levels later.
2. **Click behavior** — should clicking the window stop recording? Or non-interactive (pass-through)? Recommend: non-interactive (matches the "always-on-top, doesn't get in the way" intent).
3. **Position** — bottom-center of the active display, ~80px from the bottom. Sound right, or somewhere else?
4. **Default style** — `mini` (matches Superwhisper's selected default in the screenshot). OK?

## Verification (full flow)
- [ ] Start app, open settings → "Mini" is selected by default
- [ ] Press hotkey → mini pill appears bottom-center
- [ ] Press hotkey again → pill hides, paste happens
- [ ] Switch to Classic → next recording shows wider waveform
- [ ] Switch to None → recording works, no window appears
- [ ] Hold hotkey → pill dims to paused state; resume → animation resumes
- [ ] Cancel hotkey → pill hides immediately
- [ ] Window appears on the display where the cursor is, not always primary
- [ ] Doesn't steal focus (typing into another app continues to work)
