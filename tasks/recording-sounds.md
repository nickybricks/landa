# Bundled recording sounds (replace OS system sounds)

## Goal
Ship our own recording-feedback sounds as fixed defaults so users don't pick a sound,
and stop depending on whatever the OS happens to have. Smooth, deep, "blob"/pop character.

## What shipped
- **5 bundled WAVs** in `assets/sounds/` (`start`, `stop`, `cancel`, `hold`, `resume`),
  identical on macOS and Windows. Derived from the macOS "Tink" sample: pitched down with
  a glide, smoothed (low-pass), shaped with a resonant "blob" filter — no third-party audio.
  - start = deep down-glide · stop = deep up-glide · cancel = deeper start (−24→−16)
  - hold = stop · resume = start
- **No picker.** Removed the five per-sound dropdowns + preview buttons from Settings.
  Only "Mute all sounds" remains.
- Generators kept in `tools/sounds/` (not shipped) for reproducibility — see its README.

## Changes
- [x] `assets/sounds/*.wav` added; `tools/sounds/` holds bake.py + tuners + settings.json
- [x] `main.js`: `playSound(kind)` now plays bundled WAVs; resolves `process.resourcesPath/sounds`
      when packaged, `__dirname/assets/sounds` in dev. Removed `DEFAULT_SOUNDS`,
      `getDefaultSound`, `listSystemSounds`, the 5 `current*Sound` vars, and the
      `get-system-sounds`/`get-default-sounds`/`play-sound` IPC handlers.
- [x] `package.json`: `extraResources` ships `assets/sounds/*.wav` → `Resources/sounds`
      (unpacked, so afplay / PowerShell SoundPlayer can read real paths — asar is unreadable
      to external players).
- [x] `preload.js`: removed `getSystemSounds` / `getDefaultSounds` / `playSound` bridges.
- [x] `renderer/settings.{html,js,css}`: removed sound-picker rows, controls, orphaned
      i18n keys (en+de) and CSS (`.sound-row`, `.sound-controls`, `.play-btn`, muted-rows).

## Fixed along the way
- **"Mute all sounds" was a no-op** on the playback side — main.js never read `sound_muted`.
  Now `playSound` is gated by a `soundsMuted` flag.
- **Mute "forgot" on the next hotkey.** The flag was only updated via `applyConfig`, which
  rides on a 300ms debounced save + backend round-trips — so the main process could still
  hold the old value when the next hotkey fired. Fixed with a direct `set-sound-muted` IPC
  (`send`→`on`) that the toggle calls immediately; config still persists it for restart, and
  `applyConfig` restores it on launch.

## Left as-is (flagged)
- Backend `landa_core.py` still has unused `sound_start/stop/cancel/hold/resume` defaults in
  its config dict. Harmless; not removed to avoid touching config validation/migration.

## Verification
- [x] `node --check` on main.js / preload.js / settings.js — pass
- [x] No remaining references to removed sound symbols
- [x] Dev path resolves to all 5 WAVs and they play via afplay
- [x] `npm start` boots with no errors
- [ ] Manual: press the hotkey in a running app to hear start/stop/cancel/hold/resume,
      and confirm "Mute all sounds" silences them. (Needs a human at the keyboard.)
