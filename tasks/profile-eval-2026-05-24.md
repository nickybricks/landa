# Everyday-profiles polish + agent mode — eval snapshot (2026-05-24)

Covers the **Email + Personal Message** prompts: (1) the targeted polish, and (2) **agent
mode** (compose-from-instruction). Snapshot for Nick's blind rating, same gate as the code
profile. Reproduce (55 cases, ~2 min — calls are spaced to avoid the proxy rate-limit):
`set -a && . ./.env && set +a && ./backend/venv/bin/python evals/run_profile_samples.py`.
(LLM output varies run to run — rate the *behavior*, not exact words.)

Corpus: `evals/everyday_profiles.json` — **59 cases** (31 email, 28 PM), across
business / private / personal personas, EN+DE, all styles, plus edge cases (numbers,
self-correction, non-native phrasing, already-clean, venting/tone, multi-topic, tiny inputs)
and **4 adversarial agent-mode misfire traps** (see below).
Latest run: **59/59 fired, 0 guardrail failures, 0 proxy fallbacks**. The known
*intermittent* widening on `EM-biz-followup` ("loop in Sarah" → "future communications") did
not fire this run; it catches most runs but not every run (see watch-outs).

> **Full input→output for all 55 cases:** [tasks/profile-eval-results-2026-05-24.md](profile-eval-results-2026-05-24.md).
> This file is the curated highlights; that one is the complete transcript.

---

## Agent mode (NEW — auto compose-from-instruction, no toggle)
The Email/PM prompts now auto-detect whether the dictation is the **message** (cleaned
verbatim, the usual path) or an **instruction** to compose (third-person recipient +
directive verb). Code stays excluded. Live-verified compositions:

| instruction (one-line dictation) | composed output |
|---|---|
| tell her I am so sorry about yesterday and that I will make it up to her this weekend | I'm really sorry about yesterday. I'll make it up to you this weekend. |
| reply to mom that I will be there for dinner on sunday and ask if I should bring anything | I'll be there for dinner on Sunday. Should I bring anything? |
| sag ihm dass ich es heute leider nicht schaffe aber morgen auf jeden fall vorbeikomme | Ich schaffe es heute leider nicht, komme aber morgen auf jeden Fall vorbei. *(du kept)* |
| write her a reply saying I cannot make friday but monday works and apologize for the short notice | Hello, / I am writing to let you know that I am unable to meet on Friday. However, Monday works for me. I apologize for the short notice. / Best regards, |
| answer the customer explaining that we will refund the order within five business days and apologize | Hello, / We will process a refund for your order within five business days. We apologize for any inconvenience this may have caused. / Best regards, |

Composes only the given points; **no invented facts**; preserves du. Two compose-path bugs
were caught + fixed mid-build: a residual "I hope this message finds you well" opener and a
literal "[Name]" placeholder when no recipient was named (now uses the no-name greeting).

**Rate agent mode on:** did it correctly tell instruction from message? did it invent
anything? **Misfire watch:** a literal message read as an instruction (or vice-versa).

### Adversarial misfire probe (4 boundary traps, 2026-05-24) — PASSED 4/4
Added to close the coverage gap: the original corpus only tested clearly-an-instruction vs
clearly-a-message. These four sit on the heuristic boundary. **Detection was correct in both
directions, including the two hardest:**

