# Landa — Electron App

Cross-platform Electron frontend for Landa. Replaces the native SwiftUI app while using the same Python backend.

## Prerequisites

**End users:** No prerequisites — download the `.dmg` or `.exe` from the releases page and install normally.

**Developers:** Node.js 18+ and npm. Python 3.9+ is required to run the backend from source (`npm start`) — the build process compiles a self-contained binary so end users need neither Python nor any pip packages.

## Setup

```bash
npm install
```

## Run (Development)

```bash
npm start
```

This will:
1. Show a microphone icon in your system tray / menu bar
2. Automatically start the Python backend (`landa_core.py`) on `localhost:7890`
3. Register the global hotkey (default: `Cmd+Shift+F5` on macOS)

## Usage

- **Global hotkey** — Press the configured shortcut to start/stop recording. Transcribed text is auto-pasted into the active app.
- **Tray menu** — Right-click (or click on macOS) the tray icon to toggle reformat, change modes, open settings, or quit.
- **Cancel recording** — Press the cancel hotkey (default: `Escape`) to discard a recording in progress.
- **Hold/Resume recording** — Press the hold hotkey (default: `F6`) to pause and resume an active recording.
- **Settings** — Click "Settings…" in the tray menu to configure API keys, hotkeys, sounds, and more.
- **Modes** — Each mode category (Personal Message, Email) can be toggled on/off. When disabled, no reformatting is applied — raw transcription only. Modes only activate when you're in a linked app or URL; unlinked apps always get raw transcription.
- **Add to Vocabulary** — Press the "Add to Vocabulary" hotkey (default: `F7`) with a word selected in any app to instantly open Settings and add it to your vocabulary replacements.
- **Vocabulary** — Define word replacements (e.g. correct spellings Whisper consistently mishears) in the Vocabulary tab in Settings.
- **Transcription history** — View, copy, and delete past transcriptions from the History tab in Settings.
- **Local Whisper** — Optionally run transcription locally using whisper.cpp instead of the OpenAI API.
- **GPT-4o Transcribe** — Use OpenAI's Realtime API (`gpt-4o-transcribe` or `gpt-4o-mini-transcribe`) for streaming transcription.

## Config

Configuration is stored at `~/.landa/config.json` — the same file used by the Python backend and the original Swift app. Changing settings in the Electron app updates this file.

## Build / Package

```bash
# macOS .dmg
npm run build:mac

# Windows .exe installer
npm run build:win
```

Both commands first compile the Python backend into a self-contained binary using PyInstaller (requires Python 3.9+ and pip on the build machine), then package the app with electron-builder.

## Architecture

```
electron-app/
├── main.js          # Main process: tray, backend lifecycle, global hotkey, IPC
├── preload.js       # Context bridge between main and renderer
├── renderer/
│   ├── settings.html   # Settings window markup
│   ├── settings.css    # Design system styles
│   └── settings.js     # Settings UI logic and config management
├── assets/
│   └── trayTemplate.png  # macOS menu bar icon (template image)
└── package.json
```

## Cross-Platform Notes

- **macOS**: Uses `afplay` for system sounds, `osascript` for paste simulation (via the Python backend), template images for the tray icon.
- **Windows**: The Python backend handles paste differently on Windows. Sound playback falls back to system defaults. Global shortcuts use `Ctrl` instead of `Cmd`.
