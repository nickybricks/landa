# Recording Window: Notch & Movable — Feasibility Note

_Researched 2026-05-22. Environment: Electron 33, macOS 26 (Tahoe). No code changed._

## The two asks
1. Dock the recording pill to the MacBook notch.
2. Let the user pick the pill up and place it wherever they want (it currently only appears, fixed, on hotkey).

**Verdict: both are doable.** Notch docking has a "good enough, not pixel-perfect" caveat unless we add a small native helper. Movable is straightforward but trades away one deliberate behavior we'd need to design around.

---

## How it works today (the starting point)
- The pill is a frameless, transparent, always-on-top window that appears only while recording. Code: `createRecordingWindow` / `positionRecordingWindow` in [main.js:966](../main.js#L966).
- It auto-parks **bottom-center** of whichever screen the cursor is on, ~80px up ([main.js:1029-1031](../main.js#L1029-L1031)).
- Two intentional settings matter here:
  - `movable: false` ([main.js:975](../main.js#L975)) — can't be dragged.
  - `setIgnoreMouseEvents(true)` ([main.js:1006](../main.js#L1006)) — **all clicks pass through it** to the app you're dictating into. This is the "never gets in your way" guarantee.

---

## Ask 1 — Notch docking

### What's actually possible
You can't draw *inside* the notch (it's the physical camera cutout). What apps like NotchNook do is place a window flush against the **top-center**, visually merging with the black notch. We can do the same: park the pill at top-center, just below or flanking the notch.

### The catch: Electron doesn't tell us where the notch is
- Apple exposes the exact geometry via `NSScreen.safeAreaInsets` / `auxiliaryTopLeftArea` / `auxiliaryTopRightArea`, but **Electron does not surface these** — the feature request was closed "not planned" ([electron#31478](https://github.com/electron/electron/issues/31478)).
- There's **no maintained off-the-shelf npm module** for this on Electron; the `safe-area-insets` packages are React Native / mobile only.

So we have two implementation routes:

| Route | Accuracy | Effort | Notes |
|---|---|---|---|
| **A. Heuristic (no native code)** | Approximate | Low | Detect a notch by reading the top inset (`display.bounds` vs `display.workArea`): a notched Mac's menu bar is ~37–38px tall vs ~24px without. We know there's a notch and its rough height; we **don't** get the exact notch width. Park at top-center. Good enough for a centered pill. |
| **B. Tiny native add-on** | Exact | Medium | A ~30-line Objective-C/Node addon reading `safeAreaInsets`/`auxiliaryTopLeftArea`. Pixel-perfect, but adds a native build step to the macOS pipeline and is one more thing to maintain/notarize. |

**Recommendation:** Route A. For a small centered indicator, exact notch width buys us almost nothing, and we avoid a native dependency.

### Must-handle edge cases
- **No notch** (older MacBooks, Mac mini/Studio, any external monitor) → fall back to plain top-center.
- **Windows** → no notch concept; "notch" preset should map to top-center or be hidden on Windows.
- Multi-monitor: which screen? Today we follow the cursor; we'd keep that.

---

## Ask 2 — Movable, remembers its spot

### Possible — yes. The one real tradeoff
To drag a window the user has to be able to *click* it. That directly conflicts with `setIgnoreMouseEvents(true)`, the thing that lets clicks pass through to your document.

Two ways to resolve it:

| Approach | UX | Tradeoff |
|---|---|---|
| **Whole pill draggable** | Grab anywhere | Pill now eats clicks meant for the app underneath whenever the cursor is over it. Breaks the click-through promise. |
| **Small drag handle only** (recommended) | A little grip on the pill is draggable; rest stays click-through | Preserves click-through everywhere except the tiny handle. Slightly more UI work. Uses the `setIgnoreMouseEvents(true, { forward: true })` + per-element toggle pattern. |

### Mechanics
- macOS frameless drag normally uses CSS `-webkit-app-region: drag` on a handle element. **Known limitation:** this is glitchy on *transparent* always-on-top windows (black-flash / maximize bugs — electron#21102, #32502). Safer path: implement drag manually in the renderer (mousedown → track delta → `win.setPosition`) via an IPC channel, which sidesteps the transparent-window drag bugs.
- **Persistence:** save the chosen `{x, y}` (or a named preset) to config — same config the app already writes on first run. On show, `positionRecordingWindow` reads the saved spot instead of always computing bottom-center.

---

## Suggested shape (if we proceed)
One feature that satisfies both asks:
- A **position setting** with presets: `Bottom-center` (current default), `Notch / top-center`, and `Custom`.
- Pill gets a **small drag handle**; dragging switches the setting to `Custom` and saves `{x, y}`.
- Heuristic notch detection (Route A) with graceful fallback when there's no notch / on Windows.

## Decisions locked (2026-05-22)
1. **Position is global** — one spot, shared across all apps/displays.
2. **Windows: hide the notch preset entirely** (no top-center substitute).
3. **Notch alignment: pixel-perfect** → Route B, native macOS helper reading `safeAreaInsets` / `auxiliaryTopLeftArea`, NotchNook-style.
4. **Always-on pill is the new default for everyone.** The window stops being recording-only; it lives on screen at all times.
5. **Resting state is purely visual** — clicking does nothing; recording still starts via the hotkey only. No hover menu now (deferred).
6. **Keep an "Off" option** so users who find an always-on pill intrusive can hide it (preserves today's clutter-free experience as a choice).

## Implementation outline (for review before building)
**A. Always-on lifecycle** — decouple the window from the recording session.
- Create the pill on app launch (when style ≠ Off), keep it shown; don't destroy on recording end. `showRecordingWindow`/`hideRecordingWindow`/`destroyRecordingWindow` ([main.js:1034-1071](../main.js#L1034)) get repurposed into resting ↔ recording ↔ processing state messages to the renderer instead of show/hide.
- Settings: replace/extend the `recording_window_style` set (`classic`/`mini`/`none` — [main.js:99](../main.js#L99)) so the always-on pill is default and `none` = Off.

**B. Reposition (drag + persist)** — global position.
- Add a small drag handle in [renderer/recording.html](../renderer/recording.html); keep the rest click-through (`setIgnoreMouseEvents(true, { forward: true })` toggled per-element).
- Manual drag via IPC (mousedown → delta → `win.setPosition`), avoiding the transparent-window `-webkit-app-region` bugs (electron#21102/#32502).
- Persist `{x, y}` to config; `positionRecordingWindow` reads saved spot, falls back to bottom-center on first run.

**C. Notch dock (native, pixel-perfect)** — macOS only.
- Tiny Objective-C node add-on exposing `safeAreaInsets` + `auxiliaryTopLeftArea` for the active `NSScreen`.
- Add a "Dock to notch" preset that snaps the pill flush under the notch using exact geometry.
- Wire the native build into electron-builder + CI notarization (`scripts/build_backend.sh` / release workflow).
- Graceful fallback: no notch → preset unavailable/greyed; Windows → preset hidden.

### Cost flags
- Native add-on adds a compile + notarization step to the macOS pipeline (the main new maintenance cost).
- Always-on-by-default is a visible behavior change for existing users; mitigated by the Off option.

## Sources
- [electron#31478 — notch detection feature request (closed, not planned)](https://github.com/electron/electron/issues/31478)
- [Apple — auxiliaryTopLeftArea](https://developer.apple.com/documentation/AppKit/NSScreen/auxiliaryTopLeftArea-uglc) · [safeAreaInsets](https://developer.apple.com/documentation/appkit/nsscreen/safeareainsets)
- [Electron — Frameless Window (drag regions, click-through)](https://www.electronjs.org/docs/latest/api/frameless-window)
- [Electron — screen / Display API](https://www.electronjs.org/docs/latest/api/screen)
