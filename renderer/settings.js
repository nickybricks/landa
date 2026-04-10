// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config = null;
let platform = 'darwin';
let systemSounds = [];
let recordingAction = null; // which shortcut is being recorded
let nemoInstalled = null;
let nemoInstalling = false;

// Default shortcuts (must match Python backend's DEFAULT_CONFIG)
const DEFAULTS = {
  toggle_recording: { key: 'f5', key_code: 96, modifiers: ['command', 'shift'] },
  cancel_recording: { key: 'escape', key_code: 53, modifiers: [] },
  change_mode: { key: 'k', key_code: 40, modifiers: ['option', 'shift'] },
  push_to_talk: { key: '', key_code: -1, modifiers: [] },
  mouse_shortcut: { key: '', key_code: -1, modifiers: [] },
};

// OpenAI languages (matches Swift ModelsLibraryView)
const OPENAI_LANGUAGES = [
  ['auto', 'Auto-detect'], ['en', 'English'], ['fr', 'French'], ['de', 'German'],
  ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'],
  ['pl', 'Polish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['cs', 'Czech'],
  ['sk', 'Slovak'], ['ro', 'Romanian'], ['hu', 'Hungarian'], ['bg', 'Bulgarian'],
  ['hr', 'Croatian'], ['da', 'Danish'], ['et', 'Estonian'], ['fi', 'Finnish'],
  ['el', 'Greek'], ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['sl', 'Slovenian'],
  ['sv', 'Swedish'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
];

// NeMo languages (matches Swift ModelsLibraryView)
const NEMO_LANGUAGES = [
  ['auto', 'Auto-detect'], ['en', 'English'], ['bg', 'Bulgarian'], ['hr', 'Croatian'],
  ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'], ['et', 'Estonian'],
  ['fi', 'Finnish'], ['fr', 'French'], ['de', 'German'], ['el', 'Greek'],
  ['hu', 'Hungarian'], ['it', 'Italian'], ['lv', 'Latvian'], ['lt', 'Lithuanian'],
  ['mt', 'Maltese'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['ro', 'Romanian'],
  ['ru', 'Russian'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['es', 'Spanish'],
  ['sv', 'Swedish'], ['uk', 'Ukrainian'],
];

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  platform = await window.api.getPlatform();
  document.body.classList.add('platform-' + platform);
  systemSounds = await window.api.getSystemSounds();

  // Load config first (retry if backend isn't ready yet)
  config = await window.api.getConfig();
  if (!config) {
    for (let i = 0; i < 5 && !config; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      config = await window.api.getConfig();
    }
  }

  populateSoundSelects();
  populateLanguageSelect();
  populateLlmModelSelect('openai');
  setupSidebarToggle();
  setupSidebarNav();
  setupShortcutCapture();
  setupOptionToggles();
  setupSoundControls();
  setupProviderSwitch();
  setupApiKeyInput();
  setupLlmSettings();
  setupModesTab();
  setupHistoryTab();

  if (config) applyConfig(config);

  // Check NeMo if provider is nemo
  if (config && config.api_provider === 'nemo') {
    await checkNemoStatus();
  }

  // Listen for config updates from main process polling
  window.api.onConfigUpdated((updated) => {
    // Skip if a save is pending/in-flight — the frontend is the source of truth
    // during edits. Applying a stale polled value would reset dropdowns/inputs.
    if (saveInFlight) return;
    config = updated;
    applyConfig(config, { fromPoll: true });
  });

  // Listen for NeMo install progress
  window.api.onNemoInstallProgress((line) => {
    const el = document.getElementById('nemo-status-line');
    if (el) el.textContent = line;
  });

  // Listen for tab navigation from tray menu
  window.api.onNavigateTab((tab) => {
    const item = document.querySelector(`.sidebar-item[data-tab="${tab}"]`);
    if (item) item.click();
  });
});

// ---------------------------------------------------------------------------
// Sidebar Toggle
// ---------------------------------------------------------------------------

function setupSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');

  if (localStorage.getItem('sidebar-collapsed') === 'true') {
    sidebar.classList.add('collapsed');
  }

  btn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
  });
}

// ---------------------------------------------------------------------------
// Sidebar Navigation
// ---------------------------------------------------------------------------

function setupSidebarNav() {
  document.querySelectorAll('.sidebar-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');

      const tab = item.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });

  // Start on Configuration tab (matches Swift default)
  document.querySelector('[data-tab="configuration"]').click();
}

// ---------------------------------------------------------------------------
// Apply Config to UI
// ---------------------------------------------------------------------------

function applyConfig(cfg, { fromPoll = false } = {}) {
  // Shortcuts
  for (const action of Object.keys(DEFAULTS)) {
    const combo = cfg[action] || DEFAULTS[action];
    renderShortcutBadges(action, combo);
    updateResetButton(action, combo, DEFAULTS[action]);
  }

  // Options
  document.getElementById('opt-autoPaste').checked = cfg.auto_paste;
  document.getElementById('opt-autoCapitalize').checked = cfg.auto_capitalize;
  document.getElementById('opt-autoPunctuate').checked = cfg.auto_punctuate;

  // Sounds
  document.getElementById('opt-soundMuted').checked = cfg.sound_muted || false;
  document.getElementById('sel-soundStart').value = cfg.sound_start || 'Tink';
  document.getElementById('sel-soundStop').value = cfg.sound_stop || 'Pop';
  updateSoundRowsDisabled(cfg.sound_muted || false);

  // Provider
  document.getElementById('sel-provider').value = cfg.api_provider;
  // Only toggle section visibility from polls — skip renderNemoContent to
  // avoid destroying open dropdowns (language select, etc.)
  if (fromPoll) {
    document.getElementById('section-openai').classList.toggle('hidden', cfg.api_provider !== 'openai');
    document.getElementById('section-nemo').classList.toggle('hidden', cfg.api_provider !== 'nemo');
  } else {
    updateProviderSections(cfg.api_provider);
  }

  // OpenAI (transcription)
  document.getElementById('inp-apiKey').value = cfg.api_key || '';
  const openaiModel = cfg.openai_model || 'whisper-large-v3';
  document.getElementById('sel-openaiModel').value = openaiModel;
  document.getElementById('sel-openaiLang').value = cfg.openai_language || 'auto';
  if (!fromPoll) updateLocalModelStatus(openaiModel);

  // LLM Settings — auto-populate key from transcription api_key when openai+unset
  applyLlmConfig(cfg, { fromPoll });

  // Modes
  applyModesConfig();
}

