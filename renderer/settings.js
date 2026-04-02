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
  systemSounds = await window.api.getSystemSounds();

  populateSoundSelects();
  populateLanguageSelect();
  setupSidebarNav();
  setupShortcutCapture();
  setupOptionToggles();
  setupSoundControls();
  setupProviderSwitch();
  setupApiKeyInput();

  // Load config
  config = await window.api.getConfig();
  if (config) applyConfig(config);

  // Check NeMo if provider is nemo
  if (config && config.api_provider === 'nemo') {
    await checkNemoStatus();
  }

  // Listen for config updates from main process polling
  window.api.onConfigUpdated((updated) => {
    config = updated;
    applyConfig(config);
  });

  // Listen for NeMo install progress
  window.api.onNemoInstallProgress((line) => {
    const el = document.getElementById('nemo-status-line');
    if (el) el.textContent = line;
  });
});

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

function applyConfig(cfg) {
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
  document.getElementById('sel-soundStart').value = cfg.sound_start;
  document.getElementById('sel-soundStop').value = cfg.sound_stop;
  updateSoundRowsDisabled(cfg.sound_muted || false);

  // Provider
  document.getElementById('sel-provider').value = cfg.api_provider;
  updateProviderSections(cfg.api_provider);

  // OpenAI
  document.getElementById('inp-apiKey').value = cfg.api_key || '';
  document.getElementById('sel-openaiModel').value = cfg.openai_model || 'whisper-1';
  document.getElementById('sel-openaiLang').value = cfg.openai_language || 'auto';
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

  for (const sound of systemSounds) {
    startSel.add(new Option(sound, sound));
    stopSel.add(new Option(sound, sound));
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
  document.getElementById('sel-openaiModel').addEventListener('change', (e) => {
    if (!config) return;
    config.openai_model = e.target.value;
    saveConfig();
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
// Save Config
// ---------------------------------------------------------------------------

let saveDebounce = null;

function saveConfig() {
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(async () => {
    if (!config) return;

    // Don't save nemo as provider if not installed
    const toSave = { ...config };
    if (toSave.api_provider === 'nemo' && nemoInstalled !== true) {
      toSave.api_provider = 'openai';
    }

    await window.api.saveConfig(toSave);
  }, 300);
}
