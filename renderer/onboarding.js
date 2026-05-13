// ---------------------------------------------------------------------------
// Onboarding — 5-screen first-run flow
// ---------------------------------------------------------------------------

const TRANSLATIONS = {
  de: {
    'common.continue': 'Weiter',
    'common.back': 'Zurück',
    'welcome.title': 'Willkommen bei Landa.',
    'welcome.body': 'In 60 Sekunden tippst du nie wieder.',
    'welcome.cta': 'Los geht\'s',
    'mic.title': 'Mikrofon',
    'mic.body': 'Landa braucht dein Mikrofon, um zu hören, was du sagst.',
    'mic.cta': 'Mikrofon erlauben',
    'mic.granted': 'Mikrofon bereit',
    'acc.title': 'Bedienungshilfen',
    'acc.body': 'Damit Landa Text in andere Apps einfügen kann, brauchen wir Zugriff auf die „Bedienungshilfen".',
    'acc.note': 'Landa simuliert nur Cmd+V zum Einfügen — es liest weder deinen Bildschirm noch steuert es deinen Computer.',
    'acc.cta': 'Systemeinstellungen öffnen',
    'acc.granted': 'Zugriff erteilt',
    'train.title': 'Probier\'s aus',
    'train.notesTab': 'Neue Notiz',
    'train.prompt': 'Kürzel drücken zum Starten',
    'train.success': 'Super! Das hat geklappt.',
    'train.continueHint': 'Klick auf Weiter, wenn du bereit bist.',
    'train.settingsNote': 'Das Tastenkürzel kannst du jederzeit in den Einstellungen ändern.',
    'lang.title': 'Welche Sprache sprichst du mit Landa?',
    'lang.body': 'Landa hört zu und tippt für dich. Welche Sprache sprichst du normalerweise?',
    'lang.de': 'Deutsch',
    'lang.en': 'Englisch',
    'lang.both': 'Beides',
    'lang.recommended': 'Empfohlen',
    'lang.cta': 'Weiter',
    'lang.hint.de': 'Landa versteht dich nur auf Deutsch.',
    'lang.hint.en': 'Landa versteht dich nur auf Englisch.',
    'lang.hint.both': 'Landa versteht dich in jeder Sprache.',
    'lang.settingsNote': 'Das kannst du jederzeit in den Einstellungen ändern.',
    'done.title': 'Fertig!',
    'done.body': 'Du kannst jetzt loslegen — drück das Tastenkürzel, sprich, drück nochmal.',
    'done.settings': 'Tastenkürzel und Sprache änderst du jederzeit in den Einstellungen.',
    'done.cta': 'Los geht\'s',
  },
  en: {
    'common.continue': 'Continue',
    'common.back': 'Back',
    'welcome.title': 'Welcome to Landa.',
    'welcome.body': 'In 60 seconds, you\'ll never type again.',
    'welcome.cta': 'Let\'s go',
    'mic.title': 'Microphone',
    'mic.body': 'Landa needs your microphone to hear what you say.',
    'mic.cta': 'Allow microphone',
    'mic.granted': 'Microphone ready',
    'acc.title': 'Accessibility',
    'acc.body': 'So Landa can paste text into other apps, we need access to "Accessibility".',
    'acc.note': 'Landa only simulates Cmd+V to paste — it does not read your screen or control your computer.',
    'acc.cta': 'Open System Settings',
    'acc.granted': 'Access granted',
    'train.title': 'Try it',
    'train.notesTab': 'New Note',
    'train.prompt': 'Press the shortcut to start',
    'train.success': 'Nice! That worked.',
    'train.continueHint': 'Click Continue when you\'re ready.',
    'train.settingsNote': 'You can change the shortcut anytime in Settings.',
    'lang.title': 'Which language do you speak to Landa?',
    'lang.body': 'Landa listens and types for you. What do you usually speak?',
    'lang.de': 'German',
    'lang.en': 'English',
    'lang.both': 'Both',
    'lang.recommended': 'Recommended',
    'lang.cta': 'Continue',
    'lang.hint.de': 'Landa only understands you in German.',
    'lang.hint.en': 'Landa only understands you in English.',
    'lang.hint.both': 'Landa understands you in any language.',
    'lang.settingsNote': 'You can change this anytime in Settings.',
    'done.title': 'Done!',
    'done.body': 'You\'re set — press the shortcut, speak, press again.',
    'done.settings': 'Change the shortcut and language anytime in Settings.',
    'done.cta': 'Let\'s go',
  },
};

let lang = 'en';
let platform = 'darwin';
let steps = [1, 2, 3, 4, 5, 6];
let currentIdx = 0;
let chosenLang = null;
let accPollTimer = null;

