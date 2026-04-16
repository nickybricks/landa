// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config = null;
let platform = 'darwin';
let systemSounds = [];
let recordingAction = null; // which shortcut is being recorded
let _setupDone = false; // true once UI is populated & first applyConfig has run

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

const WHISPER_MODELS = [
  { value: 'whisper-large-v3-turbo', label: 'Whisper Large V3 Turbo', logo: 'openai' },
  { value: 'whisper-large-v3', label: 'Whisper Large V3', logo: 'openai' },
  { value: 'whisper-medium', label: 'Whisper Medium', logo: 'openai' },
  { value: 'whisper-small', label: 'Whisper Small', logo: 'openai' },
  { value: 'whisper-base', label: 'Whisper Base', logo: 'openai' },
  { value: 'whisper-1', label: 'whisper-1 (API)', logo: 'openai' },
  { value: 'nemo', label: 'NeMo Parakeet', logo: 'nvidia' },
];

// ---------------------------------------------------------------------------
// i18n — UI Language
// ---------------------------------------------------------------------------

const TRANSLATIONS = {
  en: {
    // Sidebar
    'nav.home': 'Home',
    'nav.profiles': 'Profiles',
    'nav.settings': 'Settings',
    'nav.history': 'History',
    // Home
    'home.desc': 'Lightweight voice-to-text for macOS & Windows.<br>Press your hotkey to record, release to transcribe and paste.',
    // Settings tab — language section
    'settings.language.section': 'Language',
    'settings.language.label': 'App Language',
    // Settings tab — model section
    'settings.model.section': 'Model',
    'settings.model.apikey': 'API Key',
    'settings.model.model': 'Model',
    'settings.model.language': 'Language',
    // Settings tab — shortcuts
    'settings.shortcuts.section': 'Keyboard Shortcuts',
    'settings.shortcuts.toggle': 'Toggle Recording',
    'settings.shortcuts.toggle.sub': 'Starts and stops recordings',
    'settings.shortcuts.cancel': 'Cancel Recording',
    'settings.shortcuts.cancel.sub': 'Discards active recording',
    'settings.shortcuts.record': 'Record shortcut',
    'settings.shortcuts.recording': 'Press shortcut…',
    // Settings tab — application
    'settings.app.section': 'Application',
    'settings.app.autopaste': 'Auto-paste into active app',
    'settings.app.autocapitalize': 'Auto-capitalize',
    'settings.app.autopunctuate': 'Auto-punctuate',
    // Settings tab — sounds
    'settings.sounds.section': 'Recording Sounds',
    'settings.sounds.mute': 'Mute all sounds',
    'settings.sounds.start': 'Start sound',
    'settings.sounds.stop': 'Stop sound',
    'settings.sounds.cancel': 'Cancel sound',
    // Modes tab
    'modes.llm.btn': 'LLM Settings',
    'modes.llm.title': 'LLM Settings',
    'modes.llm.subtitle.cloud': 'Modes use a language model to reformat your transcribed speech. Choose a provider and enter your API key.',
    'modes.llm.subtitle.local': 'Modes use a local on-device model to reformat your transcribed speech. No API key required — your data never leaves this computer.',
    'modes.llm.provider': 'Provider',
    'modes.llm.apikey': 'API Key',
    'modes.llm.apikey.placeholder': 'Enter API key…',
    'modes.llm.model': 'Model',
    'modes.llm.local.option': 'Local (on-device)',
    'modes.llm.autofill': 'API key auto-filled from Settings.',
    'modes.nollm.title': 'LLM not configured',
    'modes.nollm.text': 'Set up an API key in LLM Settings to use modes.',
    'modes.nollm.btn': 'Open LLM Settings',
    'modes.nollm.local': 'Download Gemma 3 4B in LLM Settings to use modes.',
    'modes.disabled': 'This mode is currently disabled. Enable it to activate auto-detection and reformatting.',
    'modes.banner.title': 'This profile applies to:',
    'modes.banner.empty': 'Click + to link apps or URLs to this profile',
    'modes.category.personal': 'Personal Message',
    'modes.category.email': 'Email',
    // Modes styles
    'modes.style.formal': 'Formal.',
    'modes.style.formal.sub': 'Caps + Punctuation',
    'modes.style.casual': 'Casual',
    'modes.style.casual.sub': 'Caps + Less punctuation',
    'modes.style.excited': 'Excited!',
    'modes.style.excited.sub': 'More exclamations',
    // Modes card toggles
    'modes.toggle.include_greeting': 'Include greeting',
    'modes.toggle.include_sign_off': 'Include sign-off',
    'modes.toggle.use_emoji': 'Use emoji',
    // Modes card UI
    'modes.card.just_now': 'just now',
    'modes.card.to': 'To: Oscar',
    // Local Whisper model status
    'local.no_backend': 'Could not reach backend.',
    'local.whisper.tagline': 'Open source · runs entirely on your device · your voice never leaves this computer.',
    'local.whisper.tagline.size': 'Open source · runs entirely on your device · your voice never leaves this computer. (~1.5 GB)',
    'local.install': 'Install',
    'local.installing': 'Installing…',
    'local.downloading.note': 'Downloading model…',
    'local.downloading.badge': '⏳ Downloading',
    'local.download': 'Download',
    'local.retry': 'Retry',
    'local.ready': '✓ Ready',
    'local.download_failed': 'Download failed: ',
    'local.install_failed': 'Install failed. Check logs and try again.',
    // Local LLM model status
    'local.llm.tagline': 'Runs entirely on your device — your data never leaves this computer.',
    'local.llm.tagline.size': 'Gemma 3 4B · runs entirely on your device · ~2.5 GB download.',
    'local.llm.tagline.ready': 'Gemma 3 4B · runs entirely on your device · your data never leaves this computer.',
    'local.llm.install_engine': 'Install engine',
    'local.llm.downloading': 'Downloading…',
    'local.llm.engine_error': 'Engine installed but failed to load. See error below.',
    'local.llm.install_failed': 'Install failed — see error below.',
    // History tab
    'history.title': 'History',
    'history.clear': 'Clear All',
    'history.empty.title': 'No transcriptions yet',
    'history.empty.sub': 'Your transcription history will appear here.',
    'history.yesterday': 'Yesterday',
    'history.copy': 'Copy',
    'history.delete': 'Delete',
    // Home stats
    'home.stats.empty': 'Record your first transcription to see your stats here.',
    'home.stats.transcriptions': 'Transcriptions',
    'home.stats.words': 'Words',
    'home.stats.saved': 'Time Saved',
    'home.stats.streak': 'Day Streak',
    'home.stats.longest': 'Longest',
    'home.stats.bestday': 'Best Day',
    // Linked apps popup
    'popup.title': 'Add Apps & URLs',
    'popup.linked_apps': 'Linked Apps',
    'popup.no_apps': 'No apps linked — select apps below to add',
    'popup.search': 'Search apps…',
    'popup.loading': 'Loading apps…',
    'popup.urls': 'Website URLs',
    'popup.urls.hint': 'Mode activates when you visit this site in your browser.',
    'popup.url.placeholder': 'e.g. mail.google.com',
    'popup.url.add': 'Add website',
    'popup.done': 'Done',
    'popup.no_apps_found': 'No apps found',
    'popup.no_installed': 'No installed apps found',
    // Modes card preview text
    'modes.preview.personal-message.formal': 'Hey, are you free for lunch tomorrow?\nLet\'s do 12 if that works for you.',
    'modes.preview.personal-message.casual': 'Hey are you free for lunch tomorrow?\nLet\'s do 12 if that works for you',
    'modes.preview.personal-message.excited': 'Hey, are you free for lunch tomorrow?\nLet\'s do 12 if that works for you!',
    'modes.preview.email.formal': 'Hi Oscar,\n\nI wanted to follow up regarding our conversation earlier today. It was a pleasure discussing the project details with you.\n\nPlease don\'t hesitate to reach out if you have any further questions.\n\nBest regards,\nLotti',
    'modes.preview.email.casual': 'Hi Oscar, great talking with you today. Looking forward to catching up again soon\n\nBest,\nLotti',
    'modes.preview.email.excited': 'Hi Oscar,\n\nIt was great talking with you today! Really looking forward to our next chat!\n\nBest,\nLotti',
  },
  de: {
    // Sidebar
    'nav.home': 'Startseite',
    'nav.profiles': 'Profile',
    'nav.settings': 'Einstellungen',
    'nav.history': 'Verlauf',
    // Home
    'home.desc': 'Schlanke Sprach-zu-Text-App für macOS & Windows.<br>Drücke deinen Hotkey zum Aufnehmen, loslassen zum Transkribieren und Einfügen.',
    // Settings tab — language section
    'settings.language.section': 'Sprache',
    'settings.language.label': 'App-Sprache',
    // Settings tab — model section
    'settings.model.section': 'Modell',
    'settings.model.apikey': 'API-Schlüssel',
    'settings.model.model': 'Modell',
    'settings.model.language': 'Sprache',
    // Settings tab — shortcuts
    'settings.shortcuts.section': 'Tastaturkürzel',
    'settings.shortcuts.toggle': 'Aufnahme umschalten',
    'settings.shortcuts.toggle.sub': 'Startet und stoppt Aufnahmen',
    'settings.shortcuts.cancel': 'Aufnahme abbrechen',
    'settings.shortcuts.cancel.sub': 'Bricht aktive Aufnahme ab',
    'settings.shortcuts.record': 'Kürzel aufzeichnen',
    'settings.shortcuts.recording': 'Kürzel drücken…',
    // Settings tab — application
    'settings.app.section': 'Anwendung',
    'settings.app.autopaste': 'Automatisch in aktive App einfügen',
    'settings.app.autocapitalize': 'Automatisch großschreiben',
    'settings.app.autopunctuate': 'Automatisch interpunktieren',
    // Settings tab — sounds
    'settings.sounds.section': 'Aufnahmetöne',
    'settings.sounds.mute': 'Alle Töne stummschalten',
    'settings.sounds.start': 'Starton',
    'settings.sounds.stop': 'Stopton',
    'settings.sounds.cancel': 'Abbrechen-Ton',
    // Modes tab
    'modes.llm.btn': 'KI-Einstellungen',
    'modes.llm.title': 'KI-Einstellungen',
    'modes.llm.subtitle.cloud': 'Profile nutzen ein Sprachmodell, um deine Sprache umzuformatieren. Wähle einen Anbieter und gib deinen API-Schlüssel ein.',
    'modes.llm.subtitle.local': 'Profile nutzen ein lokales Modell auf deinem Gerät. Kein API-Schlüssel erforderlich — deine Daten verlassen diesen Computer nicht.',
    'modes.llm.provider': 'Anbieter',
    'modes.llm.apikey': 'API-Schlüssel',
    'modes.llm.apikey.placeholder': 'API-Schlüssel eingeben…',
    'modes.llm.model': 'Modell',
    'modes.llm.local.option': 'Lokal (auf Gerät)',
    'modes.llm.autofill': 'API-Schlüssel aus Einstellungen übernommen.',
    'modes.nollm.title': 'KI nicht konfiguriert',
    'modes.nollm.text': 'Richte einen API-Schlüssel in den KI-Einstellungen ein, um Profile zu nutzen.',
    'modes.nollm.btn': 'KI-Einstellungen öffnen',
    'modes.nollm.local': 'Gemma 3 4B in den KI-Einstellungen herunterladen, um Profile zu nutzen.',
    'modes.disabled': 'Dieser Modus ist derzeit deaktiviert. Aktiviere ihn, um automatische Erkennung und Umformatierung zu nutzen.',
    'modes.banner.title': 'Dieses Profil gilt für:',
    'modes.banner.empty': 'Klicke auf +, um Apps oder URLs zu verknüpfen',
    'modes.category.personal': 'Persönliche Nachricht',
    'modes.category.email': 'E-Mail',
    // Modes styles
    'modes.style.formal': 'Formell.',
    'modes.style.formal.sub': 'Großschreibung + Satzzeichen',
    'modes.style.casual': 'Locker',
    'modes.style.casual.sub': 'Großschreibung + weniger Satzzeichen',
    'modes.style.excited': 'Begeistert!',
    'modes.style.excited.sub': 'Mehr Ausrufezeichen',
    // Modes card toggles
    'modes.toggle.include_greeting': 'Begrüßung einschließen',
    'modes.toggle.include_sign_off': 'Abschlussformel einschließen',
    'modes.toggle.use_emoji': 'Emoji verwenden',
    // Modes card UI
    'modes.card.just_now': 'gerade eben',
    'modes.card.to': 'An: Oscar',
    // Local Whisper model status
    'local.no_backend': 'Backend nicht erreichbar.',
    'local.whisper.tagline': 'Open Source · läuft vollständig auf deinem Gerät · deine Stimme verlässt diesen Computer nicht.',
    'local.whisper.tagline.size': 'Open Source · läuft vollständig auf deinem Gerät · deine Stimme verlässt diesen Computer nicht. (~1,5 GB)',
    'local.install': 'Installieren',
    'local.installing': 'Installiert…',
    'local.downloading.note': 'Modell wird heruntergeladen…',
    'local.downloading.badge': '⏳ Wird geladen',
    'local.download': 'Herunterladen',
    'local.retry': 'Erneut versuchen',
    'local.ready': '✓ Bereit',
    'local.download_failed': 'Download fehlgeschlagen: ',
    'local.install_failed': 'Installation fehlgeschlagen. Logs prüfen und erneut versuchen.',
    // Local LLM model status
    'local.llm.tagline': 'Läuft vollständig auf deinem Gerät — deine Daten verlassen diesen Computer nicht.',
    'local.llm.tagline.size': 'Gemma 3 4B · läuft vollständig auf deinem Gerät · ~2,5 GB Download.',
    'local.llm.tagline.ready': 'Gemma 3 4B · läuft vollständig auf deinem Gerät · deine Daten verlassen diesen Computer nicht.',
    'local.llm.install_engine': 'Engine installieren',
    'local.llm.downloading': 'Wird heruntergeladen…',
    'local.llm.engine_error': 'Engine installiert, aber Laden fehlgeschlagen. Fehler unten ansehen.',
    'local.llm.install_failed': 'Installation fehlgeschlagen — Fehler unten ansehen.',
    // History tab
    'history.title': 'Verlauf',
    'history.clear': 'Alles löschen',
    'history.empty.title': 'Noch keine Transkriptionen',
    'history.empty.sub': 'Dein Transkriptionsverlauf erscheint hier.',
    'history.yesterday': 'Gestern',
    'history.copy': 'Kopieren',
    'history.delete': 'Löschen',
    // Home stats
    'home.stats.empty': 'Nimm deine erste Transkription auf, um deine Statistiken zu sehen.',
    'home.stats.transcriptions': 'Transkriptionen',
    'home.stats.words': 'Wörter',
    'home.stats.saved': 'Zeit gespart',
    'home.stats.streak': 'Tage-Streak',
    'home.stats.longest': 'Längste',
    'home.stats.bestday': 'Bester Tag',
    // Linked apps popup
    'popup.title': 'Apps & URLs hinzufügen',
    'popup.linked_apps': 'Verknüpfte Apps',
    'popup.no_apps': 'Keine Apps verknüpft — Apps unten auswählen',
    'popup.search': 'Apps suchen…',
    'popup.loading': 'Apps werden geladen…',
    'popup.urls': 'Website-URLs',
    'popup.urls.hint': 'Modus aktiviert sich, wenn du diese Seite im Browser besuchst.',
    'popup.url.placeholder': 'z.B. mail.google.com',
    'popup.url.add': 'Website hinzufügen',
    'popup.done': 'Fertig',
    'popup.no_apps_found': 'Keine Apps gefunden',
    'popup.no_installed': 'Keine installierten Apps gefunden',
    // Modes card preview text
    'modes.preview.personal-message.formal': 'Hey, hast du morgen Zeit zum Mittagessen?\nUm 12 Uhr würde mir passen, wenn es dir passt.',
    'modes.preview.personal-message.casual': 'Hey hast du morgen Zeit zum Mittagessen?\nUm 12 würde passen wenn es dir passt',
    'modes.preview.personal-message.excited': 'Hey, hast du morgen Zeit zum Mittagessen?\nUm 12 Uhr würde mir passen, wenn es dir passt!',
    'modes.preview.email.formal': 'Hallo Oscar,\n\nich wollte mich bezüglich unseres heutigen Gesprächs nochmals melden. Es war mir eine Freude, die Projektdetails mit dir zu besprechen.\n\nBei weiteren Fragen stehe ich gerne zur Verfügung.\n\nMit freundlichen Grüßen,\nLotti',
    'modes.preview.email.casual': 'Hi Oscar, tolles Gespräch heute. Freue mich schon auf unser nächstes Treffen\n\nBeste Grüße,\nLotti',
    'modes.preview.email.excited': 'Hi Oscar,\n\nes war wirklich toll, heute mit dir zu sprechen! Ich freue mich sehr auf unser nächstes Gespräch!\n\nBeste Grüße,\nLotti',
  },
};

