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

### ✅ DONE (parallel auth session): Authentication foundation — Supabase (EU) magic-link + entitlement
Built + **verified live** on branch **`auth-supabase`** (worktree; 3 commits `5db4f7a`/`d4c70fc`/`0e0d916`,
**unmerged, not pushed**). Supabase project `landa` (EU/Frankfurt) + `profiles`/`usage` schema (RLS
read-only), magic-link sign-in via `landa://` deep link (PKCE), encrypted session, hard sign-in gate,
Account panel (plan/usage/sign-out + **payment seam stubbed**). Brevo (EU) SMTP wired for auth email.
Full spec + the exact STRATEGY/NEXT_SESSION rows are in [tasks/auth-supabase.md](tasks/auth-supabase.md).
**Auth-step status (updated 2026-05-24, session 4):**
1. **Proxy enforcement — proxy side DEPLOYED + VERIFIED LIVE (8/8).** `landa-proxy`: `lib/entitlement.ts`
   (Supabase ES256-JWT verify via JWKS, weekly meter read, atomic `increment_usage` RPC) wired into
   `api/reformat.ts`; migration `0002` applied to the live DB; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   set on Vercel Production; deployed + aliased. 🔒 Enforced **only when `x-landa-user-jwt` is present**
   (no-JWT→unchanged, verified against prod). Harness `scripts/test-enforcement.mts` 8/8.
   **Committed + pushed:** proxy `6ff3222` (github.com/nickybricks/landa-proxy), migration `a399a31` (auth-supabase).
   **Next = app-side "C":** token plumbing main→backend→proxy (`x-landa-user-jwt`) + 402→raw-fallback+nudge.
   Plan: [tasks/proxy-enforcement.md](tasks/proxy-enforcement.md).
2. **Authenticate `landavoice.com` in Brevo** — **runbook READY** at
   [tasks/brevo-domain-auth.md](tasks/brevo-domain-auth.md). Nick executes (Brevo dashboard → copy DKIM +
   brevo-code; IONOS DNS → add DKIM/DMARC, merge SPF; click Verify). I confirm propagation via `dig`.
3. **Integrate the branch** — merge `auth-supabase` → `main` (after the profile session's uncommitted
   edits land, to reconcile the shared STRATEGY/NEXT_SESSION rows). Also fold migration `0002` (currently
   in the auth-supabase **worktree**) into the branch at integration.

### ✅ DONE: everyday-profile polish + agent mode reviewed & committed
Email + PM polish **and agent mode** were judged (LLM-as-judge, 53/55 clean), the corpus was
expanded to **59 cases** with **4 adversarial misfire traps → detection passed 4/4**, and the
work was **committed**. Snapshot: [tasks/profile-eval-2026-05-24.md](tasks/profile-eval-2026-05-24.md);
re-run live (~2 min): `set -a && . ./.env && set +a && ./backend/venv/bin/python evals/run_profile_samples.py`.
**⚠️ Carry-forward — agent mode is unreleased and unannounced:** before any release that ships
it, update **onboarding + landing + changelog** (it changes what dictation does — CLAUDE.md §5).
**Residuals (not blockers):** intermittent "loop in X → future communications" widening (1/59);
slightly prim German-excited register; compose path adds mild courtesy filler — candidates for a
future tightening pass, not required now.

### Where things stand
The **profile-depth roadmap item is done** (Email/PM polish + agent mode + Notes eval + auto-register).
A lot is now **built but unreleased**, and it stacks:
- **Slice 1** — code category (committed `10a81a9`)
- **Agent mode** — Email + PM compose-from-instruction (committed `102ab94`)
- **Auto-register** — the "Automatic" style (3h, committed `b4da6b6`)
- **Profiles UI redesign** — tone selector + apps banner (3h, committed `ec89261`)

No release has shipped any of it yet.