| trap | input | should | result |
|---|---|---|---|
| `PM-trap-tell-literal` | "tell me honestly did you like the place…" | NOT compose | ✅ stayed verbatim ("Did you actually like the place, or were you just being polite?") — directive verb "tell" did not false-trigger |
| `PM-trap-thirdperson-mention` | "did you hear sarah got the job, celebrate with her…" | NOT compose | ✅ stayed verbatim — a third-person *mention* alone didn't trip compose |
| `EM-trap-noverb-instruction` | "an email to the team letting them know the office is closed friday…" | COMPOSE | ✅ composed the notice without a directive verb to cue it |
| `EM-trap-2ndperson-instruction` | "reply that **you** are happy with the offer but **you** need it in writing…" | COMPOSE + flip person | ✅ composed AND shifted "you are happy" → "**I** am happy" (the misfire would've addressed the recipient) |

**One residual (not a detection miss):** the compose path adds mild **courtesy filler** the
instruction didn't give — e.g. "please plan accordingly… thank you for your understanding and
cooperation", "Thank you for the offer." It's tone padding, not invented facts/commitments, so
lower-severity than the followup-widening — a candidate for a future "no closing courtesy
filler" tightening, not a blocker.

---

## What changed (3 targeted fixes — see `backend/landa_core.py`)
1. **Emoji is now controlled solely by the toggle.** `get_mode_prompt` adds an explicit
   "Do not use any emojis" when the toggle is off, so the *Excited* style no longer
   sprinkles (or stacks) emojis on its own.
2. **PM formal / casual / excited now read distinctly** — each style prompt got a clear
   register rule + a worked example (formal = full punctuation & closing period; casual =
   loose, light punctuation, may drop a trailing period; excited = energy via words +
   exclamation, no emoji).
3. **Formal email no longer invents pleasantries** — tightened `_EMAIL_GUARDRAILS` so
   greetings/sign-offs stay but unspoken filler ("I hope you're well", "ich hoffe, es geht
   Ihnen gut", request-padding like "in future communications") is dropped.

Guardrails (Sie/du, anti-invention) re-checked: **0 failures**. Code eval: **18/18**, no
regression.

---

## Same input, three PM styles (the differentiation proof)
> in: "hey so I was thinking we could grab dinner this weekend maybe try that new place you mentioned let me know if you're free"

- **formal:** Hey, I was thinking we could grab dinner this weekend and try that new place you mentioned. Let me know if you're free.
- **casual:** Hey, was thinking we could grab dinner this weekend, maybe try that new place you mentioned. Let me know if you're free
- **excited:** Hey, I was thinking we could grab dinner this weekend! Maybe try that new place you mentioned? Let me know if you're free!

---

## Fix 1 — emoji (toggle OFF ⇒ emoji-free)
| case | before | after |
|---|---|---|
| PM-EN-excited | …move in next month! I can't believe it! **🎉🏠** | …I can't believe it! *(no emoji)* |
| PM-DE-excited | …unbedingt feiern! **🎉🥳** | …unbedingt feiern! *(no emoji)* |
| PM-EN-casual (toggle **ON**) | Happy birthday! 🎉 … | Happy birthday! Hope you have an amazing day 🎉 … *(exactly one, inline)* |

## Fix 3 — formal email boilerplate dropped
**EM-DE-formal-Sie**
- before: "Sehr geehrter Herr Müller, **ich hoffe, es geht Ihnen gut.** … Ich würde mich freuen, wenn wir einen Termin finden könnten."
- after: "Sehr geehrter Herr Müller, ich möchte mich bezüglich des Angebots … bei Ihnen melden. … Könnten wir dazu nächste Woche telefonieren?"

**EM-EN-formal-1** — "loop in Sarah" was → "include Sarah **in future communications**"; now → "include Sarah **in these discussions**" (anchored to the spoken topic). Dropped "Additionally,".

**EM-EN-excited** — was "fantastic news to share! …exciting opportunity. …to get things rolling!"; now "exciting news! …I'm super pumped about this! Let's set up a kickoff meeting next week." (less gushy, fewer invented clauses).

---

## Watch-outs to probe in the blind A/B
- **Agent-mode misfire:** the line between "message" and "instruction" is a heuristic
  (third-person recipient + directive verb). Probe edge cases — e.g. a literal message that
  happens to start "tell me…", or an instruction phrased in the second person.
- **Intermittent request-widening:** `EM-biz-followup` still occasionally renders "loop in
  Sarah" → "future communications" (1/55 in the final run; correct on most runs). The
  guardrail forbids it but the model isn't 100% deterministic. Decide if that residual rate
  is acceptable.
- **German excited register:** excited-DE sometimes renders "ich **habe** / mit **einer** Eins"
  where a real excited text keeps the contractions "ich **hab** / **'ner**". Check if it feels too prim.
- **Casual dropping the trailing period** is intentional (texting feel) — confirm you like it.
- Confirm the boilerplate suppression doesn't make formal email feel *curt* on longer dictations.

## Rating (fill in)
Per case: 👍 / 👎 / note. Overall: did the polish move Email + PM toward the mature-SaaS bar without losing your voice?
