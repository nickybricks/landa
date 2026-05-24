const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, clipboard, dialog, ipcMain, systemPreferences, nativeTheme, shell, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const http = require('http');
const os = require('os');
const auth = require('./auth');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'http://127.0.0.1:7890';
const CONFIG_DIR = path.join(os.homedir(), '.landa');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
// Sentinel for "user has finished onboarding". Source of truth instead of the
// onboarding_completed flag in config.json — the flag has been observed to
// flip back to false across updates (config rewrites, race conditions) and
// surprise users with the onboarding flow. The marker file is only ever
// created (never written to), so it can't be clobbered by partial config saves.
const ONBOARDED_MARKER_PATH = path.join(CONFIG_DIR, '.onboarded');
// First app launch timestamp (ISO string) and a sentinel marking that the
// in-app feedback prompt has been shown (or skipped for existing users).
const FIRST_LAUNCH_PATH = path.join(CONFIG_DIR, '.first-launch-at');
const FEEDBACK_PROMPTED_PATH = path.join(CONFIG_DIR, '.feedback-prompted');
const FEEDBACK_PROMPT_DELAY_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// ---------------------------------------------------------------------------
// Diagnostic logging
//
// Persists backend output, backend crashes, and uncaught main-process errors
// to ~/Library/Logs/Landa (macOS) / %APPDATA%\Landa\logs (Windows) so support
// can diagnose crashes and "dictation stopped working" reports. Each file is
// capped and rotated once to bound disk usage.
// ---------------------------------------------------------------------------

const LOG_MAX_BYTES = 2 * 1024 * 1024; // 2 MB before rotating to .old

function logDir() {
  const dir = app.getPath('logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function appendLog(fileName, text) {
  try {
    const file = path.join(logDir(), fileName);
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) {
        fs.renameSync(file, file + '.old');
      }
    } catch {} // file may not exist yet
    fs.appendFileSync(file, text.endsWith('\n') ? text : text + '\n');
  } catch {}
}

function logEvent(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  appendLog('main.log', line);
}
const POLL_INTERVAL = 1000; // 1 second

// In dev (unpackaged), load <repo>/.env so LANDA_PROXY_URL / LANDA_APP_SECRET
// reach the Python subprocess via inherited env. Production builds bake the
// values into backend/landa_constants.py — this loader is a no-op there.
if (!app.isPackaged) {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
    }
  } catch (e) {
    console.warn('[Landa] .env load failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tray = null;
let trayIconIdle = null;
let trayIconRecording = null;
let settingsWindow = null;
let onboardingWindow = null;
let authWindow = null;
let signedIn = false;        // hard auth gate: app is inert until true
let appReady = false;        // true once whenReady init has run
let pendingAuthUrl = null;   // a landa:// callback that arrived before we were ready
let recordingWindow = null;
let recordingWindowStyle = 'mini'; // 'classic' | 'mini' | 'none'
let recordingWindowAlwaysShow = true; // when true, pill lives on screen at rest
// Pill placement as a fraction of the active display's work area: fx = pill-center-x,
// fy = pill-bottom-y. Stored relative so the spot is preserved when the pill follows
// the cursor to another monitor. null → default (bottom-center, hugging the Dock).
let recordingWindowPosition = null;
let recordingWindowActiveDisplayId = null; // display the pill currently sits on
let lastCursorDisplayId = null;            // cursor's display on the previous poll (settle filter)
let audioLevelTimer = null;
let backendProcess = null;
let pollTimer = null;
let isRecording = false;
let isOnHold = false;
let reformatEnabled = false;
let reformatMode = 'default';
let modesConfig = { enabled: { 'personal-message': false, 'email': false }, selections: { 'personal-message': 'formal', 'email': 'formal' } };
let currentShortcut = null; // Electron accelerator string
let currentCancelShortcut = null; // Electron accelerator for cancel_recording
let currentHoldShortcut = null; // Electron accelerator for hold_recording
let currentVocabShortcut = null; // Electron accelerator for add_to_vocabulary
let soundsMuted = false; // when true, skip all recording feedback sounds
let lastHotkeyTime = 0;
let hotkeyInFlight = false; // re-entrancy guard
let appQuitting = false;
let hotkeyCompletedAt = 0; // timestamp of last completed hotkey action
let isCapturingHotkey = false;
let pendingUpdateVersion = null;
let updateDownloadStarted = false;

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------

function notifyUpdateReady(version) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('update-ready', version);
    return;
  }
  // Settings window closed (the normal case — Landa runs in the tray).
  // Without this, the downloaded update sits unused until the user happens
  // to open Settings, so they stay on the old version indefinitely. Show a
  // native blocking dialog instead.
  const choice = dialog.showMessageBoxSync({
    type: 'info',
    buttons: ['Jetzt neu starten', 'Später'],
    defaultId: 0,
    cancelId: 1,
    title: 'Landa Update',
    message: `Landa ${version} ist bereit zur Installation.`,
    detail: 'Landa startet neu, um das Update anzuwenden.',
  });
  if (choice === 0) {
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall();
      } catch (err) {
        console.error('[updater] quitAndInstall failed:', err && err.message ? err.message : err);
      }
    });
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  // Safety net: if the user dismisses the update dialog, still apply the
  // downloaded update the next time Landa quits/restarts.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (updateDownloadStarted) return;
    updateDownloadStarted = true;
    autoUpdater.downloadUpdate().catch((err) => {
      console.error('[updater] downloadUpdate failed:', err && err.message ? err.message : err);
      updateDownloadStarted = false;
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateVersion = (info && info.version) || pendingUpdateVersion || '';
    notifyUpdateReady(pendingUpdateVersion);
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err && err.message ? err.message : err);
  });
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

function apiRequest(method, endpoint, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {},
      timeout: timeoutMs,
    };

    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    } else if (method === 'POST') {
      options.headers['Content-Length'] = 0;
    }

    const req = http.request(options, (res) => {
      const buffers = [];
      res.on('data', (chunk) => { buffers.push(chunk); });
      res.on('end', () => {
        const chunks = Buffer.concat(buffers).toString('utf8');
        try {
          resolve(JSON.parse(chunks));
        } catch {
          resolve(chunks);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const api = {
  fetchConfig: () => apiRequest('GET', '/config'),
  saveConfig: (config) => apiRequest('POST', '/config', config),
  patchConfig: (patch) => apiRequest('POST', '/config', patch),
  fetchStatus: () => apiRequest('GET', '/status'),
  startRecording: () => apiRequest('POST', '/start', null, 12000),
  stopRecording: () => apiRequest('POST', '/stop', null, 35000),
  cancelRecording: () => apiRequest('POST', '/cancel', null, 12000),
  holdRecording: () => apiRequest('POST', '/hold', null, 5000),
  resumeRecording: () => apiRequest('POST', '/resume', null, 5000),
  selectMode: (mode) => apiRequest('POST', '/modes/select', { mode }),
  fetchNemoStatus: () => apiRequest('GET', '/nemo/status'),
  fetchHistory: () => apiRequest('GET', '/history'),
  clearHistory: () => apiRequest('DELETE', '/history'),
  deleteHistoryEntry: (id) => apiRequest('DELETE', `/history/${encodeURIComponent(id)}`),
  acknowledgePaste: () => apiRequest('POST', '/acknowledge-paste'),
};

function readConfigFromDisk() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`[Landa] Failed to read config from disk: ${err.message}`);
    return null;
  }
}

function hasOnboardedMarker() {
  try {
    return fs.existsSync(ONBOARDED_MARKER_PATH);
  } catch {
    return false;
  }
}

function writeOnboardedMarker() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(ONBOARDED_MARKER_PATH, '');
  } catch (err) {
    console.error(`[Landa] Failed to write onboarded marker: ${err.message}`);
  }
}

// True if the user has finished onboarding at any point. The marker file is
// authoritative; we also accept the legacy onboarding_completed flag so users
// who onboarded on a previous version don't get re-onboarded after this change.
function isOnboarded(config) {
  if (hasOnboardedMarker()) return true;
  if (config && config.onboarding_completed === true) {
    // Legacy state: flag says done, marker is missing. Backfill the marker
    // so future launches can rely on it even if the flag gets rewritten.
    writeOnboardedMarker();
    return true;
  }
  return false;
}

// Feedback prompt bookkeeping. Called once at startup. Three cases:
//   - feedback already prompted → no-op
//   - first-launch timestamp already recorded → no-op
//   - user is already onboarded but has no first-launch marker → existing
//     user from before this feature; mark as prompted so we don't bother them
//   - otherwise → record first-launch timestamp for a new user
function recordFirstLaunchOrSkip() {
  try {
    if (fs.existsSync(FEEDBACK_PROMPTED_PATH)) return;
    if (fs.existsSync(FIRST_LAUNCH_PATH)) return;
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (hasOnboardedMarker()) {
      fs.writeFileSync(FEEDBACK_PROMPTED_PATH, '');
    } else {
      fs.writeFileSync(FIRST_LAUNCH_PATH, new Date().toISOString());
    }
  } catch (err) {
    console.error(`[Landa] Failed to record first-launch state: ${err.message}`);
  }
}

