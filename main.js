const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, clipboard, dialog, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const http = require('http');
const os = require('os');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'http://127.0.0.1:7890';
const CONFIG_DIR = path.join(os.homedir(), '.findmyvoice');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const POLL_INTERVAL = 1000; // 1 second, matches Swift app

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tray = null;
let settingsWindow = null;
let backendProcess = null;
let pollTimer = null;
let isRecording = false;
let reformatEnabled = false;
let reformatMode = 'default';
let currentShortcut = null; // Electron accelerator string
let lastHotkeyTime = 0;

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

function apiRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {},
      timeout: 5000,
    };

    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => {
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
  startRecording: () => apiRequest('POST', '/start'),
  stopRecording: () => apiRequest('POST', '/stop'),
  selectMode: (mode) => apiRequest('POST', '/modes/select', { mode }),
  fetchNemoStatus: () => apiRequest('GET', '/nemo/status'),
};

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
      console.log(`[FindMyVoice] Registered hotkey: ${accelerator}`);
    } else {
      console.error(`[FindMyVoice] Failed to register hotkey: ${accelerator}`);
    }
  } catch (err) {
    console.error(`[FindMyVoice] Hotkey registration error: ${err.message}`);
  }
}

async function handleHotkeyPress() {
  // Debounce: 500ms like the Swift app
  const now = Date.now();
  if (now - lastHotkeyTime < 500) return;
  lastHotkeyTime = now;

  try {
    if (isRecording) {
      await api.stopRecording();
    } else {
      await api.startRecording();
    }
    const status = await api.fetchStatus();
    isRecording = status.recording;
    updateTray();
  } catch (err) {
    console.error(`[FindMyVoice] Hotkey action failed: ${err.message}`);
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
  tray.setToolTip('FindMyVoice');
  updateTray();
}

function updateTray() {
  if (!tray) return;

  const statusLabel = isRecording
    ? 'Recording…'
    : (reformatEnabled ? `Idle · ${capitalize(reformatMode)}` : 'Idle');

  const modeItems = ['default', 'email', 'slack'].map((mode) => ({
    label: capitalize(mode),
    type: 'radio',
    checked: reformatMode === mode,
    click: () => { api.selectMode(mode).catch(() => {}); },
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: 'Reformat Output',
      type: 'checkbox',
      checked: reformatEnabled,
      click: (item) => {
        api.patchConfig({ reformat_enabled: item.checked }).catch(() => {});
      },
    },
    {
      label: `Mode: ${capitalize(reformatMode)}`,
      submenu: modeItems,
    },
    { type: 'separator' },
    {
      label: 'Settings…',
      click: openSettings,
    },
    { type: 'separator' },
    {
      label: 'Quit FindMyVoice',
      accelerator: 'CommandOrControl+Q',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Update tray icon based on recording state
  if (process.platform === 'darwin') {
    tray.setTitle(isRecording ? '●' : '');
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

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 520,
    title: 'FindMyVoice Settings',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Backend Lifecycle
// ---------------------------------------------------------------------------

function findBackendRoot() {
  const script = path.join('backend', 'findmyvoice_core.py');

  // 1. Bundled in resources (packaged app)
  const resourcePath = process.resourcesPath;
  if (fs.existsSync(path.join(resourcePath, script))) {
    console.log('[FindMyVoice] Found backend in app resources');
    return resourcePath;
  }

  // 2. ~/.findmyvoice/backend/
  const homeBackend = CONFIG_DIR;
  if (fs.existsSync(path.join(homeBackend, script))) {
    console.log('[FindMyVoice] Found backend in ~/.findmyvoice/');
    return homeBackend;
  }

  // 3. Walk up from app directory (dev builds)
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, script))) {
      console.log(`[FindMyVoice] Found backend at: ${dir}`);
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function findPython(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'backend', 'venv', 'bin', 'python'),
    path.join(projectRoot, 'backend', 'venv', 'Scripts', 'python.exe'), // Windows
    path.join(os.homedir(), '.findmyvoice', 'backend', 'venv', 'bin', 'python'),
    path.join(os.homedir(), '.findmyvoice', 'backend', 'venv', 'Scripts', 'python.exe'),
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
    console.error('[FindMyVoice] Could not find findmyvoice_core.py — backend will not start');
    return;
  }

  const scriptPath = path.join(backendRoot, 'backend', 'findmyvoice_core.py');
  const pythonPath = findPython(backendRoot);
  console.log(`[FindMyVoice] Starting backend: ${pythonPath} ${scriptPath}`);

  backendProcess = spawn(pythonPath, [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });
  backendProcess.stderr.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.on('error', (err) => {
    console.error(`[FindMyVoice] Failed to start backend: ${err.message}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[FindMyVoice] Backend exited with code ${code}`);
    backendProcess = null;
  });

  console.log(`[FindMyVoice] Backend started (pid=${backendProcess.pid})`);
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    console.log('[FindMyVoice] Backend stopped');
    backendProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Status Polling (mirrors Swift's 1-second timer)
// ---------------------------------------------------------------------------

let currentHotkeyCombo = null;

function startStatusPolling() {
  pollTimer = setInterval(async () => {
    try {
      const status = await api.fetchStatus();
      const changed = isRecording !== status.recording;
      isRecording = status.recording;
      if (changed) updateTray();
    } catch {
      // Backend not ready yet — ignore
    }

    try {
      const config = await api.fetchConfig();
      const combo = config.toggle_recording;
      const newAccelerator = hotkeyToAccelerator(combo);

      // Re-register hotkey if changed
      if (newAccelerator !== currentShortcut) {
        registerHotkey(combo);
        currentHotkeyCombo = combo;
      }

      // Update reformat state
      const reformatChanged = reformatEnabled !== config.reformat_enabled ||
                               reformatMode !== config.reformat_mode;
      reformatEnabled = config.reformat_enabled || false;
      reformatMode = config.reformat_mode || 'default';
      if (reformatChanged) updateTray();

      // Forward config updates to settings window
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('config-updated', config);
      }
    } catch {
      // Backend not ready yet — ignore
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
    if (micStatus !== 'granted') {
      systemPreferences.askForMediaAccess('microphone').then((granted) => {
        console.log(`[FindMyVoice] Microphone permission: ${granted ? 'granted' : 'denied'}`);
      });
    }

    // Accessibility — needed for paste simulation (handled by backend via osascript)
    // We check and prompt via a dialog if not trusted
    try {
      const trusted = systemPreferences.isTrustedAccessibilityClient(true);
      console.log(`[FindMyVoice] Accessibility trusted: ${trusted}`);
    } catch {
      // Not available on all versions
    }
  }
}

// ---------------------------------------------------------------------------
// IPC handlers for settings window (registered in setupIpcHandlers)
// ---------------------------------------------------------------------------

function setupIpcHandlers() {
  ipcMain.handle('get-config', async () => {
    try { return await api.fetchConfig(); }
    catch { return null; }
  });

  ipcMain.handle('save-config', async (_event, config) => {
    try { return await api.saveConfig(config); }
    catch { return null; }
  });

  ipcMain.handle('patch-config', async (_event, patch) => {
    try { return await api.patchConfig(patch); }
    catch { return null; }
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

  ipcMain.handle('play-sound', (_event, name) => {
    if (process.platform === 'darwin') {
      const soundPath = `/System/Library/Sounds/${name}.aiff`;
      if (fs.existsSync(soundPath)) {
        spawn('afplay', [soundPath], { stdio: 'ignore' });
      }
    }
    // Windows: could use powershell to play system sounds
  });

  ipcMain.handle('get-platform', () => process.platform);
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
  setupIpcHandlers();
  // Hide dock icon on macOS (menu bar app)
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  requestPermissions();
  startBackend();
  createTray();

  // Wait a moment for backend to start, then load config and register hotkey
  setTimeout(async () => {
    try {
      const config = await api.fetchConfig();
      registerHotkey(config.toggle_recording);
      currentHotkeyCombo = config.toggle_recording;
      reformatEnabled = config.reformat_enabled || false;
      reformatMode = config.reformat_mode || 'default';
      updateTray();
    } catch {
      // Use default hotkey
      registerHotkey({ key: 'f5', key_code: 96, modifiers: ['command', 'shift'] });
    }
  }, 2000);

  startStatusPolling();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (pollTimer) clearInterval(pollTimer);
  stopBackend();
});

// Keep the app running when all windows are closed (tray app)
app.on('window-all-closed', (e) => {
  // Don't quit — we're a tray app
});
