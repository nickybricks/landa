// Recording window — listens for style/paused/level state from main process via IPC.
// Uses the contextBridge `window.api` exposed by preload.js.

const bars = Array.from(document.querySelectorAll('.bars span'));
// Sine-wave envelope: bars taller in the center, shorter at the edges.
const barFactors = bars.map((_, i) => {
  const t = (i / (bars.length - 1)) * Math.PI;
  return 0.35 + 0.65 * Math.sin(t);
});

window.api.onRecordingStyle((style) => {
  document.body.classList.remove('style-mini', 'style-classic');
  if (style === 'classic') document.body.classList.add('style-classic');
  else document.body.classList.add('style-mini');
});

window.api.onRecordingPaused((paused) => {
  document.body.classList.toggle('is-paused', !!paused);
  if (paused) bars.forEach(b => { b.style.transform = 'scaleY(0.05)'; });
});

window.api.onRecordingProcessing((processing) => {
  document.body.classList.toggle('is-processing', !!processing);
});

window.api.onAudioLevel((rms) => {
  const level = Math.min(1, rms);
  bars.forEach((bar, i) => {
    const h = level < 0.04 ? 0.05 : Math.max(0.08, level * barFactors[i]);
    bar.style.transform = `scaleY(${h.toFixed(3)})`;
  });
});
