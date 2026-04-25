# v0.13.1 — Packaged App Distribution Fix

## Goal

Ship a patch release where the macOS (and Windows) package works out-of-the-box for all users, with no manual Python or pip setup required.

## Root Causes (from 0.13.0 investigation)

- **Dep problem:** The packaged app bundled `landa_core.py` but not its Python dependencies (`sounddevice`, `flask`, etc.). `findPython()` fell back to system `python3`, which lacked those modules, so the backend crashed with `ModuleNotFoundError`.
- **Config timing:** On startup, main.js waited only 2 s for `/config`; if the backend hadn't started yet, the app silently fell back to the default hotkey (`Cmd+Shift+F5`) instead of the user's saved hotkey.
- **Translocated app:** Packaged app launched from within a DMG (translocated path) was blocked by the single-instance lock from an already-running translocated instance. *(Fixed in 0.13.0.)*

## Changes in 0.13.1

- [x] `scripts/build_backend.sh` / `build_backend.ps1` — PyInstaller compiles `landa_core.py` into a self-contained binary (`landa_backend`) that bundles all Python deps. No Python or venv needed on user machines.
- [x] `scripts/before_build.js` — electron-builder `beforeBuild` hook: runs the PyInstaller script automatically before any `electron-builder` invocation (local or CI).
- [x] `package.json` — version 0.13.1, `beforeBuild` hook wired, binary dir added to `extraResources`, build scripts updated.
- [x] `main.js` `startBackend()` — checks for compiled binary (`backend/landa_backend/landa_backend`) first; falls back to Python script for dev mode.
- [x] `main.js` startup config — uses `getBestAvailableConfig()` with disk fallback instead of bare `/config` fetch, so the saved hotkey is applied even if the backend hasn't finished starting.
- [x] `.gitignore` — excludes `backend/build_venv/`, `backend/build/`, `backend/dist/`, `backend/*.spec`.
- [x] `.github/workflows/release.yml` — adds `actions/setup-python@v5` (Python 3.11) to both mac and windows CI jobs so PyInstaller is available.
- [x] `README.md` — prerequisites updated: end users need nothing; developers need Python 3.9+ for dev mode.

## Verification

- [ ] `bash scripts/build_backend.sh` runs without errors on a dev machine
- [ ] `backend/dist/landa_backend/landa_backend` binary exists and runs standalone (no venv active)
- [ ] `npm run build:mac` produces a DMG that launches from `/Applications` without error
- [ ] Backend starts correctly (no `ModuleNotFoundError`) and logs `[Landa] Starting compiled backend`
- [ ] Hotkey is registered from saved config, not the default `Cmd+Shift+F5`
- [ ] Full flow: hotkey → record → transcribe → paste works
- [ ] GitHub Actions build-mac job passes on tag push

## Release Notes

### v0.13.1 — Packaged App Distribution Fix

**All Mac (and Windows) users can now download and run Landa without installing Python or any pip packages.** The packaged app now bundles the entire Python backend as a self-contained binary compiled with PyInstaller.

#### Changes
- **Fix: backend missing deps in packaged app** — `landa_core.py` is now compiled into a standalone binary (`landa_backend`) that includes all dependencies (`Flask`, `sounddevice`, `numpy`, `openai`, etc.). No Python installation or virtual environment required.
- **Fix: hotkey reverted to default on startup** — the app now reads saved config from disk as a fallback if the backend isn't ready within the startup window, so your configured hotkey is always applied correctly.
- **Fix: translocated DMG launch** *(carried from 0.13.0)* — the app shows a clear dialog if launched from within a DMG rather than from `/Applications`.
