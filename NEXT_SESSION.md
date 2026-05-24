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

**Goal:** **Plan** the **adaptive per-app writing style** feature (STRATEGY.md → top product priority). Nick's call (2026-05-24): **plan only this session — no code yet.** Produce a design doc + per-app style table at `tasks/adaptive-per-app-style.md` for review before any implementation.

**Why this one:** highest-leverage product bet, and *not* blocked by the legal entity or vendor quota.

**Research already done (2026-05-24 — don't re-derive):**
- The app **already routes per app**: backend detects frontmost app/URL and matches it to one of 3 buckets — Email / Personal Message / Notes — via `get_active_category()` ([landa_core.py:809](backend/landa_core.py#L809)), then applies a tuned prompt via `get_mode_prompt()` ([landa_core.py:849](backend/landa_core.py#L849)).
- **Notion is the proven per-app override pattern:** `_is_notion_target()` swaps in a Notion-Markdown prompt instead of the generic Notes one ([landa_core.py:877-882](backend/landa_core.py#L877-L882)). Extend *this* mechanism rather than inventing a new one.
- **The gap:** apps inside a bucket share one voice — Slack/WhatsApp/Discord/Telegram/Signal are all "personal-message" with the *identical* prompt. **Cursor / code editors aren't handled at all** (a genuinely new "code" purpose, not a tone tweak).
- Config shape: `modes.categories[].linkedApps/linkedUrls`, `modes.selections` (style per category), `modes.toggles`; prompts in `MODE_SYSTEM_PROMPTS[category][style]` ([landa_core.py:507](backend/landa_core.py#L507)).
- ⚠️ Prompts are **heavily tuned** (German address forms Sie/du, guardrails). Per-app variants are prompt-engineering that needs an **eval on real dictations** (STRATEGY.md: "polish quality needs an eval, not vibes"), and must work on **macOS + Windows**.

**Open scoping decision for the planning doc** (Nick declined to pick a build-scope yet — the plan should lay out the options): (a) messaging tone split first [smallest], (b) + new Cursor/code-editor target, (c) full per-app matrix [multi-session]. Keep consistent with "built-in profiles, not user-defined" (STRATEGY.md).

**Done when:** `tasks/adaptive-per-app-style.md` exists with the design + a per-app → style/format table + the recommended first slice, reviewed by Nick. No code until approved.

**Parallel (Nick, real-world — not a Claude task):** form the legal entity; chase the Anthropic/Google EU quota. These unblock payments + the EU flip.

---

## ⚠️ In flight / don't forget (uncommitted or half-done)

- **Resolved 2026-05-24:** the unexplained `main.js` pill-positioning change was reviewed and committed (`a997538`); strategy/workflow docs committed (`0f0f79b`).
- **Still uncommitted (clarify when relevant, not urgent):** `tasks/todo.md` (EU-migration WIP notes), and untracked `LANDING.md` + `archive/` — unknown provenance, left untouched until Nick confirms what they are.
- _(add new in-flight items here as they happen)_

---

## Session log (most recent first)

### 2026-05-24
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
