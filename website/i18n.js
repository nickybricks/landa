const strings = {
  en: {
    hero: 'Talk into any app.\nLanda types it for you.',
    subtext: 'Press your hotkey to record, release to transcribe and paste — formatted, polished, and private.',
    mac: 'Download for Mac',
    win: 'Download for Windows',
    tryIt: 'Try it out',
    loadingModel: 'Loading transcription model',
    loadingNote: 'first time only',
    modelReady: 'Ready to transcribe',
    shortcutHint: 'Hold <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> to record',
    recording: 'Recording…',
    transcribing: 'Transcribing…',
    micDenied: 'Microphone access denied.',
  },
  de: {
    hero: 'Sprich in jede App rein.\nLanda tippt es für dich.',
    subtext: 'Drücke dein Tastaturkürzel zum Aufnehmen, erneut drücken zum Transkribieren und Einfügen — formatiert, bereinigt, privat.',
    mac: 'Für Mac laden',
    win: 'Für Windows laden',
    tryIt: 'Versuch es doch mal',
    loadingModel: 'Transkriptionsmodell wird geladen',
    loadingNote: 'nur beim ersten Mal',
    modelReady: 'Bereit zur Transkription',
    shortcutHint: 'Halte <kbd>Strg</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> zum Aufnehmen',
    recording: 'Aufnahme…',
    transcribing: 'Wird transkribiert…',
    micDenied: 'Mikrofonzugriff verweigert.',
  },
};

const lang = navigator.language.startsWith('de') ? 'de' : 'en';
document.documentElement.lang = lang;

document.querySelectorAll('[data-i18n]').forEach((el) => {
  const key = el.getAttribute('data-i18n');
  if (strings[lang][key]) {
    el.innerHTML = strings[lang][key].replace(/\n/g, '<br>');
  }
});

document.querySelectorAll('[data-i18n-html]').forEach((el) => {
  const key = el.getAttribute('data-i18n-html');
  if (strings[lang][key]) {
    el.innerHTML = strings[lang][key];
  }
});

window.__i18n = { lang, strings: strings[lang] };