function getCurrentLang() {
  return localStorage.getItem('ui-lang') || 'en';
}

function t(key) {
  const lang = getCurrentLang();
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  return dict[key] !== undefined ? dict[key] : (TRANSLATIONS.en[key] || key);
}

function applyTranslations() {
  const lang = getCurrentLang();
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const val = t(el.dataset.i18n);
    if (val !== undefined) el.textContent = val;
  });

  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const val = t(el.dataset.i18nHtml);
    if (val !== undefined) el.innerHTML = val;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const val = t(el.dataset.i18nPlaceholder);
    if (val !== undefined) el.placeholder = val;
  });

  document.querySelectorAll('[data-i18n-option]').forEach((el) => {
    const val = t(el.dataset.i18nOption);
    if (val !== undefined) el.textContent = val;
  });
}

const UI_LANG_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
];

function setupLanguagePicker() {
  initLogoSelect('sel-ui-lang', UI_LANG_OPTIONS);
  setLogoSelect('sel-ui-lang', getCurrentLang());

  document.getElementById('sel-ui-lang').addEventListener('logo-select-change', (e) => {
    localStorage.setItem('ui-lang', e.detail.value);
    applyTranslations();
    // Re-render dynamic content that's currently visible
    if (config) {
      for (const action of Object.keys(DEFAULTS)) {
        renderShortcutBadges(action, config[action] || DEFAULTS[action]);
      }
    }
    const modesTab = document.getElementById('tab-modes');
    if (modesTab && modesTab.classList.contains('active')) {
      renderBanner(selectedCategory);
      renderStyleCards(selectedCategory);
      updateModesLlmGate();
      const llmProvider = config ? (config.llm_provider || 'openai') : 'openai';
      applyLlmProviderVisibility(llmProvider);
    }
    if (document.getElementById('tab-history').classList.contains('active')) {
      loadHistory();
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

// Flush any pending debounced save when the window is about to close
// so that settings changes are never lost on quit.
window.addEventListener('beforeunload', () => {
  if (saveDebounce) {
    clearTimeout(saveDebounce);
    saveDebounce = null;
  }
  // Always flush config on unload (Cmd+R, window close) via synchronous IPC
  // so the save completes before the page tears down.
  if (config) {
    window.api.saveConfigSync({ ...config });
  }
});

// Register config-updated listener early so events from the main process's
// did-finish-load handler are never lost.  If setup isn't done yet we stash
// the latest config and apply it once the UI is ready.
let _pendingConfig = null;
window.api.onConfigUpdated((updated) => {
  if (!_setupDone) {
    _pendingConfig = updated;
    return;
  }
  // Skip if a save is pending/in-flight — the frontend is the source of truth
  // during edits. Applying a stale polled value would reset dropdowns/inputs.
  if (saveInFlight) return;
  config = updated;
  applyConfig(config, { fromPoll: true });
});

document.addEventListener('DOMContentLoaded', async () => {
  platform = await window.api.getPlatform();
  document.body.classList.add('platform-' + platform);
  systemSounds = await window.api.getSystemSounds();

  const version = await window.api.getAppVersion();
  document.getElementById('app-version-label').textContent = `Version ${version}`;

  // Load config first (retry if backend isn't ready yet)
  config = await window.api.getConfig();
  if (!config) {
    for (let i = 0; i < 5 && !config; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      config = await window.api.getConfig();
    }
  }

  // If getConfig() still returned null but we received a config-updated event
  // from the main process while awaiting, use that instead.
  if (!config && _pendingConfig) {
    config = _pendingConfig;
  }

  // Fire installed-apps scan immediately so the cache is warm before the user
  // opens the linked-apps popup (no await — runs in background).
  preloadInstalledApps();

  populateSoundSelects();
  populateLanguageSelect();
  initLogoSelect('sel-openaiModel', WHISPER_MODELS);
  populateLlmModelSelect('openai');
  setupLanguagePicker();
  applyTranslations();
  setupSidebarToggle();
  setupSidebarNav();
  setupShortcutCapture();
  setupOptionToggles();
  setupSoundControls();
  setupApiKeyInput();
  setupLlmSettings();
  setupModesTab();
  setupHistoryTab();
  setupHomeTab();

  if (config) applyConfig(config);

  // Mark setup as done — any future config-updated events apply immediately.
  _setupDone = true;

  // If a config-updated event arrived after getConfig() but before we finished
  // setup, apply it now (it may be newer than what getConfig() returned).
  if (_pendingConfig && _pendingConfig !== config) {
    config = _pendingConfig;
    applyConfig(config, { fromPoll: true });
  }
  _pendingConfig = null;

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
  document.getElementById('sel-soundCancel').value = cfg.sound_cancel || 'Funk';
  updateSoundRowsDisabled(cfg.sound_muted || false);

  // Transcription model
  const apiKeyInput = document.getElementById('inp-apiKey');
  apiKeyInput.value = cfg.api_key || '';
  if (apiKeyInput._showMasked) apiKeyInput._showMasked();
  // If the backend provider is nemo, show nemo in the model dropdown
  const openaiModel = cfg.api_provider === 'nemo' ? 'nemo' : (cfg.openai_model || 'whisper-large-v3');
  setLogoSelect('sel-openaiModel', openaiModel);
  const langSel = document.getElementById('sel-openaiLang');
  langSel.value = cfg.openai_language || 'auto';
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
  if (!container) return;
  container.innerHTML = '';

  if (recordingAction === action) {
    const label = document.createElement('span');
    label.className = 'recording-label';
    label.textContent = t('settings.shortcuts.recording');
    container.appendChild(label);
    return;
  }

  if (!combo.key || combo.key === '') {
    const label = document.createElement('span');
    label.className = 'record-label';
    label.textContent = t('settings.shortcuts.record');
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
  if (!btn) return;
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
  document.getElementById('sound-cancel-row').classList.toggle('disabled', muted);
}

// ---------------------------------------------------------------------------
// Sound Controls
// ---------------------------------------------------------------------------

function populateSoundSelects() {
  const startSel = document.getElementById('sel-soundStart');
  const stopSel = document.getElementById('sel-soundStop');
  const cancelSel = document.getElementById('sel-soundCancel');
  const startVal = (config && config.sound_start) || 'Tink';
  const stopVal = (config && config.sound_stop) || 'Pop';
  const cancelVal = (config && config.sound_cancel) || 'Funk';

  for (const sound of systemSounds) {
    startSel.add(new Option(sound, sound, false, sound === startVal));
    stopSel.add(new Option(sound, sound, false, sound === stopVal));
    cancelSel.add(new Option(sound, sound, false, sound === cancelVal));
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

  document.getElementById('sel-soundCancel').addEventListener('change', (e) => {
    if (!config) return;
    config.sound_cancel = e.target.value;
    window.api.playSound(e.target.value);
    saveConfig();
  });

  document.querySelectorAll('.play-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const which = btn.dataset.sound;
      const selId = which === 'start' ? 'sel-soundStart'
                  : which === 'stop'  ? 'sel-soundStop'
                  : 'sel-soundCancel';
      window.api.playSound(document.getElementById(selId).value);
    });
  });
}


// ---------------------------------------------------------------------------
// API Key Input
// ---------------------------------------------------------------------------

function maskKey(key) {
  if (!key || key.trim() === '') return '';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 3) + '...' + key.slice(-4);
}

function showMaskedKey(inputEl, maskedEl, key) {
  if (!key || key.trim() === '') {
    maskedEl.classList.add('hidden');
    inputEl.classList.remove('hidden');
    return;
  }
  maskedEl.textContent = maskKey(key);
  maskedEl.classList.remove('hidden');
  inputEl.classList.add('hidden');
}

function showKeyInput(inputEl, maskedEl) {
  maskedEl.classList.add('hidden');
  inputEl.classList.remove('hidden');
  inputEl.focus();
  inputEl.select();
}

function setupApiKeyInput() {
  const input = document.getElementById('inp-apiKey');
  const masked = document.getElementById('masked-apiKey');
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

  // On blur: save immediately then show masked display
  input.addEventListener('blur', () => {
    if (!config) return;
    config.api_key = input.value;
    clearTimeout(debounce);
    debounce = null;
    saveConfig();
    showMaskedKey(input, masked, input.value);
  });

  // Click masked span to edit
  masked.addEventListener('click', () => showKeyInput(input, masked));

  // Expose so applyConfig can trigger masked display
  input._showMasked = () => showMaskedKey(input, masked, input.value);

  // Model picker — save immediately (custom logo dropdown)
  document.getElementById('sel-openaiModel').addEventListener('logo-select-change', async (e) => {
    if (!config) return;
    const model = e.detail.value;
    config.openai_model = model;
    // Sync api_provider for the backend
    config.api_provider = model === 'nemo' ? 'nemo' : 'openai';
    saveConfigNow();
    await updateLocalModelStatus(model);
  });

  // Language picker — save immediately so the setting persists even if the
  // window is closed right after the change (no 300ms debounce).
  document.getElementById('sel-openaiLang').addEventListener('change', (e) => {
    if (!config) return;
    config.openai_language = e.target.value;
    saveConfigNow();
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

const LOCAL_WHISPER_MODELS = new Set([
  'whisper-large-v3-turbo', 'whisper-large-v3', 'whisper-medium', 'whisper-small', 'whisper-base',
]);
let _whisperStatusPollTimer = null;
let _whisperDepsInstalling = false;

async function updateLocalModelStatus(modelName) {
  const statusEl = document.getElementById('local-model-status');
  const dividerEl = document.getElementById('local-model-divider');
  const apiKeyRow = document.getElementById('row-api-key');
  const apiKeyDivider = document.getElementById('divider-api-key');
  if (!statusEl || !dividerEl) return;

  const isLocal = LOCAL_WHISPER_MODELS.has(modelName) || modelName === 'nemo';
  if (apiKeyRow) apiKeyRow.classList.toggle('hidden', isLocal);
  if (apiKeyDivider) apiKeyDivider.classList.toggle('hidden', isLocal);

  if (!isLocal || modelName === 'nemo') {
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
    el.innerHTML = `<div class="local-model-row"><span class="local-model-note muted">${t('local.no_backend')}</span></div>`;
    return;
  }

  if (!status.deps_installed) {
    el.innerHTML = `
      <div class="local-model-row">
        <span class="local-model-note">${t('local.whisper.tagline')}</span>
        <button class="btn-local-model" id="btn-install-whisper-deps">${t('local.install')}</button>
      </div>
      ${_whisperDepsInstalling ? `<div class="local-model-installing"><span>⏳ ${t('local.installing')}</span><div class="status-line" id="whisper-deps-status-line"></div></div>` : ''}
    `;
    const btn = document.getElementById('btn-install-whisper-deps');
    if (btn) btn.addEventListener('click', installWhisperDeps);
    return;
  }

  if (status.downloading) {
    el.innerHTML = `
      <div class="local-model-row">
        <span class="local-model-note">${t('local.downloading.note')}</span>
        <span class="local-model-badge downloading">${t('local.downloading.badge')}</span>
      </div>
    `;
    return;
  }

  if (status.error) {
    const row = document.createElement('div');
    row.className = 'local-model-row';
    const note = document.createElement('span');
    note.className = 'local-model-note error';
    note.textContent = `${t('local.download_failed')}${status.error}`;
    const btn = document.createElement('button');
    btn.className = 'btn-local-model';
    btn.textContent = t('local.retry');
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
        <span class="local-model-note">${t('local.whisper.tagline.size')}</span>
        <button class="btn-local-model" id="btn-download-whisper">${t('local.download')}</button>
      </div>
    `;
    const btn = document.getElementById('btn-download-whisper');
    if (btn) btn.addEventListener('click', () => downloadWhisperModel(modelName));
    return;
  }

  // Cached and ready
  el.innerHTML = `
    <div class="local-model-row">
      <span class="local-model-note">${t('local.whisper.tagline')}</span>
      <span class="local-model-badge ready">${t('local.ready')}</span>
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
    if (el) el.innerHTML += `<div class="local-model-note error">${t('local.install_failed')}</div>`;
  }
}

async function downloadWhisperModel(modelName) {
  await window.api.downloadWhisperModel(modelName);
  // Start polling
  await updateLocalModelStatus(modelName);
}

// ---------------------------------------------------------------------------
// Local LLM Status (llama-cpp-python + GGUF model download)
// ---------------------------------------------------------------------------

let _llmStatusPollTimer = null;
let _llmDepsInstalling = false;
let _llmLocalCached = false; // used by hasLlmApiKey()
let _llmInstallLog = []; // rolling pip output for error display

async function updateLlmLocalStatus(modelId) {
  const el = document.getElementById('llm-local-status');
  if (!el) return;

  const status = await window.api.getLlmLocalStatus(modelId);
  _llmLocalCached = !!(status && status.cached);
  renderLlmLocalStatus(status, modelId);
  updateModesLlmGate();
  // Re-sync mode toggle checked states now that _llmLocalCached is resolved
  applyModesConfig();

  clearInterval(_llmStatusPollTimer);
  if (status && status.downloading) {
    _llmStatusPollTimer = setInterval(async () => {
      const s = await window.api.getLlmLocalStatus(modelId);
      _llmLocalCached = !!(s && s.cached);
      renderLlmLocalStatus(s, modelId);
      updateModesLlmGate();
      applyModesConfig();
      if (s && !s.downloading) {
        clearInterval(_llmStatusPollTimer);
        _llmStatusPollTimer = null;
      }
    }, 2000);
  }
}

function renderLlmLocalStatus(status, modelId) {
  const el = document.getElementById('llm-local-status');
  if (!el) return;

  if (!status) {
    el.innerHTML = `<div class="local-model-row"><span class="local-model-note muted">${t('local.no_backend')}</span></div>`;
    return;
  }

  if (!status.deps_installed) {
    const engineLabel = platform === 'darwin' ? 'mlx-lm' : 'llama-cpp-python';
    if (_llmDepsInstalling) {
      el.innerHTML = `
        <div class="local-model-row">
          <span class="local-model-note">${t('local.installing')} ${engineLabel}…</span>
          <button class="btn-local-model" disabled style="opacity:0.5">${t('local.installing')}</button>
        </div>
        <pre class="llm-install-log" id="llm-deps-log">${_llmInstallLog.slice(-8).map(escapeHtml).join('\n')}</pre>
      `;
    } else if (status.deps_error) {
      // pip install succeeded but import still fails — show the actual error
      el.innerHTML = `
        <div class="local-model-row">
          <span class="local-model-note error">${t('local.llm.engine_error')}</span>
          <button class="btn-local-model" id="btn-install-llm-deps">${t('local.retry')}</button>
        </div>
        <pre class="llm-install-log error">${escapeHtml(status.deps_error)}</pre>
      `;
      const btn = document.getElementById('btn-install-llm-deps');
      if (btn) btn.addEventListener('click', installLlmDeps);
    } else {
      el.innerHTML = `
        <div class="local-model-row">
          <span class="local-model-note">${t('local.llm.tagline')}</span>
          <button class="btn-local-model" id="btn-install-llm-deps">${t('local.llm.install_engine')}</button>
        </div>
      `;
      const btn = document.getElementById('btn-install-llm-deps');
      if (btn) btn.addEventListener('click', installLlmDeps);
    }
    return;
  }

  if (status.downloading) {
    const pct = status.total_bytes > 0
      ? Math.round((status.progress_bytes / status.total_bytes) * 100)
      : null;
    const label = pct !== null ? `${t('local.llm.downloading')} ${pct}%` : t('local.llm.downloading');
    el.innerHTML = `
      <div class="local-model-row">
        <span class="local-model-note">${label}</span>
        <span class="local-model-badge downloading">${t('local.downloading.badge')}</span>
      </div>
      ${pct !== null ? `<div class="llm-progress-bar"><div class="llm-progress-fill" style="width:${pct}%"></div></div>` : ''}
    `;
    return;
  }

  if (status.error) {
    const row = document.createElement('div');
    row.className = 'local-model-row';
    const note = document.createElement('span');
    note.className = 'local-model-note error';
    note.textContent = `${t('local.download_failed')}${status.error}`;
    const btn = document.createElement('button');
    btn.className = 'btn-local-model';
    btn.textContent = t('local.retry');
    btn.addEventListener('click', () => startLlmModelDownload(modelId));
    row.appendChild(note);
    row.appendChild(btn);
    el.innerHTML = '';
    el.appendChild(row);
    return;
  }

  if (!status.cached) {
    el.innerHTML = `
      <div class="local-model-row">
        <span class="local-model-note">${t('local.llm.tagline.size')}</span>
        <button class="btn-local-model" id="btn-download-llm">${t('local.download')}</button>
      </div>
    `;
    const btn = document.getElementById('btn-download-llm');
    if (btn) btn.addEventListener('click', () => startLlmModelDownload(modelId));
    return;
  }

  // Cached and ready
  el.innerHTML = `
    <div class="local-model-row">
      <span class="local-model-note">${t('local.llm.tagline.ready')}</span>
      <span class="local-model-badge ready">${t('local.ready')}</span>
    </div>
  `;
}

async function installLlmDeps() {
  _llmDepsInstalling = true;
  _llmInstallLog = [];
  const modelId = config ? (config.llm_model || 'gemma-3-4b') : 'gemma-3-4b';
  renderLlmLocalStatus({ deps_installed: false }, modelId);

  window.api.onLlmDepsProgress((line) => {
    _llmInstallLog.push(line);
    if (_llmInstallLog.length > 200) _llmInstallLog.shift();
    // Live-update the log display
    const logEl = document.getElementById('llm-deps-log');
    if (logEl) logEl.textContent = _llmInstallLog.slice(-8).join('\n');
  });

  const result = await window.api.installLlmDeps();
  _llmDepsInstalling = false;

  if (result && result.success) {
    _llmInstallLog = [];
    await updateLlmLocalStatus(modelId);
  } else {
    // Show the actual pip error output
    const errorLines = _llmInstallLog.slice(-15).join('\n');
    const el = document.getElementById('llm-local-status');
    if (el) {
      el.innerHTML = `
        <div class="local-model-row">
          <span class="local-model-note error">${t('local.llm.install_failed')}</span>
          <button class="btn-local-model" id="btn-install-llm-deps">${t('local.retry')}</button>
        </div>
        <pre class="llm-install-log error">${escapeHtml(errorLines)}</pre>
      `;
      const btn = document.getElementById('btn-install-llm-deps');
      if (btn) btn.addEventListener('click', installLlmDeps);
    }
  }
}

async function startLlmModelDownload(modelId) {
  await window.api.downloadLlmModel(modelId);
  await updateLlmLocalStatus(modelId);
}

// ---------------------------------------------------------------------------
// Logo Select Helpers
// ---------------------------------------------------------------------------

function logoSrc(name) {
  return `../assets/logos/${name}.svg`;
}

/**
 * Build (or rebuild) a custom logo-select dropdown.
 * options: [{ value, label, logo }]
 */
function closeAllLogoSelects() {
  const overlay = document.getElementById('logo-select-overlay');
  if (overlay) overlay.style.display = 'none';
  document.querySelectorAll('.logo-select.open').forEach((el) => {
    el.classList.remove('open');
  });
  // Hide all menus directly — handles cases where .open may have been lost
  document.querySelectorAll('.logo-select-menu').forEach((menu) => {
    menu.style.display = 'none';
  });
}

function getOrCreateOverlay() {
  let overlay = document.getElementById('logo-select-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'logo-select-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;display:none;';
    overlay.addEventListener('click', closeAllLogoSelects);
    document.body.appendChild(overlay);
  }
  return overlay;
}

function initLogoSelect(id, options) {
  const root = document.getElementById(id);
  if (!root) return;

  // Reuse existing detached menu, or grab the placeholder from the DOM on first call
  let menu = root._logoMenu;
  if (!menu) {
    menu = root.querySelector('.logo-select-menu');
    if (!menu) return;
    menu.style.display = 'none';
    document.body.appendChild(menu);
    root._logoMenu = menu;

    // Wire trigger click directly (not via delegation)
    const trigger = root.querySelector('.logo-select-trigger');
    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = root.classList.contains('open');
        closeAllLogoSelects();
        if (!isOpen) {
          const rect = trigger.getBoundingClientRect();
          menu.style.top = `${rect.bottom + 4}px`;
          menu.style.left = `${rect.left}px`;
          menu.style.minWidth = `${rect.width}px`;
          menu.style.display = 'block';
          root.classList.add('open');
          getOrCreateOverlay().style.display = 'block';
        }
      });
    }
  }

  // Populate menu
  menu.innerHTML = '';
  for (const opt of options) {
    const item = document.createElement('div');
    item.className = 'logo-select-option';
    item.dataset.value = opt.value;
    const imgHtml = opt.logo ? `<img src="${logoSrc(opt.logo)}" width="16" height="16" alt="">` : '';
    item.innerHTML = `
      ${imgHtml}
      <span class="logo-select-option-label">${opt.label}</span>
      <span class="logo-select-check">✓</span>
    `;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const value = item.dataset.value;
      closeAllLogoSelects();
      setLogoSelect(id, value);
      root.dispatchEvent(new CustomEvent('logo-select-change', { detail: { value } }));
    });
    menu.appendChild(item);
  }

  // Default to first
  if (options.length) setLogoSelect(id, options[0].value);
}

function setLogoSelect(id, value) {
  const root = document.getElementById(id);
  if (!root) return;
  const trigger = root.querySelector('.logo-select-trigger');
  const menu = root._logoMenu;
  if (!trigger || !menu) return;

  // Update trigger display
  const matchedOption = menu.querySelector(`[data-value="${CSS.escape(value)}"]`);
  const triggerIcon = trigger.querySelector('.logo-select-icon');
  const triggerLabel = trigger.querySelector('.logo-select-label');

  if (matchedOption) {
    const optImg = matchedOption.querySelector('img');
    const optLabel = matchedOption.querySelector('.logo-select-option-label');
    if (triggerIcon) triggerIcon.src = optImg ? optImg.src : '';
    if (triggerLabel && optLabel) triggerLabel.textContent = optLabel.textContent;
  }

  // Update selected state
  menu.querySelectorAll('.logo-select-option').forEach((el) => {
    el.classList.toggle('selected', el.dataset.value === value);
  });

  // Store current value on root element for later reads
  root.dataset.value = value;
}

// ---------------------------------------------------------------------------
// LLM Settings
// ---------------------------------------------------------------------------

const LLM_MODELS = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o', logo: 'openai' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini', logo: 'openai' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', logo: 'openai' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', logo: 'openai' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', logo: 'anthropic' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', logo: 'anthropic' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', logo: 'anthropic' },
  ],
  google: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', logo: 'gemini' },
    { value: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro', logo: 'gemini' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', logo: 'gemini' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', logo: 'gemini' },
  ],
  local: [
    { value: 'gemma-3-4b', label: 'Gemma 3 4B — Local', logo: 'gemini' },
  ],
};