function shouldShowFeedbackPrompt() {
  try {
    if (fs.existsSync(FEEDBACK_PROMPTED_PATH)) return false;
    if (!fs.existsSync(FIRST_LAUNCH_PATH)) return false;
    const ts = Date.parse(fs.readFileSync(FIRST_LAUNCH_PATH, 'utf8').trim());
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts >= FEEDBACK_PROMPT_DELAY_MS;
  } catch {
    return false;
  }
}

function markFeedbackPrompted() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(FEEDBACK_PROMPTED_PATH, '');
  } catch (err) {
    console.error(`[Landa] Failed to write feedback-prompted marker: ${err.message}`);
  }
}

async function getBestAvailableConfig() {
  try {
    return await api.fetchConfig();
  } catch (err) {
    console.log(`[Landa] Backend config fetch failed, falling back to disk: ${err.message}`);
    return readConfigFromDisk();
  }
}

// ---------------------------------------------------------------------------
// Hotkey helpers
// ---------------------------------------------------------------------------

/** Convert config's HotkeyCombo to Electron accelerator string */
function hotkeyToAccelerator(combo) {
  if (!combo || !combo.key || combo.key === '') return null;

  const parts = [];
  const mods = combo.modifiers || [];

  for (const mod of mods) {
    switch (mod) {
      case 'command': parts.push('CommandOrControl'); break;
      case 'shift': parts.push('Shift'); break;
      case 'option': parts.push('Alt'); break;
      case 'control': parts.push('Ctrl'); break;
      case 'super': parts.push('Super'); break;
    }
  }

  // Map key name to Electron key
  const key = combo.key.toLowerCase();
  const keyMap = {
    'escape': 'Escape', 'space': 'Space', 'tab': 'Tab',
    'return': 'Return', 'delete': 'Backspace',
    'f1': 'F1', 'f2': 'F2', 'f3': 'F3', 'f4': 'F4',
    'f5': 'F5', 'f6': 'F6', 'f7': 'F7', 'f8': 'F8',
    'f9': 'F9', 'f10': 'F10', 'f11': 'F11', 'f12': 'F12',
  };

  const electronKey = keyMap[key] || key.toUpperCase();
  parts.push(electronKey);

  return parts.join('+');
}

function registerHotkey(combo) {
  // Unregister previous
  if (currentShortcut) {
    try { globalShortcut.unregister(currentShortcut); } catch {}
    currentShortcut = null;
  }

  const accelerator = hotkeyToAccelerator(combo);
  if (!accelerator) return;

  try {
    const ok = globalShortcut.register(accelerator, handleHotkeyPress);
    if (ok) {
      currentShortcut = accelerator;
      console.log(`[Landa] Registered hotkey: ${accelerator}`);
    } else {
      console.error(`[Landa] Failed to register hotkey: ${accelerator}`);
    }
  } catch (err) {
    console.error(`[Landa] Hotkey registration error: ${err.message}`);
  }
}

/** Update recording state and sync cancel/hold hotkey registration. */
function setRecordingState(recording) {
  const changed = isRecording !== recording;
  const wasRecording = isRecording;
  isRecording = recording;
  if (recording) {
    activateCancelHotkey();
    activateHoldHotkey();
    if (changed) {
      if (recordingWindowStyle !== 'none') {
        if (recordingWindowAlwaysShow) {
          // Already on screen at rest — just ensure it exists (don't re-show, which
          // would reassert the macOS activation policy and risk dock-icon flicker).
          if (!recordingWindow || recordingWindow.isDestroyed()) showRecordingWindow();
        } else {
          // On-demand: bring it on screen for this recording.
          showRecordingWindow();
        }
      }
      setPillRecordingActive(true);
    }
  } else {
    deactivateCancelHotkey();
    deactivateHoldHotkey();
    isOnHold = false;
    if (changed) {
      // Always-show: stay on screen, animate back to resting. On-demand: hide.
      if (recordingWindowAlwaysShow) setPillRecordingActive(false);
      else hideRecordingWindow();
    }
    // Recording just ended — history likely has a new entry (ignore cancels, which go through handleCancelPress).
    if (wasRecording && settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('history-updated');
    }
  }
  if (changed) updateTray();
}

async function handleHotkeyPress() {
  // Debounce: 500ms
  const now = Date.now();
  if (now - lastHotkeyTime < 500) return;
  lastHotkeyTime = now;

  // Re-entrancy guard — but always allow stop to go through
  if (hotkeyInFlight) {
    if (isRecording) {
      // Let the stop through even if a previous action is in-flight
      console.log(`[Landa] Hotkey in-flight but recording active — forcing stop`);
      forceStopRecording();
    } else {
      console.log(`[Landa] Hotkey ignored — previous action still in-flight`);
    }
    return;
  }
  hotkeyInFlight = true;

  const action = isRecording ? 'stop' : 'start';
  // Fire feedback sound instantly on keypress — before the backend round-trip —
  // so the click feels real-time. Backend no longer plays start/stop sounds.
  playSound(action === 'start' ? 'start' : 'stop');
  const t0 = Date.now();
  console.log(`[Landa] Hotkey pressed — action: ${action}`);
  try {
    try {
      if (isRecording) {
        stopAudioLevelPolling();
        if (recordingWindow && !recordingWindow.isDestroyed()) {
          recordingWindow.webContents.send('recording-processing', true);
        }
        const stopResponse = await api.stopRecording();
        console.log(`[Landa] stop API responded in ${Date.now() - t0}ms`);
        if (stopResponse && stopResponse.text && process.platform === 'darwin') {
          try {
            await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
            console.log(`[Landa] Direct paste triggered from /stop response`);
          } catch (err) {
            console.error('[Landa] Direct paste failed:', err.message);
          }
        } else if (stopResponse && stopResponse.text && process.platform === 'win32') {
          try {
            clipboard.writeText(stopResponse.text);
            await execAsync('powershell -command "(New-Object -COM WScript.Shell).SendKeys(\'^v\')"');
            console.log(`[Landa] Direct paste triggered from /stop response (win32)`);
          } catch (err) {
            console.error('[Landa] Direct paste failed (win32):', err.message);
          }
        }
      } else {
        const startResp = await api.startRecording();
        console.log(`[Landa] start API responded in ${Date.now() - t0}ms`);
        if (startResp && startResp.started === false) {
          console.error('[Landa] Backend failed to start recording — audio device may be stuck, see backend logs');
        }
      }
    } catch (err) {
      console.error(`[Landa] Hotkey action failed (${action}) after ${Date.now() - t0}ms: ${err.message}`);
    }

    // Always sync state — even after a timeout the backend may have acted
    try {
      const t1 = Date.now();
      const status = await api.fetchStatus();
      console.log(`[Landa] Status sync responded in ${Date.now() - t1}ms — recording: ${status.recording}`);
      setRecordingState(status.recording);
    } catch {
      // Backend unreachable — keep current state
    }
  } finally {
    console.log(`[Landa] Hotkey handling complete in ${Date.now() - t0}ms total`);
    hotkeyCompletedAt = Date.now();
    hotkeyInFlight = false;
  }
}

/** Force-stop: fire-and-forget, no guards. Used as escape hatch. */
async function forceStopRecording() {
  const t0 = Date.now();
  playSound('stop');
  console.log(`[Landa] Force stop — sending /stop`);
  try {
    await api.stopRecording();
    console.log(`[Landa] Force stop API responded in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[Landa] Force stop failed: ${err.message}`);
  }
  try {
    const status = await api.fetchStatus();
    setRecordingState(status.recording);
  } catch { /* ignore */ }
}

/** Cancel recording hotkey — discards audio entirely, no transcription */
async function handleCancelPress() {
  if (!isRecording) return; // nothing to cancel
  const t0 = Date.now();
  console.log(`[Landa] Cancel hotkey pressed — discarding recording`);
  playSound('cancel');
  try {
    await api.cancelRecording();
    console.log(`[Landa] Cancel API responded in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[Landa] Cancel failed: ${err.message}`);
  }
  try {
    const status = await api.fetchStatus();
    setRecordingState(status.recording);
  } catch { /* ignore */ }
}

/** Save the cancel combo (but don't register it globally yet — only while recording). */
function registerCancelHotkey(combo) {
  // Unregister any currently active cancel shortcut
  deactivateCancelHotkey();
  currentCancelCombo = combo;
}

