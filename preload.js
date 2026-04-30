const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  saveConfigSync: (config) => ipcRenderer.sendSync('save-config-sync', config),
  patchConfig: (patch) => ipcRenderer.invoke('patch-config', patch),
  debugLog: (msg) => ipcRenderer.send('debug-log', msg),

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

  // Local LLM
  getLlmLocalStatus: (modelId) => ipcRenderer.invoke('get-llm-local-status', modelId),
  installLlmDeps: () => ipcRenderer.invoke('install-llm-deps'),
  downloadLlmModel: (modelId) => ipcRenderer.invoke('download-llm-model', modelId),
  onLlmDepsProgress: (callback) => {
    ipcRenderer.removeAllListeners('llm-deps-progress');
    ipcRenderer.on('llm-deps-progress', (_event, line) => callback(line));
  },

  // Sounds
  getSystemSounds: () => ipcRenderer.invoke('get-system-sounds'),
  playSound: (name) => ipcRenderer.invoke('play-sound', name),

  // Platform
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // App version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  deleteHistoryEntry: (id) => ipcRenderer.invoke('delete-history-entry', id),
  onHistoryUpdated: (callback) => {
    ipcRenderer.removeAllListeners('history-updated');
    ipcRenderer.on('history-updated', () => callback());
  },

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

  // Listen for add-to-vocabulary from global hotkey
  onAddToVocabulary: (callback) => {
    ipcRenderer.removeAllListeners('add-to-vocabulary');
    ipcRenderer.on('add-to-vocabulary', (_event, word) => callback(word));
  },
  setCapturingHotkey: (active) => ipcRenderer.send('set-capturing-hotkey', active),

  // Recording window
  onRecordingStyle: (callback) => {
    ipcRenderer.removeAllListeners('recording-style');
    ipcRenderer.on('recording-style', (_event, style) => callback(style));
  },
  onRecordingPaused: (callback) => {
    ipcRenderer.removeAllListeners('recording-paused');
    ipcRenderer.on('recording-paused', (_event, paused) => callback(paused));
  },
  onAudioLevel: (callback) => {
    ipcRenderer.on('recording-level', (_event, level) => callback(level));
  },

  // Onboarding
  getMicAccessStatus: () => ipcRenderer.invoke('get-mic-access-status'),
  requestMicAccess: () => ipcRenderer.invoke('request-mic-access'),
  getAccessibilityStatus: () => ipcRenderer.invoke('get-accessibility-status'),
  openAccessibilitySettings: () => ipcRenderer.invoke('open-accessibility-settings'),
  finishOnboarding: (payload) => ipcRenderer.invoke('finish-onboarding', payload),
});
