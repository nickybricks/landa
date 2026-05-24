# Adaptive per-app writing style — design doc (PLAN ONLY)

> **Status:** design for review. **No code this session** (Nick's call, 2026-05-24). Implementation starts only after Nick approves a scope slice at the bottom.
> **Strategy anchor:** `STRATEGY.md` → "Adaptive per-app writing style — TOP product priority." Built-in profiles, **not** user-defined. Must work macOS **and** Windows. Polish quality is proven by an **eval on real dictations, not vibes**.

---

## 1. The goal in one sentence

Each target app should get text tuned to *that app* — its tone, its formatting, and (for code editors) its entire purpose — instead of every app inside a bucket sharing one identical prompt.

---

## 2. How it works today (grounded in the code)

The pipeline is two stages, plus one existing per-app override:

1. **Route** — `get_active_category()` ([landa_core.py:809](../backend/landa_core.py#L809)) reads the frontmost app/URL and returns the first category whose `linkedApps`/`linkedUrls` match, or `None` (→ raw transcription, no polish).
2. **Select prompt** — `get_mode_prompt()` ([landa_core.py:849](../backend/landa_core.py#L849)) looks up `MODE_SYSTEM_PROMPTS[category][style]` ([landa_core.py:507](../backend/landa_core.py#L507)), where `style` comes from the user's `modes.selections[category]`, then layers on toggles (email greeting/sign-off, personal-message emoji).
3. **One per-app override exists** — for Notes, `_is_notion_target()` ([landa_core.py:839](../backend/landa_core.py#L839)) swaps the prompt to `_NOTES_SMART_NOTION` ([landa_core.py:607](../backend/landa_core.py#L607)).

The three shipped categories and their default `linkedApps` ([landa_core.py:188](../backend/landa_core.py#L188)):

| Category | Style options | Default linked apps | Default linked URLs |
|---|---|---|---|
| `email` | formal / casual / excited | Mail, Outlook | gmail, outlook.live, outlook.office |
| `personal-message` | formal / casual / excited | Slack, Discord, WhatsApp | — |
| `notes` | smart | Notes, Notepad, Notion | notion.so |

**The single most important pattern to copy:** the Notion override is *not* a new prompt — it's the **same behavioral core** (`_NOTES_SMART_CORE`) with a **different FORMAT block** appended (`_NOTES_SMART_PLAIN` vs `_NOTES_SMART_NOTION`, [landa_core.py:597-616](../backend/landa_core.py#L597-L616)). All the hard-won tuning (anti-invention rules, the request/agent rule, title logic) lives in the shared core and is reused verbatim. Only the markup instructions change. **We extend this, we don't reinvent it.**

---

## 3. The gap, decomposed into three *different kinds* of variation

This is the key insight: "per-app style" is not one problem. It's three, and they want different solutions.

**A. Format variation — how the text is marked up.**
Notion renders Markdown blocks; Apple Notes/Notepad render plain text; Slack renders *lightweight* Markdown (`*bold*`, `> quote`, no `#` headings); WhatsApp/Signal/iMessage render plain text and lean on emoji. This is the **most objective and most eval-able** axis (you can verify the markup pastes correctly), and it's the one already solved for Notes. The personal-message bucket ignores it entirely — Slack and WhatsApp get byte-identical output today.

**B. Tone / register variation — how formal or warm.**
Slack is workplace-casual and concise; WhatsApp/Signal are personal and warm; Discord/Telegram are casual-community. Today all five live in `personal-message` with one prompt. The user's formal/casual/excited selection still applies, but there's no app-aware default tone.

**C. Purpose variation — what the output even *is*.**
Code editors (Cursor, VS Code) are a **genuinely new purpose**, not a tone tweak. Dictating into Cursor is usually one of: a prompt to the AI agent, a code comment, a commit message, or prose in a Markdown/docs file. Today these editors match **no** category → `get_active_category()` returns `None` → **raw transcription, no polish at all.** This is the only target that's currently *broken* rather than *generic*, which makes it the biggest absolute quality jump.

---

## 4. Architectural recommendation

Generalize the Notion mechanism into a thin **app-override layer**, and add **one new category** for the new purpose. Two shapes because the variation is two kinds:

### 4a. Messaging (variation A+B) → app-override deltas inside `personal-message`
Mirror `_is_notion_target()`. Introduce a small built-in map of app → `{format_block, tone_delta}` that `get_mode_prompt()` consults *after* it picks the base personal-message prompt, appending the app's format/tone delta the same way the email toggles append greetings today. The shared personal-message core + `_PM_GUARDRAILS` (incl. the Sie/du address-form rule) stay untouched, so we don't risk the tuning. Example deltas:
- **Slack/Discord** → "lightweight Markdown is fine (`*bold*`), workplace-casual, concise."
- **WhatsApp/Signal/Telegram** → "plain text, warm and personal, contractions fine."

This keeps the user's formal/casual/excited selection working *and* layers an app-aware default on top.

### 4b. Code editors (variation C) → a real new `code` category
This needs to be a first-class category in `MODE_SYSTEM_PROMPTS` + the default `categories` config + a settings tile, because it's a new purpose with its own behavioral core (no Sie/du, no email guardrails — those would be actively wrong). Its core should: keep technical terms/identifiers verbatim, not "polish" code-like phrasing into prose, and default to a clean instruction/prose style suitable for an AI-agent prompt or a comment. (Sub-styles like comment vs commit-message vs agent-prompt are a *later* refinement — start with one smart style.)

### Why not just one big per-app matrix?
A full matrix (every app × every style with bespoke prompts) is a multi-session prompt-engineering project with a real regression surface on heavily-tuned prompts, and it's the hardest to eval. The override-delta + one-new-category shape gets ~80% of the user-visible win at ~20% of the risk, and the mechanism it establishes scales to the full matrix later.

---

## 5. Per-app → tone / format / detection table

Detection reality (verified in code, [landa_core.py:721](../backend/landa_core.py#L721)):
- **macOS:** app name via System Events; **browser tab URL is available** for Chrome/Safari/Arc/Edge/Brave/Firefox → web apps route by URL.
- **Windows:** foreground **process name only** (`_detect_active_app_windows`, [landa_core.py:673](../backend/landa_core.py#L673)); **no URL detection at all.** Web-only messaging (WhatsApp Web, Slack in a browser) will *not* route on Windows — only the desktop app matches. This is a hard constraint for the table.

| App | Detected name (mac / win) | Bucket today | Proposed bucket | Proposed tone | Proposed format | New? |
|---|---|---|---|---|---|---|
| Mail / Outlook | Mail / `olk`,`OUTLOOK` | email | email | (unchanged) | (unchanged) | no |
| Gmail (web) | URL `mail.google.com` | email (mac only) | email | unchanged | unchanged | win gap¹ |
| Slack | `Slack` / `slack` | personal-message | personal-message | workplace-casual, concise | lightweight Markdown | tone+fmt |
| Discord | `Discord` | personal-message | personal-message | casual community | lightweight Markdown | tone+fmt |
| WhatsApp | `WhatsApp` | personal-message | personal-message | warm, personal | plain + emoji-friendly | tone+fmt |
| Telegram | `Telegram` (if linked²) | personal-message | personal-message | casual | plain | tone |
| Signal | `Signal` (if linked²) | personal-message | personal-message | warm, personal | plain | tone |
| Notes / Notepad | `Notes` / `Notepad` | notes | notes | unchanged | plain (shipped) | no |
| Notion | `Notion` / URL | notes | notes | unchanged | Markdown blocks (shipped) | no |
| **Cursor** | `Cursor` / `Cursor` | **none → raw** | **code (new)** | instruction/neutral | plain, identifiers verbatim | **NEW** |
| **VS Code** | `Code` / `Code` | **none → raw** | **code (new)** | instruction/neutral | plain, identifiers verbatim | **NEW** |

¹ Gmail/web mail already only routes on macOS (URL-based) — pre-existing Windows gap, not introduced here.
² Telegram/Signal are in the *migration* default ([landa_core.py:302](../backend/landa_core.py#L302)) but **not** the fresh-install default ([landa_core.py:194](../backend/landa_core.py#L194)) — the two lists have drifted. Flag for cleanup; align both lists if we touch this.

⚠️ **Every detected name in this table must be confirmed on a real machine of each OS before shipping** — process names are not guaranteed (e.g. VS Code is `Code` on both, Cursor is `Cursor`, but Outlook's Windows process has changed across versions). This verification is part of implementation, not assumed.

---

## 6. The three scope options (Nick to choose the first slice)

From NEXT_SESSION.md. Re-framed with honest tradeoffs:

| Option | What ships | User-visible win | Risk | Eval difficulty |
|---|---|---|---|---|
| **(a) Messaging tone/format split** | Slack/Discord vs WhatsApp/Signal deltas inside personal-message | Better fit for PRIMARY persona's Slack + chats | **Regression risk** on a heavily-tuned prompt; gains are subjective | Hard — "is Slack tone better?" needs blind rating |
| **(b) + Code-editor category** | New `code` category for Cursor/VS Code | **Largest absolute jump** — turns *no polish* into useful polish | Low — it's net-new behavior, can't regress an existing prompt | Easier — compare against raw transcription, clear baseline |
| **(c) Full per-app matrix** | Bespoke prompt per app × style | Most complete | Highest — large prompt surface, multi-session | Hardest — many cells to eval |

### ✅ DECIDED (Nick, 2026-05-24): code category first, then the messaging split.
Reasoning that backed the recommendation:
- The code editor is the only target that's currently **broken** (raw transcription). Fixing broken > polishing generic.
- It's the **lowest-risk** change: a new category can't regress the existing tuned prompts, because it shares none of their core.
- It's the **easiest to eval** honestly: the baseline is "no polish," so before/after is unambiguous.
- It **proves the new-category mechanism** end-to-end (config default + migration + settings tile + detection on both OSes) on the safest possible target, which the messaging split then reuses.
- The messaging split (a) is real value for the PRIMARY persona but rides on the most heavily-tuned prompt we have — better to do it *second*, with the eval harness already built from slice 1.

If Nick prefers to lead with the primary persona (Slack), do (a) first — but budget for the eval and the regression risk up front.

---

## 7. Eval plan (required before either slice ships — "not vibes")

1. **Corpus:** collect ~15–20 real dictations *per target* (Nick's own + any tester audio), spanning short/long and DE/EN, including the Sie/du and anti-invention edge cases the current prompts guard.
2. **Baseline:** run each through today's behavior (code editors → raw transcription; messaging → current personal-message prompt) and save outputs.
3. **Candidate:** run the same audio through the new prompts.
4. **Blind rating:** Nick rates A/B without knowing which is which, on: correctness (no invented facts), format-pastes-cleanly, tone-fit. A candidate ships only if it's ≥ baseline on correctness and better on fit/format.
5. **Cross-platform smoke:** confirm detection fires and output pastes correctly on **both** macOS and Windows for every app in the slice.

---

## 8. Config, migration & settings-UI implications

- **Built-in, not user-defined** (STRATEGY): the prompts/deltas live in `landa_core.py` code, not config. Only the `linkedApps` lists live in editable config.
- **New `code` category needs a migration** alongside the existing category back-fill ([landa_core.py:293-329](../backend/landa_core.py#L293-L329)) so existing users get `code` with its default `linkedApps` (Cursor, Code) and default `enabled` state. Decide its default `enabled` value (see open questions).
- **Settings UI:** a new category should appear as a tile consistent with email/personal-message/notes (renderer). Messaging deltas need **no** new UI — they apply automatically by app. Keep renderer changes minimal; this doc doesn't design the UI, just flags it's needed for the code category.
- **Align the two drifted `linkedApps` defaults** (§5 note ²) if we're in this code anyway — surgical, mention to Nick first.

---

## 9. Risks & mitigations

- **Regressing tuned prompts (messaging).** Mitigation: never edit the shared core/guardrails; only *append* an app delta, exactly as email toggles do today.
- **Detection names wrong per-OS.** Mitigation: verify on real machines (§5); fall back to bucket default when no app delta matches (graceful — same as today).
- **Windows web-app gap.** WhatsApp/Slack-in-browser won't route on Windows. Accept as known limitation (pre-existing); document, don't pretend it works.
- **Code-in-editor false positives.** Someone writing prose in a Markdown file inside VS Code would get the code tone. Mitigation: keep the code core *neutral/instruction* rather than aggressively "code-only," so prose still reads fine.
- **Scope creep into the full matrix.** Mitigation: ship one slice, eval, then decide — don't pre-build cells nobody asked for (CLAUDE.md §2).

---

## 10. Open questions for Nick

1. ✅ **First slice:** code-category-first. (Decided 2026-05-24.)
2. ✅ **Code category default `enabled`:** **on by default** for all existing users via migration. (Decided 2026-05-24.) → Eval (§7) must clear *before* the release that ships it, since everyone gets it at once.
3. **Code sub-styles:** one smart style to start, or do you already want comment / commit-message / agent-prompt variants?
4. **Telegram/Signal:** fold into the fresh-install default too, or leave the lists as-is?
5. **Eval corpus:** can you supply ~15–20 real dictations per target, or should we start with your own usage only?

---

## 11. Quality gates before shipping (definition of done)

Slice 1 ships only after it clears all of these — not just the feature working:

- **Evals** — the §7 blind A/B on real dictations; must be ≥ baseline on correctness and better on fit/format (on-by-default = everyone gets it at once).
- **Security review** — no secrets, no unsafe input handling in the new path (run `/review security`).
- **Maintainability review** — the new `code` category reuses the override pattern cleanly, no duplication of tuned cores (run `/review maintainability`).
- **Reliability review** — graceful fallback when detection misses (→ existing bucket/raw), no crashes on unknown app names, both OSes (run `/review reliability`).
- **Cross-platform smoke** — detection fires and output pastes correctly on macOS **and** Windows (§5, §7.5).

Fastest path: run `/review` (fans out security · maintainability · reliability · performance · UX) on the branch before the release, then fix findings. Eval + cross-platform smoke are manual and gate the on-by-default release.

---

*Done-when (this doc): design + per-app table + recommended first slice exist and are reviewed by Nick. No code until a slice is approved. Slice ships only after §11 quality gates pass.*
