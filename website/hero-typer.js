(() => {
  const heroEl = document.querySelector('[data-hero]');
  const rot = document.querySelector('[data-rot]');
  if (!rot || !heroEl) return;

  const initialLabel = rot.textContent;
  const caret = heroEl.querySelector('.caret');

  const apps = [
    { name: 'Slack',       logo: 'logos/slack.png' },
    { name: 'Apple Notes', logo: 'logos/apple-notes.png' },
    { name: 'Claude',      logo: 'logos/claude.png' },
    { name: 'Apple Mail',  logo: 'logos/apple-mail.png' },
    { name: 'WhatsApp',    logo: 'logos/whatsapp.png' },
    { name: 'Gmail',       logo: 'logos/gmail.svg' },
    { name: 'ChatGPT',     logo: 'logos/chatgpt.png' },
  ];

  apps.forEach((a) => { const i = new Image(); i.src = a.logo; });

  const TYPE_MS = 70;
  const ERASE_MS = 35;
  const HOLD_MS = 1500;
  const INITIAL_HOLD_MS = 1800;
  const BETWEEN_MS = 220;

  let running = false;
  const STOP = Symbol('stop');

  const sleep = (ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms);
    sleep._cancel = () => { clearTimeout(t); reject(STOP); };
  });

  function stop() {
    if (!running) return;
    running = false;
    if (sleep._cancel) sleep._cancel();
    rot.textContent = initialLabel;
    if (caret) caret.style.display = 'none';
  }

  function start() {
    if (running) return;
    running = true;
    rot.textContent = initialLabel;
    if (caret) caret.style.display = '';
    loop();
  }

  heroEl.style.cursor = 'pointer';
  heroEl.addEventListener('click', () => {
    if (running) stop(); else start();
  });

  async function eraseText(textNode) {
    while (textNode.data.length) {
      textNode.data = textNode.data.slice(0, -1);
      await sleep(ERASE_MS);
    }
  }

  async function typeApp(app) {
    rot.textContent = '';
    const img = document.createElement('img');
    img.className = 'rot-icon';
    img.src = app.logo;
    img.alt = '';
    rot.appendChild(img);
    rot.appendChild(document.createTextNode(' '));
    const txt = document.createTextNode('');
    rot.appendChild(txt);

    for (const ch of app.name) {
      txt.data += ch;
      await sleep(TYPE_MS);
    }
    await sleep(HOLD_MS);
    await eraseText(txt);
    rot.textContent = '';
  }

  async function loop() {
    try {
      await sleep(INITIAL_HOLD_MS);
      const initial = rot.firstChild;
      if (initial && initial.nodeType === 3) {
        await eraseText(initial);
      } else {
        rot.textContent = '';
      }
      await sleep(BETWEEN_MS);

      let i = 0;
      while (true) {
        await typeApp(apps[i]);
        i = (i + 1) % apps.length;
        await sleep(BETWEEN_MS);
      }
    } catch (e) {
      if (e !== STOP) throw e;
    }
  }

  start();
})();
