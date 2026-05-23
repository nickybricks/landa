#!/usr/bin/env python3
"""Build a self-serve tuner that smooths the REAL Tink sample (embedded as PCM)."""
import base64, subprocess, os

SRC = "/System/Library/Sounds/Tink.aiff"
OUT = "/tmp/landa_sounds/tuner.html"
SR = 44100

# Decode the real Tink to mono 16-bit PCM and embed it (no file:// fetch needed).
raw = subprocess.check_output(
    ["ffmpeg", "-loglevel", "error", "-i", SRC, "-ac", "1", "-ar", str(SR),
     "-f", "s16le", "-c:a", "pcm_s16le", "pipe:1"]
)
b64 = base64.b64encode(raw).decode()
print(f"embedded {len(raw)} bytes of Tink PCM ({len(raw)/2/SR*1000:.0f}ms)")

HTML = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Landa — Smooth Tink Tuner</title>
<style>
  :root {{ color-scheme: dark; }} * {{ box-sizing: border-box; }}
  body {{ font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#14141a; color:#e8e8ee;
         margin:0; padding:40px; max-width:680px; margin-inline:auto; }}
  h1 {{ font-size:22px; margin:0 0 4px; }}
  .sub {{ color:#9a9aa8; font-size:14px; margin:0 0 28px; line-height:1.5; }}
  .card {{ background:#1d1d26; border:1px solid #2c2c38; border-radius:18px; padding:24px 26px; }}
  .row {{ display:grid; grid-template-columns:110px 1fr 70px; align-items:center; gap:14px; margin:16px 0; }}
  .row label {{ font-size:13.5px; color:#c8c8d4; }}
  .row .desc2 {{ grid-column:1/-1; font-size:11.5px; color:#7a7a88; margin:-10px 0 4px 124px; }}
  .row output {{ font-size:12.5px; color:#9a9aa8; text-align:right; font-variant-numeric:tabular-nums; }}
  input[type=range] {{ width:100%; accent-color:#7c5cff; height:22px; }}
  .btns {{ display:flex; gap:10px; margin-top:22px; }}
  button {{ font:inherit; font-size:14px; font-weight:600; cursor:pointer; border:none; border-radius:999px;
           padding:12px 22px; color:#fff; background:#7c5cff; }}
  button.ghost {{ background:#2c2c38; }}
  .export {{ margin-top:24px; }}
  textarea {{ width:100%; height:90px; background:#0f0f15; color:#c8c8d4; border:1px solid #2c2c38;
             border-radius:12px; padding:12px; font-family:ui-monospace,Menlo,monospace; font-size:12px; }}
  .hint {{ color:#8a8a98; font-size:13px; margin:8px 0 0; line-height:1.5; }}
</style></head>
<body>
  <h1>Smooth Tink Tuner</h1>
  <p class="sub">This is the <b>real macOS Tink</b>, processed live. Drag a slider and it auto-plays.
  Start with <b>Smoothness</b> — that's the metallic-vs-mellow knob. When it sounds right, hit
  “Copy settings” and paste it back to me; I'll bake the exact file and wire it in.</p>

  <div class="card" id="card"></div>

  <div class="btns">
    <button onclick="play()">▶ Play</button>
    <button class="ghost" onclick="reset()">↺ Reset to original Tink</button>
  </div>

  <div class="export">
    <button onclick="copySettings()">📋 Copy settings for Claude</button>
    <textarea id="out" readonly></textarea>
    <p class="hint">Paste the box above back into chat.</p>
  </div>

<script>
const SR = {SR};
const B64 = "{b64}";

// Decode embedded Tink PCM (s16le mono) -> Float32Array
const bin = atob(B64);
const bytes = new Uint8Array(bin.length);
for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
const i16 = new Int16Array(bytes.buffer);
const pcm = new Float32Array(i16.length);
for (let i=0;i<i16.length;i++) pcm[i] = i16[i] / 32768;
const TOTAL = pcm.length / SR;

const DEFAULTS = {{ cutoff: 450, attack: 0.021, length: Math.min(0.56, TOTAL), volume: 1.0 }};
let s = {{...DEFAULTS}};

// label, key, min, max, step, format, sub-description
const SLIDERS = [
  ["Smoothness","cutoff",400,8000,50, v=> v>=7500?"original":v<=900?"very mellow":Math.round(v)+" Hz",
     "Left = soft & mellow, right = original metallic Tink"],
  ["Softness","attack",0,0.030,0.001, v=> v<=0.002?"sharp":v>=0.020?"very soft":Math.round(v*1000)+" ms",
     "Rounds the sharp start so there's no click"],
  ["Length","length",0.06,TOTAL,0.01, v=> Math.round(v*1000)+" ms",
     "Trims the tail — shorter = snappier"],
  ["Volume","volume",0.2,1.0,0.01, v=> Math.round(v*100)+"%", "Overall level"],
];

let ctx, buffer;
function getBuffer(){{
  if(!ctx) ctx = new (window.AudioContext||window.webkitAudioContext)();
  if(!buffer){{ buffer = ctx.createBuffer(1, pcm.length, SR); buffer.getChannelData(0).set(pcm); }}
  return buffer;
}}
function play(){{
  const b = getBuffer();
  const src = ctx.createBufferSource(); src.buffer = b;
  const lp = ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=s.cutoff; lp.Q.value=0.4;
  const g = ctx.createGain();
  const t0 = ctx.currentTime, len = s.length, atk = Math.min(s.attack, len*0.5);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(s.volume, t0+atk);
  g.gain.setValueAtTime(s.volume, t0+Math.max(atk, len-0.018));
  g.gain.linearRampToValueAtTime(0, t0+len);
  src.connect(lp); lp.connect(g); g.connect(ctx.destination);
  src.start(t0); src.stop(t0+len+0.02);
}}

function build(){{
  const c = document.getElementById("card"); c.innerHTML="";
  for(const [label,key,min,max,step,fmt,sub] of SLIDERS){{
    const row=document.createElement("div"); row.className="row";
    row.innerHTML=`<label>${{label}}</label>
      <input type="range" min="${{min}}" max="${{max}}" step="${{step}}" value="${{s[key]}}">
      <output>${{fmt(s[key])}}</output>
      <div class="desc2">${{sub}}</div>`;
    const inp=row.querySelector("input"), out=row.querySelector("output");
    inp.addEventListener("input", ()=>{{ s[key]=parseFloat(inp.value); out.textContent=fmt(s[key]); }});
    inp.addEventListener("change", play);
    c.appendChild(row);
  }}
}}
function reset(){{ s={{...DEFAULTS}}; build(); play(); }}
function copySettings(){{
  const txt = JSON.stringify({{source:"Tink", ...s}}, null, 2);
  document.getElementById("out").value = txt;
  navigator.clipboard?.writeText(txt);
}}
build();
</script></body></html>"""

with open(OUT, "w") as f:
    f.write(HTML)
print(f"wrote {OUT}  ({os.path.getsize(OUT)} bytes)")
