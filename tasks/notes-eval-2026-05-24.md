# Notes profile — eval snapshot (2026-05-24)

**What:** First eval of the `notes` profile. Built 14 cases into `evals/everyday_profiles.json`
(corpus now 73) and ran them through the live reformat path via the sampler:

```
set -a && . ./.env && set +a
./backend/venv/bin/python evals/run_profile_samples.py notes
```

(The `notes` arg is a new substring filter; the sampler also gained a `target` field so Notes
cases can drive the plain-vs-Notion branch — `target: "notion"` stubs `_is_notion_target()` true.)

**Result: 14/14 clean. 0 guardrail failures, 0 proxy fallbacks. No prompt changes made.**

Same finding as the Email/PM session: the everyday prompts are thin-in-spec but already good. The
Notes prompt (`_NOTES_SMART_CORE` + plain/Notion variants + request rule + `_NOTES_GUARDRAILS`) is
solid and needed no targeted fixes — fixing it would violate "don't fix what isn't broken."

## Coverage (EN + DE)

| Behavior | Cases | Verdict |
|---|---|---|
| Buy/do list, plain target | `NO-buy-list-plain-en/de` | ✅ title + `- ` bullets, no Markdown |
| Buy/do list, Notion target | `NO-buy-list-notion-en/de` | ✅ `# Title` + `[]` checkboxes |
| Connected prose | `NO-prose-en/de` | ✅ paragraphs, no bullets |
| Multi-group → sub-headings | `NO-multigroup-en` | ✅ grouped (minor: 1st group unlabeled) |
| Title rule: clear topic | `NO-title-clear-en` | ✅ fitting title added |
| Title rule: bare list, no context | `NO-barelist-notitle-en` | ✅ no invented title |
| Request rule (generate content) | `NO-request-margarita-en`, `NO-request-packliste-de` | ✅ real content, instruction not echoed |
| **Anti-invention (announced, unnamed)** | `NO-antiinvention-party-en`, `NO-antiinvention-recipe-en`, `NO-antiinvention-de` | ✅ **invented nothing** |

## Minor cosmetic residuals (not defects, no fix)

1. Notion checkbox lines carry trailing double-spaces (`[] Tent  `) — harmless Markdown hard-breaks.
2. German request-rule generation can run long (24-item ski Packliste vs tight 7-item margarita) — verbose, not wrong.
3. Multi-group: the first group's items sit under the title without their own sub-heading while later
   groups get one — slight inconsistency, still readable.

Carry these into any future tightening pass; none blocks anything today.
