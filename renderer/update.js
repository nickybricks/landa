const titleEl = document.getElementById('title');
const subtitleEl = document.getElementById('subtitle');
const barFillEl = document.getElementById('bar-fill');
const percentEl = document.getElementById('percent');
const sizeEl = document.getElementById('size');

let installing = false;

function formatMB(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

window.api.onUpdateVersion((version) => {
  if (version) titleEl.textContent = `Updating to Landa ${version}`;
});

window.api.onUpdateProgress(({ percent, transferred, total }) => {
  if (installing) return;
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  barFillEl.style.width = `${p}%`;
  percentEl.textContent = `${p}%`;
  if (total > 0) {
    sizeEl.textContent = `${formatMB(transferred)} / ${formatMB(total)}`;
  }
});

window.api.onUpdateInstalling(() => {
  installing = true;
  subtitleEl.textContent = 'Installing — Landa will restart automatically…';
  barFillEl.style.width = '100%';
  percentEl.textContent = '100%';
});
