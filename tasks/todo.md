# Landa — Production-Readiness Backlog

Source: [tasks/review-2026-05-02.md](tasks/review-2026-05-02.md)
Reviewed against: commit `b96d9b6`

---

## How to use this file

**Session start (30 seconds):**
1. Read this file — it's the only thing you need to orient.
2. Run `git log --oneline -10` to see what was done since last session.
3. Pick the next unchecked item from the current tier and implement it.

**When a fix is committed:**
1. Check the box here and add `Fixed: abc1234` after the item.
2. Find the relevant line in [review-2026-05-02.md](tasks/review-2026-05-02.md) by searching for the `file:line` reference and add `<!-- Fixed: abc1234 -->` inline.
   - You never need to re-read the full review file. Just search for the specific reference.

**When a fix makes another item moot:**
- Strike it through here: `~~Item text~~ (superseded by bearer token fix above)`

---

## Tier A — Safe to do first (isolated changes, cannot break other things)

Do these in any order within the tier. Each touches one spot and has no side effects.

- [x] **chmod 0600 on config and history files** (`landa_core.py:312-315`) — Fixed: pending commit
  - What breaks for users today: anyone on the same Mac or Windows PC can open `~/.landa/config.json` and read your OpenAI/Anthropic API keys and your full transcription history in plain text.

- [x] **sandbox: true on all four app windows** (`main.js:726, 766, 802, 910`) — Fixed: pending commit
  - What breaks for users today: if malicious code ever runs inside the app window, it has more access than it should. One-line fix per window.

- [ ] **Block window navigation** — add `setWindowOpenHandler` + `will-navigate` to all windows (`main.js`)
  - What breaks for users today: a malicious link could hijack the app window and drive it to an attacker site while keeping full access to your microphone and config.

- [ ] **Add CSP header to recording.html and update.html** (`renderer/recording.html`, `renderer/update.html`)
  - What breaks for users today: these two windows have no script injection protection (the other two windows already have it).

- [ ] **Escape user-controlled strings before injecting into HTML** (`renderer/settings.js:2014, 2098`)
  - What breaks for users today: a crafted app name or URL saved in your config could run code inside the app the next time settings opens.

- [ ] **Switch sips/plutil to execFile, no shell string** (`main.js:1237, 1263`)
  - What breaks for users today: an installed app with a weird name (containing `"` or backtick) could trigger unintended shell commands on macOS.

- [ ] **Refuse version downgrades in auto-updater** (`main.js:79`)
  - What breaks for users today: a tampered update metadata file could silently roll all users back to an older, more vulnerable version.

- [x] **Load tray icons once at startup instead of re-reading from disk every update** (`main.js:686-697`) — Fixed: pending commit
  - What breaks for users today: every second, the app reads the tray icon file from disk again. Not user-visible, but unnecessary work every second of uptime.

- [ ] **Fix preload.js audio-level listener accumulation** (`preload.js:90-92`)
  - What breaks for users today: if the recording window is recreated, audio level callbacks pile up — each tick calls the handler N times instead of once.

- [ ] **Fix temp PNG not deleted if icon loading fails** (`main.js:1240`)
  - What breaks for users today: temp files accumulate in /tmp when icon loading throws an error.

- [ ] **Fix accessibility prompt firing every launch** (`main.js:1199-1204`)
  - What breaks for users today: app asks for Accessibility permission on every launch, even if it's already granted.

- [x] **Strip stale "Swift app" comments** (`main.js:18`, `landa_core.py:5-6`, `renderer/settings.js:22`) — Fixed: pending commit
  - What breaks for users today: nothing. But any future engineer will waste time looking for a Swift codebase that no longer exists.

---

## Tier B — Logic changes (implement after all Tier A items are done)

Do these in order — some build on each other. Smoke-test the full flow (launch → hotkey → record → paste) after each one.

- [ ] **Atomic config and history writes** (`landa_core.py:312-315, 337-340`)
  - What breaks for users today: if the app crashes or is force-quit while saving (e.g. during a recording), `config.json` gets truncated. On next launch, all settings silently reset to factory defaults — hotkeys, vocabulary, modes, API keys, all gone.

- [ ] **Graceful backend shutdown — SIGTERM + wait + SIGKILL** (`main.js:1071-1077`)
  - What breaks for users today: quitting the app doesn't wait for the backend to finish writing. On Windows the backend is just killed instantly. Combines with the atomic-writes fix above.

- [ ] **before-quit handler: wait for in-flight transcription to finish** (`main.js:1763`)
  - What breaks for users today: quitting the app while a recording is being processed silently drops the transcription. The user gets nothing pasted.

- [ ] **Defer auto-update install if recording is active** (`main.js:130-131`)
  - What breaks for users today: the app can restart mid-dictation, dropping whatever was being transcribed.

