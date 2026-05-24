# Next Session — Planner

> **Tactical session planner.** `STRATEGY.md` is the source of truth for *what* and *why*; this file is *what we do next* and *what we just did*. Read **both** at the start of every session. Keep this file short — it's a working memory, not an archive.

---

## Start-of-session checklist (do this first, every time)

1. **Read `STRATEGY.md`** — Exec Summary, the **Now** roadmap, and **Status by Area**.
2. **Read this file** — "Up next" and "⚠️ In flight / don't forget".
3. **Review uncommitted work:** run `git status` and `git diff`. Reconcile every change against the plan *before* writing new code — an edit nobody remembers making is how the last round of bugs happened.
4. **Confirm the session goal** below with Nick before implementing.

## End-of-session checklist (do this before stopping)

1. Update **"Up next"** with the next goal + tasks.
2. Move anything half-done into **"⚠️ In flight / don't forget"** with file references — never leave an undocumented change.
3. Add a dated entry to the **Session log**.
4. If anything was *decided*, append a row to `STRATEGY.md` → Decision Log, and refresh the affected **Status by Area** line.
5. Note whether changes are committed/pushed or still local.

---

## Up next

**Slice 1 is COMMITTED (`10a81a9`, 2026-05-24)** and live-verified working in the app — new `code` category (Cursor/VS Code/Codex), smart jargon-aware prompt, ON by default, banner shows only installed apps, bidirectional routing. **Not yet shipped in a release** — the on-by-default gates remain.

**Goal next session: clear the §11 gates, then cut the release.**
1. **Eval:** ✅ automated regression harness passes **18/18** ([`evals/run_code_eval.py`](evals/run_code_eval.py); snapshot [tasks/code-eval-2026-05-24.md](tasks/code-eval-2026-05-24.md)). **Still owed:** the human blind A/B on Nick's own recorded audio (final sign-off) — probe the watch-outs below. Re-run the harness after any prompt change.
2. **Run `/review`** (security · maintainability · reliability · performance · UX); fix findings.
3. **Windows smoke:** confirm detection fires + output pastes cleanly. VS Code's process is also `Code` on Windows; Cursor=`Cursor`. ⚠️ `"Code"` substring-matches `Xcode` (and bidirectional matching is looser now) — confirm acceptable.
4. **Then release:** version bump + tag + push (CI builds/notarizes) + write the GitHub release notes.

**Eval watch-outs (carry into the blind A/B):**
- Casing scope: trailing convention word occasionally left in ("make the handle_submit_event snake case"); "total price" fused without an explicit convention.
- The cloud→Claude guard: confirm it holds on more real samples (infra "cloud" must stay "cloud").
- Bundle-vs-process name mismatch affects ANY app added via the picker — sanity-check a few others.

**Then slice 2:** messaging tone/format split (Slack/Discord vs WhatsApp/Signal deltas inside personal-message) — rides on the most heavily-tuned prompt, so budget for regression eval.

