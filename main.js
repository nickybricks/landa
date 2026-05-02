const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, clipboard, dialog, ipcMain, systemPreferences, nativeTheme, shell, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const http = require('http');
const os = require('os');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'http://127.0.0.1:7890';
const CONFIG_DIR = path.join(os.homedir(), '.landa');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const POLL_INTERVAL = 1000; // 1 second, matches Swift app

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
let settingsWindow = null;
let onboardingWindow = null;
let recordingWindow = null;
let recordingWindowStyle = 'mini'; // 'classic' | 'mini' | 'none'
let updateWindow = null;
let audioLevelTimer = null;
let backendProcess = null;
let pollTimer = null;
let isRecording = false;
let isOnHold = false;
let reformatEnabled = false;
let reformatMode = 'default';
let modesConfig = { selections: { 'personal-message': 'formal', 'email': 'formal' } };
let currentShortcut = null; // Electron accelerator string
let currentCancelShortcut = null; // Electron accelerator for cancel_recording
let currentHoldShortcut = null; // Electron accelerator for hold_recording
let currentVocabShortcut = null; // Electron accelerator for add_to_vocabulary
let currentCancelSound = 'Funk'; // system sound name to play on cancel
let currentHoldSound = 'Tink'; // system sound name to play on hold
let currentResumeSound = 'Pop'; // system sound name to play on resume
let lastHotkeyTime = 0;
let hotkeyInFlight = false; // re-entrancy guard
let hotkeyCompletedAt = 0; // timestamp of last completed hotkey action
let isCapturingHotkey = false;
let updateDialogShown = false;

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    if (updateDialogShown) return;
    updateDialogShown = true;
    dialog.showMessageBox({
      type: 'info',
      buttons: ['Install Now & Restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Available',
      message: `Landa ${info.version} is available`,
      detail: 'The update will download now and Landa will restart automatically when it\'s ready.',
    }).then((result) => {
      if (result.response === 0) {
        showUpdateWindow(info.version);
        autoUpdater.downloadUpdate().catch((err) => {
          console.error('[updater] downloadUpdate failed:', err && err.message ? err.message : err);
          destroyUpdateWindow();
          dialog.showMessageBox({
            type: 'error',
            buttons: ['OK'],
            title: 'Update Failed',
            message: 'The update could not be downloaded.',
            detail: err && err.message ? err.message : 'Unknown error. Please try again later.',
          }).catch(() => {});
          updateDialogShown = false;
        });
      } else {
        updateDialogShown = false;
      }
    }).catch(() => { updateDialogShown = false; });
  });

  autoUpdater.on('download-progress', (progress) => {
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.webContents.send('update-progress', {
        percent: progress.percent || 0,
        bytesPerSecond: progress.bytesPerSecond || 0,
        transferred: progress.transferred || 0,
        total: progress.total || 0,
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.webContents.send('update-installing');
    }
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 600);
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
    if (changed) showRecordingWindow();
  } else {
    deactivateCancelHotkey();
    deactivateHoldHotkey();
    isOnHold = false;
    if (changed) hideRecordingWindow();
    // Recording just ended — history likely has a new entry (ignore cancels, which go through handleCancelPress).
    if (wasRecording && settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('history-updated');
    }
  }
  if (changed) updateTray();
}