/** Activate the cancel hotkey globally (call when recording starts). */
function activateCancelHotkey() {
  if (currentCancelShortcut) return; // already active

  const accelerator = hotkeyToAccelerator(currentCancelCombo);
  if (!accelerator) return;
  if (accelerator === currentShortcut) return;

  try {
    const ok = globalShortcut.register(accelerator, handleCancelPress);
    if (ok) {
      currentCancelShortcut = accelerator;
      console.log(`[Landa] Activated cancel hotkey: ${accelerator}`);
    }
  } catch (err) {
    console.error(`[Landa] Cancel hotkey activation error: ${err.message}`);
  }
}

/** Deactivate the cancel hotkey (call when recording stops). */
function deactivateCancelHotkey() {
  if (currentCancelShortcut) {
    try { globalShortcut.unregister(currentCancelShortcut); } catch {}
    currentCancelShortcut = null;
  }
}

/** Save the hold combo (but don't register globally yet — only while recording). */
function registerHoldHotkey(combo) {
  deactivateHoldHotkey();
  currentHoldCombo = combo;
}

/** Activate the hold hotkey globally (call when recording starts). */
function activateHoldHotkey() {
  if (currentHoldShortcut) return; // already active

  const accelerator = hotkeyToAccelerator(currentHoldCombo);
  if (!accelerator) return;
  if (accelerator === currentShortcut) return;
  if (accelerator === currentCancelShortcut) return;

  try {
    const ok = globalShortcut.register(accelerator, handleHoldPress);
    if (ok) {
      currentHoldShortcut = accelerator;
      console.log(`[Landa] Activated hold hotkey: ${accelerator}`);
    }
  } catch (err) {
    console.error(`[Landa] Hold hotkey activation error: ${err.message}`);
  }
}

/** Deactivate the hold hotkey (call when recording stops). */
function deactivateHoldHotkey() {
  if (currentHoldShortcut) {
    try { globalShortcut.unregister(currentHoldShortcut); } catch {}
    currentHoldShortcut = null;
  }
}