// ---------------------------------------------------------------------------
// Shortcut Rendering
// ---------------------------------------------------------------------------

const MOD_SYMBOLS = {
  command: '⌘', shift: '⇧', option: '⌥', control: '⌃',
};

const KEY_DISPLAY = {
  escape: 'Esc', space: 'Space', tab: 'Tab', return: 'Return', delete: 'Delete',
};

function renderShortcutBadges(action, combo) {
  const container = document.getElementById(`badge-${action}`);
  container.innerHTML = '';

  if (recordingAction === action) {
    const label = document.createElement('span');
    label.className = 'recording-label';
    label.textContent = 'Press shortcut...';
    container.appendChild(label);
    return;
  }

  if (!combo.key || combo.key === '') {
    const label = document.createElement('span');
    label.className = 'record-label';
    label.textContent = 'Record shortcut';
    container.appendChild(label);
    return;
  }

  // Modifier badges
  for (const mod of (combo.modifiers || [])) {
    const badge = document.createElement('span');
    badge.className = 'key-badge';
    badge.textContent = MOD_SYMBOLS[mod] || mod;
    container.appendChild(badge);
  }

  // Key badge
  const keyBadge = document.createElement('span');
  keyBadge.className = 'key-badge';
  const keyLower = combo.key.toLowerCase();
  keyBadge.textContent = KEY_DISPLAY[keyLower] || combo.key.toUpperCase();
  container.appendChild(keyBadge);
}

function updateResetButton(action, combo, defaultCombo) {
  const btn = document.querySelector(`.shortcut-reset[data-action="${action}"]`);
  const isDifferent = combo.key !== defaultCombo.key ||
    JSON.stringify(combo.modifiers) !== JSON.stringify(defaultCombo.modifiers);
  btn.classList.toggle('hidden', !isDifferent);
}

// ---------------------------------------------------------------------------
// Shortcut Capture
// ---------------------------------------------------------------------------

function setupShortcutCapture() {
  // Click on badges to start recording
  document.querySelectorAll('.shortcut-badges').forEach((el) => {
    el.addEventListener('click', () => {
      const action = el.id.replace('badge-', '');
      startRecording(action);
    });
  });

  // Reset buttons
  document.querySelectorAll('.shortcut-reset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      setShortcut(action, { ...DEFAULTS[action] });
    });
  });

  // Key capture
  document.addEventListener('keydown', handleKeyCapture);
}

function startRecording(action) {
  stopRecording();
  recordingAction = action;
  renderShortcutBadges(action, {});
}

function stopRecording() {
  const prev = recordingAction;
  recordingAction = null;
  if (prev && config) {
    renderShortcutBadges(prev, config[prev] || DEFAULTS[prev]);
  }
}

function handleKeyCapture(e) {
  if (!recordingAction) return;
  e.preventDefault();
  e.stopPropagation();

  // Escape without modifiers cancels
  if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
    stopRecording();
    return;
  }

  // Don't capture bare modifier keys
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

  const combo = keyEventToCombo(e);

  // Check for duplicates
  for (const action of Object.keys(DEFAULTS)) {
    if (action === recordingAction) continue;
    const existing = config[action];
    if (existing && existing.key && existing.key === combo.key &&
        JSON.stringify(existing.modifiers) === JSON.stringify(combo.modifiers)) {
      // Flash the conflicting row
      const row = document.querySelector(`.shortcut-row[data-action="${action}"]`);
      row.classList.add('duplicate');
      setTimeout(() => row.classList.remove('duplicate'), 800);
      stopRecording();
      return;
    }
  }

  setShortcut(recordingAction, combo);
  stopRecording();
}

function keyEventToCombo(e) {
  const modifiers = [];
  if (e.ctrlKey) modifiers.push('control');
  if (e.altKey) modifiers.push('option');
  if (e.shiftKey) modifiers.push('shift');
  if (e.metaKey) modifiers.push('command');

  // Map key name
  let key = '';
  const code = e.code;

  if (code.startsWith('Key')) {
    key = code.slice(3).toLowerCase();
  } else if (code.startsWith('Digit')) {
    key = code.slice(5);
  } else {
    const codeMap = {
      F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
      F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
      Escape: 'escape', Space: 'space', Tab: 'tab',
      Enter: 'return', Backspace: 'delete',
    };
    key = codeMap[code] || e.key.toLowerCase();
  }

  // Map to approximate keyCode (for backend compatibility)
  const keyCodeMap = {
    f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97,
    f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
    escape: 53, space: 49, tab: 48, return: 36, delete: 51,
    a: 0, b: 11, c: 8, d: 2, e: 14, f: 3, g: 5, h: 4,
    i: 34, j: 38, k: 40, l: 37, m: 46, n: 45, o: 31,
    p: 35, q: 12, r: 15, s: 1, t: 17, u: 32, v: 9,
    w: 13, x: 7, y: 16, z: 6,
    '0': 29, '1': 18, '2': 19, '3': 20, '4': 21,
    '5': 23, '6': 22, '7': 26, '8': 28, '9': 25,
  };

  return {
    key,
    key_code: keyCodeMap[key] ?? -1,
    modifiers,
  };
}

function setShortcut(action, combo) {
  if (!config) return;
  config[action] = combo;
  renderShortcutBadges(action, combo);
  updateResetButton(action, combo, DEFAULTS[action]);
  saveConfig();
}

// ---------------------------------------------------------------------------
// Option Toggles
// ---------------------------------------------------------------------------

function setupOptionToggles() {
  const toggles = {
    'opt-autoPaste': 'auto_paste',
    'opt-autoCapitalize': 'auto_capitalize',
    'opt-autoPunctuate': 'auto_punctuate',
    'opt-soundMuted': 'sound_muted',
  };

  for (const [id, key] of Object.entries(toggles)) {
    document.getElementById(id).addEventListener('change', (e) => {
      if (!config) return;
      config[key] = e.target.checked;
      if (key === 'sound_muted') {
        updateSoundRowsDisabled(e.target.checked);
      }
      saveConfig();
    });
  }
}

function updateSoundRowsDisabled(muted) {
  document.getElementById('sound-start-row').classList.toggle('disabled', muted);
  document.getElementById('sound-stop-row').classList.toggle('disabled', muted);
}

// ---------------------------------------------------------------------------
// Sound Controls
// ---------------------------------------------------------------------------

