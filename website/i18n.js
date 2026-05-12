const strings = {
  en: {
    heroPrefix: 'Talk into ',
    heroInitial: 'any app',
    heroSuffix: '.',
    heroLine2: 'Landa types it for you.',
    subtext: 'Press your keyboard shortcut once, speak naturally, press the shortcut again — voilà, your natural spoken words are transcribed perfectly.',
    mac: 'Download for Mac',
    win: 'Download for Windows',
    tryItOut: 'Try it out',
    notePlaceholder: 'You can add anything, just by speaking…',
    pressShortcutOnce: 'Press/click those buttons',
    pressAgainToStop: 'Press again to stop the recording',
    transcribing: 'Transcribing…',
    micDenied: 'We need microphone access to try this out — click to allow.',
    micBlocked: 'Microphone blocked. Click the lock icon in your address bar, allow the mic, then reload.',
    sectionTitle: 'Works in every app you write in.',
    mailDesc: 'Reply to emails in seconds — hands-free.',
    whatsappDesc: 'Send long messages without typing a word.',
    slackDesc: 'Drop into any channel just by speaking.',
  },
  de: {
    heroPrefix: 'Sprich in ',
    heroInitial: 'jede App',
    heroSuffix: ' rein.',
    heroLine2: 'Landa tippt es für dich.',
    subtext: 'Drücke einmal dein Tastaturkürzel, sprich ganz natürlich, drücke das Kürzel erneut — voilà, deine gesprochenen Worte werden perfekt transkribiert.',
    mac: 'Für Mac laden',
    win: 'Für Windows laden',
    tryItOut: 'Versuch es doch mal',
    notePlaceholder: 'Du kannst alles hinzufügen — einfach durch Sprechen…',
    pressShortcutOnce: 'Drücke/klicke diese Tasten',
    pressAgainToStop: 'Erneut drücken, um die Aufnahme zu stoppen',
    transcribing: 'Wird transkribiert…',
    micDenied: 'Wir brauchen Mikrofonzugriff — klicke, um zu erlauben.',
    micBlocked: 'Mikrofon blockiert. Klicke auf das Schloss-Symbol in der Adressleiste, erlaube den Zugriff und lade neu.',
    sectionTitle: 'Funktioniert in jeder App, in der du schreibst.',
    mailDesc: 'Beantworte E-Mails in Sekunden — ohne zu tippen.',
    whatsappDesc: 'Schicke lange Nachrichten, ohne ein Wort zu tippen.',
    slackDesc: 'Antworte in jedem Kanal — einfach durch Sprechen.',
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

const heroEl = document.querySelector('[data-hero]');
if (heroEl) {
  const s = strings[lang];
  heroEl.innerHTML = '';
  heroEl.appendChild(document.createTextNode(s.heroPrefix));
  const rot = document.createElement('span');
  rot.className = 'rot';
  rot.dataset.rot = '';
  rot.textContent = s.heroInitial;
  heroEl.appendChild(rot);
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.setAttribute('aria-hidden', 'true');
  heroEl.appendChild(caret);
  heroEl.appendChild(document.createTextNode(s.heroSuffix));
  heroEl.appendChild(document.createElement('br'));
  heroEl.appendChild(document.createTextNode(s.heroLine2));
}

window.__i18n = { lang, strings: strings[lang] };
