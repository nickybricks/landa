# Implementation Plan — Always-On, Movable, Notch-Dockable Pill

_Plan only. No code written yet. Companion to [recording-window-position-feasibility.md](recording-window-position-feasibility.md)._
_Environment: Electron 33, macOS 26. Targets macOS + Windows._

## What we're building (plain terms)
Today the pill only appears while recording, fixed at bottom-center, and ignores all clicks. We're turning it into a **calm pill that lives on screen all the time** (the new default), that the user can **drag anywhere** (one position, remembered) and **dock pixel-perfectly to the notch** on MacBooks that have one. At rest it's purely visual — clicking does nothing; the hotkey still starts recording. When you dictate, it animates *in place* into the recording state and back. An **Off** option stays available for anyone who doesn't want it.

## Locked decisions (from product)
- Position is **global** (one spot, all apps/displays).
- Windows: the notch option is **hidden** (no substitute).
- Notch alignment is **pixel-perfect** → native macOS helper.
- Always-on is the **new default for everyone**, exposed as a separate **"Always show" toggle (default ON)** — see third screenshot. Resting pill is **purely visual** (no click-to-start, no hover menu).
- **Resting look** = a calm solid dark pill, no active bars (screenshots 1 & 2); docks top-center under the notch (screenshot 2).
- Keep an **Off** escape hatch.

---