function populateSoundSelects() {
  const startSel = document.getElementById('sel-soundStart');
  const stopSel = document.getElementById('sel-soundStop');
  const startVal = (config && config.sound_start) || 'Tink';
  const stopVal = (config && config.sound_stop) || 'Pop';

  for (const sound of systemSounds) {
    startSel.add(new Option(sound, sound, false, sound === startVal));
    stopSel.add(new Option(sound, sound, false, sound === stopVal));
  }
}

function setupSoundControls() {
  document.getElementById('sel-soundStart').addEventListener('change', (e) => {
    if (!config) return;
    config.sound_start = e.target.value;
    window.api.playSound(e.target.value);
    saveConfig();
  });

  document.getElementById('sel-soundStop').addEventListener('change', (e) => {
    if (!config) return;
    config.sound_stop = e.target.value;
    window.api.playSound(e.target.value);
    saveConfig();
  });

  document.querySelectorAll('.play-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const which = btn.dataset.sound;
      const sel = which === 'start' ? 'sel-soundStart' : 'sel-soundStop';
      window.api.playSound(document.getElementById(sel).value);
    });
  });
}

// ---------------------------------------------------------------------------
// Provider Switch
// ---------------------------------------------------------------------------

function setupProviderSwitch() {
  document.getElementById('sel-provider').addEventListener('change', async (e) => {
    if (!config) return;
    const provider = e.target.value;
    config.api_provider = provider;
    updateProviderSections(provider);
    if (provider === 'nemo') {
      await checkNemoStatus();
    }
    saveConfig();
  });
}

function updateProviderSections(provider) {
  document.getElementById('section-openai').classList.toggle('hidden', provider !== 'openai');
  document.getElementById('section-nemo').classList.toggle('hidden', provider !== 'nemo');

  if (provider === 'nemo') {
    renderNemoContent();
  }
}

// ---------------------------------------------------------------------------
// API Key Input
// ---------------------------------------------------------------------------

function setupApiKeyInput() {
  const input = document.getElementById('inp-apiKey');
  let debounce = null;

  input.addEventListener('input', () => {
    if (!config) return;
    config.api_key = input.value;
    // Auto-populate LLM key only when both speech and LLM providers are openai
    if (config.api_provider === 'openai' && config.llm_provider === 'openai' && !config.llm_api_key) {
      config.llm_api_key = input.value;
      document.getElementById('inp-llm-api-key').value = input.value;
      updateLlmAutofillNotice(true);
      applyModesConfig();
    }
    clearTimeout(debounce);
    debounce = setTimeout(saveConfig, 500);
  });

  // Also save on blur
  input.addEventListener('blur', () => {
    if (!config) return;
    config.api_key = input.value;
    clearTimeout(debounce);
    saveConfig();
  });

  // Model picker
  document.getElementById('sel-openaiModel').addEventListener('change', async (e) => {
    if (!config) return;
    config.openai_model = e.target.value;
    saveConfig();
    await updateLocalModelStatus(e.target.value);
  });

  // Language picker
  document.getElementById('sel-openaiLang').addEventListener('change', (e) => {
    if (!config) return;
    config.openai_language = e.target.value;
    saveConfig();
  });
}

function populateLanguageSelect() {
  const sel = document.getElementById('sel-openaiLang');
  for (const [code, name] of OPENAI_LANGUAGES) {
    sel.add(new Option(name, code));
  }
}

// ---------------------------------------------------------------------------
// Local Whisper Model Status
// ---------------------------------------------------------------------------

const LOCAL_WHISPER_MODELS = new Set(['whisper-large-v3', 'whisper-large-v3-turbo']);
let _whisperStatusPollTimer = null;
let _whisperDepsInstalling = false;

async function updateLocalModelStatus(modelName) {
  const statusEl = document.getElementById('local-model-status');
  const dividerEl = document.getElementById('local-model-divider');
  const apiKeyRow = document.getElementById('row-api-key');
  const apiKeyDivider = document.getElementById('divider-api-key');
  if (!statusEl || !dividerEl) return;

  const isLocal = LOCAL_WHISPER_MODELS.has(modelName);
  if (apiKeyRow) apiKeyRow.classList.toggle('hidden', isLocal);
  if (apiKeyDivider) apiKeyDivider.classList.toggle('hidden', isLocal);

  if (!isLocal) {
    statusEl.classList.add('hidden');
    dividerEl.classList.add('hidden');
    clearInterval(_whisperStatusPollTimer);
    _whisperStatusPollTimer = null;
    return;
  }

  statusEl.classList.remove('hidden');
  dividerEl.classList.remove('hidden');

  const status = await window.api.getWhisperLocalStatus(modelName);
  renderLocalModelStatus(status, modelName);

  // Poll while downloading
  clearInterval(_whisperStatusPollTimer);
  if (status && status.downloading) {
    _whisperStatusPollTimer = setInterval(async () => {
      const s = await window.api.getWhisperLocalStatus(modelName);
      renderLocalModelStatus(s, modelName);
      if (s && !s.downloading) {
        clearInterval(_whisperStatusPollTimer);
        _whisperStatusPollTimer = null;
      }
    }, 2000);
  }
}

function renderLocalModelStatus(status, modelName) {
  const el = document.getElementById('local-model-status');
  if (!el) return;

  if (!status) {
    el.innerHTML = `<div class="local-model-row"><span class="local-model-note muted">Could not reach backend.</span></div>`;
    return;
  }

  if (!status.deps_installed) {
    el.innerHTML = `
      <div class="local-model-row">
        <span class="local-model-note">Open source · runs entirely on your device · your voice never leaves this computer.</span>
        <button class="btn-local-model" id="btn-install-whisper-deps">Install (~2 GB)</button>
      </div>
      ${_whisperDepsInstalling ? `<div class="local-model-installing"><span>⏳ Installing…</span><div class="status-line" id="whisper-deps-status-line"></div></div>` : ''}
    `;
    const btn = document.getElementById('btn-install-whisper-deps');
    if (btn) btn.addEventListener('click', installWhisperDeps);
    return;
  }

  if (status.downloading) {
    el.innerHTML = `
      <div class="local-model-row">
        <span class="local-model-note">Downloading model…</span>
        <span class="local-model-badge downloading">⏳ Downloading</span>
      </div>
    `;
    return;
  }

  if (status.error) {
    const row = document.createElement('div');
    row.className = 'local-model-row';
    const note = document.createElement('span');
    note.className = 'local-model-note error';
    note.textContent = `Download failed: ${status.error}`;
    const btn = document.createElement('button');
    btn.className = 'btn-local-model';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => downloadWhisperModel(modelName));
    row.appendChild(note);
    row.appendChild(btn);
    el.innerHTML = '';
    el.appendChild(row);
    return;
  }

  if (!status.cached) {
    el.innerHTML = `
      <div class="local-model-row">
        <span class="local-model-note">Open source · runs entirely on your device · your voice never leaves this computer. (~1.5 GB)</span>
        <button class="btn-local-model" id="btn-download-whisper">Download</button>
      </div>
    `;
    const btn = document.getElementById('btn-download-whisper');
    if (btn) btn.addEventListener('click', () => downloadWhisperModel(modelName));
    return;
  }

  // Cached and ready
  el.innerHTML = `
    <div class="local-model-row">
      <span class="local-model-note">Open source · runs entirely on your device · your voice never leaves this computer.</span>
      <span class="local-model-badge ready">✓ Ready</span>
    </div>
  `;
}

