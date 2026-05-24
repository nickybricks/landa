# Auto-register style (reshaped slice 2) — implementation plan

> **Status:** plan for review. **No code until Nick approves this doc.**
> **Strategy anchor:** `STRATEGY.md` → "Adaptive per-app writing style." Parent design: [adaptive-per-app-style.md](adaptive-per-app-style.md) §4a. This **replaces** the originally-scoped slice 2 ("manual Slack-vs-WhatsApp tone buckets") with a better mechanism Nick chose 2026-05-24.

---

## 1. The decision (what changed and why)

The original slice 2 was an app-aware tone/format split *under* a manual formal/casual/excited switch. Nick's redirect: **the manual switch itself is the friction** — "I don't want to keep switching modes." So instead of buckets under a switch, the LLM **auto-detects the register per dictation**, and the destination app feeds that decision. One automatic mechanism delivers both "right register" and the work-vs-personal feel.

**Confirmed product decisions (Nick, 2026-05-24):**
1. **Auto is a new default style, manual stays.** Add `auto` as a selectable style for **email + personal-message**, make it the *fresh-install default*. formal/casual/excited remain selectable for anyone who wants to lock a register.
2. **Auto chooses formal ↔ casual only — never excited.** "Excited" is strong and sticky; auto-triggering it is the most jarring misfire. Excited stays a deliberate manual pick.
3. **App context feeds the auto decision** (personal-message only): work chats (Slack/Discord/Teams) lean concise/professional-casual; personal chats (WhatsApp/Signal/Telegram/iMessage) lean warm/relaxed. This is where the original slice-2 work/personal split now lives.

**Scope is exactly email + personal-message** — the only two categories with a formal/casual/excited register. Notes (`smart`) and Code (`smart`) are unchanged.

---

## 2. Why this is low-regression (the key safety property)

We **do not edit** the tuned `formal` / `casual` / `excited` prompts or `_PM_GUARDRAILS` / `_EMAIL_GUARDRAILS`. `auto` is a **net-new sibling** prompt. So:
- Existing users on a manual style get byte-identical output to today — impossible to regress them.
- The only new quality surface is *auto itself* (does it pick the right register), which the eval covers.

This mirrors the slice-1 logic: a net-new behavior can't regress an existing tuned prompt.

---

## 3. Design

### 3a. New `auto` prompts (`backend/landa_core.py`)
Add `MODE_SYSTEM_PROMPTS["personal-message"]["auto"]` and `["email"]["auto"]`. Each is a **self-contained sibling** of the existing styles (consistent with how formal/casual/excited are each full strings — not a new abstraction). Each `auto` prompt:
1. **Decides the register first:** "Decide whether a *formal* (polished, complete sentences) or *casual* (relaxed, conversational) register fits best, based on what was said and how it was said."
2. **Hard-bans excited:** "Do NOT use an enthusiastic/excited register or stack exclamation marks — at most one '!', only if truly warranted." (Excited is manual-only.)
3. **Then writes** in the chosen register, reusing the same transformation guidance + worked examples the formal/casual prompts use.
4. Ends with the **same** `_PM_GUARDRAILS` / `_EMAIL_GUARDRAILS` (incl. Sie/du preservation) — appended verbatim, untouched.

Agent mode (`_PM_AGENT` / `_EMAIL_AGENT`) is already prepended in `get_mode_prompt` regardless of style, so auto inherits compose-from-instruction for free.