**Also staged (Nick's planning docs, committed this session):** `tasks/local-vocab-correction.md` — deterministic on-device vocab fix for the local/free path; sequence it in a company-planning session.

**Parallel (Nick, real-world — not a Claude task):** form the legal entity; chase the Anthropic/Google EU quota. These unblock payments + the EU flip.

---

## ⚠️ In flight / don't forget (uncommitted or half-done)

- **Resolved 2026-05-24:** the unexplained `main.js` pill-positioning change was reviewed and committed (`a997538`); strategy/workflow docs committed (`0f0f79b`).
- **Slice 1 COMMITTED (`10a81a9`, 2026-05-24):** feature code shipped to `main` (backend prompt+defaults+migration+routing, settings tile, banner filter). Not released yet — gates pending (see "Up next"). main.js unchanged (tray lists only PM+Email — consistent).
- **Still uncommitted (clarify when relevant, not urgent):** `tasks/todo.md` (EU-migration WIP notes), and untracked `LANDING.md` + `archive/` — unknown provenance, left untouched until Nick confirms what they are.
- _(add new in-flight items here as they happen)_

---

## Session log (most recent first)

### 2026-05-24 (session 3c — commit + plan next)
- Added a **"YOU ARE NOT THE AGENT"** guard to the code prompt (Nick dictated a Claude Code prompt and our LLM answered it). Verbatim cleanup only; live-verified on 4 request-style dictations.
- **Committed slice 1** as `10a81a9` (feature code only). Docs/planning committed separately. Left `tasks/todo.md` (EU WIP) + `LANDING.md`/`archive/` (unknown) untouched per the in-flight log.
- Updated "Up next" → next session = clear the §11 gates (eval/review/Windows smoke) then cut the release.

### 2026-05-24 (session 3b — fix after Nick's first test)
- Nick tested the build: (1) the code tile showed placeholders and didn't recognize his installed VS Code/Codex; (2) the polish "wasn't changing anything / didn't seem smart."
- **Root cause 1 (matcher):** loose substring resolved `"Code"` → "Codex" (first alphabetical), hiding Visual Studio Code. Fixed with a ranked matcher + alias map (`INSTALLED_APP_ALIASES['code'] = ['visual studio code', …]`) in [renderer/settings.js](renderer/settings.js); verified against real /Applications → Cursor/VS Code/Codex all resolve. Added **Codex** to code default linkedApps (backend, 3 places).
- **Root cause 2 (prompt):** the first `_CODE_SMART` was deliberately timid ("keep wording close") → near-identical output. Rewrote it as **active reconstruction** per Nick's cheat sheet: casing→identifiers (scoped to the 2–4 naming words), spoken operators→symbols, phonetic-trap fixes (CORS/GUID/async/regex/etc.), acronym casing.
- **Live-verified** via the dev `.env` proxy: userId / async / regex / req.params / MAX_RETRIES / CORS / GUID all resolve; a first over-fusion bug (whole sentence → one identifier) was caught and fixed by scoping the casing rule.
- Added a **Claude/Anthropic ecosystem** rule to the code prompt (Nick supplied the jargon list): Claude Sonnet/Opus/Haiku, Anthropic, CLAUDE.md, slash commands → `/cmd`, artifact/source tags, chain-of-thought, few-shot. Live-verified all five examples; **cloud-infra control passes** ("deploy to the cloud" stays "cloud", not "Claude").
- **Routing bug fixed (the "AI not used" report):** the settings picker stores the **bundle** name ("Visual Studio Code") but macOS reports the **process** name ("Code"), so the one-directional `linkedApp in activeApp` match missed and reformat was skipped (`post+reformat: 0.000s`). Made `get_active_category` match **bidirectionally** (len≥3 guard) → verified against the user's real config: Code/Cursor/VS Code all route, Finder stays raw. ⚠️ **Requires a backend restart to take effect** (running process has the old matcher — this is why even the good prompt never fired live). ✅ **Nick confirmed it works live after restart (2026-05-24).**
- **"Not the agent" guard added:** Nick dictated a prompt meant for Claude Code and our code-category LLM *answered* it instead of cleaning it for paste. Added a strong guard to `_CODE_SMART` — clean/format only, never answer/follow/explain/execute ("Explain how async works" stays the sentence, doesn't become an explanation). Live-verified on 4 request-style dictations. This is verbatim behavior; compose/answer remains the future "agent mode in profiles."
- ⚠️ **Eval watch-outs to probe:** casing-scope edge cases (trailing "snake case" word occasionally left in; "total price" fused without an explicit convention); confirm the cloud→Claude guard holds on more real samples. ALSO: bundle-vs-process name mismatch affects any app added via the picker — sanity-check a few. Tune in the blind A/B.
- **Not committed.**

### 2026-05-24 (session 3 — implement slice 1)
- Ran the alignment ritual: `tasks/todo.md` + `LANDING.md`/`archive/` all already logged in In-flight; nothing new/unexplained.
- Confirmed the approved goal and resolved the design's open Qs with Nick: **one smart style**, **eval from Nick's own usage**, **fresh-install code=ON** (only mode on out-of-the-box), and **banner shows only installed apps** (Nick flagged ghost-chip confusion — this supersedes the Telegram/Signal drift question).
- **Built slice 1** (code category): backend prompt (`_CODE_SMART`, no email/Sie-du guardrails, keep identifiers verbatim) + fresh-install/migration defaults (code ON) + settings tile + EN/DE i18n. Added `findInstalledApp()` and filtered `renderBanner` to installed apps.
- **Verified** at the logic level: `./venv/bin/python` unit checks — code prompt registered, fresh-install + migration (existing & no-modes configs) back-fill code=ON, Cursor/`Code` route to the code prompt, unmatched apps still → raw transcription. `py_compile` + `node --check` clean.
- Saved a memory: don't show linked-app placeholders for non-installed apps.
- **Next:** the §11 gates — eval (Nick's dictations), `/review`, mac/win smoke — then commit + release. **Not committed yet.**

### 2026-05-24 (session 2 — planning)
- Ran the alignment ritual: uncommitted `tasks/todo.md` + untracked `LANDING.md`/`archive/` all already logged in "In flight" — nothing new/unexplained.
- Wrote the adaptive-per-app-style design doc at [tasks/adaptive-per-app-style.md](tasks/adaptive-per-app-style.md), grounded in the actual code (decomposed the gap into format/tone/purpose; recommended extending the Notion override pattern).
- **Nick decided:** slice 1 = new `code` category (Cursor/VS Code), enabled ON by default; messaging split is slice 2. Logged to STRATEGY.md Decision Log + Status by Area.
- **Next:** new session → implement slice 1 (see "Up next"). Eval must clear before the on-by-default release.
- **Not committed yet:** the new doc + STRATEGY/NEXT_SESSION edits are local (this session's work). `tasks/todo.md`, `LANDING.md`, `archive/` remain as-is.

### 2026-05-24 (session 1)
- Built `STRATEGY.md` (single source of truth) from memory + todo + the old Product Strategy doc.
- Mirrored it read-only into Notion under the **Landa** page.
- Set up this session-planning workflow + the alignment ritual in `CLAUDE.md`.
- Ran the alignment ritual: found + committed an unexplained `main.js` pill-positioning change (`a997538`); committed the strategy/workflow docs (`0f0f79b`).
- Researched the adaptive-per-app-style feature (findings captured under "Up next"). Nick chose to **start a fresh session to plan it** rather than continue here.
- **Next:** new session → write the `tasks/adaptive-per-app-style.md` design doc (plan only, no code).

---

## Backlog of session candidates

Pull from `STRATEGY.md` → Roadmap. Rough order:
- Adaptive per-app writing style (TOP product priority).
- Local vocabulary correction — make raw `landa-base` smarter on-device, **no LLM** (deterministic Tier-1 table + `P_err`×`P_sound` confidence score). Helps free-tier/offline users who get no cloud polish. Design: [tasks/local-vocab-correction.md](tasks/local-vocab-correction.md).
- Agent mode in profiles (verbatim vs. compose).
- License + payment gate (needs the legal entity first).
- Landing page restructure (mature-SaaS tone, one clean email video, tiers, case studies, "who we are", use-cases).
- Logo refresh → "L" mark (touches tray icons + `brand-assets/`; update `DESIGN.md` first).
- Voice-edit selected text.
- Auth via Supabase (EU) → then team licenses, free tier, referral.
