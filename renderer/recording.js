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

// Resting (calm dark lozenge) ↔ recording (active bars). Absence of `is-recording`
// is the resting baseline, so the pill loads calm before any IPC arrives.
window.api.onRecordingActive((active) => {
  document.body.classList.toggle('is-recording', !!active);
});

// Which screen edge the pill is docked against → which edge stays planted as it grows.
window.api.onRecordingDockEdge((edge) => {
  document.body.classList.toggle('dock-top', edge === 'top');
});

// Audio-reactive bars: amplitude scales each bar's height. The rainbow border is a
// pure-CSS rotating gradient (see recording.css), so it needs no per-frame JS here.
window.api.onAudioLevel((rms) => {
  const level = Math.min(1, rms);
  bars.forEach((bar, i) => {
    const h = level < 0.04 ? 0.05 : Math.max(0.08, level * barFactors[i]);
    bar.style.transform = `scaleY(${h.toFixed(3)})`;
  });
});