/** Toggle hold/resume for an active recording. Debounced at 500ms. */
async function handleHoldPress() {
  const now = Date.now();
  if (now - lastHotkeyTime < 500) return;
  lastHotkeyTime = now;

  if (!isRecording) return;

  const t0 = Date.now();
  if (isOnHold) {
    console.log(`[Landa] Hold hotkey pressed — resuming recording`);
    playSound('resume');
    try {
      await api.resumeRecording();
      console.log(`[Landa] /resume responded in ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(`[Landa] Resume failed: ${err.message}`);
    }
  } else {
    console.log(`[Landa] Hold hotkey pressed — pausing recording`);
    playSound('hold');
    try {
      await api.holdRecording();
      console.log(`[Landa] /hold responded in ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(`[Landa] Hold failed: ${err.message}`);
    }
  }

  try {
    const status = await api.fetchStatus();
    isOnHold = status.is_on_hold || false;
    updateTray();
    if (recordingWindow && !recordingWindow.isDestroyed()) {
      recordingWindow.webContents.send('recording-paused', isOnHold);
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Add-to-Vocabulary Hotkey
// ---------------------------------------------------------------------------

function registerVocabHotkey(combo) {
  if (currentVocabShortcut) {
    try { globalShortcut.unregister(currentVocabShortcut); } catch {}
    currentVocabShortcut = null;
  }
  if (!combo || !combo.key) return;
  const accelerator = hotkeyToAccelerator(combo);
  if (!accelerator) return;
  try {
    const ok = globalShortcut.register(accelerator, handleVocabHotkey);
    if (ok) {
      currentVocabShortcut = accelerator;
      console.log(`[Landa] Registered vocab hotkey: ${accelerator}`);
    } else {
      console.error(`[Landa] Failed to register vocab hotkey: ${accelerator}`);
    }
  } catch (err) {
    console.error(`[Landa] Vocab hotkey error: ${err.message}`);
  }
}

async function handleVocabHotkey() {
  const prevClipboard = clipboard.readText();

  // Clear clipboard so we can tell whether Cmd+C actually captured a selection.
  // Without this, a no-op Cmd+C (nothing selected) leaves the previous clipboard
  // intact and we'd mistakenly treat it as the "selected word".
  clipboard.writeText('');

  try {
    if (process.platform === 'darwin') {
      await execAsync('osascript -e \'tell application "System Events" to keystroke "c" using {command down}\'');
    } else {
      await execAsync('powershell -command "(New-Object -COM WScript.Shell).SendKeys(\'^c\')"');
    }
  } catch (err) {
    console.error(`[Landa] Vocab hotkey copy failed: ${err.message}`);
    clipboard.writeText(prevClipboard);
    return;
  }

  // Wait for clipboard to update
  await new Promise((r) => setTimeout(r, 150));

  const word = clipboard.readText().trim();
  clipboard.writeText(prevClipboard); // restore

  // If nothing was selected, open vocab with empty field rather than stale text
  openSettingsToAddVocab(word);
}

function openSettingsToAddVocab(word) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    settingsWindow.webContents.send('navigate-tab', 'vocabulary');
    settingsWindow.webContents.send('add-to-vocabulary', word);
  } else {
    openSettings();
    settingsWindow.webContents.once('did-finish-load', () => {
      settingsWindow.webContents.send('navigate-tab', 'vocabulary');
      settingsWindow.webContents.send('add-to-vocabulary', word);
    });
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

// macOS quirk: setVisibleOnAllWorkspaces briefly demotes the process to
// accessory mode. Calling setActivationPolicy('regular') restores the
// process type, but the Dock can latch onto the empty slot it cached during
// the flip — leaving a visible "running" indicator dot with no icon above it.
// Re-setting the dock icon forces the Dock to re-render the slot, which is
// the per-app equivalent of `killall Dock`.
function reassertDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  try {
    app.dock.setIcon(iconPath);
  } catch (err) {
    console.error('[Landa] reassertDockIcon failed:', err && err.message ? err.message : err);
  }
}

function createTray() {
  const isWin = process.platform === 'win32';
  const idlePath = isWin
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'trayTemplate.png');
  const recordingPath = path.join(__dirname, 'assets', 'trayRecording.png');

  trayIconIdle = fs.existsSync(idlePath) ? nativeImage.createFromPath(idlePath) : nativeImage.createEmpty();
  if (!isWin) trayIconIdle.setTemplateImage(true);

  trayIconRecording = fs.existsSync(recordingPath) ? nativeImage.createFromPath(recordingPath) : nativeImage.createEmpty();

  tray = new Tray(trayIconIdle);
  tray.setToolTip('Landa');
  if (process.platform === 'win32') {
    tray.on('click', openSettings);
  }
  updateTray();
}

function updateTray() {
  if (!tray) return;

  const sels = modesConfig.selections || {};
  const enabledMap = modesConfig.enabled || {};
  const pmEnabled = enabledMap['personal-message'] !== false;
  const emailEnabled = enabledMap['email'] !== false;
  const pmStyle = capitalize(sels['personal-message'] || 'formal');
  const emailStyle = capitalize(sels['email'] || 'formal');

  const statusLabel = isOnHold
    ? 'On Hold…'
    : isRecording
      ? 'Recording…'
      : `Idle · 💬 ${pmStyle}`;

  const styles = ['formal', 'casual', 'excited'];

  function buildModeSubmenu(categoryId, currentStyle, isEnabled) {
    return [
      {
        label: isEnabled ? 'Enabled' : 'Disabled',
        type: 'checkbox',
        checked: isEnabled,
        click: () => {
          api.patchConfig({ modes: { enabled: { [categoryId]: !isEnabled } } })
            .then(cfg => { if (cfg) applyConfig(cfg); })
            .catch(() => {});
        },
      },
      { type: 'separator' },
      ...styles.map((style) => ({
        label: capitalize(style),
        type: 'radio',
        checked: currentStyle === style,
        enabled: isEnabled,
        click: () => {
          const newSels = { ...sels, [categoryId]: style };
          api.patchConfig({ modes: { selections: newSels } })
            .then(cfg => { if (cfg) applyConfig(cfg); })
            .catch(() => {});
        },
      })),
    ];
  }

  const categoryMenus = [
    {
      label: pmEnabled ? `💬 Personal Message — ${pmStyle}` : `💬 Personal Message — Off`,
      submenu: buildModeSubmenu('personal-message', sels['personal-message'] || 'formal', pmEnabled),
    },
    {
      label: emailEnabled ? `📧 Email — ${emailStyle}` : `📧 Email — Off`,
      submenu: buildModeSubmenu('email', sels['email'] || 'formal', emailEnabled),
    },
  ];

  const contextMenu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    ...categoryMenus,
    { type: 'separator' },
    {
      label: 'Profiles Settings…',
      click: () => {
        openSettings();
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          settingsWindow.webContents.send('navigate-tab', 'modes');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Settings…',
      click: openSettings,
    },
    {
      label: 'Open Logs Folder',
      click: () => shell.openPath(logDir()),
    },
    { type: 'separator' },
    {
      label: 'Quit Landa',
      accelerator: 'CommandOrControl+Q',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Update tray icon based on recording state
  if (process.platform === 'darwin') {
    if (isRecording) {
      tray.setImage(trayIconRecording);
      tray.setTitle('');
    } else {
      tray.setImage(trayIconIdle);
      tray.setTitle(isOnHold ? '⏸' : '');
    }
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Settings Window
// ---------------------------------------------------------------------------

function openSettings() {
  // Hard auth gate: the app stays inert until signed in. Every entry point to Settings
  // (tray click, tray menu, dock/app activate) funnels through here, so routing a
  // signed-out user to the sign-in window instead closes them all in one place.
  if (!signedIn) { openAuthWindow(); return; }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const isDark = nativeTheme.shouldUseDarkColors;
  const titleBarOptions = process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 20 } }
    : {
        titleBarStyle: 'hidden',
        titleBarOverlay: {
          color: isDark ? '#252525' : '#f0f0f2',
          symbolColor: isDark ? '#f5f5f7' : '#1d1d1f',
          height: 52,
        },
      };

  settingsWindow = new BrowserWindow({
    width: 1050,
    height: 750,
    minWidth: 1050,
    minHeight: 650,
    title: 'Landa Settings',
    resizable: true,
    ...titleBarOptions,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

  settingsWindow.webContents.once('did-finish-load', () => {
    if (!feedbackPromptSentThisSession && shouldShowFeedbackPrompt()
        && settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('show-feedback-prompt');
      feedbackPromptSentThisSession = true;
    }
    if (pendingUpdateVersion) {
      notifyUpdateReady(pendingUpdateVersion);
    }
  });

  // Prevent Cmd+R / Ctrl+R / F5 from reloading the settings window.
  // Reloading races with debounced config saves and causes settings to revert.
  // F5 is allowed through when the renderer is actively capturing a hotkey.
  settingsWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      (input.key === 'r' && (input.meta || input.control)) ||
      (input.key === 'F5' && !isCapturingHotkey)
    ) {
      _event.preventDefault();
    }
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function openOnboarding() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.focus();
    return;
  }

  onboardingWindow = new BrowserWindow({
    width: 640,
    height: 720,
    title: 'Landa',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  onboardingWindow.loadFile(path.join(__dirname, 'renderer', 'onboarding.html'));

  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Auth gate — magic-link sign-in (Supabase). The app is inert until signed in.
// ---------------------------------------------------------------------------

function openAuthWindow() {
  if (authWindow && !authWindow.isDestroyed()) { authWindow.focus(); return; }

  authWindow = new BrowserWindow({
    width: 460,
    height: 600,
    title: 'Landa',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  authWindow.loadFile(path.join(__dirname, 'renderer', 'auth.html'));
  authWindow.on('closed', () => { authWindow = null; });
}

// Tell any open windows whether we're signed in (auth window + settings Account tab).
function broadcastAuth() {
  for (const w of [authWindow, settingsWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('auth-changed', { signedIn });
  }
}

// React to a sign-in / sign-out transition (driven by auth.onChange).
async function applyAuthState(nowSignedIn) {
  if (nowSignedIn === signedIn) return;
  signedIn = nowSignedIn;
  broadcastAuth();

  if (signedIn) {
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
    let cfg = null;
    try { cfg = await getBestAvailableConfig(); } catch {}
    if (cfg) applyConfig(cfg);            // gate now open → applyConfig registers hotkeys
    if (!isOnboarded(cfg)) openOnboarding();
  } else {
    // Signed out → re-lock the app: drop hotkeys (reset trackers so a later sign-in
    // re-registers), close every non-gate window, and show only the auth gate.
    globalShortcut.unregisterAll();
    currentShortcut = null;
    currentHotkeyCombo = null;
    currentCancelCombo = null;
    currentHoldCombo = null;
    currentVocabCombo = null;
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    if (onboardingWindow && !onboardingWindow.isDestroyed()) onboardingWindow.close();
    destroyRecordingWindow();
    openAuthWindow();
  }
}

// Handle a `landa://auth-callback?code=…` deep link (magic-link return; later OAuth).
function handleAuthCallback(url) {
  if (!url || url.indexOf('landa://') !== 0) return;
  if (!appReady) { pendingAuthUrl = url; return; }
  auth.completeFromUrl(url)
    .then((res) => { if (!res.ok) logEvent('[Landa] auth callback failed: ' + res.error); })
    .catch((e) => logEvent('[Landa] auth callback error: ' + e.message));
}

// ---------------------------------------------------------------------------
// Recording Window — floating always-on-top indicator while recording
// ---------------------------------------------------------------------------

// Window dimensions = pill size + ~30px breathing room each side so the
// drop-shadow / blue glow can render without being clipped by the window edge.
const RECORDING_SIZES = {
  classic: { width: 320, height: 110 },
  mini:    { width: 180, height: 90 },
};

// The window stays at the recording size at all times; only the pill inside it morphs
// between its resting and recording looks (CSS). A fixed window never resizes or
// repositions on start/stop, which avoids the one-frame jump where the compositor moves
// the window before the renderer repaints the new size. The pill anchors to the screen
// edge it's docked against and grows AWAY from it (up from the Dock, down from the menu
// bar), so the docked edge stays planted and the pill never moves into the edge.
const RESTING_PILL_HEIGHT = 10; // mirrors recording.css
const RECORDING_DOCK_GAP = 2;   // px the resting pill floats above the Dock/taskbar
const PILL_EDGE_MARGIN = 4;     // window edge → pill edge gap; matches --pill-edge-margin in CSS

function currentRecordingWindowSize() {
  return RECORDING_SIZES[recordingWindowStyle] || RECORDING_SIZES.mini;
}

function createRecordingWindow() {
  const size = RECORDING_SIZES[recordingWindowStyle] || RECORDING_SIZES.mini;
  recordingWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // focusable: false would hide the macOS dock icon when this is the only
    // open window. setIgnoreMouseEvents + showInactive already keep us from
    // stealing input/focus, so we keep this true on macOS. On Windows we
    // still need it false so the window doesn't grab keyboard focus.
    focusable: process.platform !== 'darwin',
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 'floating' sits above normal app windows (stays visible while dictating) but BELOW
  // the macOS Dock, so the pill can rest just above the Dock yet never draw on top of it.
  // 'screen-saver' would put it above the Dock and let it cover the Dock icons.
  recordingWindow.setAlwaysOnTop(true, 'floating');
  recordingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // setVisibleOnAllWorkspaces transforms the macOS process type
  // (ForegroundApplication ↔ UIElementApplication) to apply the all-spaces
  // collection behavior. The transform back can fail and leave the app in
  // accessory mode, which removes the dock icon. Force it back explicitly.
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
    reassertDockIcon();
  }
  // Ignore mouse — the resting pill is purely visual; never steal clicks from the
  // app the user is dictating into.
  recordingWindow.setIgnoreMouseEvents(true);

  recordingWindow.loadFile(path.join(__dirname, 'renderer', 'recording.html'));

  recordingWindow.webContents.on('did-finish-load', () => {
    if (recordingWindow && !recordingWindow.isDestroyed()) {
      recordingWindow.webContents.send('recording-style', recordingWindowStyle);
      recordingWindow.webContents.send('recording-paused', isOnHold);
      recordingWindow.webContents.send('recording-processing', false);
      recordingWindow.webContents.send('recording-active', isRecording);
    }
  });

  recordingWindow.on('closed', () => {
    recordingWindow = null;
  });
}

/**
 * Size the window for the current state and position it so the (centered) pill's
 * bottom edge lands on the saved anchor — a { x: pill-center, y: pill-bottom } point.
 * Falls back to bottom-center hugging the Dock/taskbar. Resizing keeps the pill's
 * bottom edge fixed, so it grows upward into the recording state and never dips into
 * the Dock.
 */
function layoutRecordingWindow() {
  if (!recordingWindow || recordingWindow.isDestroyed()) return;
  const size = currentRecordingWindowSize();

  // Place the window on the display the user is currently on (follows the cursor across
  // monitors). The saved placement is a fraction of the work area, so it lands in the
  // same relative spot on any screen; absent → bottom-center hugging the Dock.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  recordingWindowActiveDisplayId = display.id;
  const { x, y, width, height } = display.workArea;
  const edge = (recordingWindowPosition && recordingWindowPosition.edge) || 'bottom';
  let pillCenterX, edgeY;
  if (recordingWindowPosition) {
    pillCenterX = x + recordingWindowPosition.fx * width;
    edgeY = y + recordingWindowPosition.fy * height;
  } else {
    pillCenterX = x + width / 2;
    // Rest just above the bottom of THIS display's usable area. macOS/Windows exclude the
    // Dock/taskbar from the work area only on the display that actually has it, and report
    // the full height on displays that don't — so a screen with no Dock hugs the bottom
    // instead of floating above a phantom Dock. When the Dock is summoned onto this display,
    // its work area shrinks and 'display-metrics-changed' fires, relaying the pill out to
    // clear it (side-mounted/hidden Dock → no bottom reserve → hugs the bottom as before).
    edgeY = (y + height) - RECORDING_DOCK_GAP;
  }

  // Anchor the docked edge of the pill (window edge ± margin) and grow away from it,
  // so the pill stays planted on its edge and the window grows in the free direction.
  // setBounds applies size + position atomically: a separate setSize/setPosition pair
  // leaves one frame where the resized window still sits at its old origin, which slides
  // the centered pill sideways and snaps it back — the visible flick on start/stop.
  recordingWindow.webContents.send('recording-dock-edge', edge);
  recordingWindow.setBounds({
    x: Math.round(pillCenterX - size.width / 2),
    y: edge === 'top'
      ? Math.round(edgeY - PILL_EDGE_MARGIN)
      : Math.round(edgeY + PILL_EDGE_MARGIN - size.height),
    width: size.width,
    height: size.height,
  }, false);
}

/**
 * Switch the pill between its calm resting look and the active recording look,
 * and drive audio-level polling (only meaningful while recording). Works in both
 * always-show and on-demand modes.
 */
function setPillRecordingActive(active) {
  if (!recordingWindow || recordingWindow.isDestroyed()) return;
  if (active) {
    // Set the dock edge / active display before the pill grows. The window is already at
    // the recording size, so this doesn't resize it — the pill just expands away from the
    // docked edge in place.
    layoutRecordingWindow();
    recordingWindow.webContents.send('recording-active', true);
    recordingWindow.webContents.send('recording-processing', false);
    startAudioLevelPolling();
  } else {
    // The window stays put; the pill simply morphs back to its resting look in place.
    recordingWindow.webContents.send('recording-active', false);
    recordingWindow.webContents.send('recording-processing', false);
    stopAudioLevelPolling();
  }
}

/**
 * Create/destroy/show the pill to match the current style + "always show" setting.
 * Called from applyConfig on any config change. Avoids recreating the window on a
 * mini↔classic switch (recreating re-triggers setVisibleOnAllWorkspaces, which can
 * flip the macOS activation policy and drop the dock icon).
 */
function syncRecordingWindowLifecycle() {
  if (recordingWindowStyle === 'none') {
    destroyRecordingWindow();
    return;
  }
  if (recordingWindowAlwaysShow) {
    if (!recordingWindow || recordingWindow.isDestroyed()) {
      showRecordingWindow();
    }
    setPillRecordingActive(isRecording);
  } else if (!isRecording) {
    // On-demand mode: the pill should only appear while recording.
    hideRecordingWindow();
  }
}

function showRecordingWindow() {
  if (recordingWindowStyle === 'none') return;
  if (!recordingWindow || recordingWindow.isDestroyed()) {
    createRecordingWindow();
  } else {
    recordingWindow.webContents.send('recording-style', recordingWindowStyle);
    recordingWindow.webContents.send('recording-paused', isOnHold);
    recordingWindow.webContents.send('recording-processing', false);
  }
  layoutRecordingWindow();
  recordingWindow.showInactive();
  // Re-assert regular activation policy on every show: setVisibleOnAllWorkspaces
  // can briefly demote the app to accessory mode, which hides the dock icon and
  // can break globalShortcut. Cheap insurance against the flip.
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
    reassertDockIcon();
  }
}

function hideRecordingWindow() {
  stopAudioLevelPolling();
  if (recordingWindow && !recordingWindow.isDestroyed()) {
    recordingWindow.hide();
  }
}

function destroyRecordingWindow() {
  stopAudioLevelPolling();
  if (recordingWindow && !recordingWindow.isDestroyed()) {
    recordingWindow.close();
  }
  recordingWindow = null;
}

// ---------------------------------------------------------------------------
// Feedback window (Tally form)
// ---------------------------------------------------------------------------

let feedbackWindow = null;
let feedbackPromptSentThisSession = false;

const FEEDBACK_URLS = {
  en: 'https://tally.so/r/OD8V2g',
  de: 'https://tally.so/r/aQZlJZ',
};

function openFeedbackWindow(lang) {
  if (feedbackWindow && !feedbackWindow.isDestroyed()) {
    feedbackWindow.focus();
    return;
  }

  const url = FEEDBACK_URLS[lang] || FEEDBACK_URLS.en;
  const title = lang === 'de' ? 'Feedback' : 'Feedback';

  feedbackWindow = new BrowserWindow({
    width: 560,
    height: 760,
    title,
    parent: settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open links Tally renders (privacy policy, etc.) in the user's default browser.
  feedbackWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });

  // Tally registers a beforeunload handler once the user types — that blocks
  // Electron's close button. Override it: clicking close means close.
  feedbackWindow.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  feedbackWindow.loadURL(url);

  feedbackWindow.on('closed', () => {
    feedbackWindow = null;
  });
}

function startAudioLevelPolling() {
  stopAudioLevelPolling();
  audioLevelTimer = setInterval(async () => {
    if (!recordingWindow || recordingWindow.isDestroyed()) return;
    try {
      const data = await apiRequest('GET', '/audio-level');
      recordingWindow.webContents.send('recording-level', data.level || 0);
    } catch (_) {}
  }, 80);
}

function stopAudioLevelPolling() {
  if (audioLevelTimer) {
    clearInterval(audioLevelTimer);
    audioLevelTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Backend Lifecycle
// ---------------------------------------------------------------------------

function findBackendRoot() {
  const script = path.join('backend', 'landa_core.py');

  // Packaged app: only the compiled binary ships (the Python source is not
  // bundled), so detect the backend by the binary, not landa_core.py.
  if (app.isPackaged) {
    const resourcePath = process.resourcesPath;
    const binaryName = process.platform === 'win32' ? 'landa_backend.exe' : 'landa_backend';
    if (fs.existsSync(path.join(resourcePath, 'backend', 'landa_backend', binaryName))) {
      console.log('[Landa] Found backend in app resources');
      return resourcePath;
    }
  } else {
    // Dev: walk up from __dirname to find the project tree first, so source
    // edits are picked up without having to clear ~/.landa/backend/.
    let dir = __dirname;
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, script))) {
        console.log(`[Landa] Found backend at: ${dir}`);
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Last-resort fallback: a hand-installed copy under ~/.landa/.
  const homeBackend = CONFIG_DIR;
  if (fs.existsSync(path.join(homeBackend, script))) {
    console.log('[Landa] Found backend in ~/.landa/');
    return homeBackend;
  }

  return null;
}

function findPython(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'backend', 'venv', 'bin', 'python'),
    path.join(projectRoot, 'backend', 'venv', 'Scripts', 'python.exe'), // Windows
    path.join(os.homedir(), '.landa', 'backend', 'venv', 'bin', 'python'),
    path.join(os.homedir(), '.landa', 'backend', 'venv', 'Scripts', 'python.exe'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Fallback to system python
  return process.platform === 'win32' ? 'python' : 'python3';
}

function startBackend() {
  const backendRoot = findBackendRoot();
  if (!backendRoot) {
    console.error('[Landa] Could not find landa_core.py — backend will not start');
    return;
  }

  // In packaged builds, prefer the PyInstaller-compiled binary (no Python required).
  // In dev (unpackaged), always run the Python source so backend edits are picked up
  // without a rebuild.
  const binaryName = process.platform === 'win32' ? 'landa_backend.exe' : 'landa_backend';
  const binaryPath = path.join(backendRoot, 'backend', 'landa_backend', binaryName);

  let cmd, args;
  if (app.isPackaged && fs.existsSync(binaryPath)) {
    console.log(`[Landa] Starting compiled backend: ${binaryPath}`);
    cmd = binaryPath;
    args = [];
  } else {
    const scriptPath = path.join(backendRoot, 'backend', 'landa_core.py');
    const pythonPath = findPython(backendRoot);
    console.log(`[Landa] Starting Python backend: ${pythonPath} ${scriptPath}`);
    cmd = pythonPath;
    args = [scriptPath];
  }

  backendProcess = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (data) => {
    const str = data.toString();
    console.log(`[backend] ${str.trim()}`);
    appendLog('backend.log', str);
  });
  backendProcess.stderr.on('data', (data) => {
    const str = data.toString();
    console.log(`[backend] ${str.trim()}`);
    appendLog('backend.log', str);
  });

  backendProcess.on('error', (err) => {
    logEvent(`[Landa] Failed to start backend: ${err.message}`);
  });

  backendProcess.on('exit', (code) => {
    logEvent(`[Landa] Backend exited with code ${code}`);
    backendProcess = null;
    if (appQuitting) return;
    // Backend crashed — reset any stuck state and restart
    hotkeyInFlight = false;
    setRecordingState(false);
    logEvent('[Landa] Backend crashed — restarting in 2s');
    setTimeout(startBackend, 2000);
  });

  console.log(`[Landa] Backend started (pid=${backendProcess.pid})`);
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    console.log('[Landa] Backend stopped');
    backendProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Config Application
// ---------------------------------------------------------------------------

let currentHotkeyCombo = null;
let currentCancelCombo = null;
let currentHoldCombo = null;
let currentVocabCombo = null;

function applyConfig(config) {
  // Don't register hotkeys until onboarding is complete AND the user is signed in
  // (hard auth gate). Registering a global shortcut on macOS triggers the
  // Accessibility TCC prompt, which should only appear inside the onboarding flow.
  const onboardingDone = isOnboarded(config) && signedIn;

  const combo = config.toggle_recording;
  const newAccelerator = hotkeyToAccelerator(combo);
  if (onboardingDone && newAccelerator !== currentShortcut) {
    registerHotkey(combo);
    currentHotkeyCombo = combo;
  }

  const cancelCombo = config.cancel_recording;
  const newCancelAccelerator = hotkeyToAccelerator(cancelCombo);
  const savedCancelAccelerator = hotkeyToAccelerator(currentCancelCombo);
  if (onboardingDone && newCancelAccelerator !== savedCancelAccelerator) {
    registerCancelHotkey(cancelCombo);
  }

  soundsMuted = config.sound_muted || false;

  const holdCombo = config.hold_recording;
  const newHoldAccelerator = hotkeyToAccelerator(holdCombo);
  const savedHoldAccelerator = hotkeyToAccelerator(currentHoldCombo);
  if (onboardingDone && newHoldAccelerator !== savedHoldAccelerator) {
    registerHoldHotkey(holdCombo);
  }

  const vocabCombo = config.add_to_vocabulary;
  const newVocabAccelerator = hotkeyToAccelerator(vocabCombo);
  const savedVocabAccelerator = hotkeyToAccelerator(currentVocabCombo);
  if (onboardingDone && newVocabAccelerator !== savedVocabAccelerator) {
    registerVocabHotkey(vocabCombo);
    currentVocabCombo = vocabCombo;
  }

  const reformatChanged = reformatEnabled !== config.reformat_enabled ||
                           reformatMode !== config.reformat_mode;
  reformatEnabled = config.reformat_enabled || false;
  reformatMode = config.reformat_mode || 'default';

  const newStyle = config.recording_window_style || 'mini';
  const styleChanged = newStyle !== recordingWindowStyle;
  recordingWindowStyle = newStyle;
  recordingWindowAlwaysShow = config.recording_window_always_show !== false;
  // The pill is fixed at bottom-center hugging the Dock (not draggable). Force the
  // anchor to null so layoutRecordingWindow always re-centers, ignoring any position
  // a previous build may have persisted.
  recordingWindowPosition = null;

  // mini↔classic: relayout the live window in place rather than recreating it
  // (recreating flips the macOS activation policy and drops the dock icon).
  if (styleChanged && newStyle !== 'none' && recordingWindow && !recordingWindow.isDestroyed()) {
    recordingWindow.webContents.send('recording-style', newStyle);
    layoutRecordingWindow();
  }
  syncRecordingWindowLifecycle();

  const newModes = config.modes || modesConfig;
  const modesChanged = JSON.stringify(newModes) !== JSON.stringify(modesConfig);
  modesConfig = newModes;

  if (reformatChanged || modesChanged) updateTray();

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('config-updated', config);
  }
}

// ---------------------------------------------------------------------------
// Status Polling
// ---------------------------------------------------------------------------

function startStatusPolling() {
  pollTimer = setInterval(async () => {
    // Follow the active monitor: if the cursor has moved to another display, relocate
    // the resting pill there. Skipped while recording so it stays put.
    // Only relocate once the cursor has stayed on the new display across two consecutive
    // samples (~1s), so a quick pass-through doesn't dart the pill over and back.
    if (recordingWindow && !recordingWindow.isDestroyed() && !isRecording) {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      if (display.id !== recordingWindowActiveDisplayId && display.id === lastCursorDisplayId) {
        layoutRecordingWindow();
      }
      lastCursorDisplayId = display.id;
    }

    // Don't overwrite state while a hotkey action is in-flight or within one
    // poll interval of it completing (backend may still be transitioning).
    if (!hotkeyInFlight && Date.now() - hotkeyCompletedAt >= POLL_INTERVAL) {
      try {
        const status = await api.fetchStatus();
        const newIsOnHold = status.is_on_hold || false;
        if (newIsOnHold !== isOnHold) {
          isOnHold = newIsOnHold;
          updateTray();
          if (recordingWindow && !recordingWindow.isDestroyed()) {
            recordingWindow.webContents.send('recording-paused', isOnHold);
          }
        }
        setRecordingState(status.recording);
        if (status.pending_paste && process.platform === 'darwin') {
          try {
            await api.acknowledgePaste();
            await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
          } catch (err) {
            console.error('[Landa] Auto-paste failed:', err.message);
          }
        }
      } catch {
        // Backend not ready yet — ignore
      }
    }
  }, POLL_INTERVAL);
}

// Re-anchor the resting pill when the Dock/taskbar geometry changes on the display it's
// already on. The status poller only relays out when the cursor crosses to a *different*
// display, so resizing, moving, hiding, or re-orienting the Dock on the pill's own display
// would otherwise leave it with a stale gap (or floating mid-screen for a side Dock).
// 'display-metrics-changed' fires with 'workArea' among the changed metrics on any of those
// Dock changes. Guarded like the poller: always-show mode, not recording, live window.
function handleDisplayMetricsChanged(_event, _display, changedMetrics) {
  if (!changedMetrics.includes('workArea')) return;
  if (!recordingWindowAlwaysShow || isRecording) return;
  if (!recordingWindow || recordingWindow.isDestroyed()) return;
  layoutRecordingWindow();
}

// ---------------------------------------------------------------------------
// IPC handlers for settings window (registered in setupIpcHandlers)
// ---------------------------------------------------------------------------

async function getInstalledAppsMac() {
  const appDirs = ['/Applications', '/System/Applications'];
  const appEntries = [];

  for (const dir of appDirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir).filter((f) => f.endsWith('.app'));
    } catch {
      continue;
    }
    for (const entry of entries) {
      appEntries.push({ name: entry.replace('.app', ''), appPath: path.join(dir, entry) });
    }
  }

  appEntries.sort((a, b) => a.name.localeCompare(b.name));

  // Process all apps in parallel — async icon conversion instead of sequential execSync
  const apps = await Promise.all(appEntries.map(async ({ name, appPath }) => {
    const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
    const tmpPng = path.join(os.tmpdir(), `fmv-icon-${safeName}.png`);
    let iconDataUrl = null;
    try {
      const icnsPath = await getAppIconFileMac(appPath);
      if (icnsPath) {
        // Fast path: convert .icns directly with sips
        await execAsync(`sips -s format png "${icnsPath}" --out "${tmpPng}" --resampleWidth 256 -z 256 256 2>/dev/null`, { timeout: 3000 });
        const ni = nativeImage.createFromPath(tmpPng);
        if (!ni.isEmpty()) iconDataUrl = ni.toDataURL();
      } else {
        // Fallback for apps with no .icns (Assets.car, e.g. Photo Booth and most
        // modern system apps): use QuickLook to render the bundle's icon.
        await execAsync(`qlmanage -t -s 256 -o "${os.tmpdir()}" "${appPath}" >/dev/null 2>&1`, { timeout: 5000 });
        const qlOutput = path.join(os.tmpdir(), `${path.basename(appPath)}.png`);
        if (fs.existsSync(qlOutput)) {
          const ni = nativeImage.createFromPath(qlOutput);
          if (!ni.isEmpty()) iconDataUrl = ni.toDataURL();
          try { fs.unlinkSync(qlOutput); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPng); } catch { /* ignore */ }
    return { name, appPath, icon: iconDataUrl };
  }));

  return apps;
}

// Resolves the .icns path for a macOS .app bundle.
// Handles both XML and binary plist formats; falls back to scanning Resources.
async function getAppIconFileMac(appPath) {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');

  let iconFileName = null;

  try {
    const buf = fs.readFileSync(plistPath);
    const isBinary = buf[0] === 0x62 && buf[1] === 0x70; // 'bp' = bplist

    if (isBinary) {
      const { stdout: xml } = await execAsync(`plutil -convert xml1 -o - "${plistPath}"`, { timeout: 2000 });
      const match = xml.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/);
      if (match) iconFileName = match[1];
    } else {
      const match = buf.toString('utf8').match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/);
      if (match) iconFileName = match[1];
    }
  } catch { /* ignore */ }

  if (iconFileName) {
    if (!iconFileName.endsWith('.icns')) iconFileName += '.icns';
    const candidate = path.join(resourcesPath, iconFileName);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fallback: pick the first .icns in Resources that isn't a document/internal icon
  try {
    const icnsFiles = fs.readdirSync(resourcesPath).filter((f) => f.endsWith('.icns'));
    const preferred = icnsFiles.find((f) => /appicon|app/i.test(f)) || icnsFiles[0];
    if (preferred) return path.join(resourcesPath, preferred);
  } catch { /* ignore */ }

  return null;
}

async function getInstalledAppsWin() {
  const programDirs = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env['LOCALAPPDATA'] && path.join(process.env['LOCALAPPDATA'], 'Programs'),
  ].filter(Boolean);

  const appEntries = [];
  const seen = new Set();

  for (const dir of programDirs) {
    let subdirs;
    try {
      subdirs = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }

    for (const subdir of subdirs) {
      const appDir = path.join(dir, subdir);
      // Find the best .exe: prefer one matching the folder name, else take the first
      let exes;
      try {
        exes = fs.readdirSync(appDir).filter((f) => f.endsWith('.exe'));
      } catch {
        continue;
      }
      if (exes.length === 0) continue;

      const appName = subdir;
      if (seen.has(appName.toLowerCase())) continue;
      seen.add(appName.toLowerCase());

      const preferred = exes.find((e) => e.toLowerCase().startsWith(appName.toLowerCase()))
        || exes[0];
      appEntries.push({ name: appName, exePath: path.join(appDir, preferred) });
    }
  }

  appEntries.sort((a, b) => a.name.localeCompare(b.name));

  // app.getFileIcon works well on Windows — exe files embed their icons
  const apps = [];
  for (const { name, exePath } of appEntries) {
    let iconDataUrl = null;
    try {
      const icon = await app.getFileIcon(exePath, { size: 'large' });
      const ni = icon.isEmpty() ? null : icon;
      if (ni) iconDataUrl = ni.resize({ width: 256, height: 256 }).toDataURL();
    } catch { /* ignore */ }
    apps.push({ name, appPath: exePath, icon: iconDataUrl });
  }

  return apps;
}

// Recording feedback sounds are bundled WAVs (assets/sounds), identical on every
// platform. They're shipped via extraResources (unpacked) so the external players
// — afplay on macOS, PowerShell's SoundPlayer on Windows — can read a real path;
// files inside app.asar are not reachable by those external processes.
function soundFilePath(kind) {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'sounds')
    : path.join(__dirname, 'assets', 'sounds');
  return path.join(dir, `${kind}.wav`);
}

// kind: 'start' | 'stop' | 'cancel' | 'hold' | 'resume'
function playSound(kind) {
  if (soundsMuted || !kind) return;
  const soundPath = soundFilePath(kind);
  if (!fs.existsSync(soundPath)) return;
  if (process.platform === 'darwin') {
    spawn('afplay', [soundPath], { stdio: 'ignore' });
    return;
  }
  if (process.platform === 'win32') {
    // Single-quote-escape the path for PowerShell, then play asynchronously.
    const psPath = soundPath.replace(/'/g, "''");
    spawn(
      'powershell',
      ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${psPath}').Play()`],
      { stdio: 'ignore', windowsHide: true },
    );
  }
}

async function ensureMacAppInstalled() {
  if (process.platform !== 'darwin' || !app.isPackaged) return true;
  if (app.isInApplicationsFolder()) return true;

  try {
    // Shows the native "Move to Applications Folder?" prompt, copies the app,
    // and relaunches from /Applications. Returns true if the move started —
    // this process is being replaced, so we bail out instead of continuing
    // to spawn the backend / register hotkeys from /Volumes/...
    const moved = app.moveToApplicationsFolder({
      conflictHandler: (conflictType) => {
        if (conflictType === 'exists') {
          const choice = dialog.showMessageBoxSync({
            type: 'question',
            buttons: ['Replace', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            message: 'A copy of Landa is already in the Applications folder.',
            detail: 'Replace it with this copy?',
          });
          return choice === 0;
        }
        // 'existsAndRunning' — another copy is already running; don't clobber it.
        return false;
      },
    });
    if (moved) return false;
  } catch (err) {
    console.error('[Landa] moveToApplicationsFolder failed:', err.message);
  }

  app.quit();
  return false;
}

function setupIpcHandlers() {
  ipcMain.handle('get-config', async () => {
    return await getBestAvailableConfig();
  });

  ipcMain.handle('save-config', async (_event, config) => {
    try {
      const result = await api.saveConfig(config);
      applyConfig(config);
      return result;
    } catch { return null; }
  });

  // Synchronous variant for beforeunload — writes config to disk immediately
  // and fires the backend update async (fire-and-forget). The disk write is
  // the authoritative fallback; the async POST keeps the backend's in-memory
  // state fresh so the next GET /config returns the right data on reload.
  ipcMain.on('save-config-sync', (event, cfg) => {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      api.saveConfig(cfg).then(() => applyConfig(cfg)).catch(() => {});
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });

  // Mute is applied directly and immediately so it never lags behind a debounced
  // config save or a stale backend round-trip. The toggle also persists to config
  // (so it survives restart); applyConfig restores soundsMuted on the next launch.
  ipcMain.on('set-sound-muted', (_event, muted) => {
    soundsMuted = !!muted;
  });

  ipcMain.on('debug-log', (_event, msg) => {
    console.log('[RENDERER]', msg);
  });

  ipcMain.on('set-capturing-hotkey', (_event, active) => {
    isCapturingHotkey = active;
  });

  ipcMain.handle('patch-config', async (_event, patch) => {
    try {
      const result = await api.patchConfig(patch);
      const fullConfig = result || await api.fetchConfig();
      if (fullConfig) applyConfig(fullConfig);
      return result;
    } catch { return null; }
  });

  ipcMain.handle('get-nemo-status', async () => {
    try { return await api.fetchNemoStatus(); }
    catch { return null; }
  });

  ipcMain.handle('install-nemo', async () => {
    return new Promise((resolve) => {
      const url = new URL('/nemo/install', API_BASE);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        timeout: 600000, // 10 min
      };

      const req = http.request(options, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const content = line.slice(6);
              if (content === '__DONE__') {
                resolve({ success: true });
                return;
              }
              if (content.startsWith('__ERROR__')) {
                resolve({ success: false, error: content });
                return;
              }
              // Send progress to renderer
              if (settingsWindow && !settingsWindow.isDestroyed()) {
                settingsWindow.webContents.send('nemo-install-progress', content);
              }
            }
          }
        });
        res.on('end', () => resolve({ success: false, error: 'Stream ended unexpectedly' }));
      });

      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
      req.end();
    });
  });

  // ---- Local Whisper ----

  ipcMain.handle('get-whisper-local-status', async (_event, modelName) => {
    try { return await apiRequest('GET', `/whisper-local/status?model=${encodeURIComponent(modelName)}`); }
    catch { return null; }
  });

  ipcMain.handle('install-whisper-deps', async () => {
    return new Promise((resolve) => {
      const url = new URL('/whisper-local/install-deps', API_BASE);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        timeout: 600000, // 10 min
      };

      const req = http.request(options, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const content = line.slice(6);
              if (content === '__DONE__') { resolve({ success: true }); return; }
              if (content.startsWith('__ERROR__')) { resolve({ success: false, error: content }); return; }
              if (settingsWindow && !settingsWindow.isDestroyed()) {
                settingsWindow.webContents.send('whisper-deps-progress', content);
              }
            }
          }
        });
        res.on('end', () => resolve({ success: false, error: 'Stream ended unexpectedly' }));
      });

      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
      req.end();
    });
  });

  ipcMain.handle('download-whisper-model', async (_event, modelName) => {
    try { return await apiRequest('POST', '/whisper-local/download', { model: modelName }); }
    catch (err) { return { error: err.message }; }
  });

  // ---- Local LLM ----

  ipcMain.handle('get-llm-local-status', async (_event, modelId) => {
    try { return await apiRequest('GET', `/llm-local/status?model=${encodeURIComponent(modelId)}`); }
    catch { return null; }
  });

  ipcMain.handle('install-llm-deps', async () => {
    return new Promise((resolve) => {
      const url = new URL('/llm-local/install-deps', API_BASE);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        timeout: 600000, // 10 min
      };

      const req = http.request(options, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const content = line.slice(6);
              if (content === '__DONE__') { resolve({ success: true }); return; }
              if (content.startsWith('__ERROR__')) { resolve({ success: false, error: content }); return; }
              if (settingsWindow && !settingsWindow.isDestroyed()) {
                settingsWindow.webContents.send('llm-deps-progress', content);
              }
            }
          }
        });
        res.on('end', () => resolve({ success: false, error: 'Stream ended unexpectedly' }));
      });

      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
      req.end();
    });
  });

  ipcMain.handle('download-llm-model', async (_event, modelId) => {
    try { return await apiRequest('POST', '/llm-local/download', { model: modelId }); }
    catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('get-platform', () => process.platform);
  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('get-login-item-enabled', () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('set-login-item-enabled', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });

  // --- Auth (Supabase). Renderer never receives tokens — get-session is sanitised. ---
  ipcMain.handle('auth-request-magic-link', (_event, email) => auth.requestMagicLink(email));
  ipcMain.handle('auth-sign-out', () => auth.signOut());
  ipcMain.handle('auth-get-session', async () => {
    const s = await auth.getSession();
    return s ? { email: s.user.email, userId: s.user.id } : null;
  });
  ipcMain.handle('auth-is-signed-in', () => auth.isSignedIn());
  ipcMain.handle('auth-get-entitlement', () => auth.getEntitlement());
  ipcMain.handle('auth-get-usage', () => auth.getUsage());
  ipcMain.handle('auth-start-upgrade', () => auth.startUpgrade());

  ipcMain.handle('install-update', () => {
    if (!pendingUpdateVersion) return false;
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall();
      } catch (err) {
        console.error('[updater] quitAndInstall failed:', err && err.message ? err.message : err);
      }
    });
    return true;
  });

  ipcMain.handle('is-dev-mode', () => {
    if (process.env.LANDA_DEV === '1') return true;
    try {
      const cfg = readConfigFromDisk();
      return cfg && cfg.dev_mode === true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('get-history', async () => {
    // Return null (not []) on failure so the renderer can distinguish "backend
    // not ready yet" from "history is genuinely empty" and retry accordingly.
    try { return await api.fetchHistory(); }
    catch { return null; }
  });

  ipcMain.handle('clear-history', async () => {
    try { return await api.clearHistory(); }
    catch { return null; }
  });

  ipcMain.handle('delete-history-entry', async (_event, id) => {
    try { return await api.deleteHistoryEntry(id); }
    catch { return null; }
  });

  ipcMain.handle('get-installed-apps', async () => {
    if (process.platform === 'darwin') {
      return getInstalledAppsMac();
    }
    if (process.platform === 'win32') {
      return getInstalledAppsWin();
    }
    return [];
  });

  // ---- Onboarding ----

  ipcMain.handle('get-mic-access-status', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('microphone');
    }
    return 'granted';
  });

  ipcMain.handle('request-mic-access', async () => {
    if (process.platform === 'darwin') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return granted ? 'granted' : 'denied';
    }
    return 'granted';
  });

  ipcMain.handle('get-accessibility-status', () => {
    if (process.platform === 'darwin') {
      try { return systemPreferences.isTrustedAccessibilityClient(false); }
      catch { return false; }
    }
    return true;
  });

  ipcMain.handle('open-accessibility-settings', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
  });

  // Called after the Accessibility step passes so the training step can use the hotkey.
  ipcMain.handle('register-main-hotkey', async () => {
    try {
      const config = await getBestAvailableConfig();
      if (config && config.toggle_recording) {
        registerHotkey(config.toggle_recording);
        currentHotkeyCombo = config.toggle_recording;
      }
    } catch (err) {
      console.error('[Landa] register-main-hotkey failed:', err.message);
    }
  });

  // Called when entering the training step — brings onboarding window to front
  // so paste lands in the test field after the user returns from System Settings.
  ipcMain.handle('focus-onboarding-window', () => {
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      onboardingWindow.focus();
    }
  });

  ipcMain.handle('open-feedback', (_event, lang) => {
    openFeedbackWindow(lang);
  });

  ipcMain.handle('mark-feedback-prompted', () => {
    markFeedbackPrompted();
  });

  ipcMain.handle('finish-onboarding', async (_event, { language }) => {
    // Write the marker first so the user is treated as onboarded even if the
    // backend patch fails or the app crashes between here and the next launch.
    writeOnboardedMarker();
    const patch = { onboarding_completed: true };
    if (language) patch.openai_language = language;
    try {
      const result = await api.patchConfig(patch);
      const fullConfig = result || await api.fetchConfig();
      if (fullConfig) applyConfig(fullConfig);
    } catch (err) {
      console.error(`[Landa] finish-onboarding patch failed: ${err.message}`);
    }
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      onboardingWindow.close();
    }
    openSettings();
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      // Window may still be loading (freshly opened) — send after load, or
      // immediately if it was already open and just focused.
      const win = settingsWindow;
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', () => win.webContents.send('navigate-tab', 'home'));
      } else {
        win.webContents.send('navigate-tab', 'home');
      }
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Register the `landa://` scheme so magic-link (and future OAuth) deep links return
// to this app. macOS delivers them via `open-url`; Windows/Linux via argv on the
// second-instance event (the single-instance lock above routes the relaunch here).
if (!app.isPackaged && process.platform === 'win32') {
  app.setAsDefaultProtocolClient('landa', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('landa');
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

app.on('second-instance', (_event, argv) => {
  const deepLink = argv.find((a) => typeof a === 'string' && a.indexOf('landa://') === 0);
  if (deepLink) handleAuthCallback(deepLink);
  if (authWindow && !authWindow.isDestroyed()) authWindow.focus();
  else if (settingsWindow) settingsWindow.focus();
});

process.on('uncaughtException', (err) => {
  logEvent(`[Landa] Uncaught exception: ${err && err.stack ? err.stack : err}`);
});
process.on('unhandledRejection', (reason) => {
  logEvent(`[Landa] Unhandled rejection: ${reason && reason.stack ? reason.stack : reason}`);
});

app.whenReady().then(() => {
  ensureMacAppInstalled().then(async (ok) => {
    if (!ok) return;

    setupIpcHandlers();

    // Initialise auth before anything user-facing; the app stays inert until signed in.
    auth.init();
    try { signedIn = await auth.isSignedIn(); } catch { signedIn = false; }
    auth.onChange((_event, session) => { applyAuthState(!!session); });
    appReady = true;
    if (pendingAuthUrl) { const u = pendingAuthUrl; pendingAuthUrl = null; handleAuthCallback(u); }

    recordFirstLaunchOrSkip();

    startBackend();
    createTray();
    app.on('activate', () => {
      if (onboardingWindow && !onboardingWindow.isDestroyed()) onboardingWindow.focus();
      else openSettings();
    });
    nativeTheme.on('updated', updateTray);

    // Load the best available config after backend startup begins.
    // Falling back to disk avoids silently reverting packaged apps to default
    // hotkeys when the Python backend needs longer than expected to boot.
    setTimeout(async () => {
      let config = null;
      try {
        config = await getBestAvailableConfig();
        if (config) applyConfig(config);
      } catch {}

      if (!config && signedIn) {
        // Final fallback if neither backend nor disk config is available — only when
        // signed in, so the auth gate isn't bypassed by registering default hotkeys.
        registerHotkey({ key: 'space', key_code: 49, modifiers: ['command', 'shift'] });
        registerCancelHotkey({ key: 'escape', key_code: 53, modifiers: [] });
        registerHoldHotkey({ key: 'f6', key_code: 97, modifiers: [] });
      }

      // Hard auth gate first: sign-in is required before the app is usable.
      if (!signedIn) {
        openAuthWindow();
      } else if (!isOnboarded(config)) {
        openOnboarding();
      }
    }, 2000);

    startStatusPolling();
    screen.on('display-metrics-changed', handleDisplayMetricsChanged);

    if (app.isPackaged) {
      setupAutoUpdater();
      autoUpdater.checkForUpdates().catch(() => {});
      setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
    }
  });
});

app.on('will-quit', () => {
  appQuitting = true;
  globalShortcut.unregisterAll();
  screen.removeListener('display-metrics-changed', handleDisplayMetricsChanged);
  if (pollTimer) clearInterval(pollTimer);
  destroyRecordingWindow();
  stopBackend();
});

// Keep the app running when all windows are closed (tray app)
app.on('window-all-closed', (e) => {
  // Don't quit — we're a tray app
});