- [ ] **Backend restart-on-crash with exponential backoff** (`main.js:1048-1069`)
  - What breaks for users today: if the backend crashes (rare, but happens with PyAudio or model-loading errors), the tray looks completely normal but every hotkey press silently fails forever until the user manually quits and relaunches.

- [ ] **Port-conflict check before spawning backend** (`main.js:1048`)
  - What breaks for users today: if a stale backend from a previous crash is still running, the new backend can't start and the whole app silently fails to function.

- [ ] **Force recording spinner to clear when backend dies mid-transcription** (`main.js:302-363`)
  - What breaks for users today: if the backend crashes right after you stop recording, the "processing" spinner spins forever. The only fix is to force-quit the app.

- [ ] **In-flight guard on audio level polling** (`main.js:949-958`)
  - What breaks for users today: if the backend stalls for any reason during recording, up to 60+ simultaneous HTTP requests pile up with no limit.

- [ ] **Shared http.Agent with keepAlive for all API requests** (`main.js:143-182`)
  - What breaks for users today: every status check and audio level poll opens a brand-new TCP connection. During a 30-second recording, that's 375+ connections. On slow machines this adds up.

- [ ] **In-flight guard on status polling** (`main.js:1149-1178`)
  - What breaks for users today: if `/status` hangs, the next poll fires before the previous one returns, causing racing UI state updates (recording indicator can flicker or show wrong state).

- [ ] **Register hotkey synchronously on startup** (`main.js:1734-1751`)
  - What breaks for users today: there's a ~2 second window after launching the app where the hotkey does nothing. Most users don't notice, but it's a real gap.

- [ ] **Cap history at 500 entries, keep in memory** (`landa_core.py:343-354`)
  - What breaks for users today: after months of use, the history file grows without limit. Every transcription requires re-reading and rewriting the entire file — gets slower over time.

- [ ] **Cache /history in memory, don't re-read from disk on every tab click** (`landa_core.py:2567-2569`)
  - What breaks for users today: every time you open the History tab, the full history file is read and parsed from disk. Gets slower as history grows.

- [ ] **Move installed-apps cache to main process** (`renderer/settings.js:467`)
  - What breaks for users today: every time you open Settings, it rescans all installed apps (80+ on most Macs), spiking CPU and causing a brief delay before the linked-apps popup is usable.

- [ ] **Prefetch pricing data at backend startup** (`landa_core.py:69-101`)
  - What breaks for users today: the first transcription after a pricing cache expiry (daily) adds up to 3 seconds of extra delay before the text is pasted.

- [ ] **Make transcription teardown thread non-daemon** (`landa_core.py:1247-1288`)
  - What breaks for users today: a transcription started a split-second before quitting is silently dropped. The paste never happens.

---

## Tier C — Cross-process changes (implement last)

These touch both Electron and Python simultaneously. Implement as a single commit per item. Test the full flow after each one.

- [ ] **Bearer token auth on all backend endpoints** (`landa_core.py:2594` + all `main.js` API calls)
  - What breaks for users today: any website you visit right now can silently turn on your microphone, read your API keys, overwrite your settings, or delete your history. This works because the backend accepts requests from anyone with no authentication.
  - Note: once this is merged, the pip-install endpoints finding (Security/Medium) is automatically closed too — mark it superseded.

- [ ] **Make backend the sole owner of config.json** (`main.js:1424-1433`)
  - What breaks for users today: Electron and the backend both write to `config.json` independently. Whichever finishes last wins. On slow machines, a save from Electron can overwrite a backend migration that ran at the same time.

---

## Tests — run in parallel with Tier A

Don't wait until all fixes are done. Set up the test harness now so each Tier B fix can be verified automatically.

- [ ] **pytest suite for backend** — `load_config` round-trip, `_migrate` with missing/unknown fields, `/status` + `/config GET`, atomic write (simulate kill mid-write, verify no data loss on reload)
- [ ] **Jest suite for main.js** — `hotkeyToAccelerator` edge cases, config default-fill
- [ ] **Playwright E2E** — app launches without crash, settings opens and config loads, change a setting + reopen + verify it persisted
- [ ] **Wire `npm test` into release.yml** — CI must pass tests before building the release artifact

---

## Deferred — real issues, lower priority

Don't schedule these until Tier A/B/C and tests are complete.

- Switch Flask dev server to `waitress` (cross-platform WSGI) — Reliability/Medium
- Split `main.js` (~1800 lines) into `lib/` modules — Maintainability/High — do after tests are in place so the refactor is verified
- Consolidate CSS design tokens into `renderer/tokens.css` — Maintainability/Medium
- Full UX/accessibility pass — separate sprint
- Bump Electron to latest 33.x patch or 38+ — Security/High (requires regression testing)
- Windows installer code signing (Authenticode) — Security/High (requires certificate purchase)

---

## Completed

*(Items move here when merged. Format: `- [x] Description — Fixed: \`commit-hash\` — YYYY-MM-DD`)*
