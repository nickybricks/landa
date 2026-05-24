// Auth window renderer. Talks only to window.api.auth (preload IPC) — no Supabase,
// no tokens here. Minimal inline EN/DE strings keyed off the saved language.

const T = {
  en: {
    title: 'Sign in to Landa',
    sub: "Enter your email and we'll send you a secure sign-in link.",
    send: 'Send sign-in link',
    sending: 'Sending…',
    sentTitle: 'Check your inbox',
    sentPre: 'We sent a sign-in link to',
    sentPost: 'Open it on this device to finish signing in.',
    resend: 'Use a different email',
    doneTitle: 'Signed in',
    doneSub: 'Opening Landa…',
    foot: 'Your account keeps Landa in sync and unlocks Pro features. Voice stays private — transcription runs on your device.',
    errEmail: 'Please enter a valid email address.',
    errSend: "Couldn't send the link. Check your connection and try again.",
  },
  de: {
    title: 'Bei Landa anmelden',
    sub: 'Gib deine E-Mail-Adresse ein – wir senden dir einen sicheren Anmeldelink.',
    send: 'Anmeldelink senden',
    sending: 'Wird gesendet…',
    sentTitle: 'Schau in dein Postfach',
    sentPre: 'Wir haben einen Anmeldelink gesendet an',
    sentPost: 'Öffne ihn auf diesem Gerät, um die Anmeldung abzuschließen.',
    resend: 'Andere E-Mail-Adresse verwenden',
    doneTitle: 'Angemeldet',
    doneSub: 'Landa wird geöffnet…',
    foot: 'Dein Konto hält Landa synchron und schaltet Pro-Funktionen frei. Deine Stimme bleibt privat – die Transkription läuft auf deinem Gerät.',
    errEmail: 'Bitte gib eine gültige E-Mail-Adresse ein.',
    errSend: 'Der Link konnte nicht gesendet werden. Prüfe deine Verbindung und versuche es erneut.',
  },
};

let t = T.en;
const $ = (id) => document.getElementById(id);

function applyStrings() {
  $('t-title').textContent = t.title;
  $('t-sub').textContent = t.sub;
  $('t-send').textContent = t.send;
  $('t-sent-title').textContent = t.sentTitle;
  $('t-sent-pre').textContent = t.sentPre;
  $('t-sent-post').textContent = t.sentPost;
  $('t-resend').textContent = t.resend;
  $('t-done-title').textContent = t.doneTitle;
  $('t-done-sub').textContent = t.doneSub;
  $('t-foot').textContent = t.foot;
}

function show(step) {
  for (const id of ['step-email', 'step-sent', 'step-done']) $(id).hidden = (id !== step);
}

function showError(msg) {
  const el = $('error');
  el.textContent = msg;
  el.hidden = !msg;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function onSubmit(e) {
  e.preventDefault();
  showError('');
  const email = $('email').value.trim();
  if (!EMAIL_RE.test(email)) { showError(t.errEmail); return; }

  const btn = $('send-btn');
  btn.disabled = true;
  $('t-send').textContent = t.sending;
  const res = await window.api.auth.requestMagicLink(email);
  btn.disabled = false;
  $('t-send').textContent = t.send;

  if (!res || !res.ok) { showError((res && res.error) || t.errSend); return; }
  $('sent-email').textContent = email;
  show('step-sent');
}

async function init() {
  try {
    const cfg = await window.api.getConfig();
    if (cfg && cfg.language === 'de') t = T.de;
  } catch { /* default EN */ }
  applyStrings();

  $('email-form').addEventListener('submit', onSubmit);
  $('resend-btn').addEventListener('click', () => { showError(''); show('step-email'); $('email').focus(); });

  // When the deep link completes in the main process, it broadcasts signed-in and
  // then closes this window. Show a brief confirmation if we get the event first.
  window.api.auth.onChange((state) => { if (state && state.signedIn) show('step-done'); });

  $('email').focus();
}

init();