function populateLlmModelSelect(provider) {
  const models = LLM_MODELS[provider] || LLM_MODELS.openai;
  initLogoSelect('sel-llm-model', models);
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
      setLogoSelect('sel-llm-model', firstModel.value);
    }
    applyLlmProviderVisibility(e.target.value);
    if (e.target.value === 'local' && firstModel) {
      updateLlmLocalStatus(firstModel.value);
    }
    saveConfig();
  });

  // API key input
  const llmKeyInput = document.getElementById('inp-llm-api-key');
  const llmMasked = document.getElementById('masked-llm-api-key');
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
    debounce = null;
    saveConfig();
    showMaskedKey(llmKeyInput, llmMasked, llmKeyInput.value);
  });

  // Click masked span to edit
  llmMasked.addEventListener('click', () => showKeyInput(llmKeyInput, llmMasked));

  // Expose so applyLlmConfig can trigger masked display
  llmKeyInput._showMasked = () => showMaskedKey(llmKeyInput, llmMasked, llmKeyInput.value);

  // Model selector
  document.getElementById('sel-llm-model').addEventListener('logo-select-change', (e) => {
    if (!config) return;
    config.llm_model = e.detail.value;
    if (config.llm_provider === 'local') {
      updateLlmLocalStatus(e.detail.value);
    }
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
  applyLlmProviderVisibility(provider);

  const llmApiKeyInput = document.getElementById('inp-llm-api-key');
  llmApiKeyInput.value = cfg.llm_api_key || '';
  if (llmApiKeyInput._showMasked) llmApiKeyInput._showMasked();

  // Set model — default to first for provider if not set
  const models = LLM_MODELS[provider] || LLM_MODELS.openai;
  const savedModel = cfg.llm_model || '';
  const modelExists = models.some((m) => m.value === savedModel);
  const modelToUse = modelExists ? savedModel : (models[0] ? models[0].value : '');
  setLogoSelect('sel-llm-model', modelToUse);
  if (!cfg.llm_model && modelToUse) {
    cfg.llm_model = modelToUse;
  }

  if (provider === 'local') {
    // async — will set _llmLocalCached and call updateModesLlmGate when done
    if (!fromPoll) updateLlmLocalStatus(modelToUse);
  } else {
    updateModesLlmGate();
  }

  updateLlmAutofillNotice(autofilled);
}

function applyLlmProviderVisibility(provider) {
  const isLocal = provider === 'local';
  const apiKeyRow = document.getElementById('llm-api-key-row');
  const apiKeyDivider = document.getElementById('llm-api-key-divider');
  const localStatus = document.getElementById('llm-local-status');
  const subtitle = document.getElementById('llm-panel-subtitle');
  if (apiKeyRow) apiKeyRow.classList.toggle('hidden', isLocal);
  if (apiKeyDivider) apiKeyDivider.classList.toggle('hidden', isLocal);
  if (localStatus) localStatus.classList.toggle('hidden', !isLocal);
  if (subtitle) {
    subtitle.textContent = isLocal
      ? t('modes.llm.subtitle.local')
      : t('modes.llm.subtitle.cloud');
  }
}

function updateLlmAutofillNotice(show) {
  const notice = document.getElementById('llm-autofill-notice');
  if (notice) notice.classList.toggle('hidden', !show);
}

function hasLlmApiKey() {
  if (config && config.llm_provider === 'local') {
    return _llmLocalCached;
  }
  return !!(config && config.llm_api_key && config.llm_api_key.trim());
}

function updateModesLlmGate() {
  const notice = document.getElementById('modes-no-llm-notice');
  if (!notice) return;
  const hasKey = hasLlmApiKey();
  notice.classList.toggle('hidden', hasKey);
  // Update notice text for local provider
  if (config && config.llm_provider === 'local' && !hasKey) {
    const textEl = notice.querySelector('.modes-no-llm-text');
    if (textEl) textEl.innerHTML = `<strong>${t('modes.nollm.title')}</strong><span>${t('modes.nollm.local')}</span>`;
  }
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
  // Refresh local model status each time the panel opens
  if (config && config.llm_provider === 'local') {
    updateLlmLocalStatus(config.llm_model || 'gemma-3-4b');
  }
}

function closeLlmPanel() {
  document.getElementById('modes-llm-btn').classList.remove('active');
  document.getElementById('modes-llm-panel').classList.add('hidden');
  document.getElementById('modes-category-panel').classList.remove('hidden');
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
    linkedApps: [],
    linkedUrls: [],
  },
  'personal-message': {
    linkedApps: [],
    linkedUrls: [],
  },
};

