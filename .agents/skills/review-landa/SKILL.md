---
name: review
description: Full performance and accuracy audit of the Landa Electron app. Checks for race conditions, UI state drift, blocking main-process operations, IPC inefficiencies, backend sync issues, and code quality problems. Trigger with /review.
metadata:
  author: landa
  version: "1.0.0"
---

# Landa App Review

Run a thorough performance and accuracy audit of this Electron app. Read the files below, then report every issue you find.

## Files to Read

Always read all of these before reporting:

- `main.js` — Electron main process
- `preload.js` — context bridge
- `renderer/settings.js` — settings UI logic
- `renderer/settings.html` — settings UI markup
- `renderer/settings.css` — styles
- `backend/landa_core.py` — Python HTTP backend

## What to Audit

### 1. Main Process Blocking
- Any `execSync`, `spawnSync`, `readFileSync` calls inside IPC handlers or loops — these freeze hotkeys and tray
- Long synchronous loops in the main process
- File system scans that could be parallelised or cached

### 2. Race Conditions & State Drift
- The 1-second poll loop: does it overwrite UI state that the user is currently editing?
- `saveInFlight` guard: is it present and used consistently across all save paths (`saveConfig`, `saveCategoryEnabled`, `saveCategoryConfig`)?
- IPC handlers that send stale data to the renderer before a debounced save resolves
- `onConfigUpdated` listener: does it bail when a save is pending?

### 3. IPC Efficiency
- Config pushed to renderer on every poll tick even if unchanged — is there a `lastSentConfigStr` dedup guard?
- Unnecessary `applyConfig` DOM updates per second
- Any IPC handler that awaits multiple sequential round-trips that could be parallelised

### 4. Backend & Config Sync
- `patchConfig` vs `saveConfig` used inconsistently (tray menu uses `patchConfig`, settings window uses `saveConfig` — do they merge correctly?)
- Missing fields in `DEFAULT_CONFIG` vs what the renderer expects
- Migration logic in `_migrate()` — any fields the renderer writes that the backend doesn't know about

### 5. Memory & Timers
- Timers (`setInterval`, `setTimeout`) that are never cleared on window close
- `_whisperStatusPollTimer` and `pollTimer` — are they always cleaned up?
- IPC event listeners registered with `ipcRenderer.on` inside `onConfigUpdated` / `onNemoInstallProgress` — do they accumulate on every settings window open?
- `installedAppsCache` — TTL correct? Could it serve stale icons?

### 6. Error Handling & Accuracy
- API calls that silently return `null` on failure — does the UI handle `null` config gracefully?
- Hotkey registration failures — is the user notified?
- Backend startup race: the 2-second `setTimeout` before first config fetch — what happens if backend takes longer?
- `hotkeyInFlight` guard — does it ever get stuck `true` if an exception fires before `finally`?

### 7. Code Quality
- Dead code, commented-out blocks, unused variables
- Inconsistent error handling patterns
- Places where `config` could be `null` but isn't checked

## Output Format

Group findings by severity:

### Critical (breaks functionality or corrupts state)
- `file:line` — description

### Performance (causes lag, freezes, or unnecessary work)
- `file:line` — description

### Accuracy (UI shows wrong state, settings don't stick)
- `file:line` — description

### Minor (code quality, edge cases)
- `file:line` — description

After the findings, include a **Summary** section with:
- Total issue count by severity
- The single highest-priority fix if any issues remain
- Confirmation of which previously fixed issues are correctly resolved (the `saveInFlight` guard, `execAsync` conversion, `lastSentConfigStr` dedup)
