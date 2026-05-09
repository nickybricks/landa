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

// Audio-reactive halo: smoothly modulates the rainbow halo's thickness, blur
// and opacity from audio amplitude. No jitter — the multi-color conic gradient
// already handles the visual interest via slow CSS rotation.

let currentLevel = 0;
let smoothed = 0;

window.api.onAudioLevel((rms) => {
  const level = Math.min(1, rms);
  bars.forEach((bar, i) => {
    const h = level < 0.04 ? 0.05 : Math.max(0.08, level * barFactors[i]);
    bar.style.transform = `scaleY(${h.toFixed(3)})`;
  });
  currentLevel = level;
});

const bodyStyle = document.body.style;

function tickGlow() {
  // Asymmetric lerp: rise quickly, fall slowly — gives a gentle bloom-and-fade
  // without ever feeling jumpy.
  const target = Math.min(1, currentLevel * 1.4);
  const ease = target > smoothed ? 0.18 : 0.06;
  smoothed += (target - smoothed) * ease;
  const a = smoothed;

  // Idle baseline: a thin, soft halo is always visible (the "shimmer when
  // starting" state). Speaking thickens, blurs and brightens it slightly —
  // calm evolution, not a pop.
  const flickerW       = 2.5 + a * 2;        //  2.5px → 4.5px
  const flickerBlur    = 2   + a * 2;        //   2px  →   4px
  const flickerOpacity = 0.65 + a * 0.25;    //  0.65  →  0.90

  const bloomW         = 3   + a * 8;        //   3px  →  11px
  const bloomBlur      = 8   + a * 10;       //   8px  →  18px
  const bloomOpacity   = 0.25 + a * 0.55;    //  0.25  →  0.80

  bodyStyle.setProperty('--flicker-w', `${flickerW.toFixed(2)}px`);
  bodyStyle.setProperty('--flicker-blur', `${flickerBlur.toFixed(2)}px`);
  bodyStyle.setProperty('--flicker-opacity', flickerOpacity.toFixed(3));
  bodyStyle.setProperty('--bloom-w', `${bloomW.toFixed(2)}px`);
  bodyStyle.setProperty('--bloom-blur', `${bloomBlur.toFixed(2)}px`);
  bodyStyle.setProperty('--bloom-opacity', bloomOpacity.toFixed(3));

  requestAnimationFrame(tickGlow);
}

requestAnimationFrame(tickGlow);
