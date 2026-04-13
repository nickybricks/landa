const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, clipboard, dialog, ipcMain, systemPreferences, nativeTheme } = require('electron');
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
let modesConfig = { selections: { 'personal-message': 'formal', 'email': 'formal' } };
let currentShortcut = null; // Electron accelerator string
let currentCancelShortcut = null; // Electron accelerator for cancel_recording
let currentCancelSound = 'Funk'; // system sound name to play on cancel
let lastHotkeyTime = 0;
let hotkeyInFlight = false; // re-entrancy guard
let lastSentConfigStr = null; // dedup config-updated pushes to settings window

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
  startRecording: () => apiRequest('POST', '/start', null, 12000),
  stopRecording: () => apiRequest('POST', '/stop', null, 12000),
  cancelRecording: () => apiRequest('POST', '/cancel', null, 12000),
  selectMode: (mode) => apiRequest('POST', '/modes/select', { mode }),
  fetchNemoStatus: () => apiRequest('GET', '/nemo/status'),
  fetchHistory: () => apiRequest('GET', '/history'),
  clearHistory: () => apiRequest('DELETE', '/history'),
  deleteHistoryEntry: (id) => apiRequest('DELETE', `/history/${encodeURIComponent(id)}`),
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

/** Update recording state and sync cancel hotkey registration. */
function setRecordingState(recording) {
  const changed = isRecording !== recording;
  isRecording = recording;
  if (recording) {
    activateCancelHotkey();
  } else {
    deactivateCancelHotkey();
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
        await api.stopRecording();
      } else {
        await api.startRecording();
      }
      console.log(`[Landa] ${action} API responded in ${Date.now() - t0}ms`);
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

  const statusLabel = isRecording
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
          api.patchConfig({ modes: { enabled: { [categoryId]: !isEnabled } } }).catch(() => {});
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
          api.patchConfig({ modes: { selections: newSels } }).catch(() => {});
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
  settingsWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      (input.key === 'r' && (input.meta || input.control)) ||
      input.key === 'F5'
    ) {
      _event.preventDefault();
    }
  });

  // Reset so the next poll sends config to the new window.  The renderer
  // registers its config-updated listener before DOMContentLoaded awaits IPC
  // calls, so the first poll event will always be received.
  lastSentConfigStr = null;

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Backend Lifecycle
// ---------------------------------------------------------------------------

function findBackendRoot() {
  const script = path.join('backend', 'landa_core.py');

  // 1. Bundled in resources (packaged app)
  const resourcePath = process.resourcesPath;
  if (fs.existsSync(path.join(resourcePath, script))) {
    console.log('[Landa] Found backend in app resources');
    return resourcePath;
  }

  // 2. ~/.landa/backend/
  const homeBackend = CONFIG_DIR;
  if (fs.existsSync(path.join(homeBackend, script))) {
    console.log('[Landa] Found backend in ~/.landa/');
    return homeBackend;
  }

  // 3. Walk up from app directory (dev builds)
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

  const scriptPath = path.join(backendRoot, 'backend', 'landa_core.py');
  const pythonPath = findPython(backendRoot);
  console.log(`[Landa] Starting backend: ${pythonPath} ${scriptPath}`);

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
// Status Polling (mirrors Swift's 1-second timer)
// ---------------------------------------------------------------------------

let currentHotkeyCombo = null;
let currentCancelCombo = null;

function startStatusPolling() {
  pollTimer = setInterval(async () => {
    // Don't overwrite state while a hotkey action is in-flight
    if (!hotkeyInFlight) {
      try {
        const status = await api.fetchStatus();
        setRecordingState(status.recording);
      } catch {
        // Backend not ready yet — ignore
      }
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

      // Update cancel hotkey combo if changed
      const cancelCombo = config.cancel_recording;
      const newCancelAccelerator = hotkeyToAccelerator(cancelCombo);
      const savedCancelAccelerator = hotkeyToAccelerator(currentCancelCombo);
      if (newCancelAccelerator !== savedCancelAccelerator) {
        registerCancelHotkey(cancelCombo);
      }

      // Update cancel sound
      currentCancelSound = config.sound_cancel || 'Funk';

      // Update reformat state
      const reformatChanged = reformatEnabled !== config.reformat_enabled ||
                               reformatMode !== config.reformat_mode;
      reformatEnabled = config.reformat_enabled || false;
      reformatMode = config.reformat_mode || 'default';

      // Update modes config
      const newModes = config.modes || modesConfig;
      const modesChanged = JSON.stringify(newModes) !== JSON.stringify(modesConfig);
      modesConfig = newModes;

      if (reformatChanged || modesChanged) updateTray();

      // Forward config updates to settings window only when something changed
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        const configStr = JSON.stringify(config);
        if (configStr !== lastSentConfigStr) {
          lastSentConfigStr = configStr;
          settingsWindow.webContents.send('config-updated', config);
        }
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
        console.log(`[Landa] Microphone permission: ${granted ? 'granted' : 'denied'}`);
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
  }
  // Windows: could use powershell to play system sounds
}

function setupIpcHandlers() {
  ipcMain.handle('get-config', async () => {
    return await getBestAvailableConfig();
  });

  ipcMain.handle('save-config', async (_event, config) => {
    try { return await api.saveConfig(config); }
    catch { return null; }
  });

  // Synchronous variant for beforeunload — writes config to disk AND updates
  // the backend's in-memory state so the next GET /config returns fresh data.
  ipcMain.on('save-config-sync', (event, cfg) => {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      // Synchronously POST to backend so its in-memory config is also updated
      // before the renderer reloads and calls GET /config.
      try {
        require('child_process').execSync(
          `curl -s -X POST -H "Content-Type: application/json" -d @"${CONFIG_PATH}" http://127.0.0.1:7890/config`,
          { timeout: 2000 }
        );
      } catch { /* backend may not be running */ }
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });

  ipcMain.on('debug-log', (_event, msg) => {
    console.log('[RENDERER]', msg);
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
      registerCancelHotkey(config.cancel_recording || { key: 'escape', key_code: 53, modifiers: [] });
      currentCancelCombo = config.cancel_recording;
      reformatEnabled = config.reformat_enabled || false;
      reformatMode = config.reformat_mode || 'default';
      modesConfig = config.modes || modesConfig;
      updateTray();
    } catch {
      // Use default hotkeys
      registerHotkey({ key: 'f5', key_code: 96, modifiers: ['command', 'shift'] });
      registerCancelHotkey({ key: 'escape', key_code: 53, modifiers: [] });
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
