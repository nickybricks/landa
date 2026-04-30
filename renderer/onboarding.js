// ---------------------------------------------------------------------------
// Onboarding — 5-screen first-run flow
// ---------------------------------------------------------------------------

const TRANSLATIONS = {
  de: {
    'common.continue': 'Weiter',
    'welcome.title': 'Willkommen bei Landa.',
    'welcome.body': 'In 60 Sekunden tippst du nie wieder.',
    'welcome.cta': 'Los geht\'s',
    'mic.title': 'Mikrofon',
    'mic.body': 'Landa braucht dein Mikrofon, um zu hören, was du sagst.',
    'mic.cta': 'Mikrofon erlauben',
    'mic.granted': 'Mikrofon bereit',
    'acc.title': 'Bedienungshilfen',
    'acc.body': 'Damit Landa Text in andere Apps einfügen kann, brauchen wir Zugriff auf die „Bedienungshilfen".',
    'acc.cta': 'Systemeinstellungen öffnen',
    'acc.granted': 'Zugriff erteilt',
    'train.title': 'Probier\'s aus',
    'train.lead': 'Drücke',
    'train.tail': ', sag „Hallo, das ist mein erster Test mit Landa.", drück nochmal.',
    'train.demo': 'Lass es mich dir zeigen',
    'lang.title': 'Sprache',
    'lang.body': 'Wie sprichst du meistens?',
    'lang.de': 'Deutsch',
    'lang.en': 'Englisch',
    'lang.both': 'Beides',
    'lang.cta': 'Fertig',
    'kbd.macos': '⌘ ⇧ F5',
    'kbd.windows': 'Strg ⇧ F5',
    'demo.text': 'Hallo, das ist mein erster Test mit Landa.',
  },
  en: {
    'common.continue': 'Continue',
    'welcome.title': 'Welcome to Landa.',
    'welcome.body': 'In 60 seconds, you\'ll never type again.',
    'welcome.cta': 'Let\'s go',
    'mic.title': 'Microphone',
    'mic.body': 'Landa needs your microphone to hear what you say.',
    'mic.cta': 'Allow microphone',
    'mic.granted': 'Microphone ready',
    'acc.title': 'Accessibility',
    'acc.body': 'So Landa can paste text into other apps, we need access to "Accessibility".',
    'acc.cta': 'Open System Settings',
    'acc.granted': 'Access granted',
    'train.title': 'Try it',
    'train.lead': 'Press',
    'train.tail': ', say "Hello, this is my first test with Landa.", press again.',
    'train.demo': 'Let me show you',
    'lang.title': 'Language',
    'lang.body': 'Which language do you speak most?',
    'lang.de': 'German',
    'lang.en': 'English',
    'lang.both': 'Both',
    'lang.cta': 'Done',
    'kbd.macos': '⌘ ⇧ F5',
    'kbd.windows': 'Ctrl ⇧ F5',
    'demo.text': 'Hello, this is my first test with Landa.',
  },
};

let lang = 'en';
let platform = 'darwin';
let steps = [1, 2, 3, 4, 5];
let currentIdx = 0;
let chosenLang = null;
let trainingAttempts = 0;
let accPollTimer = null;

function t(key) {
  return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.en[key] || key;
}

function applyTranslations() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  const kbd = document.getElementById('train-kbd');
  if (kbd) {
    kbd.textContent = t(platform === 'win32' ? 'kbd.windows' : 'kbd.macos');
  }
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
  onEnterStep(stepNum);
}

function next() {
  if (currentIdx < steps.length - 1) showStep(currentIdx + 1);
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
  panel.querySelector('#mic-grant-btn').disabled = true;
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
  // Already granted on entry — pause long enough that the ✓ is readable.
  const trusted = await window.api.getAccessibilityStatus();
  if (trusted) {
    showAccGranted();
    setTimeout(next, 1800);
    return;
  }
  // Granted mid-screen — user just made the change, quicker feedback is fine.
  accPollTimer = setInterval(async () => {
    const ok = await window.api.getAccessibilityStatus();
    if (ok) {
      clearInterval(accPollTimer);
      accPollTimer = null;
      showAccGranted();
      setTimeout(next, 900);
    }
  }, 800);
}

function showAccGranted() {
  const panel = document.querySelector('.ob-panel[data-step="3"]');
  panel.querySelector('#acc-status').hidden = false;
  panel.querySelector('#acc-open-btn').disabled = true;
}

async function handleAccOpenClick() {
  await window.api.openAccessibilitySettings();
}

// ---------------------------------------------------------------------------
// Step 4 — Hotkey training
// ---------------------------------------------------------------------------

function initTrainStep() {
  const ta = document.getElementById('train-textarea');
  const cont = document.querySelector('.ob-panel[data-step="4"] [data-action="next"]');
  ta.value = '';
  ta.focus();
  cont.disabled = true;
  trainingAttempts = 0;

  ta.addEventListener('input', () => {
    cont.disabled = ta.value.trim().length === 0;
    if (ta.value.trim().length > 0) trainingAttempts = 0;
  });

  const demoBtn = document.getElementById('train-demo-btn');
  demoBtn.classList.add('ob-hidden');
  demoBtn.addEventListener('click', () => {
    ta.value = t('demo.text');
    cont.disabled = false;
  }, { once: true });

  // After 30s of an empty textarea, count it as a failed attempt and
  // surface the demo escape hatch on the second strike.
  const tick = setInterval(() => {
    const stepActive = document.querySelector('.ob-panel[data-step="4"]').dataset.active === 'true';
    if (!stepActive) { clearInterval(tick); return; }
    if (ta.value.trim().length > 0) return;
    trainingAttempts += 1;
    if (trainingAttempts >= 2) {
      demoBtn.classList.remove('ob-hidden');
      clearInterval(tick);
    }
  }, 30000);
}

// ---------------------------------------------------------------------------
// Step 5 — Language
// ---------------------------------------------------------------------------

function initLangStep() {
  document.getElementById('finish-btn').disabled = chosenLang === null;
}

function handleLangSelect(value) {
  chosenLang = value;
  document.querySelectorAll('.ob-pill').forEach((p) => {
    p.dataset.selected = String(p.dataset.lang === value);
  });
  document.getElementById('finish-btn').disabled = false;

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

  // Always default to German — Landa's positioning is German-first ("Die einzige
  // Diktier-App, die Deutsch wirklich versteht"). The user can switch on screen 5.
  lang = 'de';

  // Skip the macOS-only Accessibility screen on Windows.
  if (platform === 'win32') {
    steps = [1, 2, 4, 5];
    document.querySelector('.ob-panel[data-step="3"]').remove();
  }

  applyTranslations();
  bindEvents();
  showStep(0);
}

function bindEvents() {
  document.querySelectorAll('[data-action="next"]').forEach((btn) => {
    btn.addEventListener('click', next);
  });
  document.getElementById('mic-grant-btn').addEventListener('click', handleMicGrantClick);
  const accBtn = document.getElementById('acc-open-btn');
  if (accBtn) accBtn.addEventListener('click', handleAccOpenClick);
  document.querySelectorAll('.ob-pill').forEach((p) => {
    p.addEventListener('click', () => handleLangSelect(p.dataset.lang));
  });
  document.getElementById('finish-btn').addEventListener('click', handleFinish);
}

init();