### 3b. App-context nudge — personal-message only (`get_mode_prompt`)
Add `_pm_app_bucket()` mirroring `_is_notion_target()` ([landa_core.py:1005](../backend/landa_core.py#L1005)) — read the cached active app via `_consume_active_app()` and classify:
- **work** → Slack, Discord, Teams (+ Microsoft Teams process names)
- **personal** → WhatsApp, Signal, Telegram, iMessage/Messages
- **None** → unknown app

In `get_mode_prompt`, when `category == "personal-message"` and `style == "auto"`, append a one-line nudge:
- work → "This message is going to a workplace chat — lean toward the concise, professional-casual end unless the content is clearly personal."
- personal → "This message is going to a personal chat — lean toward the warm, relaxed end."
- None → no nudge (pure content-based).

**Email auto gets no app nudge** (an email client doesn't tell us work vs personal) — register is content-only.

### 3c. Email greeting/sign-off under auto
`_EMAIL_GREETINGS` / `_EMAIL_SIGNOFFS` are keyed by style; there's no `auto` key. When `style == "auto"`, instead of appending a fixed string, **instruct inline** (gated by the existing `include_greeting` / `include_sign_off` toggles, which default True): "Add a greeting/sign-off matching the register you chose and the dictation language" + fold in the formal/casual forms already in those dicts. PM has no greeting/sign-off, so this is email-only.

### 3d. Config defaults + migration ([landa_core.py:185](../backend/landa_core.py#L185), [:285](../backend/landa_core.py#L285))
- **Fresh install:** `selections` default `email: "auto"`, `personal-message: "auto"` (were `"formal"`).
- **Migration (existing users):** **conservative — do NOT silently flip.** Set `auto` only where a selection key is *missing*; users with an explicit `formal`/`casual`/`excited` keep it (their output won't change on update). They opt into auto via settings; we surface it in the changelog. → **Nick: confirm this, vs. flipping everyone currently on the old default `formal` → `auto`.** (Recommend conservative; safest, and you just pick "Automatic" once.)

### 3e. Settings UI (`renderer/settings.{html,js,css}` + i18n)
- Add **"Automatic"** (DE: "Automatisch") as the first option in the email + personal-message style picker; make it the selected default for fresh config.
- **Preview card** for auto: a short descriptive card ("Picks formal or casual automatically from what you say — and, for chats, where you're writing"). Confirm against `modes.preview.*` structure; PM/email manual previews unchanged.
- Toggles (PM emoji; email greeting/sign-off) store under `toggles[category]["auto"]` — same mechanism, no UI rework.

### 3f. Drifted app lists (the §5-note² cleanup)
Fresh-install personal-message linkedApps = `["Slack","Discord","WhatsApp"]`; migration list adds `Telegram, Signal` ([landa_core.py:196](../backend/landa_core.py#L196) vs [:314](../backend/landa_core.py#L314)). Since the work/personal buckets reference all of these, **align both lists** (add Telegram/Signal + Teams to the fresh-install default). Surgical; confirm with Nick (this was the Q2 I deferred).

---

## 4. Cross-surface ripple (CLAUDE.md §5)
- **Settings UI** — yes (3e).
- **Onboarding** — check whether first-run teaches the style picker; update if so (likely a one-line mention).
- **Landing page / README / changelog** — **not yet** — this is unreleased, like agent mode + slice 1. It **joins the carry-forward bundle**: onboarding + landing + changelog must be updated before the release that ships any of these. Logged, not done now.
- **STRATEGY.md + NEXT_SESSION.md** — Decision Log row + Status by Area + planner update at session end.

## 5. Eval (the regression budget Nick flagged)
- Extend `evals/run_profile_samples.py`: add a `_pm_app_bucket` stub driven by a new case field (e.g. `app_bucket: "work"|"personal"`), mirroring the existing `_is_notion_target` stub at [:66](../evals/run_profile_samples.py#L66).
- Add `style: "auto"` cases to `evals/everyday_profiles.json` (EN+DE, email+PM):
  - Clearly-formal content → expect formal feel; clearly-casual → casual.
  - **Same PM content, work vs personal `app_bucket`** → register should shift.
  - **Misfire trap:** celebratory content under auto must NOT go excited (deterministic guard: forbid stacked `!!`; plus blind-rate).
  - Keep the Sie/du `expect`/`forbid` guards.
- Run live; **blind-rate register fit**; confirm 0 guardrail failures + 0 excited misfires.
- **Regression check:** re-run the existing manual formal/casual/excited cases — output must be unchanged (we didn't touch those prompts).

## 6. Verification / done-when
1. `py_compile` + `node --check` clean.
2. Logic check: fresh config defaults to `auto`; `get_mode_prompt` returns the auto prompt with the right app nudge for a Slack vs WhatsApp vs unknown app; manual styles unchanged.
3. App launches (`npm start`), backend healthy on :7890.
4. Eval (§5) passes; blind rating ≥ baseline.
5. STRATEGY + NEXT_SESSION updated.

## Review / eval results (2026-05-24, implemented)

Built and verified. Backend: `auto` siblings for PM + email, `_pm_app_bucket()`, app nudge wired (PM only), `auto` greeting/sign-off variants. Config: fresh-install default `auto`, conservative migration (explicit selections kept, missing keys → `auto`), app lists aligned + Teams enrichment for existing users. Settings UI: "Automatic"/"Automatisch" added as default style with EN/DE previews + Teams icon. Onboarding: no change (doesn't teach styles).

**Verification:** `py_compile` + `node --check` clean. Logic checks pass — incl. the **no-regression proof** (manual formal/casual prompts are byte-identical to before; only `auto` is new). Live sampler (`evals/run_profile_samples.py auto`): **10/10, 0 guardrail failures, 0 fallbacks** (+1 re-run of the EN business case).

**LLM-as-judge verdict (11 outputs):**
- ✅ **Register selection works**, clearest in German: business email → formal ("Sehr geehrte Frau Bergmann … Mit freundlichen Grüßen"); personal email → casual ("Hallo Lukas … Viele Grüße"). Proves the auto greeting/sign-off variant picks the right form both ways.
- ✅ **Misfire traps both pass**: celebratory PM got exactly one "!"; celebratory email got none. Auto never escalated to excited.
- ✅ **Sie/du never flipped**, including a German workplace chat that correctly stayed Sie (not flipped to du just because it's a chat app).
- ✅ EN business email landed clean/professional, not chatty.

**⚠️ Finding to carry into Nick's blind A/B:** the **work-vs-personal app nudge is subtle**. The paired neutral PM case (identical input, work vs personal bucket) produced **identical output** — the lean is a soft default, not a hard switch, so it shows little on neutral text. The content-driven register is the strong signal; the app context only nudges borderline cases. This is the "gains are subjective" caveat the parent design flagged — confirm on real Slack-vs-WhatsApp dictations whether the nudge needs strengthening or is fine as a light touch. Eval corpus now **83 cases** (10 auto).

## 7. Resolved decisions (Nick, 2026-05-24)
- **Migration policy (3d):** ✅ **conservative no-flip.** Existing users keep their explicit selection; `auto` only for fresh installs + missing keys. Output is byte-identical on update.
- **Align app lists (3f):** ✅ **yes** — add Telegram, Signal, Teams to the fresh-install personal-message default; align fresh-install ↔ migration lists.
- Per-OS process names (Teams, iMessage/Messages) confirmed on real machines before shipping, like slice 1.