async function handleHotkeyPress() {
  // Debounce: 500ms like the Swift app
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
        }
      } else {
        await api.startRecording();
        console.log(`[Landa] start API responded in ${Date.now() - t0}ms`);
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
  playSound(currentCancelSound);
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
    playSound(currentResumeSound);
    try {
      await api.resumeRecording();
      console.log(`[Landa] /resume responded in ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(`[Landa] Resume failed: ${err.message}`);
    }
  } else {
    console.log(`[Landa] Hold hotkey pressed — pausing recording`);
    playSound(currentHoldSound);
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

function createTray() {
  // Use a template image for macOS menu bar (16x16)
  const iconPath = path.join(__dirname, 'assets', 'trayTemplate.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // Fallback: create a simple icon from data
    icon = nativeImage.createEmpty();
  }
  icon.setTemplateImage(true);

  tray = new Tray(icon);
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
      const recordingIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayRecording.png'));
      tray.setImage(recordingIcon);
      tray.setTitle('');
    } else {
      const idleIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
      idleIcon.setTemplateImage(true);
      tray.setImage(idleIcon);
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
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

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
    },
  });

  onboardingWindow.loadFile(path.join(__dirname, 'renderer', 'onboarding.html'));

  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });
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
    },
  });

  recordingWindow.setAlwaysOnTop(true, 'screen-saver');
  recordingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // setVisibleOnAllWorkspaces transforms the macOS process type
  // (ForegroundApplication ↔ UIElementApplication) to apply the all-spaces
  // collection behavior. The transform back can fail and leave the app in
  // accessory mode, which removes the dock icon. Force it back explicitly.
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
  }
  // Ignore mouse — never steal clicks from the app the user is dictating into.
  recordingWindow.setIgnoreMouseEvents(true);

  recordingWindow.loadFile(path.join(__dirname, 'renderer', 'recording.html'));

  recordingWindow.webContents.on('did-finish-load', () => {
    if (recordingWindow && !recordingWindow.isDestroyed()) {
      recordingWindow.webContents.send('recording-style', recordingWindowStyle);
      recordingWindow.webContents.send('recording-paused', isOnHold);
      recordingWindow.webContents.send('recording-processing', false);
    }
  });

  recordingWindow.on('closed', () => {
    recordingWindow = null;
  });
}

function positionRecordingWindow() {
  if (!recordingWindow || recordingWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const [winW, winH] = recordingWindow.getSize();
  const targetX = Math.round(x + (width - winW) / 2);
  const targetY = Math.round(y + height - winH - 80);
  recordingWindow.setPosition(targetX, targetY, false);
}

function showRecordingWindow() {
  if (recordingWindowStyle === 'none') return;
  if (!recordingWindow || recordingWindow.isDestroyed()) {
    createRecordingWindow();
  } else {
    // Make sure size matches current style (in case style changed since creation).
    const size = RECORDING_SIZES[recordingWindowStyle] || RECORDING_SIZES.mini;
    recordingWindow.setSize(size.width, size.height, false);
    recordingWindow.webContents.send('recording-style', recordingWindowStyle);
    recordingWindow.webContents.send('recording-paused', isOnHold);
    recordingWindow.webContents.send('recording-processing', false);
  }
  positionRecordingWindow();
  recordingWindow.showInactive();
  startAudioLevelPolling();
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
// Update progress window
// ---------------------------------------------------------------------------

function showUpdateWindow(version) {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.show();
    updateWindow.focus();
    return;
  }
  updateWindow = new BrowserWindow({
    width: 380,
    height: 180,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'Landa Update',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  updateWindow.setAlwaysOnTop(true, 'floating');
  updateWindow.loadFile(path.join(__dirname, 'renderer', 'update.html'));
  updateWindow.webContents.on('did-finish-load', () => {
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.webContents.send('update-version', version);
    }
  });
  updateWindow.on('closed', () => { updateWindow = null; });
  updateWindow.once('ready-to-show', () => {
    if (updateWindow && !updateWindow.isDestroyed()) updateWindow.show();
  });
}

function destroyUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }
  updateWindow = null;
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

  // Packaged app: prefer the bundled resources copy.
  if (app.isPackaged) {
    const resourcePath = process.resourcesPath;
    if (fs.existsSync(path.join(resourcePath, script))) {
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
    console.log(`[backend] ${data.toString().trim()}`);
  });
  backendProcess.stderr.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.on('error', (err) => {
    console.error(`[Landa] Failed to start backend: ${err.message}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[Landa] Backend exited with code ${code}`);
    backendProcess = null;
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
  const combo = config.toggle_recording;
  const newAccelerator = hotkeyToAccelerator(combo);
  if (newAccelerator !== currentShortcut) {
    registerHotkey(combo);
    currentHotkeyCombo = combo;
  }

  const cancelCombo = config.cancel_recording;
  const newCancelAccelerator = hotkeyToAccelerator(cancelCombo);
  const savedCancelAccelerator = hotkeyToAccelerator(currentCancelCombo);
  if (newCancelAccelerator !== savedCancelAccelerator) {
    registerCancelHotkey(cancelCombo);
  }

  currentCancelSound = config.sound_cancel || 'Funk';
  currentHoldSound = config.sound_hold || 'Tink';
  currentResumeSound = config.sound_resume || 'Pop';

  const holdCombo = config.hold_recording;
  const newHoldAccelerator = hotkeyToAccelerator(holdCombo);
  const savedHoldAccelerator = hotkeyToAccelerator(currentHoldCombo);
  if (newHoldAccelerator !== savedHoldAccelerator) {
    registerHoldHotkey(holdCombo);
  }

  const vocabCombo = config.add_to_vocabulary;
  const newVocabAccelerator = hotkeyToAccelerator(vocabCombo);
  const savedVocabAccelerator = hotkeyToAccelerator(currentVocabCombo);
  if (newVocabAccelerator !== savedVocabAccelerator) {
    registerVocabHotkey(vocabCombo);
    currentVocabCombo = vocabCombo;
  }

  const reformatChanged = reformatEnabled !== config.reformat_enabled ||
                           reformatMode !== config.reformat_mode;
  reformatEnabled = config.reformat_enabled || false;
  reformatMode = config.reformat_mode || 'default';

  const newStyle = config.recording_window_style || 'mini';
  if (newStyle !== recordingWindowStyle) {
    recordingWindowStyle = newStyle;
    // Recreate next show — sizes differ, simpler than resize+notify in place.
    destroyRecordingWindow();
  }

  const newModes = config.modes || modesConfig;
  const modesChanged = JSON.stringify(newModes) !== JSON.stringify(modesConfig);
  modesConfig = newModes;

  if (reformatChanged || modesChanged) updateTray();

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('config-updated', config);
  }
}

// ---------------------------------------------------------------------------
// Status Polling (mirrors Swift's 1-second timer)
// ---------------------------------------------------------------------------

function startStatusPolling() {
  pollTimer = setInterval(async () => {
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

// ---------------------------------------------------------------------------
// Permissions (macOS)
// ---------------------------------------------------------------------------

function requestPermissions() {
  if (process.platform === 'darwin') {
    // Microphone — Electron handles the system prompt automatically
    // when the app first tries to access the mic.
    // We trigger it by checking systemPreferences.
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[Landa] Microphone permission status: ${micStatus}`);
    if (micStatus !== 'granted') {
      systemPreferences.askForMediaAccess('microphone').then((granted) => {
        console.log(`[Landa] Microphone permission after request: ${granted ? 'granted' : 'denied'}`);
      });
    }

    // Accessibility — needed for paste simulation (handled by backend via osascript)
    // We check and prompt via a dialog if not trusted
    try {
      const trusted = systemPreferences.isTrustedAccessibilityClient(true);
      console.log(`[Landa] Accessibility trusted: ${trusted}`);
    } catch {
      // Not available on all versions
    }
  }
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
    let iconDataUrl = null;
    try {
      const icnsPath = await getAppIconFileMac(appPath);
      if (icnsPath) {
        const tmpPng = path.join(os.tmpdir(), `fmv-icon-${name.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
        await execAsync(`sips -s format png "${icnsPath}" --out "${tmpPng}" --resampleWidth 256 -z 256 256 2>/dev/null`, { timeout: 3000 });
        const ni = nativeImage.createFromPath(tmpPng);
        if (!ni.isEmpty()) iconDataUrl = ni.toDataURL();
        try { fs.unlinkSync(tmpPng); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
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
      // Use plutil to convert binary plist to XML on the fly
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

function playSound(name) {
  if (process.platform === 'darwin') {
    const soundPath = `/System/Library/Sounds/${name}.aiff`;
    if (fs.existsSync(soundPath)) {
      spawn('afplay', [soundPath], { stdio: 'ignore' });
    }
  } else if (process.platform === 'win32') {
    spawn('powershell', ['-c', '[System.Media.SystemSounds]::Beep.Play()'],
      { stdio: 'ignore', windowsHide: true });
  }
}

function isInstalledMacAppPath(executablePath) {
  if (process.platform !== 'darwin') return true;
  const normalized = path.resolve(executablePath);
  const appBundlePath = path.dirname(path.dirname(path.dirname(normalized)));
  const userApplications = path.join(os.homedir(), 'Applications');

  return (
    appBundlePath.startsWith('/Applications/') ||
    appBundlePath.startsWith(`${userApplications}/`)
  );
}

function isTranslocatedMacApp(executablePath) {
  return process.platform === 'darwin' && executablePath.includes('/AppTranslocation/');
}

async function ensureMacAppInstalled() {
  if (process.platform !== 'darwin' || !app.isPackaged) return true;

  const executablePath = process.execPath;
  const installed = isInstalledMacAppPath(executablePath);
  const translocated = isTranslocatedMacApp(executablePath);
  if (installed && !translocated) return true;

  const appName = app.getName();
  const message =
    `${appName} needs to be moved to the Applications folder before it can use global hotkeys and macOS permissions correctly.\n\n` +
    'Please drag the app from the DMG into Applications, quit this copy, and then open Landa again from Applications.';

  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Open Applications Folder', 'Reveal This App', 'Quit'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: `${appName} Must Be Installed`,
    message,
  });

  if (result.response === 0) {
    await shell.openPath('/Applications');
  } else if (result.response === 1) {
    shell.showItemInFolder(executablePath);
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

  ipcMain.handle('get-system-sounds', () => {
    if (process.platform === 'darwin') {
      const soundsDir = '/System/Library/Sounds';
      try {
        return fs.readdirSync(soundsDir)
          .filter((f) => f.endsWith('.aiff'))
          .map((f) => f.replace('.aiff', ''))
          .sort();
      } catch { return []; }
    }
    // Windows — return some common system sound names
    return ['Default', 'Notify', 'Alert'];
  });

  ipcMain.handle('play-sound', (_event, name) => playSound(name));

  ipcMain.handle('get-platform', () => process.platform);
  ipcMain.handle('get-app-version', () => app.getVersion());

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
    try { return await api.fetchHistory(); }
    catch { return []; }
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

  ipcMain.handle('finish-onboarding', async (_event, { language }) => {
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

app.on('second-instance', () => {
  if (settingsWindow) settingsWindow.focus();
});

app.whenReady().then(() => {
  ensureMacAppInstalled().then((ok) => {
    if (!ok) return;

    setupIpcHandlers();

    requestPermissions();
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

      if (!config) {
        // Final fallback if neither backend nor disk config is available.
        registerHotkey({ key: 'f5', key_code: 96, modifiers: ['command', 'shift'] });
        registerCancelHotkey({ key: 'escape', key_code: 53, modifiers: [] });
        registerHoldHotkey({ key: 'f6', key_code: 97, modifiers: [] });
      }

      if (config && config.onboarding_completed === false) {
        openOnboarding();
      }
    }, 2000);

    startStatusPolling();

    if (app.isPackaged) {
      setupAutoUpdater();
      autoUpdater.checkForUpdates().catch(() => {});
      setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (pollTimer) clearInterval(pollTimer);
  destroyRecordingWindow();
  stopBackend();
});

// Keep the app running when all windows are closed (tray app)
app.on('window-all-closed', (e) => {
  // Don't quit — we're a tray app
});
