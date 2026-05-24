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

**Goal:** **Implement slice 1** of adaptive per-app style: a **new `code` category** for code editors (Cursor, VS Code), **enabled ON by default**. Design + rationale in [tasks/adaptive-per-app-style.md](tasks/adaptive-per-app-style.md) — read it first; it's approved.

**Decided 2026-05-24:** slice = code-category-first (not the messaging split); on-by-default for all existing users via migration. Messaging tone/format split is slice 2.

**Build checklist (see the design doc §4b/§8 for detail):**
1. Add a `code` category to `MODE_SYSTEM_PROMPTS` with its own behavioral core — **no email/Sie-du guardrails** (they'd be wrong); keep identifiers/technical terms verbatim, neutral instruction/prose tone, one "smart" style to start. → [landa_core.py:507](backend/landa_core.py#L507)
2. Add `code` to the fresh-install default `categories` + a **migration** that back-fills it (linkedApps: `Cursor`, `Code`) and sets `enabled = true`. → [landa_core.py:188](backend/landa_core.py#L188), [landa_core.py:293-329](backend/landa_core.py#L293-L329)
3. New settings tile for the `code` category, consistent with the others (renderer). Messaging needs no UI.
4. **Verify detected app names on real macOS + Windows machines** (process name only on Windows — no URL detection). Cursor=`Cursor`, VS Code=`Code` on both — confirm, don't assume.
5. **Eval before the release ships it** (§7): ~15–20 real dictations in Cursor/VS Code, blind A/B vs today's raw transcription. On-by-default means everyone gets it at once, so it must clear the eval first.
6. **Pass the quality gates before shipping** (doc §11): evals + security + maintainability + reliability reviews (run `/review`) + macOS/Windows smoke. Feature working ≠ done.

**Watch-outs carried from the design:**
- Don't touch the shared personal-message/email cores or guardrails — slice 1 is purely additive.
- Prose-in-a-Markdown-file inside VS Code shouldn't read badly → keep the code core neutral, not aggressively code-only.
- Two `linkedApps` defaults have drifted (fresh-install lacks Telegram/Signal that the migration adds) — flag to Nick if touching that code; open Q in the doc.

**Still-open Qs for Nick (doc §10):** code sub-styles (one smart style vs comment/commit/agent-prompt variants); Telegram/Signal default alignment; eval corpus source.

**Parallel (Nick, real-world — not a Claude task):** form the legal entity; chase the Anthropic/Google EU quota. These unblock payments + the EU flip.

---

## ⚠️ In flight / don't forget (uncommitted or half-done)

- **Resolved 2026-05-24:** the unexplained `main.js` pill-positioning change was reviewed and committed (`a997538`); strategy/workflow docs committed (`0f0f79b`).
- **Still uncommitted (clarify when relevant, not urgent):** `tasks/todo.md` (EU-migration WIP notes), and untracked `LANDING.md` + `archive/` — unknown provenance, left untouched until Nick confirms what they are.
- _(add new in-flight items here as they happen)_

---

## Session log (most recent first)

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
- Agent mode in profiles (verbatim vs. compose).
- License + payment gate (needs the legal entity first).
- Landing page restructure (mature-SaaS tone, one clean email video, tiers, case studies, "who we are", use-cases).
- Logo refresh → "L" mark (touches tray icons + `brand-assets/`; update `DESIGN.md` first).
- Voice-edit selected text.
- Auth via Supabase (EU) → then team licenses, free tier, referral.