async function installWhisperDeps() {
  _whisperDepsInstalling = true;
  const modelName = config ? (config.openai_model || 'whisper-large-v3') : 'whisper-large-v3';
  renderLocalModelStatus({ deps_installed: false }, modelName);

  window.api.onWhisperDepsProgress((line) => {
    const el = document.getElementById('whisper-deps-status-line');
    if (el) el.textContent = line;
  });

  const result = await window.api.installWhisperDeps();
  _whisperDepsInstalling = false;

  if (result && result.success) {
    await updateLocalModelStatus(modelName);
  } else {
    const el = document.getElementById('local-model-status');
    if (el) el.innerHTML += `<div class="local-model-note error">Install failed. Check logs and try again.</div>`;
  }
}

async function downloadWhisperModel(modelName) {
  await window.api.downloadWhisperModel(modelName);
  // Start polling
  await updateLocalModelStatus(modelName);
}

// ---------------------------------------------------------------------------
// LLM Settings
// ---------------------------------------------------------------------------

const LLM_MODELS = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
};

function populateLlmModelSelect(provider) {
  const sel = document.getElementById('sel-llm-model');
  if (!sel) return;
  const models = LLM_MODELS[provider] || LLM_MODELS.openai;
  sel.innerHTML = '';
  for (const m of models) {
    sel.add(new Option(m.label, m.value));
  }
}

function setupLlmSettings() {
  // LLM icon button in modes sidebar
  document.getElementById('modes-llm-btn').addEventListener('click', () => {
    openLlmPanel();
  });

  // "Open LLM Settings" shortcut from no-key notice
  document.getElementById('modes-no-llm-goto-btn').addEventListener('click', () => {
    openLlmPanel();
  });

  // Provider selector
  document.getElementById('sel-llm-provider').addEventListener('change', (e) => {
    if (!config) return;
    config.llm_provider = e.target.value;
    populateLlmModelSelect(e.target.value);
    // Set model to first option for this provider
    const firstModel = (LLM_MODELS[e.target.value] || [])[0];
    if (firstModel) {
      config.llm_model = firstModel.value;
      document.getElementById('sel-llm-model').value = firstModel.value;
    }
    saveConfig();
  });

  // API key input
  const llmKeyInput = document.getElementById('inp-llm-api-key');
  let debounce = null;
  llmKeyInput.addEventListener('input', () => {
    if (!config) return;
    config.llm_api_key = llmKeyInput.value;
    updateLlmAutofillNotice(false);
    applyModesConfig();
    clearTimeout(debounce);
    debounce = setTimeout(saveConfig, 500);
  });
  llmKeyInput.addEventListener('blur', () => {
    if (!config) return;
    config.llm_api_key = llmKeyInput.value;
    clearTimeout(debounce);
    saveConfig();
  });

  // Model selector
  document.getElementById('sel-llm-model').addEventListener('change', (e) => {
    if (!config) return;
    config.llm_model = e.target.value;
    saveConfig();
  });
}

function applyLlmConfig(cfg, { fromPoll = false } = {}) {
  const provider = cfg.llm_provider || 'openai';

  // Auto-populate llm_api_key from transcription api_key only when both providers are openai
  let autofilled = false;
  if (!cfg.llm_api_key && cfg.api_provider === 'openai' && cfg.llm_provider === 'openai' && cfg.api_key) {
    cfg.llm_api_key = cfg.api_key;
    autofilled = true;
    if (!fromPoll) saveConfig();
  }

  document.getElementById('sel-llm-provider').value = provider;
  populateLlmModelSelect(provider);

  document.getElementById('inp-llm-api-key').value = cfg.llm_api_key || '';

  // Set model — default to first for provider if not set
  const models = LLM_MODELS[provider] || LLM_MODELS.openai;
  const savedModel = cfg.llm_model || '';
  const modelExists = models.some((m) => m.value === savedModel);
  const modelToUse = modelExists ? savedModel : (models[0] ? models[0].value : '');
  document.getElementById('sel-llm-model').value = modelToUse;
  if (!cfg.llm_model && modelToUse) {
    cfg.llm_model = modelToUse;
  }

  updateLlmAutofillNotice(autofilled);
  updateModesLlmGate();
}

function updateLlmAutofillNotice(show) {
  const notice = document.getElementById('llm-autofill-notice');
  if (notice) notice.classList.toggle('hidden', !show);
}

function hasLlmApiKey() {
  return !!(config && config.llm_api_key && config.llm_api_key.trim());
}

function updateModesLlmGate() {
  const notice = document.getElementById('modes-no-llm-notice');
  if (!notice) return;
  const hasKey = hasLlmApiKey();
  notice.classList.toggle('hidden', hasKey);
  // Disable only the enable/disable toggles when no key — categories stay clickable
  document.querySelectorAll('.mode-toggle input').forEach((inp) => {
    inp.disabled = !hasKey;
  });
  document.querySelectorAll('.mode-toggle').forEach((el) => {
    el.style.opacity = hasKey ? '' : '0.4';
    el.style.pointerEvents = hasKey ? '' : 'none';
  });
}

function openLlmPanel() {
  document.getElementById('modes-llm-btn').classList.add('active');
  document.querySelectorAll('.modes-category').forEach((el) => el.classList.remove('active'));
  document.getElementById('modes-llm-panel').classList.remove('hidden');
  document.getElementById('modes-category-panel').classList.add('hidden');
}

