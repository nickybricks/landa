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

**Goal (proposed — confirm at session start):** Start the **adaptive per-app writing style** feature (STRATEGY.md → top product priority) — each target app gets its own tone + formatting, building on the existing modes.

**Why this one:** it's the highest-leverage product bet and is *not* blocked by the legal entity or vendor quota, so it's the most valuable thing Claude can build right now while the entity/payments track proceeds in the real world.

**Tasks (to refine in plan mode):**
- [ ] Map how modes/profiles currently resolve per app (Email / Personal Message / Notes) and where tone+formatting is decided.
- [ ] Design how each app maps to a writing style (WhatsApp vs. Slack vs. Notion vs. Cursor vs. email).
- [ ] Spec before coding; verify on both macOS and Windows.

**Done when:** dictating into two different apps produces two visibly app-appropriate outputs, verified live (hotkey → record → transcribe → polish → paste).

**Parallel (Nick, real-world — not a Claude task):** form the legal entity; chase the Anthropic/Google EU quota. These unblock payments + the EU flip.

---

## ⚠️ In flight / don't forget (uncommitted or half-done)

- **Uncommitted working-tree changes exist** (as of 2026-05-24): `main.js` modified, `tasks/recording-sounds.md` deleted, `tasks/todo.md` modified, plus new untracked landing/strategy assets. **Review with `git diff` before building anything** — confirm these are intended before they cause surprises.
- _(add new in-flight items here as they happen)_

---

## Session log (most recent first)

### 2026-05-24
- Built `STRATEGY.md` (single source of truth) from memory + todo + the old Product Strategy doc.
- Mirrored it read-only into Notion under the **Landa** page.
- Set up this session-planning workflow + the alignment ritual in `CLAUDE.md`.
- **Next:** confirm and start adaptive per-app writing style (see Up next).

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