const MODES_STYLES = {
  formal: { name: 'Formal.', subtitle: 'Caps + Punctuation' },
  casual: { name: 'Casual', subtitle: 'Caps + Less punctuation' },
  excited: { name: 'Excited!', subtitle: 'More exclamations' },
};

const CATEGORY_TOGGLES = {
  'email': [
    { key: 'include_greeting', label: 'Include greeting', default: true },
    { key: 'include_sign_off', label: 'Include sign-off', default: true },
  ],
  'personal-message': [
    { key: 'use_emoji', label: 'Use emoji', default: false },
  ],
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

  // Gate toggles immediately — don't wait for applyConfig
  updateModesLlmGate();

  // Installed apps are preloaded at DOMContentLoaded (above) so the cache
  // is warm before the user opens the linked-apps popup.
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
  renderCategoryToggles(categoryId);
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

  const MAX_VISIBLE = 5;
  const allItems = [...apps];
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

  const emptySubtext = allItems.length === 0
    ? `<div class="modes-banner-subtitle">${t('modes.banner.empty')}</div>`
    : '';

  banner.innerHTML = `
    <div class="modes-banner-text">
      <div class="modes-banner-title">${t('modes.banner.title')}</div>
      ${emptySubtext}
    </div>
    <div class="modes-banner-icons">
      ${iconElements}
      ${overflowEl}
      <div class="modes-banner-icon plus" id="banner-add-btn">+</div>
    </div>
  `;

  banner.style.cursor = 'pointer';
  banner.addEventListener('click', () => openLinkedAppsPopup(categoryId));
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
        <div class="popup-title">${t('popup.title')}</div>
        <button class="popup-close" id="popup-close-btn">&times;</button>
      </div>
      ${buildLinkedAppsSection()}
      <div class="popup-search-row">
        <input type="text" class="popup-search-input" id="popup-search"
               placeholder="${t('popup.search')}" autocomplete="off">
      </div>
      <div class="app-grid-scroll" id="app-grid-scroll">
        <div class="apps-loading">
          <div class="apps-spinner"></div>
          <span>${t('popup.loading')}</span>
        </div>
      </div>
      ${buildUrlSection()}
      <div class="popup-footer">
        <button class="popup-done-btn" id="popup-done-btn">${t('popup.done')}</button>
      </div>
    `;
  }

  function buildLinkedAppsSection() {
    const chips = apps.length === 0
      ? `<span class="linked-apps-empty">${t('popup.no_apps')}</span>`
      : apps.map((name, i) => `
          <div class="linked-app-chip" data-index="${i}" title="${name}">
            ${getLinkedAppIconHtml(name)}
            <button class="linked-app-chip-remove" data-index="${i}">&times;</button>
          </div>
        `).join('');

    return `
      <div class="linked-apps-section" id="linked-apps-section">
        <div class="popup-section-title">${t('popup.linked_apps')}</div>
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
        <div class="popup-section-title">${t('popup.urls')}</div>
        <div class="popup-hint">${t('popup.urls.hint')}</div>
        <div class="popup-url-tags" id="popup-url-tags">${tags}</div>
        <div class="popup-add-row">
          <input type="text" class="popup-input" id="popup-url-input"
                 placeholder="${t('popup.url.placeholder')}">
          <button class="popup-add-btn" id="popup-add-url">${t('popup.url.add')}</button>
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
      return `<div class="apps-empty">${filter ? t('popup.no_apps_found') : t('popup.no_installed')}</div>`;
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

function getToggleState(categoryId, styleId, toggleKey, defaultVal) {
  const toggles = config?.modes?.toggles?.[categoryId]?.[styleId] ?? {};
  return toggleKey in toggles ? toggles[toggleKey] : defaultVal;
}

function saveToggleState(categoryId, styleId, toggleKey, value) {
  if (!config) return;
  config.modes ??= {};
  config.modes.toggles ??= {};
  config.modes.toggles[categoryId] ??= {};
  config.modes.toggles[categoryId][styleId] ??= {};
  config.modes.toggles[categoryId][styleId][toggleKey] = value;
  saveConfig();
}

function renderCategoryToggles() {
  const container = document.getElementById('modes-toggles');
  if (container) container.innerHTML = '';
  // Toggles are now rendered inside each style card by renderStyleCards
}

function renderStyleCards(categoryId) {
  const container = document.getElementById('modes-cards');
  const selections = (config && config.modes && config.modes.selections) || {};
  const currentStyle = selections[categoryId] || 'formal';

  container.innerHTML = '';

  for (const [styleId, style] of Object.entries(MODES_STYLES)) {
    const preview = t(`modes.preview.${categoryId}.${styleId}`);
    const isSelected = styleId === currentStyle;

    const card = document.createElement('div');
    card.className = `mode-card${isSelected ? ' selected' : ''}`;
    card.dataset.style = styleId;

    const bodyHTML = categoryId === 'personal-message'
      ? `<div class="mode-card-message-bubble">
          <div class="mode-card-message-text">${preview.replace(/\n/g, '<br>')}</div>
          <div class="mode-card-message-time">${t('modes.card.just_now')}</div>
        </div>`
      : `<div class="mode-card-to">${t('modes.card.to')}</div>
         <div class="mode-card-preview">${preview}</div>`;

    card.innerHTML = `
      <div class="mode-card-header">
        <div class="mode-card-name">${t('modes.style.' + styleId)}</div>
        <div class="mode-card-subtitle">${t('modes.style.' + styleId + '.sub')}</div>
      </div>
      <div class="mode-card-divider"></div>
      ${bodyHTML}
    `;

    // Append category toggles at the bottom of each card
    const defs = CATEGORY_TOGGLES[categoryId] || [];
    if (defs.length > 0) {
      const togglesWrap = document.createElement('div');
      togglesWrap.className = 'mode-card-toggles';
      for (const { key, default: defaultVal } of defs) {
        const checked = getToggleState(categoryId, styleId, key, defaultVal);
        const row = document.createElement('div');
        row.className = 'mode-card-toggle-row';
        row.innerHTML = `
          <span class="modes-toggle-label">${t('modes.toggle.' + key)}</span>
          <label class="mode-toggle">
            <input type="checkbox" ${checked ? 'checked' : ''}>
            <span class="mode-toggle-slider"></span>
          </label>
        `;
        const input = row.querySelector('input');
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('change', (e) => {
          e.stopPropagation();
          saveToggleState(categoryId, styleId, key, e.target.checked);
        });
        row.addEventListener('click', (e) => e.stopPropagation());
        togglesWrap.appendChild(row);
      }
      card.appendChild(togglesWrap);
    }

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
  for (const [catId] of Object.entries(MODES_CATEGORIES)) {
    const styleId = selections[catId] || 'formal';
    const styleName = MODES_STYLES[styleId] ? t('modes.style.' + styleId).replace(/[.!]$/, '') : t('modes.style.formal').replace(/[.!]$/, '');
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
    renderCategoryToggles(selectedCategory);
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

/** Save immediately — used for dropdown/toggle changes that should persist
 *  even if the window closes right after. Skips the 300ms debounce. */
function saveConfigNow() {
  saveInFlight = true;
  clearTimeout(saveDebounce);
  if (!config) { saveInFlight = false; return; }
  window.api.saveConfig({ ...config }).finally(() => { saveInFlight = false; });
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

    const usageHtml = buildUsageHtml(entry.usage);

    el.innerHTML = `
      <div class="history-entry-text">${escapeHtml(entry.text)}</div>
      <div class="history-entry-meta">
        <span class="history-entry-time">${formatTimestamp(entry.timestamp)}</span>
        <div class="history-entry-actions">
          <button class="history-action-btn copy" title="Copy to clipboard">${t('history.copy')}</button>
          <button class="history-action-btn delete" title="Delete">${t('history.delete')}</button>
        </div>
      </div>
      ${usageHtml}
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

    const badge = el.querySelector('.usage-badge');
    if (badge && entry.usage) {
      badge.addEventListener('mouseenter', () => {
        const tip = getUsageTooltip();
        tip.innerHTML = buildTooltipContent(entry.usage);
        tip.style.display = 'block';
        const rect = badge.getBoundingClientRect();
        tip.style.left = rect.left + 'px';
        tip.style.top = (rect.bottom + 6) + 'px';
      });
      badge.addEventListener('mouseleave', (e) => {
        if (!e.relatedTarget || !e.relatedTarget.closest('#usage-tooltip-overlay')) {
          getUsageTooltip().style.display = 'none';
        }
      });
    }

    list.appendChild(el);
  }
}

let _usageTooltipEl = null;
function getUsageTooltip() {
  if (!_usageTooltipEl) {
    _usageTooltipEl = document.createElement('div');
    _usageTooltipEl.id = 'usage-tooltip-overlay';
    _usageTooltipEl.addEventListener('mouseleave', () => {
      _usageTooltipEl.style.display = 'none';
    });
    document.body.appendChild(_usageTooltipEl);
  }
  return _usageTooltipEl;
}

function buildUsageHtml(usage) {
  if (!usage?.steps?.length) return '';
  const totalCost = typeof usage.total_cost === 'number' ? '$' + usage.total_cost.toFixed(4) : '—';
  const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens.toLocaleString() : '—';
  return `<div class="history-usage"><button class="usage-badge" type="button">${totalTokens} tokens · ${totalCost}</button></div>`;
}

function fmtLatency(ms) {
  if (typeof ms !== 'number') return null;
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
}

function buildTooltipContent(usage) {
  const steps = usage.steps || [];
  const stepRows = steps.map((s) => {
    const isLocal = s.local === true;
    const costStr = isLocal ? '$0.00' : (typeof s.cost === 'number' ? '$' + s.cost.toFixed(4) : '—');
    const latencyStr = fmtLatency(s.latency_ms);
    if (s.step === 'transcription') {
      const durStr = typeof s.duration_seconds === 'number' ? s.duration_seconds.toFixed(1) + 's' : null;
      return `
        <div class="usage-tooltip-row"><span class="usage-tooltip-label">Model</span><span class="usage-tooltip-value">${escapeHtml(s.model)}</span></div>
        ${durStr ? `<div class="usage-tooltip-row"><span class="usage-tooltip-label">Audio</span><span class="usage-tooltip-value">${durStr}</span></div>` : ''}
        ${latencyStr ? `<div class="usage-tooltip-row"><span class="usage-tooltip-label">Inference</span><span class="usage-tooltip-value">${latencyStr}</span></div>` : ''}
        <div class="usage-tooltip-row"><span class="usage-tooltip-label">Cost</span><span class="usage-tooltip-value">${costStr}</span></div>`;
    }
    if (isLocal) {
      return `
        <div class="usage-tooltip-row"><span class="usage-tooltip-label">Model</span><span class="usage-tooltip-value">${escapeHtml(s.model)}</span></div>
        ${latencyStr ? `<div class="usage-tooltip-row"><span class="usage-tooltip-label">Inference</span><span class="usage-tooltip-value">${latencyStr}</span></div>` : ''}
        <div class="usage-tooltip-row"><span class="usage-tooltip-label">Cost</span><span class="usage-tooltip-value">${costStr}</span></div>`;
    }
    const inputStr = typeof s.input_tokens === 'number' ? s.input_tokens.toLocaleString() : '—';
    const outputStr = typeof s.output_tokens === 'number' ? s.output_tokens.toLocaleString() : '—';
    const totalStr = typeof s.input_tokens === 'number' && typeof s.output_tokens === 'number'
      ? (s.input_tokens + s.output_tokens).toLocaleString() : '—';
    return `
      <div class="usage-tooltip-row"><span class="usage-tooltip-label">Model</span><span class="usage-tooltip-value">${escapeHtml(s.model)}</span></div>
      <div class="usage-tooltip-row"><span class="usage-tooltip-label">Input</span><span class="usage-tooltip-value">${inputStr}</span></div>
      <div class="usage-tooltip-row"><span class="usage-tooltip-label">Output</span><span class="usage-tooltip-value">${outputStr}</span></div>
      <div class="usage-tooltip-row"><span class="usage-tooltip-label">Total</span><span class="usage-tooltip-value">${totalStr} · ${costStr}</span></div>
      ${latencyStr ? `<div class="usage-tooltip-row"><span class="usage-tooltip-label">Inference</span><span class="usage-tooltip-value">${latencyStr}</span></div>` : ''}`;
  });

  const prepStr = fmtLatency(usage.prep_latency_ms);
  const pasteStr = fmtLatency(usage.paste_latency_ms);
  const totalLatencyStr = fmtLatency(usage.total_latency_ms);
  const footer = totalLatencyStr ? `
    <div class="usage-tooltip-sep"></div>
    ${prepStr ? `<div class="usage-tooltip-row"><span class="usage-tooltip-label">Prep</span><span class="usage-tooltip-value">${prepStr}</span></div>` : ''}
    ${pasteStr ? `<div class="usage-tooltip-row"><span class="usage-tooltip-label">Paste</span><span class="usage-tooltip-value">${pasteStr}</span></div>` : ''}
    <div class="usage-tooltip-row"><span class="usage-tooltip-label">Total</span><span class="usage-tooltip-value">${totalLatencyStr}</span></div>`
    : '';

  return stepRows.map((r, i) =>
    i < stepRows.length - 1 ? r + '<div class="usage-tooltip-sep"></div>' : r
  ).join('') + footer;
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
    return t('history.yesterday') + ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  // Older
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Home Tab — Usage Stats
// ---------------------------------------------------------------------------

function setupHomeTab() {
  // Load stats immediately (home is the default active tab)
  loadHomeStats();

  // Reload when user navigates back to home
  document.querySelectorAll('.sidebar-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (item.dataset.tab === 'home') loadHomeStats();
    });
  });
}

async function loadHomeStats() {
  const entries = await window.api.getHistory();
  renderHomeStats(entries || []);
}

function computeStats(entries) {
  if (!entries.length) return null;

  const wordCounts = entries.map((e) => (e.text.trim() ? e.text.trim().split(/\s+/).length : 0));
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  const totalTranscriptions = entries.length;

  // Time saved: assume 50 wpm average typing speed
  const minutesSaved = totalWords / 50;
  let timeSaved;
  if (minutesSaved < 1) {
    timeSaved = '<1 min';
  } else if (minutesSaved < 60) {
    timeSaved = Math.round(minutesSaved) + ' min';
  } else {
    const h = Math.floor(minutesSaved / 60);
    const m = Math.round(minutesSaved % 60);
    timeSaved = m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  // Current streak: consecutive days ending today
  const daySet = new Set(entries.map((e) => e.timestamp.slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Longest transcription (word count)
  const longestWords = Math.max(...wordCounts);

  // Best day (most transcriptions on a single day)
  const dayCounts = {};
  for (const e of entries) {
    const day = e.timestamp.slice(0, 10);
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  }
  const bestDay = Math.max(...Object.values(dayCounts));

  return { totalTranscriptions, totalWords, timeSaved, streak, longestWords, bestDay };
}

function renderHomeStats(entries) {
  const card = document.getElementById('home-stats-card');
  const empty = document.getElementById('home-stats-empty');
  const grid = document.getElementById('home-stats-grid');

  const stats = computeStats(entries);

  if (!stats) {
    card.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = t('home.stats.empty');
    return;
  }

  empty.classList.add('hidden');
  card.classList.remove('hidden');

  const items = [
    { value: stats.totalTranscriptions.toLocaleString(), label: t('home.stats.transcriptions') },
    { value: stats.totalWords.toLocaleString(),          label: t('home.stats.words') },
    { value: stats.timeSaved,                            label: t('home.stats.saved') },
    { value: stats.streak > 0 ? stats.streak : '—',     label: t('home.stats.streak') },
    { value: stats.longestWords.toLocaleString(),        label: t('home.stats.longest') },
    { value: stats.bestDay.toLocaleString(),             label: t('home.stats.bestday') },
  ];

  grid.innerHTML = items.map(({ value, label }) => `
    <div class="stat-item">
      <span class="stat-value">${escapeHtml(String(value))}</span>
      <span class="stat-label">${escapeHtml(label)}</span>
    </div>
  `).join('');
}