function closeLlmPanel() {
  document.getElementById('modes-llm-btn').classList.remove('active');
  document.getElementById('modes-llm-panel').classList.add('hidden');
  document.getElementById('modes-category-panel').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// NeMo
// ---------------------------------------------------------------------------

async function checkNemoStatus() {
  const result = await window.api.getNemoStatus();
  nemoInstalled = result ? result.installed : null;
  renderNemoContent();
}

function renderNemoContent() {
  const container = document.getElementById('nemo-content');

  if (nemoInstalling) {
    container.innerHTML = `
      <div class="nemo-installing">
        <div style="display:flex;align-items:center;gap:8px;">
          <span>⏳</span>
          <strong>Installing NeMo...</strong>
        </div>
        <div class="status-line" id="nemo-status-line">Starting installation...</div>
      </div>
    `;
    return;
  }

  if (nemoInstalled === true) {
    const nemoLangOptions = NEMO_LANGUAGES.map(([code, name]) => {
      const selected = config && config.nemo_language === code ? 'selected' : '';
      return `<option value="${code}" ${selected}>${name}</option>`;
    }).join('');

    container.innerHTML = `
      <div class="nemo-installed">
        <div class="model-row">
          <span>parakeet-tdt-0.6b-v3</span>
          <span class="check">✓</span>
        </div>
        <p class="muted" style="font-size:12px;">Runs fully on-device. No API key required.</p>
        <div class="nemo-lang-row">
          <span>Language</span>
          <select id="sel-nemoLang" style="min-width:160px;">${nemoLangOptions}</select>
        </div>
      </div>
    `;

    document.getElementById('sel-nemoLang').addEventListener('change', (e) => {
      if (!config) return;
      config.nemo_language = e.target.value;
      saveConfig();
    });
    return;
  }

  // Not installed
  container.innerHTML = `
    <div class="nemo-not-installed">
      <h4>NeMo is not installed.</h4>
      <p>To use local AI transcription, the NeMo toolkit needs to be downloaded (~2 GB).</p>
      <div id="nemo-error-msg"></div>
      <button class="btn-primary" id="btn-installNemo">Install NeMo — Free</button>
    </div>
  `;

  document.getElementById('btn-installNemo').addEventListener('click', startNemoInstall);
}

async function startNemoInstall() {
  nemoInstalling = true;
  renderNemoContent();

  const result = await window.api.installNemo();

  nemoInstalling = false;
  if (result && result.success) {
    nemoInstalled = true;
    saveConfig();
  } else {
    nemoInstalled = false;
  }
  renderNemoContent();

  if (result && !result.success) {
    const errEl = document.getElementById('nemo-error-msg');
    if (errEl) {
      errEl.innerHTML = `<div class="nemo-error">Installation failed. Check logs and try again.</div>`;
    }
  }
}

// ---------------------------------------------------------------------------
// Modes Tab
// ---------------------------------------------------------------------------

const MODES_CATEGORIES = {
  'personal-message': {
    name: 'Personal Message',
    icon: '💬',
  },
  'email': {
    name: 'Email',
    icon: '📧',
  },
};

// Known app icons — label + background color for recognizable apps
const KNOWN_APP_ICONS = {
  'gmail': { label: 'G', bg: '#EA4335' },
  'mail': { label: '✉', bg: '#007AFF' },
  'apple mail': { label: '✉', bg: '#007AFF' },
  'outlook': { label: 'O', bg: '#0078D4' },
  'superhuman': { label: 'S', bg: '#5C35E0' },
  'spark': { label: 'S', bg: '#4F46E5' },
  'airmail': { label: 'A', bg: '#1E88E5' },
  'slack': { label: 'S', bg: '#4A154B' },
  'discord': { label: 'D', bg: '#5865F2' },
  'whatsapp': { label: 'W', bg: '#25D366' },
  'telegram': { label: 'T', bg: '#0088cc' },
  'signal': { label: 'S', bg: '#3A76F0' },
  'imessage': { label: '💬', bg: '#34C759' },
  'messages': { label: '💬', bg: '#34C759' },
};

// Default linked apps/URLs per category (used if config has none yet)
const DEFAULT_CATEGORIES = {
  'email': {
    linkedApps: ['Mail', 'Outlook', 'Superhuman'],
    linkedUrls: ['mail.google.com', 'outlook.live.com', 'outlook.office.com'],
  },
  'personal-message': {
    linkedApps: ['Slack', 'Discord', 'WhatsApp', 'Telegram', 'Signal'],
    linkedUrls: [],
  },
};

const MODES_STYLES = {
  formal: { name: 'Formal.', subtitle: 'Caps + Punctuation' },
  casual: { name: 'Casual', subtitle: 'Caps + Less punctuation' },
  excited: { name: 'Excited!', subtitle: 'More exclamations' },
};

const MODES_PREVIEWS = {
  'personal-message': {
    formal: 'Hey, are you free for lunch tomorrow?\nLet\'s do 12 if that works for you.',
    casual: 'Hey are you free for lunch tomorrow?\nLet\'s do 12 if that works for you',
    excited: 'Hey, are you free for lunch tomorrow?\nLet\'s do 12 if that works for you!',
  },
  'email': {
    formal: 'Hi Oscar,\n\nI wanted to follow up regarding our conversation earlier today. It was a pleasure discussing the project details with you.\n\nPlease don\'t hesitate to reach out if you have any further questions.\n\nBest regards,\nLotti',
    casual: 'Hi Oscar, great talking with you today. Looking forward to catching up again soon\n\nBest,\nLotti',
    excited: 'Hi Oscar,\n\nIt was great talking with you today! Really looking forward to our next chat!\n\nBest,\nLotti',
  },
};

let selectedCategory = 'personal-message';

// Cache for installed apps list (in-memory only, re-scanned after 5 min)
let installedAppsCache = null;
let installedAppsCacheTime = 0;
const APPS_CACHE_TTL = 5 * 60 * 1000;

async function preloadInstalledApps() {
  const now = Date.now();
  if (!installedAppsCache || now - installedAppsCacheTime > APPS_CACHE_TTL) {
    installedAppsCache = await window.api.getInstalledApps();
    installedAppsCacheTime = Date.now();
    renderBanner(selectedCategory);
  }
}

function setupModesTab() {
  document.querySelectorAll('.modes-category').forEach((el) => {
    el.addEventListener('click', () => {
      closeLlmPanel();
      selectCategory(el.dataset.category);
    });
  });

  // Wire toggle switches — stop propagation so click doesn't also select the category
  for (const categoryId of Object.keys(MODES_CATEGORIES)) {
    const toggle = document.getElementById(`toggle-${categoryId}`);
    if (!toggle) continue;
    toggle.addEventListener('click', (e) => e.stopPropagation());
    toggle.querySelector('input').addEventListener('change', (e) => {
      if (!hasLlmApiKey()) { e.target.checked = false; return; }
      saveCategoryEnabled(categoryId, e.target.checked);
      // Update dim state immediately
      const row = document.querySelector(`.modes-category[data-category="${categoryId}"]`);
      if (row) row.classList.toggle('disabled', !e.target.checked);
      // If this category is currently selected, refresh the disabled notice
      if (selectedCategory === categoryId) {
        updateDisabledNotice(categoryId);
      }
    });
  }

  // Render initial state
  selectCategory('personal-message');

  // Pre-load installed apps so banner icons show real icons immediately
  preloadInstalledApps();
}

function selectCategory(categoryId) {
  selectedCategory = categoryId;

  // Update active state in Column 2
  document.querySelectorAll('.modes-category').forEach((el) => {
    el.classList.toggle('active', el.dataset.category === categoryId);
  });

  updateDisabledNotice(categoryId);
  renderBanner(categoryId);
  renderStyleCards(categoryId);
}

function updateDisabledNotice(categoryId) {
  const notice = document.getElementById('modes-disabled-notice');
  if (!notice) return;
  const enabled = getCategoryEnabled(categoryId);
  notice.classList.toggle('hidden', enabled);
}

function getCategoryConfig(categoryId) {
  const cats = (config && config.modes && config.modes.categories) || {};
  return cats[categoryId] || DEFAULT_CATEGORIES[categoryId] || { linkedApps: [], linkedUrls: [] };
}

function getCategoryEnabled(categoryId) {
  // Modes require an LLM API key — treat as disabled when none is set
  if (!hasLlmApiKey()) return false;
  const enabled = (config && config.modes && config.modes.enabled) || {};
  // Default to true if not explicitly set
  return enabled[categoryId] !== false;
}

function saveCategoryEnabled(categoryId, isEnabled) {
  if (!config) return;
  if (!config.modes) config.modes = { selections: {}, categories: {}, enabled: {} };
  if (!config.modes.enabled) config.modes.enabled = {};
  config.modes.enabled[categoryId] = isEnabled;
  saveConfig();
}

function getAppIcon(appName) {
  const key = appName.toLowerCase();
  if (KNOWN_APP_ICONS[key]) return KNOWN_APP_ICONS[key];
  // Fallback: first letter with a neutral color
  return { label: appName.charAt(0).toUpperCase(), bg: '#6B7280' };
}

function getBannerIconHtml(name) {
  if (installedAppsCache) {
    const cached = installedAppsCache.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (cached && cached.icon) {
      return `<div class="modes-banner-icon modes-banner-icon-app"><img src="${cached.icon}" alt="${name}"></div>`;
    }
  }
  const icon = getAppIcon(name);
  return `<div class="modes-banner-icon" style="background: ${icon.bg};">${icon.label}</div>`;
}

function renderBanner(categoryId) {
  const banner = document.getElementById('modes-banner');
  const catCfg = getCategoryConfig(categoryId);
  const apps = catCfg.linkedApps || [];
  const urls = catCfg.linkedUrls || [];

  // Show up to 5 app icons, then overflow
  const MAX_VISIBLE = 5;
  const allItems = [...apps];
  // Add URL-based items (show domain as icon)
  for (const url of urls) {
    const domain = url.replace(/^https?:\/\//, '').split('/')[0];
    allItems.push(domain);
  }

  const visible = allItems.slice(0, MAX_VISIBLE);
  const overflow = allItems.length - MAX_VISIBLE;

  const iconElements = visible.map((name) => getBannerIconHtml(name)).join('');

  const overflowEl = overflow > 0
    ? `<div class="modes-banner-icon overflow">+${overflow}</div>`
    : '';

  banner.innerHTML = `
    <div class="modes-banner-text">
      <div class="modes-banner-title">This profile applies to:</div>
    </div>
    <div class="modes-banner-icons">
      ${iconElements}
      ${overflowEl}
      <div class="modes-banner-icon plus" id="banner-add-btn">+</div>
    </div>
  `;

  document.getElementById('banner-add-btn').addEventListener('click', () => {
    openLinkedAppsPopup(categoryId);
  });
}

// ---------------------------------------------------------------------------
// Linked Apps/URLs Popup (installed-apps grid + URL section)
// ---------------------------------------------------------------------------

function openLinkedAppsPopup(categoryId) {
  closeLinkedAppsPopup();

  const catCfg = getCategoryConfig(categoryId);
  let apps = [...(catCfg.linkedApps || [])];
  let urls = [...(catCfg.linkedUrls || [])];

  const overlay = document.createElement('div');
  overlay.className = 'popup-overlay';
  overlay.id = 'linked-apps-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeLinkedAppsPopup();
  });

  const popup = document.createElement('div');
  popup.className = 'popup-panel';
  popup.innerHTML = buildShell();
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Wire static controls
  popup.querySelector('#popup-close-btn').addEventListener('click', closeLinkedAppsPopup);
  popup.querySelector('#popup-done-btn').addEventListener('click', closeLinkedAppsPopup);
  popup.querySelector('#popup-search').addEventListener('input', onSearch);
  wireLinkedAppsRemove();
  wireUrlSection();

  // Escape to close
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeLinkedAppsPopup();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Async: load and render installed apps grid
  loadAndRenderApps();

  // ── Builders ─────────────────────────────────────────────────────────────

  function buildShell() {
    return `
      <div class="popup-header">
        <div class="popup-title">Add Apps &amp; URLs</div>
        <button class="popup-close" id="popup-close-btn">&times;</button>
      </div>
      ${buildLinkedAppsSection()}
      <div class="popup-search-row">
        <input type="text" class="popup-search-input" id="popup-search"
               placeholder="Search apps…" autocomplete="off">
      </div>
      <div class="app-grid-scroll" id="app-grid-scroll">
        <div class="apps-loading">
          <div class="apps-spinner"></div>
          <span>Loading apps…</span>
        </div>
      </div>
      ${buildUrlSection()}
      <div class="popup-footer">
        <button class="popup-done-btn" id="popup-done-btn">Done</button>
      </div>
    `;
  }

  function buildLinkedAppsSection() {
    const chips = apps.length === 0
      ? `<span class="linked-apps-empty">No apps linked — select apps below to add</span>`
      : apps.map((name, i) => `
          <div class="linked-app-chip" data-index="${i}" title="${name}">
            ${getLinkedAppIconHtml(name)}
            <button class="linked-app-chip-remove" data-index="${i}">&times;</button>
          </div>
        `).join('');

    return `
      <div class="linked-apps-section" id="linked-apps-section">
        <div class="popup-section-title">Linked Apps</div>
        <div class="linked-apps-strip">${chips}</div>
      </div>
    `;
  }

  function getLinkedAppIconHtml(name) {
    if (installedAppsCache) {
      const cached = installedAppsCache.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (cached && cached.icon) {
        return `<img class="linked-app-icon-img" src="${cached.icon}" alt="">`;
      }
    }
    const ic = getAppIcon(name);
    return `<div class="linked-app-icon-letter" style="background:${ic.bg};">${ic.label}</div>`;
  }

  function refreshLinkedAppsSection() {
    const existing = popup.querySelector('#linked-apps-section');
    if (!existing) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = buildLinkedAppsSection();
    existing.replaceWith(tmp.firstElementChild);
    wireLinkedAppsRemove();
  }

  function wireLinkedAppsRemove() {
    popup.querySelectorAll('.linked-app-chip-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        const name = apps[idx];
        apps.splice(idx, 1);
        saveCategoryConfig(categoryId, apps, urls);
        renderBanner(categoryId);
        refreshLinkedAppsSection();
        // Uncheck the app in the grid if visible
        const gridItem = popup.querySelector(`.app-grid-item[data-name="${CSS.escape(name)}"]`);
        if (gridItem) {
          gridItem.classList.remove('linked');
          gridItem.querySelector('.app-grid-check')?.remove();
        }
      });
    });
  }

  function buildUrlSection() {
    const tags = urls.map((url, i) => `
      <div class="url-tag">
        <span class="url-tag-text">${url}</span>
        <button class="url-tag-remove" data-index="${i}" title="Remove">&times;</button>
      </div>
    `).join('');

    return `
      <div class="popup-section" id="popup-url-section">
        <div class="popup-section-title">Website URLs</div>
        <div class="popup-hint">Mode activates when you visit this site in your browser.</div>
        <div class="popup-url-tags" id="popup-url-tags">${tags}</div>
        <div class="popup-add-row">
          <input type="text" class="popup-input" id="popup-url-input"
                 placeholder="e.g. mail.google.com">
          <button class="popup-add-btn" id="popup-add-url">Add website</button>
        </div>
      </div>
    `;
  }

  function wireUrlSection() {
    popup.querySelectorAll('.url-tag-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        urls.splice(parseInt(btn.dataset.index, 10), 1);
        saveCategoryConfig(categoryId, apps, urls);
        renderBanner(categoryId);
        refreshUrlTags();
      });
    });

    const addUrlBtn = popup.querySelector('#popup-add-url');
    const urlInput = popup.querySelector('#popup-url-input');
    if (!addUrlBtn || !urlInput) return;

    const doAdd = () => {
      const val = urlInput.value.trim().replace(/^https?:\/\//, '');
      if (val && val.includes('.') && !val.includes(' ') && !urls.includes(val)) {
        urls.push(val);
        saveCategoryConfig(categoryId, apps, urls);
        renderBanner(categoryId);
        refreshUrlTags();
        urlInput.value = '';
      }
    };
    addUrlBtn.addEventListener('click', doAdd);
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  }

  function refreshUrlTags() {
    const container = popup.querySelector('#popup-url-tags');
    if (!container) return;
    container.innerHTML = urls.map((url, i) => `
      <div class="url-tag">
        <span class="url-tag-text">${url}</span>
        <button class="url-tag-remove" data-index="${i}" title="Remove">&times;</button>
      </div>
    `).join('');
    popup.querySelectorAll('.url-tag-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        urls.splice(parseInt(btn.dataset.index, 10), 1);
        saveCategoryConfig(categoryId, apps, urls);
        renderBanner(categoryId);
        refreshUrlTags();
      });
    });
  }

  // ── App grid ─────────────────────────────────────────────────────────────

  function buildGridHtml(allApps, filter) {
    const list = filter
      ? allApps.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()))
      : allApps;

    if (list.length === 0) {
      return `<div class="apps-empty">${filter ? 'No apps found' : 'No installed apps found'}</div>`;
    }

    const items = list.map((appItem) => {
      const linked = apps.some((a) => a.toLowerCase() === appItem.name.toLowerCase());
      const iconHtml = appItem.icon
        ? `<img class="app-grid-icon-img" src="${appItem.icon}" alt="">`
        : `<div class="app-grid-icon-placeholder">${appItem.name.charAt(0).toUpperCase()}</div>`;
      const checkHtml = linked ? '<div class="app-grid-check">✓</div>' : '';
      return `
        <div class="app-grid-item${linked ? ' linked' : ''}" data-name="${appItem.name}">
          <div class="app-grid-icon">${iconHtml}${checkHtml}</div>
          <div class="app-grid-name">${appItem.name}</div>
        </div>
      `;
    }).join('');

    return `<div class="app-grid">${items}</div>`;
  }

  function wireGridClicks() {
    popup.querySelectorAll('.app-grid-item').forEach((item) => {
      item.addEventListener('click', () => {
        const name = item.dataset.name;
        const idx = apps.findIndex((a) => a.toLowerCase() === name.toLowerCase());
        if (idx >= 0) {
          apps.splice(idx, 1);
          item.classList.remove('linked');
          const check = item.querySelector('.app-grid-check');
          if (check) check.remove();
        } else {
          apps.push(name);
          item.classList.add('linked');
          const iconDiv = item.querySelector('.app-grid-icon');
          if (iconDiv && !iconDiv.querySelector('.app-grid-check')) {
            const checkDiv = document.createElement('div');
            checkDiv.className = 'app-grid-check';
            checkDiv.textContent = '✓';
            iconDiv.appendChild(checkDiv);
          }
        }
        saveCategoryConfig(categoryId, apps, urls);
        renderBanner(categoryId);
        refreshLinkedAppsSection();
      });
    });
  }

  function onSearch(e) {
    if (!installedAppsCache) return;
    const scroll = popup.querySelector('#app-grid-scroll');
    if (scroll) {
      scroll.innerHTML = buildGridHtml(installedAppsCache, e.target.value);
      wireGridClicks();
    }
  }

  async function loadAndRenderApps() {
    const now = Date.now();
    if (!installedAppsCache || now - installedAppsCacheTime > APPS_CACHE_TTL) {
      installedAppsCache = await window.api.getInstalledApps();
      installedAppsCacheTime = Date.now();
    }
    const scroll = popup.querySelector('#app-grid-scroll');
    if (!scroll) return; // popup was closed during load
    const filter = popup.querySelector('#popup-search')?.value || '';
    scroll.innerHTML = buildGridHtml(installedAppsCache, filter);
    wireGridClicks();
    // Upgrade any letter-circle icons to real icons now that the cache is ready
    refreshLinkedAppsSection();
  }
}