### Strongest next focus — converge on a release
1. **Blind A/B evals (Nick):** (a) **code category** on real Cursor/VS Code dictations (slice-1 gate; watch-outs below); (b) **auto-register** on real email/Slack/WhatsApp dictations — especially **whether the work/personal nudge is strong enough** (it's subtle: identical neutral input gave identical output across buckets).
2. **Release surfaces (CLAUDE.md §5):** onboarding + landing + changelog must reflect **agent mode + the Automatic style + the code category** before they ship.
3. **Windows smoke:** code-category detection + the new **Teams/Telegram/Signal** routing fire and paste cleanly.
4. **Cut it:** version bump + tag + push (CI notarizes) + write the GitHub release notes.

### Alternatives (if not the release)
- **Deeper Profiles UX rethink** — 3h was a first cut (tone selector + banner); the "distinctly Landa" mental-model redesign is still open.
- **Robustness & security** — hardening backlog: config write-race, crash-restart loop, localhost backend auth (last pairs with payments).
- **Smarter offline transcription** — deterministic local vocab fix ([tasks/local-vocab-correction.md](tasks/local-vocab-correction.md)) for the free/local path.

### Slice 1 — committed, not yet released
**Slice 1 is COMMITTED (`10a81a9`, 2026-05-24)** and live-verified working in the app — new `code` category (Cursor/VS Code/Codex), smart jargon-aware prompt, ON by default, banner shows only installed apps, bidirectional routing. **Not yet shipped in a release** — the on-by-default gates remain (below). These can run whenever; they don't block picking a new focus above.

**Goal next session: clear the §11 gates, then cut the release.**
1. **Eval:** ✅ automated regression harness passes **18/18** ([`evals/run_code_eval.py`](evals/run_code_eval.py); snapshot [tasks/code-eval-2026-05-24.md](tasks/code-eval-2026-05-24.md)). **Still owed:** the human blind A/B on Nick's own recorded audio (final sign-off) — probe the watch-outs below. Re-run the harness after any prompt change.
2. **`/review` — DONE** ([tasks/review-2026-05-24.md](tasks/review-2026-05-24.md)). Slice-1-relevant fix shipped: XSS escaping of app names/URLs (`0c6892a`). Everything else is **pre-existing** → captured as the **hardening backlog** in STRATEGY.md → Engineering status (not slice-1 blockers; prioritize separately, several pair with payments/EU). One slice-1 follow-up: the category taxonomy is now defined twice — fix via a backend `/modes/schema` before adding the next category.
3. **Windows smoke:** confirm detection fires + output pastes cleanly. VS Code's process is also `Code` on Windows; Cursor=`Cursor`. ⚠️ `"Code"` substring-matches `Xcode` (and bidirectional matching is looser now) — confirm acceptable.
4. **Then release:** version bump + tag + push (CI builds/notarizes) + write the GitHub release notes.

**Eval watch-outs (carry into the blind A/B):**
- Casing scope: trailing convention word occasionally left in ("make the handle_submit_event snake case"); "total price" fused without an explicit convention.
- The cloud→Claude guard: confirm it holds on more real samples (infra "cloud" must stay "cloud").
- Bundle-vs-process name mismatch affects ANY app added via the picker — sanity-check a few others.

**Slice 2 — DONE (reshaped), uncommitted:** became automatic register detection rather than a manual tone bucket (see session 3h log + [tasks/auto-register-style.md](tasks/auto-register-style.md)).

**Also staged (Nick's planning docs, committed this session):** `tasks/local-vocab-correction.md` — deterministic on-device vocab fix for the local/free path; sequence it in a company-planning session.

**Parallel (Nick, real-world — not a Claude task):** form the legal entity; chase the Anthropic/Google EU quota. These unblock payments + the EU flip.

---

## ⚠️ In flight / don't forget (uncommitted or half-done)

- **Resolved 2026-05-24:** the unexplained `main.js` pill-positioning change was reviewed and committed (`a997538`); strategy/workflow docs committed (`0f0f79b`).
- **Slice 1 COMMITTED (`10a81a9`, 2026-05-24):** feature code shipped to `main` (backend prompt+defaults+migration+routing, settings tile, banner filter). Not released yet — gates pending (see "Up next"). main.js unchanged (tray lists only PM+Email — consistent).
- **Everyday-profile polish + AGENT MODE — COMMITTED (`102ab94`, 2026-05-24, session 3f).** `backend/landa_core.py` (PM style prompts, `_EMAIL_GUARDRAILS`, emoji branch, `_EMAIL_AGENT`/`_PM_AGENT` blocks in `get_mode_prompt`) + `evals/run_profile_samples.py` + `evals/everyday_profiles.json` (now **59 cases**, incl. 4 adversarial traps) + `tasks/profile-polish-email-pm.md` + `tasks/profile-eval-2026-05-24.md` + `tasks/profile-eval-results-2026-05-24.md`. Reviewed (LLM-as-judge 53/55) + adversarial probe 4/4. **⚠️ Still owed:** agent mode is unreleased/unannounced — onboarding/landing/changelog before the release that ships it.
- **Notes eval + preview-card polish — COMMITTED (session 3g, 2026-05-24).** Three commits on `main`, **not pushed**: `1ce01b9` (Notes eval 14/14 + preview cards), `db6dcf5` (descope sync — auto-language double-pass → WON'T FIX, incl. Nick's `tasks/review-2026-05-24.md` edit), `f2967f1` (Nick's German `du` refinements to the email previews). **Notes prompt itself UNCHANGED** (eval'd clean; corpus now 73). ⚠️ **Still owed:** Nick to eyeball the preview cards in-app after a Landa restart (a stale instance held the single-instance lock at commit time — low risk, copy-only).
- **Auto-register style (reshaped slice 2) — BUILT + COMMITTED `b4da6b6` (session 3h, not pushed).** Files: `backend/landa_core.py` (`auto` prompts for PM+email, `_pm_app_bucket()`, app nudge in `get_mode_prompt`, `auto` greeting/sign-off variants, fresh-install default `auto`, conservative migration, app-list alignment + Teams enrichment), `renderer/settings.js` ("Automatic" style + EN/DE labels/previews + Teams icon), `evals/run_profile_samples.py` (`_pm_app_bucket` stub) + `evals/everyday_profiles.json` (now **83 cases**, 10 auto), `tasks/auto-register-style.md` (plan + eval results). Live eval **10/10, 0 guardrail failures**; manual styles unchanged (no-regression proven). **⚠️ Still owed:** (1) Nick eyeballs the new "Automatic" card in-app after a Landa restart; (2) Nick's blind A/B on real dictations — **probe whether the work/personal app nudge is strong enough** (it's subtle: identical neutral input gave identical output across buckets); (3) agent mode + Automatic are unreleased → onboarding/landing/changelog before the release that ships them.
- **Profiles tone UI redesign — BUILT + COMMITTED `ec89261` (session 3h, not pushed).** Adding the 4th tone card squeezed the layout + looked like Wispr. Replaced the card wall with a compact segmented tone selector + one full-width preview (`renderStyleCards`/`selectStyle` in `renderer/settings.js`; `.modes-tone*` in `renderer/settings.css`; `modes.tone.label` i18n EN/DE). Fixed an off-brand blue selection glow → brand red. Also refined the **apps banner** ("This profile applies to:" → **"Active in"**, app icons squared, card height reduced, blue hover → red). **⚠️ Owed:** Nick reloads the app and eyeballs the new Profiles layout (all four categories). First cut at the roadmap's "rethink Profiles UX"; the deeper mental-model rethink is still open.
- **Proxy enforcement (proxy side) — DEPLOYED + VERIFIED LIVE (8/8), COMMITTED + PUSHED `6ff3222` (session 4, 2026-05-24).** `lib/entitlement.ts` + `scripts/test-enforcement.mts`; `api/reformat.ts` (metering pre-check + increment), `.env.example` (+Supabase env), `package.json` (+`jose`) in `~/Developer/landa-proxy` (github.com/nickybricks/landa-proxy). 🔒 Enforced only when `x-landa-user-jwt` present (live app sends none → unchanged, proven against prod). Decisions: free = 2,000 *polished* words/week, weekly reset, dictated-input metering, soft cap, 402→raw-fallback. Vercel Production has `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (added this session). **Next:** app-side "C".
- **Migration `0002_usage_increment.sql` — APPLIED to the live DB** (ref `lvxucmpfxdgozetqytto`; RPC confirmed present) and **COMMITTED + PUSHED `a399a31`** on `auth-supabase`.
- **New task docs on `main`, UNCOMMITTED:** `tasks/brevo-domain-auth.md` (runbook) + `tasks/proxy-enforcement.md` (plan). Nothing committed this session.
- **Still uncommitted (clarify when relevant, not urgent):** `tasks/todo.md` (EU-migration WIP notes), and untracked `LANDING.md` + `archive/` — unknown provenance, left untouched until Nick confirms what they are.
- **Packaging fix — COMMITTED + PUSHED on `auth-supabase` (`f16f49e`, session 4).** The electron-builder `files` allowlist omitted `auth.js`, so the packaged app crashed on launch (`Cannot find module './auth'`) — dev-from-source never hit it; **would have shipped a broken first auth release.** Caught by packaging the branch (`npm run build:mac`) to test sign-in. Added `auth.js` to `files`; verified present in the asar; reinstalled + relaunched clean. **A local test `.dmg`/`.app` exists in the worktree's `dist/` (gitignored, not a release).**
- **Auth gate hardened — COMMITTED + PUSHED on `auth-supabase` (`3b648f0`, session 4).** Nick found that a signed-out user could still reach Settings (tray icon, tray menu, dock/activate) behind the auth window — recording was gated but the window wasn't, and `npm start` auto-opened Settings via the `activate` handler. **Decided: fully inert until signed in.** Fix = one guard in `openSettings()` ([main.js](main.js)): signed-out → route to the auth window (every Settings entry point funnels through it). **✅ VERIFIED on the packaged build (2026-05-24):** signed-out shows only the sign-in window; magic-link sign-in completes end-to-end (no stray Electron). The whole auth round-trip — the last unverified piece of the foundation — is now proven on a packaged macOS build.
- **Auth foundation on branch `auth-supabase` — COMMITTED, UNMERGED** (now also pushed; 3 commits;
  `auth.js`, `renderer/auth.*`, `supabase/`, `main.js`/`preload.js`, settings Account section,
  `+@supabase/supabase-js`+`ws`). Verified live. **Pre-launch owed:** authenticate `landavoice.com`
  in Brevo (spam); proxy-side JWT verify + server metering + free-tier enforcement (`landa-proxy`).
  These STRATEGY/NEXT_SESSION edits were made **on the branch** (not main) to avoid clobbering the
  parallel profile session — they reconcile at merge. Full detail: [tasks/auth-supabase.md](tasks/auth-supabase.md).
- **Brand re-skin (app + landing) — IMPLEMENTED, UNCOMMITTED (session 5, 2026-05-24).** The decided monochrome deep-red + Cloud Dancer system is now live in code, replacing the old `#0088ff` blue DS. Files: `renderer/settings.css` (+`.html`/`.js`), `renderer/recording.css`, `renderer/onboarding.css`, `renderer/auth.css`, `renderer/update.css`, `website/style.css` + `website/index.html`, `DESIGN.md`. Tokens→deep-red brand/light-grey surfaces/varied radii(app)/dark mode/semantic `--error`/`--success`/`--warning`; liquid glass dropped (home cards + glow line + sky photo) **except the resting pill keeps its blur** (Nick); recording rainbow ring→deep-red; **all UI emoji→Lucide inline line-icons** (platform glyphs ⌘⌥⏎⌫✓ kept). Verified: JS `node --check` clean, CSS braces balanced, zero old-brand literals/UI-emoji project-wide. **⚠️ Owed:** Nick eyeballs the app + site (code-verified only — GUI couldn't render here). **Open/flagged:** landing kept pill-radius CTAs (app went 4px); 5 per-app colored section radials left colorful; self-hosted fonts + "L" logo still out of scope. **Surface refinement (Nick):** the warm beige (`--bg #f0eee9`) read "dark beige" in the live app → lightened to **light neutral grey** (`--bg #f5f5f6`, cards `#ffffff`, sidebar `#ededee`) across app + site + DESIGN.md, picked via a new **`design-system.html`** token playground (untracked, kept in repo as a brand tool; served at `localhost:8765`). Brand colours + dark mode unchanged. **Radii (Nick):** reverted the re-skin's flat 4px back to the **original varied per-element radii** (cards 16px, controls 8px, sidebar 12px, + per-item exceptions) across settings/onboarding/auth/update — different roundings per element are intentional, NOT a single global knob; DESIGN.md radius section updated. **Wordmark:** added "Landa" top-left — sidebar on macOS (below traffic lights), titlebar on Windows. **Layout/polish pass (same session, all uncommitted):** (a) `--content-top: 50px` spacing token → 50px before the first title/item on every tab (History/Vocab/Settings headers + both Profiles columns); Home left as-is; (b) **Settings tab now has a title header** ("Settings"/"Einstellungen", `settings.title` i18n) matching History/Vocab; (c) **Home logo swapped** to the new L-mark asset (`assets/Landa-Logo-2026-new-iOS-Default-1024x1024@1x.png`); (d) macOS **sidebar island got a hairline border** (`var(--border)`) + **reduced/left-biased shadow**; (e) **Profiles categories rebuilt as a "drawer"** that tucks behind the sidebar island (macOS only, via `:has()` + z-index + negative margin; right corners rounded, widened to 264px, left-padding clears the island, light right shadow). **Future (logged to STRATEGY roadmap):** dedicated user Profile/account menu + avatar; collapsible category drawer + its own border; Home stats-prominence rearrange. All still uncommitted; Nick to eyeball after restart, then commit the whole design pass.
- **Streaming transcription = new primary-path direction (2026-05-25, research/decision session).** Decided: cloud streaming ASR is back IN as the primary path (wedge is EU-hosted+zero-retention, not on-device); local `landa-base` becomes the offline fallback shown in the UI; **no** large local polish model (download/RAM cost). Triggered by a teardown of a real Wispr Flow client log (audio streamed to Baseten *during* recording → 45.9s clip transcribes in 441ms; fused ASR→format; context prefetched during recording). Logged to STRATEGY Decision Log (3 rows, 2026-05-25) + Status (Product/Engineering/Compliance) + roadmap (flipped the "streaming OUT" line). New plan doc: [tasks/streaming-asr-latency-plan.md](tasks/streaming-asr-latency-plan.md). **🔴 Now the #1, EXISTENTIAL priority** (Nick: "if not on the others' level, no point shipping at all"). **Sequencing DECIDED:** ship streaming on an interim (non-EU OK) backend NOW, fronted by **Landa's own thin streaming gateway** so the EU flip is later just an endpoint/provider config swap (no client change). ❌ never wire the client to a vendor SDK directly. **v1 is unblocked** — does NOT wait on the entity/vendor track. **Next build steps:** stand up the gateway + a streaming ASR+format provider, stream audio during recording, warm-at-hotkey, context prefetch; build offline fallback (bundled `landa-base` + deterministic vocab correction, `tasks/local-vocab-correction.md`) + offline UI badge alongside. **Docs-only this session — no code changed.** ⚠️ Ripple when shipped: onboarding/landing/changelog describe on-device transcription today; keep EU marketing off + no EU customers until the EU flip.
- _(add new in-flight items here as they happen)_

---

## Session log (most recent first)

### 2026-05-25 (research — transcription speed: how Wispr Flow / Willow Voice do it)
- Question from Nick: how to get the best + fastest transcription, given the cloud LLM polish costs time + money per call. Researched competitor approaches (cloud-LLM vs on-device vs deterministic; streaming; Parakeet/CoreML; small local LLMs; hybrid routing).
- Nick supplied a **real Wispr Flow client log**. Teardown findings: they **stream audio to Baseten (gRPC) during recording** (45.9s clip → 441ms server ASR; ASR time ~constant vs length), run **ASR+format as one fused GPU step** (format 37–259ms, a small fine-tuned model), **prefetch context during recording** (`/llm/extract_asr_words` proper nouns, macOS AX scrape, app-type classification, server-side personalization styles), and **warm the connection at hotkey-down**. Even `privacy_mode` streams audio out → Wispr does nothing offline.
- **Decisions (Nick):** streaming cloud transcription is the **primary path** (wedge = EU-hosted + zero-retention, not on-device); local = **offline fallback**, shown in UI; **no large local polish model** (download/RAM). Logged to STRATEGY (Decision Log 2026-05-25 ×3, Status, roadmap) + this file's In-flight. Wrote [tasks/streaming-asr-latency-plan.md](tasks/streaming-asr-latency-plan.md) (explicit teardown + target architecture + component/phasing plan).
- **Consequence flagged:** streaming = audio leaves device → "EU-hosted, zero-retention" must cover audio; needs a persistent EU ASR+format service (not Vercel) → leans harder on the gated entity/vendor track. **Docs-only; no code changed.** ⚠️ Wispr logs should NOT live in the repo (per STRATEGY open question) — referenced findings only, nothing committed.

### 2026-05-24 (session 5 — brand re-skin: implement the decided design across app + landing)
- Goal (Nick): "focus on the design of the app first, then the landing page." Alignment ritual clean (known `tasks/todo.md` EU-WIP + untracked `LANDING.md`/`archive/`; STRATEGY.md had gained the parallel session-4 free-tier/enforcement rows — surfaced, left intact).
- **The gap:** the 2026-05-24 brand decisions (deep-red/Cloud Dancer, 4px, no glass, line-icons) were fully specced in DESIGN.md but **never implemented** — code still shipped the old `#0088ff` blue DS. Scoped with Nick to **core re-skin**; Nick added two directives mid-flight: keep the resting-pill blur; emoji must go.
- **App (5 windows):** rewrote `:root` tokens + dark overrides in settings/recording/onboarding/auth/update; added semantic `--error`/`--success`/`--warning` (error = distinct orange-red so danger≠brand); swept the hardcoded blue/orange/cool-grey literals + rgba glow tints to tokens (sed for bulk, Edit for judgment cases); killed the 3 home-card glass + removed the home sky photo & white glow line; recording orb rainbow→rotating deep-red; **all UI emoji→Lucide inline SVGs**, platform glyphs kept.
- **Landing (`website/`):** same token swap + dark mode, blue glow system→red, rainbow→red, warmed cool-grey surfaces, fixed the footer-wordmark gradient (sed had injected invalid `var()` into an SVG attr → literal brand hexes), 📎→paperclip line-icon, lang-dot kept green via `--success`.
- **DESIGN.md:** corrected the resting-pill row (keeps blur), added the no-glass exception, added the semantic-color table.
- Verified: `node --check` all JS, CSS brace balance, zero old-brand/UI-emoji project-wide. `npm start` exited 0 (sandbox can't render a GUI → not a visual confirmation). **All uncommitted. Visual QA owed to Nick.** Open decisions flagged: landing pill-radius vs 4px; the per-app colored radials; fonts + "L" logo (out of scope).

### 2026-05-24 (session 4 — Brevo runbook + proxy-side enforcement)
- Alignment ritual clean: only the known `tasks/todo.md` (EU WIP) + untracked `LANDING.md`/`archive/` uncommitted, matching the in-flight log.
- Two tasks, scoped to **A + B** (Nick's call), C deferred.
- **A — Brevo/`landavoice.com`:** can't execute (DNS = IONOS, no access; DKIM/brevo-code = Nick's Brevo account). Diagnosed via `dig`: SPF Google-only, no DKIM, no DMARC → mail fails auth → spam. Wrote an exact IONOS+Brevo runbook ([tasks/brevo-domain-auth.md](tasks/brevo-domain-auth.md)): add brevo-code + DKIM TXT, **merge** Brevo into the one SPF record, add DMARC `p=none`. I verify propagation after.
- **B — proxy enforcement (proxy side):** surfaced the gap the auth doc missed — the proxy `reformat` call is made by the **Python backend**, but the JWT lives in **Electron main** (`auth.js`, branch); main doesn't pass it down. So "C" is real token plumbing, deferred. Built the proxy side: `lib/entitlement.ts` (Supabase **ES256 JWT via JWKS** — confirmed the live project uses asymmetric keys — weekly meter read, atomic `increment_usage` RPC), wired ~minimal lines into `api/reformat.ts`, migration `0002` (worktree), `.env.example`/`package.json`, and a live harness. 🔒 **Production-safe:** enforced only when `x-landa-user-jwt` is present (live app sends none → behaves as today). Typecheck + 8 unit checks pass. **Uncommitted in `~/Developer/landa-proxy`; not deployed.**
- **Decisions** (logged to STRATEGY): free = 2,000 *polished* words/week (raw transcription unlimited), **weekly** reset, dictated-input metering, soft cap, 402→raw-fallback+nudge. Resolved the free-tier-cadence open question.
- **Then DEPLOYED + VERIFIED live (Nick gave the service-role key, approved deploy):** first harness run showed old code live (4/4 new-code gates failed) → migration `0002` was already applied (RPC returned 409 not 404), but the **proxy code wasn't deployed and `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` weren't actually set on Vercel** (Nick had handed me the key, not added it). Added both env vars to Production, redeployed → **harness 8/8 against prod**: no-JWT→200 unmetered (production-safe, proven), valid→200+exact word increment, over-limit→402 `free_limit_reached`, bad JWT→401.
- **Committed + pushed:** proxy `6ff3222` (github.com/nickybricks/landa-proxy); migration `a399a31` (auth-supabase).
- **Then validated the auth foundation on a PACKAGED build** (Nick asked; dev `npm start` can't test the `landa://` deep link). En route found Nick's original complaint was two things: (1) a **gate hole** — signed-out users could open Settings via tray/dock → fixed `3b648f0` (decided **fully inert**: `openSettings()` routes signed-out → sign-in window); (2) the **"second Electron / welcome screen"** = dev-only — unpackaged builds register `landa://` to the generic Electron binary, so the magic link launches a bare Electron, not the app. Built `npm run build:mac` → first packaged launch **crashed** `Cannot find module './auth'`: electron-builder's `files` omitted `auth.js` → fixed `f16f49e` (would have shipped broken). Rebuilt, reinstalled. **✅ Nick confirmed "all worked":** packaged sign-in + gate verified end-to-end. (macOS keychain "Safe Storage" prompt on first packaged launch is expected — cross-binary ACL, not a prod issue.)
- **Owed next:** app-side "C" (token plumbing main→backend→proxy + 402 handling). Brevo: Nick executes the runbook.

### 2026-05-24 (session 3h — slice 2, reshaped into automatic register detection)
- Alignment ritual clean: only the known `tasks/todo.md` (EU WIP) + untracked `LANDING.md`/`archive/` uncommitted; 4 local commits ahead of origin (unpushed), all as logged.
- Started on slice 2 (work/personal tone split). **Nick redirected mid-planning:** the *manual* formal/casual/excited switch is the real friction — "I don't want to keep switching modes." Pivoted to **automatic register detection**: the LLM auto-picks formal↔casual per dictation; the destination chat app (work vs personal) feeds it. This **subsumes** the original slice-2 split into one mechanism. Decisions: Auto = new **default** style (manual stays); Auto **never** chooses excited (manual-only — the sharpest misfire); conservative migration (keep explicit selections); align app lists (+Teams/Telegram/Signal).
- **Built it** (net-new `auto` sibling prompt → can't regress the tuned prompts): `backend/landa_core.py` + `renderer/settings.js` ("Automatic"/"Automatisch") + eval sampler/corpus (83 cases). 
- **Verified:** py_compile + node --check clean; logic checks incl. **no-regression proof** (manual prompts byte-identical); live sampler **10/10, 0 guardrail failures**. German formal-vs-casual + greeting/sign-off correct both ways; celebratory **misfire traps held** (no auto-excited); **Sie/du never flipped** (incl. a workplace chat staying Sie).
- **⚠️ Honest finding:** the work/personal app nudge is *subtle* — identical neutral input gave identical output across buckets. The content-driven register is the strong signal; the app context only nudges borderline cases. Flagged for Nick's blind A/B.
- **Then two UI redesigns (Nick saw the running app):**
  - **Profiles tone UI** — the 4th tone card ("Automatic") squeezed Email/PM into a horizontal scroll, and the card wall was the main "looks like Wispr" tell. Replaced it with a **compact segmented tone selector + one full-width preview** (toggles inside it); Notes/Code show just the preview. Reused the native Recording-Window segmented pattern. Rewrote `renderStyleCards`/`selectStyle` in `renderer/settings.js`; `.modes-tone*` in `renderer/settings.css`; `modes.tone.label` i18n EN/DE. Nick picked this from 3 mocked options.
  - **Apps banner** — relabeled "This profile applies to:" → **"Active in"** (EN) / "Aktiv in" (DE), **squared** the app icons (were round/social), removed the overlap, shrank the card height, bumped icons to 32px on Nick's note. (`.modes-banner*` in `renderer/settings.css` + banner i18n.)
  - Fixed an off-brand **blue** selection/hover glow → brand red in both redesigns (DESIGN.md). node --check clean.
- Logged everything to STRATEGY Decision Log + Product status. **Committed** as `b4da6b6` (auto-register feature) + `ec89261` (Profiles UI redesign), on `main`, **not pushed**. **⚠️ Carry-forward:** agent mode + the Automatic style + the code category are all unreleased → onboarding/landing/changelog owed before the release that ships them.

### 2026-05-24 (session 3g — finish profile roadmap: Notes eval + preview cards)
- Alignment ritual clean: only the known `tasks/todo.md` (EU WIP) + untracked `LANDING.md`/`archive/` uncommitted; reconciled against the in-flight log.
- Nick chose "finish the profile roadmap," **safe-two-first** sequencing (Notes + preview cards now; **slice 2 deferred** to its own session — needs a product decision + regression budget).
- **Part A — Notes:** corpus had 0 Notes cases. Built **14** (corpus 59→73), extended the sampler (plain-vs-Notion `target` field + a category filter arg). Live run: **14/14 clean, 0 guardrail failures**. LLM-as-judged each: anti-invention traps all held (announced-but-unnamed → invented nothing), title rule correct both ways, plain/Notion branch + request rule work EN+DE. Verdict = same as Email/PM: already good → **no prompt changes** (don't fix what isn't broken). Snapshot: [tasks/notes-eval-2026-05-24.md](tasks/notes-eval-2026-05-24.md).
- **Part B — preview cards:** elevated `modes.preview.*` for **email** (unified all 3 styles on one scenario; **removed the invented boilerplate** the old formal preview still showed — it contradicted our own `_EMAIL_GUARDRAILS`) and **notes** (grocery list → professional project note), EN+DE. **PM + code left unchanged** (already at the bar). `node --check`/JSON/py_compile pass; app launches, backend healthy.
- **Committed** `1ce01b9` (profile work + the two canonical docs). Logged to STRATEGY Decision Log + Product status.
- **Then two follow-ups:** synced Nick's parallel descope (auto-language double-pass → **WON'T FIX**) into STRATEGY's hardening backlog so the docs agree (`db6dcf5`, with his `tasks/review-2026-05-24.md` edit); committed Nick's native-speaker pass making the German email previews consistently **du** (`f2967f1`). Tree clean except the long-standing `tasks/todo.md` (EU WIP) + untracked `LANDING.md`/`archive/`.
### 2026-05-24 (parallel session — auth foundation: Supabase EU magic-link + entitlement)
- Ran in an isolated `auth-supabase` git worktree so it never clobbered the concurrent profile session.
- Planned to `tasks/auth-supabase.md`, checked in, then built: Supabase EU/Frankfurt project + schema
  (RLS), main-process auth module (PKCE magic-link, safeStorage-encrypted session, entitlement/usage
  reads, payment seam stub), `landa://` deep-link handler + hard sign-in gate, auth window, settings
  Account section. Added a `ws` polyfill (Electron Node-20 has no global WebSocket).
- **Verified live with Nick:** deep-link routing (dummy-code test) + full magic-link sign-in. Fixed two
  test-found bugs (`d4c70fc`): sign-out now re-locks the app; free-tier usage shows `X/limit` (was
  "Unlimited"). Hit Supabase's built-in email rate limit → wired **Brevo (EU) SMTP**; sign-in then
  worked end-to-end. Email lands in spam → `landavoice.com` domain auth is a pre-launch task.
- Committed `5db4f7a`/`d4c70fc`/`0e0d916` on the branch (unmerged, not pushed). STRATEGY + this file
  updated **on the branch**. Saved memory `project_auth_foundation_branch`.

### 2026-05-24 (session 3f — judge the profile polish + agent mode, then commit)
- Alignment ritual: every uncommitted change reconciled against the in-flight log — clean. (Mid-session, STRATEGY.md gained brand/naming decision rows from a **parallel edit** — surfaced, kept out of this commit; left in the working tree for Nick.)
- Nick asked me to **be the LLM-as-judge** rather than rate himself. Reviewed all 55 cases against spec: **53/55 clean**. Two residuals, both pre-known watch-outs (intermittent "loop in X → future communications" widening; prim German-excited). Agent mode: 8/8 composed correctly, none echoed, no invented facts, du/Sie preserved.
- Flagged the one real coverage gap: the corpus only tested clearly-instruction vs clearly-message. Nick chose **add adversarial cases first**. Added 4 boundary traps (literal message opening with "tell"; genuine message mentioning a third person; instruction with no directive verb; instruction in the second person). Live run: **detection passed 4/4 both directions**, incl. the second-person person-shift ("you are happy" → "I am happy"). Corpus now **59 cases**, 0 guardrail failures, 0 fallbacks. Only residual: compose path adds mild courtesy filler (tone padding, not invented facts).
- **Committed** the polish + agent mode + evals + docs as `102ab94` (profile files only). Then committed the **parallel brand workstream** separately as `a6fbec2` (DESIGN.md + STRATEGY.md) — first reconciling a palette contradiction (STRATEGY said gold accent #A9762F, DESIGN said red #A32B2B → DESIGN.md is truth, STRATEGY updated to the monochrome deep-red system). Logged to STRATEGY Decision Log + Product status. **Pushed `main` to origin (no tag → backup, not a release).** ⚠️ Agent mode unreleased/unannounced → onboarding/landing/changelog owed before the release that ships it.

### 2026-05-24 (session 3e — polish everyday profiles: Email + PM)
- Picked option 1 (deepen Email + PM). Alignment ritual clean (`tasks/todo.md` EU-WIP + untracked `LANDING.md`/`archive/` as logged).
- Built a reusable Email/PM **sampler** (`evals/run_profile_samples.py` + 14-case `evals/everyday_profiles.json`, EN+DE, all styles × toggles). Tone is subjective → it prints input→output for blind rating + auto-checks only the deterministic guardrails (case-sensitive, so German `Sie`≠`sie`=them).
- **Baseline diagnosis (the reframe):** Email/PM aren't broken like code-in-editors — they're thin-in-spec but already good. Three real gaps: emoji leaks into Excited regardless of the toggle; PM formal/casual/excited barely differ; formal email invents pleasantries.
- Nick chose **targeted fixes** (not a wholesale rewrite) + emoji=toggle-only + suppress email boilerplate. Made 3 surgical edits in `backend/landa_core.py`. Verified live: emoji only when toggled (one, inline); same-input triptych shows distinct styles; German formal dropped "ich hoffe, es geht Ihnen gut". Guardrails 0-fail; **code eval still 18/18**.
- Snapshot for rating: [tasks/profile-eval-2026-05-24.md](tasks/profile-eval-2026-05-24.md). **Not committed — awaiting Nick's blind A/B.** Logged to STRATEGY Decision Log + Product status.
- **Then Nick redirected: implement AGENT MODE now, eval after.** Added `_EMAIL_AGENT`/`_PM_AGENT` blocks (auto compose-from-instruction, no toggle, reuses the Notes pattern; Code excluded) wired into `get_mode_prompt`. **Expanded the corpus to 55 cases** (29 email/26 PM, 8 agent, business/private/personal personas + edge cases). Sampler now spaces calls (proxy rate-limit was producing false "echo" failures) + flags `out==in` fallbacks.
- Live-verified agent mode composes (EN+DE, du preserved, only the given points): "tell her I'm so sorry…" → "I'm really sorry about yesterday. I'll make it up to you this weekend." Caught + fixed two compose-path issues: residual "I hope this message finds you well" boilerplate and a literal "[Name]" placeholder when no recipient named. Final full run: **0 guardrail failures, 0 fallbacks**; code eval **18/18**.

### 2026-05-24 (session 3d — review + harden + hold)
- Ran `/review` (5-dimension prod-readiness) → [tasks/review-2026-05-24.md](tasks/review-2026-05-24.md). Most findings pre-existing/app-wide.
- **Fixed** the one slice-1-relevant item: XSS escaping of app names + linked URLs in settings rendering, made `escapeHtml` quote-safe (`0c6892a`). Verified an injection payload is neutralized.
- **Logged** the rest as a **hardening backlog** in STRATEGY.md → Engineering (`88dd09c`): backend auth/CORS, shared secret, config race, crash loop, auto-language double-pass, taxonomy dup, a11y.
- Nick **deferred** the "what to build next" choice to a fresh session — 4 options captured at the top of "Up next."
- All committed locally; **nothing pushed**. Working tree clean except the known `tasks/todo.md` (EU WIP) + untracked `LANDING.md`/`archive/`.

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
- Logo refresh → "L" mark (touches tray icons + `brand-assets/`; update `DESIGN.md` first). **Asset now exists** (`assets/Landa-Logo-2026-new-iOS-Default-1024x1024@1x.png`, already used in Home) — rollout to tray icon / app+dock icon / installers (`.icns`/`.ico`) / website / `brand-assets/` still pending.
- Voice-edit selected text.
- Auth via Supabase (EU) → then team licenses, free tier, referral.
- **Dedicated user Profile/account menu** — move the account block out of Settings into it; entry = uploadable **avatar** under the Feedback button (sidebar bottom) + editable display name. ⚠️ Resolve the name clash ("Profiles" tab = writing modes vs new "Profile" = user account).
- **Collapsible Profiles category drawer** — toggle at the top-right of its island + add a border to the drawer for cleaner definition.
- **Home rearrange** — make the stats numbers the hero; they read as secondary today.
