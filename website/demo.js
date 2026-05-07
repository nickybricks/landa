(function () {
  const PROXY_URL = 'https://landa-proxy.vercel.app/api/transcribe';
  const t = () => window.__i18n?.strings || {};

  const isMac = /mac/i.test(navigator.platform);
  const ctrlKey = isMac ? '⌃' : (window.__i18n?.lang === 'de' ? 'Strg' : 'Ctrl');

  function hint(key) {
    return (t()[key] || '').replace('{ctrl}', `<kbd>${ctrlKey}</kbd>`);
  }

  const island   = document.querySelector('.demo-island');
  const btnAction = document.querySelector('.btn-action');
  const elInner  = document.querySelector('.demo-inner');
  const elHint   = document.querySelector('.demo-hint');
  const elField  = document.querySelector('.demo-field');

  let micReady = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let recordingMime = '';

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

  // ── First click: request mic, reveal textarea ────────────────────────────

  btnAction.addEventListener('click', async () => {
    if (micReady) return;

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      const original = btnAction.innerHTML;
      btnAction.textContent = t().micDenied || 'Microphone access denied.';
      setTimeout(() => { btnAction.innerHTML = original; }, 2500);
      return;
    }

    micReady = true;
    elInner.hidden = false;
    elHint.innerHTML = hint('shortcutHint');
    elField.focus();
  });

  // ── Button push-to-talk ──────────────────────────────────────────────────

  btnAction.addEventListener('mousedown', (e) => {
    if (!micReady) return;
    e.preventDefault();
    startRecording();
  });

  document.addEventListener('mouseup', () => {
    if (isRecording) stopRecording();
  });

  btnAction.addEventListener('touchstart', (e) => {
    if (!micReady) return;
    e.preventDefault();
    startRecording();
  });

  document.addEventListener('touchend', () => {
    if (isRecording) stopRecording();
  });

  // ── Keyboard shortcut (toggle) ───────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.shiftKey || e.key !== 'R') return;
    if (!micReady) return;
    e.preventDefault();
    isRecording ? stopRecording() : startRecording();
  });

  // ── Recording ────────────────────────────────────────────────────────────

  async function startRecording() {
    if (isRecording) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recordingMime = mediaRecorder.mimeType || mime || '';
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      sendAudio();
    };

    mediaRecorder.start();
    isRecording = true;
    island.classList.add('recording');
    elHint.innerHTML = t().recording;
    elHint.classList.add('recording');
  }

  function stopRecording() {
    if (!isRecording) return;
    if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
    isRecording = false;
    island.classList.remove('recording');
    elHint.classList.remove('recording');
    elHint.innerHTML = t().transcribing;
  }

  // ── Transcription ────────────────────────────────────────────────────────

  async function sendAudio() {
    const mime = recordingMime || 'audio/webm';
    const ext = extFor(mime);
    const blob = new Blob(audioChunks, { type: mime });
    const form = new FormData();
    form.append('file', blob, `recording.${ext}`);

    try {
      const res = await fetch(PROXY_URL, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${body ? ' – ' + body.slice(0, 200) : ''}`);
      }
      const data = await res.json();
      const text = data.text?.trim();
      if (text) elField.value += (elField.value ? '\n' : '') + text;
    } catch (err) {
      const msg = err?.message || String(err) || 'unknown';
      elField.value += (elField.value ? '\n' : '') + '[Error: ' + msg + ']';
    }

    elHint.innerHTML = hint('shortcutHint');
    elField.focus();
  }
})();
