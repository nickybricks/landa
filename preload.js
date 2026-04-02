const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  patchConfig: (patch) => ipcRenderer.invoke('patch-config', patch),

  // NeMo
  getNemoStatus: () => ipcRenderer.invoke('get-nemo-status'),
  installNemo: () => ipcRenderer.invoke('install-nemo'),
  onNemoInstallProgress: (callback) => {
    ipcRenderer.on('nemo-install-progress', (_event, line) => callback(line));
  },

  // Sounds
  getSystemSounds: () => ipcRenderer.invoke('get-system-sounds'),
  playSound: (name) => ipcRenderer.invoke('play-sound', name),

  // Platform
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Installed apps (for popup grid)
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),

  // Listen for config updates from polling
  onConfigUpdated: (callback) => {
    ipcRenderer.on('config-updated', (_event, config) => callback(config));
  },

  // Listen for tab navigation from main process (e.g. tray menu → Modes)
  onNavigateTab: (callback) => {
    ipcRenderer.on('navigate-tab', (_event, tab) => callback(tab));
  },
});