function closeLinkedAppsPopup() {
  const overlay = document.getElementById('linked-apps-overlay');
  if (overlay) {
    overlay.remove();
    // Re-render banner to reflect changes
    renderBanner(selectedCategory);
  }
}

function saveCategoryConfig(categoryId, apps, urls) {
  if (!config) return;
  if (!config.modes) config.modes = { selections: {}, categories: {} };
  if (!config.modes.categories) config.modes.categories = {};
  config.modes.categories[categoryId] = { linkedApps: [...apps], linkedUrls: [...urls] };
  saveConfig();
}

function renderStyleCards(categoryId) {
  const container = document.getElementById('modes-cards');
  const selections = (config && config.modes && config.modes.selections) || {};
  const currentStyle = selections[categoryId] || 'formal';

  container.innerHTML = '';

  for (const [styleId, style] of Object.entries(MODES_STYLES)) {
    const preview = MODES_PREVIEWS[categoryId][styleId];
    const isSelected = styleId === currentStyle;

    const card = document.createElement('div');
    card.className = `mode-card${isSelected ? ' selected' : ''}`;
    card.dataset.style = styleId;

    const bodyHTML = categoryId === 'personal-message'
      ? `<div class="mode-card-message-bubble">
          <div class="mode-card-message-text">${preview.replace(/\n/g, '<br>')}</div>
          <div class="mode-card-message-time">just now</div>
        </div>`
      : `<div class="mode-card-to">To: Oscar</div>
         <div class="mode-card-preview">${preview}</div>`;

    card.innerHTML = `
      <div class="mode-card-header">
        <div class="mode-card-name">${style.name}</div>
        <div class="mode-card-subtitle">${style.subtitle}</div>
      </div>
      <div class="mode-card-divider"></div>
      ${bodyHTML}
    `;

    card.addEventListener('click', () => {
      selectStyle(categoryId, styleId);
    });

    container.appendChild(card);
  }
}

