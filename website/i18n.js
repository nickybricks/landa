const strings = {
  en: {
    hero: 'Talk into any app.\nLanda types it for you.',
    subtext: 'Press your hotkey to record, release to transcribe and paste — formatted, polished, and private.',
    mac: 'Download for Mac',
    win: 'Download for Windows',
  },
  de: {
    hero: 'Sprich in jede App rein.\nLanda tippt es für dich.',
    subtext: 'Drücke dein Tastaturkürzel zum Aufnehmen, erneut drücken zum Transkribieren und Einfügen — formatiert, bereinigt, privat.',
    mac: 'Für Mac laden',
    win: 'Für Windows laden',
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
