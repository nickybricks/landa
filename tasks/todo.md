# Windows hotkey fixes (tester feedback)

## Problem
Windows tester: keyboard shortcut never fired during onboarding; Windows key / lone
modifier keys did nothing when setting a shortcut.

## Root causes
1. **Onboarding hotkey dead on Windows** — the global hotkey is registered only inside
   the macOS-only Accessibility step (`showAccGranted` → `registerMainHotkey`). Windows
   skips that step, so the hotkey is never registered before the training step.
2. **Awkward / unbindable Windows default** — default was `Ctrl+⊞+Alt+Space`, including
   the Windows key, which the capture code can't reproduce.
3. **Win key can't be bound + no feedback on lone modifiers** — capture maps ⊞ to the
   Command modifier (→ Control on Windows); bare modifier presses are silently ignored.

## Plan (decisions: Ctrl+Alt+Space default, block ⊞ cleanly, add hint)
- [x] Register main hotkey when entering the training step, all platforms
      → `renderer/onboarding.js` `initTrainStep()`
- [x] Change Windows default to Ctrl+Alt+Space
      → `backend/landa_core.py` default + `renderer/settings.js` DEFAULTS override
- [x] Update onboarding key labels to `Ctrl + Alt + Space`
      → `renderer/onboarding.js` `getHotkeyLabels()`
- [x] ~~Ignore the Windows key during capture on win32~~ REVERSED by request:
      the Win key (⊞) is now bindable, mapped to the `super` modifier on Windows
      → `renderer/settings.js` `keyEventToCombo()`
- [x] Show an inline hint when only a modifier is pressed
      → `renderer/settings.js` `handleKeyCapture()` + `showRecordingHint()` + i18n (EN/DE)
- [x] Syntax-checked all changed files (node --check, py_compile) — pass

## Review
Changes (6 edits across 3 files + backend):
- `renderer/onboarding.js` — `initTrainStep()` now calls `registerMainHotkey()` so the
  hotkey is live on Windows (which skips the macOS Accessibility step). Labels updated.
- `backend/landa_core.py` + `renderer/settings.js` — Windows default now Ctrl+Alt+Space.
- `renderer/settings.js` — `keyEventToCombo()` maps ⊞ to the `super` modifier on win32 so
  the Windows key is bindable; lone-modifier presses show an inline hint via new
  `showRecordingHint()` + `settings.shortcuts.hint` i18n.

Not done here: GUI launch test skipped — the bug is Windows-only (can't reproduce on
macOS) and launching would hijack the screen. Needs a real Windows onboarding test.

### Deferred to a later session — transcription speed + silent data loss
Full diagnosis + prioritized fix plan written up in
[windows-transcription-speed-plan.md](windows-transcription-speed-plan.md).
Headlines:
- **Speed (high priority):** local faster-whisper uses `beam_size=5` → ~3–5× slower than
  needed; warm runs are ~1× real-time on the tester's CPU. Quick win: drop to `beam_size=1`.
- **Silent data loss (critical):** recordings that take >30 s to transcribe are dropped on
  Windows — `/stop` times out at 30 s and Windows has no fallback to paste the late result.
- Plus: pin language when the user chose one (fixes short-clip mis-detection, e.g. Thai).