function selectStyle(categoryId, styleId) {
  if (!config) return;

  // Ensure modes structure exists
  if (!config.modes) config.modes = { selections: {} };
  if (!config.modes.selections) config.modes.selections = {};

  config.modes.selections[categoryId] = styleId;

  // Update card selection visuals
  document.querySelectorAll('.mode-card').forEach((card) => {
    card.classList.toggle('selected', card.dataset.style === styleId);
  });

  // Update Column 2 subtitle
  updateCategorySubtitles();

  saveConfig();
}

function updateCategorySubtitles() {
  const selections = (config && config.modes && config.modes.selections) || {};
  for (const [catId, catData] of Object.entries(MODES_CATEGORIES)) {
    const styleId = selections[catId] || 'formal';
    const styleName = MODES_STYLES[styleId] ? MODES_STYLES[styleId].name.replace(/[.!]$/, '') : 'Formal';
    const el = document.getElementById(`cat-style-${catId}`);
    if (el) el.textContent = styleName;
  }
}

function applyModesConfig() {
  updateCategorySubtitles();

  // Sync toggle checkboxes and dim state for each category
  for (const categoryId of Object.keys(MODES_CATEGORIES)) {
    const enabled = getCategoryEnabled(categoryId);
    const toggle = document.getElementById(`toggle-${categoryId}`);
    if (toggle) toggle.querySelector('input').checked = enabled;
    const row = document.querySelector(`.modes-category[data-category="${categoryId}"]`);
    if (row) row.classList.toggle('disabled', !enabled);
  }

  updateModesLlmGate();

  // Re-render cards if modes tab is currently showing the selected category
  if (document.getElementById('tab-modes').classList.contains('active')) {
    updateDisabledNotice(selectedCategory);
    renderStyleCards(selectedCategory);
  }
}