## Current code anchors (what we're changing)
- Window create/position/show/hide: `createRecordingWindow` / `positionRecordingWindow` / `showRecordingWindow` / `hideRecordingWindow` / `destroyRecordingWindow` — [main.js:966-1071](../main.js#L966-L1071).
- Recording start/stop drives show/hide today: `setRecordingState` — [main.js:399-418](../main.js#L399-L418).
- Style applied from config: [main.js:1325-1331](../main.js#L1325-L1331); default `'mini'`.
- Click-through + non-movable flags: [main.js:975](../main.js#L975), [main.js:1006](../main.js#L1006).
- Renderer pill markup: [renderer/recording.html](../renderer/recording.html); state handling: [renderer/recording.js](../renderer/recording.js); sizes/styles: [renderer/recording.css:78-79](../renderer/recording.css#L78-L79).
- Settings style picker (Classic / Mini / None): [renderer/settings.html:310-338](../renderer/settings.html#L310-L338); handler: [renderer/settings.js:872-889](../renderer/settings.js#L872-L889).
- Config persists via backend `/config` (`api.saveConfig`) — [main.js:230](../main.js#L230); applied in `applyConfig` — [main.js:1279](../main.js#L1279).

## Settings model (matches third screenshot)
Keep the existing **Style** picker — **Classic / Mini / None** — unchanged. Add a separate **"Always show" toggle (default ON)** below it, with a `?` help tooltip. Style sets the *look*; the toggle sets *when it's on screen*. This gives three states:
- **None** → no pill, ever.
- **Mini/Classic + Always show OFF** → pill appears only while recording (today's behavior preserved).
- **Mini/Classic + Always show ON** (default) → pill always on screen, resting ↔ recording in place.

Plus two controls under "Recording Window":
- **Dock to notch** (macOS + notched only; hidden otherwise).
- **Reset position** (re-center to bottom-center).

New config keys:
- `recording_window_always_show`: `boolean` — default **true**.
- `recording_window_position`: `{ x, y }` — global, persisted on drag/dock. Absent on first run → bottom-center.
- `recording_window_docked`: `boolean` — when true, re-snap to the notch on each show (notch geometry can change with display changes).

---

## Phase 1 — Always-on lifecycle
Decouple the window from the recording session; add a resting state, gated by the new toggle.

1. **Persist the window when "Always show" is ON.** Create the pill after config loads at startup (style ≠ None **and** `recording_window_always_show`); keep it shown in **resting** state. When the toggle is OFF, keep today's behavior: create/show on record, hide on stop.
2. **Repurpose state plumbing.** `setRecordingState(true/false)` ([main.js:406](../main.js#L406)/[main.js:411](../main.js#L411)) sends a `recording-active` message to the renderer. In always-show mode the window stays and the renderer switches resting ↔ recording; in on-demand mode it still show/hides.
3. **Resting visual = solid dark pill** (screenshots 1 & 2): no active bars, calm. Add the resting treatment in [renderer/recording.css](../renderer/recording.css) + a `recording-active` handler in [renderer/recording.js](../renderer/recording.js) (idle baseline halo already exists at [recording.js:52-57](../renderer/recording.js#L52-L57); resting = bars hidden/flat). Update `DESIGN.md` if new tokens are introduced.
4. **Off handling.** Style `none` → never create the pill. Style/toggle change in `applyConfig` ([main.js:1325](../main.js#L1325)) creates or destroys accordingly (mind the dock-icon/activation-policy note already in that block).

**Verify:** `npm start` with Always show ON → solid dark pill visible at rest on launch; hotkey → animates to recording → returns to resting on stop. Toggle OFF → pill only during recording. Set None → no pill. No dock-icon flicker on style/toggle switch.

## Phase 2 — Drag to reposition + remember (global)
4. **Drag handle.** Add a small grip element to [renderer/recording.html](../renderer/recording.html). Window stays click-through globally via `setIgnoreMouseEvents(true, { forward: true })`; handle toggles it: `mouseenter` → enable mouse events (IPC → main `setIgnoreMouseEvents(false)`), `mouseleave` → restore click-through. (Pattern from Electron Frameless docs.)
5. **Manual drag.** On handle `mousedown`, track pointer delta and call a new IPC `move-recording-window` → `recordingWindow.setPosition(x, y)`. Implement drag manually (not `-webkit-app-region: drag`) to avoid the transparent-window drag bugs (electron#21102 / #32502).
6. **Persist.** On `mouseup`, save `recording_window_position` to config. `positionRecordingWindow` ([main.js:1023](../main.js#L1023)) reads the saved position; falls back to bottom-center when absent. Dragging clears `recording_window_docked`.

**Verify:** drag the handle → pill moves; clicks *outside* the handle still pass through to the app underneath (type into a doc behind the pill); position survives app restart; multi-monitor sane.

## Phase 3 — Notch dock (native, pixel-perfect, macOS only)
7. **Native helper.** Small Objective-C node add-on (e.g. `native/notch/`) exposing the active `NSScreen`'s `safeAreaInsets` + `auxiliaryTopLeftArea` / `auxiliaryTopRightArea`. Returns `null` when there's no notch or off-macOS. Built with node-gyp + prebuildify (prebuilt arm64 binary checked in or built in CI).
8. **Dock action.** "Dock to notch" computes the target so the pill sits flush beneath the notch center using exact geometry; sets `recording_window_docked = true` and snaps. Re-snap on each show and on `display-metrics-changed`.
9. **Build pipeline.** Wire the native module into electron-builder (asar-unpack the binary) and the macOS CI build/notarization in the release workflow. Confirm the binary is signed/notarized.
10. **Platform gating.** Windows: don't build/load the addon; hide the notch control in settings (existing `get-platform` IPC at [main.js:1823](../main.js#L1823)). Non-notched Mac: control disabled/greyed.

**Verify:** on a notched MacBook, dock snaps flush and survives restart + display changes; on a non-notched Mac the control is disabled; on Windows it's absent; CI produces a notarized build with the native binary included; auto-updater artifacts still complete.

## Phase 4 — Settings UI + polish
11. Update the "Recording Window" section ([renderer/settings.html:310](../renderer/settings.html#L310)) to match the third screenshot: keep the Classic/Mini/None Style picker; add an **"Always show" toggle row (default ON)** with a `?` help tooltip, then **Dock to notch** + **Reset position** (gated by platform/notch). Wire in [renderer/settings.js:879](../renderer/settings.js#L879).
12. Copy + a11y pass on the new controls (tooltip text for "Always show").

**Verify:** all three layouts (mac notched / mac non-notched / Windows) show the right controls; Always show defaults ON and persists; Dock/Reset persist; matches `DESIGN.md` tokens.

---

## Risks / cost (named, not hidden)
- **Native add-on** is the main new maintenance + build cost (compile + notarization on the macOS release). Only way to hit pixel-perfect.
- **Always-on by default** changes behavior for existing users — mitigated by the Off option; worth a line in release notes.
- **Click-through + drag handle** is the fiddliest UX detail (toggling `setIgnoreMouseEvents` cleanly so the rest stays pass-through). Test against a real editor behind the pill.
- Transparent always-on-top + `setVisibleOnAllWorkspaces` already has a known dock-icon/activation-policy quirk ([main.js:996-1004](../main.js#L996-L1004)) — keep the existing reassert logic intact when the window now lives permanently.

## Suggested sequencing
Phase 1 → 2 are self-contained and shippable on both platforms without native code. Phase 3 (notch) is the heaviest and macOS-only; it can land in a follow-up release if we want value sooner. Recommend shipping 1+2 first, then 3.

## Resolved (from screenshots)
- Resting visual = solid dark pill, no bars (screenshots 1 & 2).
- "Always show" is its own toggle (default ON), separate from the Style picker (screenshot 3); Mini/Classic stay as look-only.
- Notch dock = pill flush top-center under the notch (screenshot 2).
