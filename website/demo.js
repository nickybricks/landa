(function () {
  const PROXY_URL = 'https://landa-proxy.vercel.app/api/transcribe';
  const STORAGE_KEY = 'landa_demo_first_visit';
  const t = () => window.__i18n?.strings || {};
  const lang = window.__i18n?.lang || 'en';
  const isMac = /mac/i.test(navigator.platform);
  const ctrlLabel = lang === 'de' ? 'Strg' : 'Ctrl';

  const block    = document.querySelector('.demo-block');
  const btnTry   = document.querySelector('[data-demo-try]');
  if (!block || !btnTry) return;
  const elContent = block.querySelector('[data-demo-content]');
  const elDate    = block.querySelector('[data-demo-date]');
  const elPrompt  = block.querySelector('[data-demo-prompt]');
  const elKeys    = block.querySelector('[data-demo-keys]');
  const elRec     = block.querySelector('[data-demo-rec]');
  const recBars   = Array.from(elRec.querySelectorAll('.bars span'));

  // ── Placeholder text on contenteditable ──────────────────────────────
  elContent.setAttribute('data-placeholder', t().notePlaceholder || '');

  function refreshPlaceholder() {
    const empty = elContent.textContent.replace(/​/g, '').length === 0;
    elContent.classList.toggle('is-empty', empty);
  }
  elContent.addEventListener('input', refreshPlaceholder);
  elContent.addEventListener('blur', refreshPlaceholder);
  refreshPlaceholder();

  // ── First-visit date in title row ────────────────────────────────────
  function formatVisit(d) {
    const months = lang === 'de'
      ? ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const at = lang === 'de' ? 'um' : 'at';
    return `${day}. ${month} ${year} ${at} ${hh}:${mm}`;
  }

  let stored = localStorage.getItem(STORAGE_KEY);
  let visitDate;
  if (stored) {
    const parsed = new Date(stored);
    visitDate = isNaN(parsed) ? new Date() : parsed;
  } else {
    visitDate = new Date();
    try { localStorage.setItem(STORAGE_KEY, visitDate.toISOString()); } catch {}
  }
  elDate.textContent = formatVisit(visitDate);

  // ── Key definitions (OS-aware) ───────────────────────────────────────
  // Each entry: { label, codes: [matching event.code values], id }
  const KEY_DEFS = isMac
    ? [
        { id: 'alt',   label: '⌥',       codes: ['AltLeft', 'AltRight'] },
        { id: 'space', label: 'Space',   codes: ['Space'] },
      ]
    : [
        { id: 'ctrl',  label: ctrlLabel, codes: ['ControlLeft', 'ControlRight'] },
        { id: 'meta',  label: '⊞',       codes: ['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight'] },
        { id: 'alt',   label: 'Alt',     codes: ['AltLeft', 'AltRight'] },
        { id: 'space', label: 'Space',   codes: ['Space'] },
      ];

  const keyEls = {};   // id -> button element
  const codeToId = {}; // event.code -> id

  function renderKeys() {
    elKeys.innerHTML = '';
    KEY_DEFS.forEach((def, i) => {
      if (i > 0) {
        const plus = document.createElement('span');
        plus.className = 'key-plus';
        plus.textContent = '+';
        elKeys.appendChild(plus);
      }
      const k = document.createElement('button');
      k.type = 'button';
      k.className = 'key';
      k.textContent = def.label;
      k.addEventListener('click', () => {
        if (state === 'idle-ready') startRecording();
        else if (state === 'recording') stopRecording();
      });
      elKeys.appendChild(k);
      keyEls[def.id] = k;
      def.codes.forEach((c) => { codeToId[c] = def.id; });
    });
  }
  renderKeys();

  function setKeyPressed(id, pressed) {
    const el = keyEls[id];
    if (el) el.classList.toggle('pressed', pressed);
  }
  function clearAllPressed() {
    Object.values(keyEls).forEach((el) => el.classList.remove('pressed'));
  }

  // ── State machine ────────────────────────────────────────────────────
  // States: idle-no-mic | idle-ready | recording | transcribing
  let state = 'idle-no-mic';

  function setState(next) {
    state = next;
    block.dataset.state = next;

    if (next === 'idle-no-mic') {
      btnTry.hidden = false;
      btnTry.classList.remove('denied');
      btnTry.textContent = t().tryItOut || 'Try it out';
      block.hidden = true;
      elRec.hidden = true;
      elRec.classList.remove('is-processing');
    } else if (next === 'idle-ready') {
      btnTry.hidden = true;
      block.hidden = false;
      elPrompt.textContent = t().pressShortcutOnce || '';
      elRec.hidden = true;
      elRec.classList.remove('is-processing');
    } else if (next === 'recording') {
      btnTry.hidden = true;
      block.hidden = false;
      elPrompt.textContent = t().pressAgainToStop || '';
      elRec.hidden = false;
      elRec.classList.remove('is-processing');
    } else if (next === 'transcribing') {
      btnTry.hidden = true;
      block.hidden = false;
      elPrompt.textContent = t().transcribing || '';
      elRec.hidden = false;
      elRec.classList.add('is-processing');
    }
  }

  setState('idle-no-mic');

  // ── Mic permission via Try it out ────────────────────────────────────
  async function getMicPermissionState() {
    if (!navigator.permissions?.query) return 'unknown';
    try {
      const res = await navigator.permissions.query({ name: 'microphone' });
      return res.state; // 'granted' | 'denied' | 'prompt'
    } catch {
      return 'unknown';
    }
  }

  async function requestMic() {
    // If the browser has persistently denied mic, getUserMedia will reject
    // without prompting — short-circuit to the "unblock + reload" message.
    const pre = await getMicPermissionState();
    if (pre === 'denied') {
      showBlockedMessage();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
      btnTry.classList.remove('denied');
      setState('idle-ready');
    } catch {
      const post = await getMicPermissionState();
      if (post === 'denied') showBlockedMessage();
      else showSoftDeniedMessage();
    }
  }

  function showSoftDeniedMessage() {
    btnTry.classList.add('denied');
    btnTry.textContent = t().micDenied || 'Microphone access denied.';
  }

  function showBlockedMessage() {
    btnTry.classList.add('denied');
    btnTry.textContent = t().micBlocked || 'Microphone blocked — enable it in site settings, then reload.';
  }

  btnTry.addEventListener('click', requestMic);

  // On load, if the browser already remembers a denial, surface the
  // unblock-and-reload message right away instead of the generic CTA.
  getMicPermissionState().then((stateNow) => {
    if (stateNow === 'denied') showBlockedMessage();
  });

  // ── Caret-position insertion ─────────────────────────────────────────
  // We track the user's last caret position inside the note. If they've
  // never clicked into the note, we just append at the end.
  let savedRange = null;

  function captureRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (elContent.contains(r.startContainer)) {
      savedRange = r.cloneRange();
    }
  }
  ['keyup', 'mouseup', 'focus'].forEach((ev) =>
    elContent.addEventListener(ev, captureRange)
  );

  function insertAtCaret(text) {
    let range = savedRange;
    if (!range || !elContent.contains(range.startContainer)) {
      // Append at end of note (with a line break if there's existing text).
      range = document.createRange();
      range.selectNodeContents(elContent);
      range.collapse(false);
      if (elContent.textContent.length > 0) {
        const br = document.createElement('br');
        range.insertNode(br);
        range.setStartAfter(br);
        range.collapse(true);
      }
    } else {
      range.deleteContents();
    }

    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    savedRange = range.cloneRange();

    // Keep the caret visible if we just appended at the end.
    elContent.scrollTop = elContent.scrollHeight;
  }

  // ── Keyboard shortcut listener ───────────────────────────────────────
  // Visual: each key in the chord depresses on its own keydown.
  // Trigger: when Space is RELEASED, if the chord matched at the moment
  // Space went down. This avoids the keydown auto-repeat loop and gives
  // the user a clear "press → release → recording starts" rhythm.
  let chordArmed = false;

  function chordMatches(e) {
    return isMac
      ? (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey)
      : (e.ctrlKey && e.altKey && e.metaKey && !e.shiftKey);
  }

  document.addEventListener('keydown', (e) => {
    const id = codeToId[e.code];
    if (!id) return;
    if (state === 'idle-no-mic') return;

    setKeyPressed(id, true);

    if (id === 'space' && !e.repeat) {
      if (state === 'transcribing') return;
      if (chordMatches(e)) {
        chordArmed = true;
        e.preventDefault();
      }
    } else if (id !== 'space') {
      // Modifiers in our chord — prevent default so the browser doesn't
      // open a menu (e.g. Alt focusing the menu bar in some browsers).
      if (chordMatches(e) || e.altKey || e.metaKey) e.preventDefault();
    }
  });

  document.addEventListener('keyup', (e) => {
    const id = codeToId[e.code];
    if (!id) return;
    setKeyPressed(id, false);

    if (id === 'space' && chordArmed) {
      chordArmed = false;
      e.preventDefault();
      if (state === 'idle-ready') startRecording();
      else if (state === 'recording') stopRecording();
    }
  });

  // Lose focus / window blur — release any visually-held keys so the UI
  // doesn't get stuck depressed if a modifier keyup never fires.
  window.addEventListener('blur', () => {
    chordArmed = false;
    clearAllPressed();
  });

  // ── Recording ────────────────────────────────────────────────────────
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingMime = '';
  let activeStream = null;

  function pickMime() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/aac',
    ];
    for (const m of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(m)) return m;
    }
    return '';
  }

  function extFor(mime) {
    if (!mime) return 'webm';
    if (mime.includes('mp4') || mime.includes('aac')) return 'mp4';
    if (mime.includes('ogg')) return 'ogg';
    return 'webm';
  }

  async function startRecording() {
    if (state !== 'idle-ready') return;
    setState('recording');
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('idle-ready');
      return;
    }
    const mime = pickMime();
    mediaRecorder = mime ? new MediaRecorder(activeStream, { mimeType: mime }) : new MediaRecorder(activeStream);
    recordingMime = mediaRecorder.mimeType || mime || '';
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      if (activeStream) activeStream.getTracks().forEach((tr) => tr.stop());
      activeStream = null;
      sendAudio();
    };
    mediaRecorder.start();
    startBarsAnimation();
  }

  function stopRecording() {
    if (state !== 'recording') return;
    setState('transcribing');
    stopBarsAnimation();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch {}
    }
  }

  // ── Synthetic bars animation (no real audio analyser — keep simple) ──
  let barsTimer = null;
  function startBarsAnimation() {
    stopBarsAnimation();
    barsTimer = setInterval(() => {
      recBars.forEach((b, i) => {
        const phase = Math.sin(Date.now() / 180 + i * 0.6);
        const h = 0.2 + 0.6 * (0.5 + 0.5 * phase) * (0.7 + 0.3 * Math.random());
        b.style.transform = `scaleY(${h.toFixed(3)})`;
      });
    }, 90);
  }
  function stopBarsAnimation() {
    if (barsTimer) clearInterval(barsTimer);
    barsTimer = null;
    recBars.forEach((b) => { b.style.transform = 'scaleY(0.05)'; });
  }

  // ── Transcription ────────────────────────────────────────────────────
  async function sendAudio() {
    const mime = recordingMime || 'audio/webm';
    const ext = extFor(mime);
    const blob = new Blob(audioChunks, { type: mime });
    const form = new FormData();
    form.append('file', blob, `recording.${ext}`);

    let text = '';
    try {
      const res = await fetch(PROXY_URL, { method: 'POST', body: form });
      if (res.ok) {
        const data = await res.json();
        text = (data.text || '').trim();
      }
    } catch {}

    if (text) {
      insertAtCaret(text);
      refreshPlaceholder();
    }
    setState('idle-ready');
  }
})();