// ---------------------------------------------------------------------------
// Save Config
// ---------------------------------------------------------------------------

let saveDebounce = null;
let saveInFlight = false;

function saveConfig() {
  saveInFlight = true;
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(async () => {
    if (!config) return;
    try {
      await window.api.saveConfig({ ...config });
    } finally {
      saveInFlight = false;
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// History Tab
// ---------------------------------------------------------------------------

function setupHistoryTab() {
  // Load history when the tab becomes active
  document.querySelectorAll('.sidebar-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (item.dataset.tab === 'history') {
        loadHistory();
      }
    });
  });

  // Clear all button
  document.getElementById('btn-clear-history').addEventListener('click', async () => {
    await window.api.clearHistory();
    renderHistory([]);
  });
}

async function loadHistory() {
  const entries = await window.api.getHistory();
  renderHistory(entries || []);
}

function renderHistory(entries) {
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const clearBtn = document.getElementById('btn-clear-history');

  // Remove all entries but keep the empty placeholder
  list.querySelectorAll('.history-entry').forEach((el) => el.remove());

  if (!entries.length) {
    empty.style.display = '';
    clearBtn.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  clearBtn.style.display = '';

  for (const entry of entries) {
    const el = document.createElement('div');
    el.className = 'history-entry';
    el.innerHTML = `
      <div class="history-entry-text">${escapeHtml(entry.text)}</div>
      <div class="history-entry-meta">
        <span class="history-entry-time">${formatTimestamp(entry.timestamp)}</span>
        <div class="history-entry-actions">
          <button class="history-action-btn copy" title="Copy to clipboard">Copy</button>
          <button class="history-action-btn delete" title="Delete">Delete</button>
        </div>
      </div>
    `;

    el.querySelector('.copy').addEventListener('click', () => {
      navigator.clipboard.writeText(entry.text);
    });

    el.querySelector('.delete').addEventListener('click', async () => {
      await window.api.deleteHistoryEntry(entry.id);
      el.remove();
      // Check if list is now empty
      if (!list.querySelector('.history-entry')) {
        empty.style.display = '';
        clearBtn.style.display = 'none';
      }
    });

    list.appendChild(el);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTimestamp(iso) {
  const date = new Date(iso);
  const now = new Date();
  const diff = now - date;

  // Today: show time only
  if (diff < 86400000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth()) {
    return 'Yesterday, ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  // Older
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