function t(key) {
  return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.en[key] || key;
}

function applyTranslations() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-train-kbd]').forEach(renderHotkeyKeys);
}

function getHotkeyLabels() {
  // Default toggle hotkey: ⌥+Space (Mac), Ctrl+⊞+Alt+Space (Windows).
  if (platform === 'win32') {
    const ctrl = lang === 'de' ? 'Strg' : 'Ctrl';
    return [ctrl, '⊞', 'Alt', 'Space'];
  }
  return ['⌥', 'Space'];
}

function renderHotkeyKeys(container) {
  container.innerHTML = '';
  const labels = getHotkeyLabels();
  labels.forEach((label, i) => {
    if (i > 0) {
      const plus = document.createElement('span');
      plus.className = 'ob-key-plus';
      plus.textContent = '+';
      container.appendChild(plus);
    }
    const key = document.createElement('span');
    key.className = 'ob-key';
    key.textContent = label;
    container.appendChild(key);
  });
}

// ---------------------------------------------------------------------------
// Step rendering
// ---------------------------------------------------------------------------

function renderProgress() {
  const container = document.getElementById('ob-progress');
  container.innerHTML = '';
  steps.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'ob-dot';
    if (i < currentIdx) dot.dataset.state = 'done';
    else if (i === currentIdx) dot.dataset.state = 'current';
    container.appendChild(dot);
  });
}

function showStep(idx) {
  if (idx < 0 || idx >= steps.length) return;
  currentIdx = idx;
  const stepNum = steps[idx];
  document.querySelectorAll('.ob-panel').forEach((p) => {
    p.dataset.active = String(Number(p.dataset.step) === stepNum);
  });
  renderProgress();
  updateBackBtn();
  onEnterStep(stepNum);
}

function updateBackBtn() {
  const btn = document.getElementById('ob-back-btn');
  if (!btn) return;
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === steps.length - 1;
  btn.hidden = isFirst || isLast;
}

function next() {
  if (currentIdx < steps.length - 1) showStep(currentIdx + 1);
}

function back() {
  if (currentIdx > 0) showStep(currentIdx - 1);
}

function onEnterStep(stepNum) {
  if (accPollTimer) { clearInterval(accPollTimer); accPollTimer = null; }
  if (stepNum === 2) initMicStep();
  if (stepNum === 3) initAccStep();
  if (stepNum === 4) initTrainStep();
  if (stepNum === 5) initLangStep();
}

// ---------------------------------------------------------------------------
// Step 2 — Microphone
// ---------------------------------------------------------------------------

async function initMicStep() {
  const status = await window.api.getMicAccessStatus();
  if (status === 'granted') markMicGranted();
}

function markMicGranted() {
  const panel = document.querySelector('.ob-panel[data-step="2"]');
  panel.querySelector('#mic-status').hidden = false;
  panel.querySelector('#mic-grant-btn').hidden = true;
  panel.querySelector('[data-action="next"]').disabled = false;
}

async function handleMicGrantClick() {
  if (platform === 'win32') {
    // Windows: trigger the renderer-level prompt via getUserMedia.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
      markMicGranted();
    } catch {
      // denied — user can retry
    }
    return;
  }
  const result = await window.api.requestMicAccess();
  if (result === 'granted') markMicGranted();
}

// ---------------------------------------------------------------------------
// Step 3 — Accessibility (macOS only)
// ---------------------------------------------------------------------------

async function initAccStep() {
  const trusted = await window.api.getAccessibilityStatus();
  if (trusted) {
    showAccGranted();
    return;
  }
  accPollTimer = setInterval(async () => {
    const ok = await window.api.getAccessibilityStatus();
    if (ok) {
      clearInterval(accPollTimer);
      accPollTimer = null;
      showAccGranted();
    }
  }, 800);
}

function showAccGranted() {
  const panel = document.querySelector('.ob-panel[data-step="3"]');
  panel.querySelector('#acc-status').hidden = false;
  panel.querySelector('#acc-next-btn').disabled = false;
  // Register the hotkey now that Accessibility is granted, so the training
  // step (step 4) can receive the keypress.
  window.api.registerMainHotkey();
}

async function handleAccOpenClick() {
  await window.api.openAccessibilitySettings();
}

// ---------------------------------------------------------------------------
// Step 4 — Hotkey training
// ---------------------------------------------------------------------------

