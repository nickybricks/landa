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
    ipcRenderer.removeAllListeners('nemo-install-progress');
    ipcRenderer.on('nemo-install-progress', (_event, line) => callback(line));
  },

  // Local Whisper
  getWhisperLocalStatus: (modelName) => ipcRenderer.invoke('get-whisper-local-status', modelName),
  installWhisperDeps: () => ipcRenderer.invoke('install-whisper-deps'),
  downloadWhisperModel: (modelName) => ipcRenderer.invoke('download-whisper-model', modelName),
  onWhisperDepsProgress: (callback) => {
    ipcRenderer.removeAllListeners('whisper-deps-progress');
    ipcRenderer.on('whisper-deps-progress', (_event, line) => callback(line));
  },

  // Sounds
  getSystemSounds: () => ipcRenderer.invoke('get-system-sounds'),
  playSound: (name) => ipcRenderer.invoke('play-sound', name),

  // Platform
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  deleteHistoryEntry: (id) => ipcRenderer.invoke('delete-history-entry', id),

  // Installed apps (for popup grid)
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),

  // Listen for config updates from polling
  onConfigUpdated: (callback) => {
    ipcRenderer.removeAllListeners('config-updated');
    ipcRenderer.on('config-updated', (_event, config) => callback(config));
  },

  // Listen for tab navigation from main process (e.g. tray menu → Modes)
  onNavigateTab: (callback) => {
    ipcRenderer.removeAllListeners('navigate-tab');
    ipcRenderer.on('navigate-tab', (_event, tab) => callback(tab));
  },
});
