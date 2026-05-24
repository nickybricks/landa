# Polish the everyday profiles — Email + Personal Message (deepen prompts)

**Goal:** bring the Email and Personal Message reformat prompts up to the `code` profile's
depth/quality bar — worked examples + clearer structural/register rules — **without**
regressing the hard-won guardrails (German Sie/du address-form, anti-invention).

**Scope (decided 2026-05-24, Nick):** deepen the **Email + PM prompts only**. Notes is
already rich and is left as-is. The per-profile **UI card examples** (`modes.preview.*`)
are explicitly out of scope this session. Slice 2 (Slack-vs-WhatsApp split) is a separate
later job.

**Scope addition (decided 2026-05-24, Nick — mid-session):** also **implement agent mode
now** for Email + PM (then expand the evals to cover it). Agent mode = the profile
auto-detects whether the dictation is the *message itself* (clean verbatim, the usual path)
or an *instruction to compose* ("tell her I'm sorry about yesterday…") and writes the actual
message. **No toggle** — automatic intent detection, same pattern Notes already uses.
Code is excluded (it keeps its opposite "YOU ARE NOT THE AGENT" guard).

**Why prompts, not a token eval:** unlike `code` (objectively-right tokens like
`getUserInfo`/`CORS`), Email/PM quality is tone/register — subjective. The real gate is
Nick's **blind A/B rating**, same as code. The sampler produces before/after samples for
that rating; it only auto-asserts the few *deterministic* guardrails.

## Current state (the gap)
- **Personal Message** — thinnest. 3 styles (formal/casual/excited), ~2 sentences each.
  No worked examples, no app-awareness (Slack==WhatsApp), emoji guidance lives only in the
  toggle tail. `backend/landa_core.py:607-633`.
- **Email** — decent but generic. 3 styles + conditional greeting/sign-off blocks + Sie/du
  + anti-invention. One-paragraph instructions, no worked examples. `:635-660`.
- `code` is the depth template: numbered, example-driven rules. `:547-604`.

## Plan
- [x] 1. Corpus `evals/everyday_profiles.json` — 14 realistic raw dictations, EN+DE, each
      style × key toggles (greeting/sign-off, emoji, Sie vs du).
- [x] 2. Sampler `evals/run_profile_samples.py` — forces category/style/toggles, prints
      `input → output`; hard guardrail asserts are **case-sensitive** (German Sie/du is
      defined by capitalization, so `Sie`≠`sie`=them).
- [x] 3. Captured BASELINE → diagnosis: profiles aren't broken, they're thin-in-spec but
      already produce good output. Three real gaps found (emoji leak, PM styles barely
      differ, formal-email invents pleasantries).
- [x] 4. **Targeted** fixes (Nick chose targeted over a wholesale rewrite, 2026-05-24):
      emoji = toggle-only; PM style gradient w/ worked examples; tightened email guardrail.
      Guardrails re-checked 0 fail; code eval 18/18.
- [x] 5. Before/after doc `tasks/profile-eval-2026-05-24.md` written for Nick's blind rating.
- [x] 6. **Agent mode** implemented for Email + PM (`_EMAIL_AGENT` / `_PM_AGENT` blocks
      prepended in `get_mode_prompt`). Auto-detect instruction-vs-message; no toggle.
- [x] 7. **Corpus expanded** to 55 cases (29 email, 26 PM, 8 agent) spanning business /
      private / personal personas + edge cases (numbers, self-correction, non-native,
      already-clean, venting/tone, multi-topic). Sampler spaces calls (proxy rate-limit)
      and flags proxy fallbacks (`out == in`).
- [x] 8. **Adversarial agent-mode probe** (corpus now **59 cases**): added 4 boundary traps
      to close the misfire-coverage gap — a literal message opening with "tell", a genuine
      message that *mentions* a third person, an instruction with no directive verb, and an
      instruction phrased in the second person. **Detection passed 4/4** both directions
      (incl. the second-person person-shift). Residual: compose path adds mild courtesy
      filler (not invented facts) — future tightening, not a blocker. Judged committable.

## Ripple (CLAUDE.md §5)
Prompt-only, backend-only. Style set unchanged → no settings-UI / onboarding / landing
change. `code` eval re-run → **18/18, no regression** (agent blocks touch only the
email/PM branches of `get_mode_prompt`; code path untouched).
⚠️ **Agent mode is a user-facing behavior change** — when released it should be reflected in
onboarding + landing copy + changelog (it changes what dictation does). Not done yet.

## Review
Done 2026-05-24. Three surgical edits in `backend/landa_core.py`:
- `get_mode_prompt` PM branch: added an explicit "Do not use any emojis" in the toggle-off
  path so Excited stops sprinkling emojis — the toggle is now the single control.
- `_EMAIL_GUARDRAILS`: keep greetings/sign-offs, forbid unspoken pleasantries + request-padding.
- The 3 personal-message style prompts: real register gradient + one worked example each.

Verified live via the proxy: emoji only when toggled on (one, inline); same-input triptych
shows distinct formal/casual/excited; German formal email dropped "ich hoffe, es geht Ihnen
gut". **Not committed yet** — awaiting Nick's blind rating before commit.

**Agent mode (added mid-session):** `_EMAIL_AGENT` / `_PM_AGENT` blocks prepended in
`get_mode_prompt` for email + personal-message. Live-verified composing, not echoing:
"tell her I'm so sorry about yesterday…" → "I'm really sorry about yesterday. I'll make it
up to you this weekend."; "sag ihm dass ich es heute nicht schaffe…" → "Ich schaffe es heute
leider nicht, komme aber morgen auf jeden Fall vorbei." (du preserved). Verbatim cases still
clean normally (auto-detection holds).

**Watch-outs** (carried into the eval doc): German-excited may render too prim ("ich habe"
vs spoken "ich hab"); casual dropping the trailing period is intentional; **boilerplate
suppression needed a second pass** — a multi-topic email re-injected "I hope this message
finds you well", so `_EMAIL_GUARDRAILS` was generalized (probe it holds); **agent-mode
misfire risk** — a literal message mistaken for an instruction or vice-versa (probe in A/B).

**Out of scope this session** (still open from the roadmap item): Notes prompt, the
per-profile UI card examples (`modes.preview.*`), and slice 2 (Slack-vs-WhatsApp split).
