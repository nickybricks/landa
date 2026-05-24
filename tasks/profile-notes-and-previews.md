# Finish everyday-profile depth — Notes eval + preview-card polish

**Session goal (2026-05-24):** Nick chose "finish the profile roadmap," safe-two-first sequencing.
This session = **Notes prompt** (diagnose, then targeted fixes) + **preview-card copy polish**.
**Slice 2** (Slack/Discord vs WhatsApp/Signal split) is deferred to its own session — it rides the
most-tuned PM prompt and needs a product decision + a regression-eval budget.

Approach mirrors the Email/PM session: **don't assume the prompt is broken.** The Notes prompt is
already deep (`_NOTES_SMART_CORE` + plain/Notion variants + request rule + `_NOTES_GUARDRAILS`).
Sample it first, judge, then make *targeted* fixes only where output is genuinely off.

---

## Part A — Notes prompt (diagnose → targeted fixes)

The shared eval corpus (`evals/everyday_profiles.json`, 59 cases) has **0 Notes cases**. Build them,
then run the existing sampler (`evals/run_profile_samples.py`).

- [ ] **Extend the sampler for Notes targets.** `get_mode_prompt` branches on `_is_notion_target()`
      for Notes (plain text vs Notion Markdown). The sampler stubs `get_active_category` but not the
      active-app cache, so add a small `target` field (`plain`|`notion`) per Notes case and stub
      `lc._is_notion_target` in `run_case` accordingly.
      → verify: a `notion` case produces Markdown (`#`, `[]`); a `plain` case produces none.
- [ ] **Add Notes cases** covering the real behaviors, EN + DE:
      - bullet list of named items (plain + notion)
      - connected thoughts → prose paragraphs
      - multi-group dictation → sub-headings
      - TITLE rule: clear topic → adds title; bare list, no context → NO invented title
      - REQUEST RULE: "add the ingredients for a Spicy Margarita" → generates the content
      - ANTI-INVENTION: "I still need to buy stuff for the party" (no items named) → invents nothing
      → verify: `expect`/`forbid` guardrails encode the anti-invention + format checks.
- [ ] **Run the sampler**, then LLM-as-judge the output (Nick's stated preference: I judge, not him).
      → verify: 0 guardrail failures, 0 fallbacks; judge verdict recorded in a snapshot file.
- [ ] **Targeted fixes only** where output is genuinely off — no wholesale rewrite. Re-run after each.
      → verify: regression — re-run leaves the good cases unchanged; code eval still 18/18.

## Part B — Preview-card copy polish (`modes.preview.*`)

The per-profile example input→output cards (`renderer/settings.js`, EN @198–205, DE @351–358) are
fully present in both languages. STRATEGY decision (2026-05-24) says polish **includes** these —
"smoother and more mature, not throwaway." This is copy elevation, not a gap-fill.

- [ ] Elevate all 8 EN + 8 DE preview strings to the mature-SaaS bar — realistic professional
      contexts, register kept distinct across formal/casual/excited, short enough to fit the card.
- [ ] Render-check in-app: `npm start` → Profiles → each category × style, EN + DE.
      → verify: cards read polished and correct in both languages; no layout overflow.

## Surfaces to sync (CLAUDE.md §5)

- **Settings UI** — the preview strings ARE the Part-B change.
- **Onboarding / landing / changelog** — *no change*: Notes already shipped; this is quality
      refinement, not a new user-facing behavior. (Contrast: agent mode, which IS owed those.)
- **DESIGN.md** — no visual change.
- **STRATEGY.md** — Decision Log row (Notes eval outcome + preview polish) + refresh Product status.
- **NEXT_SESSION.md** — end-of-session update.

## Review (done 2026-05-24)

**Part A — Notes: diagnosed clean, NO prompt changes.** Built 14 Notes cases (corpus 59→73),
extended the sampler (`target` field + category filter arg), ran live: **14/14 clean, 0 guardrail
failures**. Anti-invention traps all held (announced-but-unnamed → invented nothing); title rule
correct both ways; plain-vs-Notion branch works EN+DE; request rule fires. Same verdict as Email/PM:
already good, fixing it would be over-engineering. Snapshot: [notes-eval-2026-05-24.md](notes-eval-2026-05-24.md).
Three minor cosmetic residuals logged there (Notion trailing spaces; verbose DE request output;
multigroup first-group sub-heading) — none worth a change.

**Part B — Preview cards: email + notes elevated; PM + code unchanged.**
- **Email (6 strings, EN+DE):** unified all three styles on one realistic scenario (reviewing Q3
  numbers) so the formal/casual/excited gradient is legible, and **removed the invented boilerplate**
  the old formal email still showed ("It was a pleasure discussing…", "Please don't hesitate to reach
  out…") — that was inconsistent with our own `_EMAIL_GUARDRAILS`, so this is a surface-sync fix.
- **Notes (2 strings, EN+DE):** throwaway grocery list → professional project note (title + action
  items) that actually demonstrates the smart structuring.
- **PM (6) + Code (2): no change** — already unified, realistic, at the bar; editing PM risked making
  personal messages sound corporate.

**Verification:** `node --check` + JSON + py_compile all pass. App launches, backend healthy on :7890.
Visual card render to be eyeballed by Nick after a Landa restart (low risk — copy-only in an unchanged
`pre-wrap`/`<br>` template; new email copy is shorter than the old, so no new overflow risk).

**Surfaces (§5):** Settings UI = the change. No onboarding/landing/changelog (refinement, not new
behavior). No DESIGN.md change. STRATEGY + NEXT_SESSION updated.

**Slice 2 deferred** to its own session (PM tone/format split — needs product decision + regression budget).