function initTrainStep() {
  const content = document.getElementById('train-content');
  const cta = document.getElementById('train-cta');
  const success = document.getElementById('train-success');
  const hint = document.getElementById('train-hint');
  const dateEl = document.getElementById('train-date');
  const cont = document.querySelector('.ob-panel[data-step="4"] [data-action="next"]');

  content.textContent = '';
  cont.disabled = true;
  cont.classList.remove('ob-btn-pulse');
  cta.hidden = false;
  success.hidden = true;
  hint.hidden = true;

  const locale = lang === 'de' ? 'de-DE' : 'en-US';
  dateEl.textContent = new Date().toLocaleString(locale, {
    month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  // Re-focus the window (user may have just returned from System Settings) then
  // focus the content area so paste lands in the right place.
  window.api.focusOnboardingWindow().then(() => content.focus());

  let succeeded = false;
  content.addEventListener('input', () => {
    const hasText = content.textContent.trim().length > 0;
    cont.disabled = !hasText;
    if (hasText) {
      cta.hidden = true;
      if (!succeeded) {
        succeeded = true;
        success.hidden = false;
        hint.hidden = false;
        cont.classList.add('ob-btn-pulse');
      }
    }
  });

  // Stop pulsing once the user actively notices the CTA.
  const stopPulse = () => cont.classList.remove('ob-btn-pulse');
  cont.addEventListener('mouseenter', stopPulse, { once: true });
  cont.addEventListener('focus', stopPulse, { once: true });
}

// ---------------------------------------------------------------------------
// Step 5 — Language
// ---------------------------------------------------------------------------

function initLangStep() {
  // Default to 'auto' (Whisper detects the language) — prevents the mismatch
  // case where the user picks a UI language but actually speaks something else.
  if (chosenLang === null) {
    handleLangSelect('auto');
  } else {
    document.getElementById('lang-next-btn').disabled = false;
    updateLangHint();
  }
}

function updateLangHint() {
  const hint = document.getElementById('lang-hint');
  if (!hint) return;
  if (chosenLang === 'de') hint.textContent = t('lang.hint.de');
  else if (chosenLang === 'en') hint.textContent = t('lang.hint.en');
  else if (chosenLang === 'auto') hint.textContent = t('lang.hint.both');
  else hint.textContent = '';
}

function handleLangSelect(value) {
  chosenLang = value;
  document.querySelectorAll('.ob-panel[data-step="5"] .ob-pill').forEach((p) => {
    p.dataset.selected = String(p.dataset.lang === value);
  });
  document.getElementById('lang-next-btn').disabled = false;
  updateLangHint();

  // Persist UI lang choice for the settings window.
  // 'auto' keeps whatever was picked at boot from system locale.
  if (value === 'de') localStorage.setItem('ui-lang', 'de');
  else if (value === 'en') localStorage.setItem('ui-lang', 'en');
}

async function handleFinish() {
  const finish = document.getElementById('finish-btn');
  finish.disabled = true;
  await window.api.finishOnboarding({ language: chosenLang || 'auto' });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  platform = await window.api.getPlatform();
  document.body.classList.add(`platform-${platform}`);

  // No default — user picks on screen 1. 'en' is a safe fallback for t() internals.
  lang = 'en';

  // Skip the macOS-only Accessibility screen on Windows.
  if (platform === 'win32') {
    steps = [1, 2, 4, 5, 6];
    document.querySelector('.ob-panel[data-step="3"]').remove();
  }

  applyTranslations();
  bindEvents();
  showStep(0);
}

// ---------------------------------------------------------------------------
// Step 1 — Welcome language pick
// ---------------------------------------------------------------------------

function handleWelcomeLangSelect(value) {
  lang = value;
  localStorage.setItem('ui-lang', value);
  applyTranslations();
  document.getElementById('welcome-titles').dataset.chosen = value;
  document.querySelectorAll('[data-ui-lang]').forEach((el) => {
    el.dataset.selected = String(el.dataset.uiLang === value);
  });
  document.getElementById('welcome-next-btn').disabled = false;
}

function bindEvents() {
  document.querySelectorAll('[data-action="next"]').forEach((btn) => {
    btn.addEventListener('click', next);
  });
  document.querySelectorAll('[data-ui-lang]').forEach((el) => {
    if (el.tagName === 'BUTTON') {
      el.addEventListener('click', () => handleWelcomeLangSelect(el.dataset.uiLang));
    }
  });
  document.getElementById('mic-grant-btn').addEventListener('click', handleMicGrantClick);
  const accBtn = document.getElementById('acc-open-btn');
  if (accBtn) accBtn.addEventListener('click', handleAccOpenClick);
  document.querySelectorAll('.ob-pill[data-lang]').forEach((p) => {
    p.addEventListener('click', () => handleLangSelect(p.dataset.lang));
  });
  document.getElementById('finish-btn').addEventListener('click', handleFinish);
  document.getElementById('ob-back-btn').addEventListener('click', back);
}

init();
