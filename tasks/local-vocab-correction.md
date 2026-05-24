# Local vocabulary correction — make raw `landa-base` output smarter on-device (no LLM)

**Status:** PLAN ONLY (design captured 2026-05-24). Not built. Staged for the company-planning session to sequence.

## Goal
Make the **local** transcription path produce cleaner technical/dev text **without any cloud LLM call** — a deterministic, on-device post-pass over `landa-base` (whisper-small) output, run after `transcribe()` and before paste.

## Why this matters (and why it's NOT redundant with the code smart-style)
- The shipped "code" smart-style fixes the same class of errors, but via the **cloud polish LLM** (active-reconstruction prompt, [backend/landa_core.py](../backend/landa_core.py)).
- **Free-tier and offline users get no polish** — they see raw local transcription. A local correction pass is the only thing that improves *their* output.
- Deterministic = cheap, instant, no network, never hallucinates. Safe for the always-on local path.
- Relationship: **complement, not replacement.** Tier-1 deterministic corrections run locally for everyone; the cloud code prompt keeps doing the fuzzy contextual work for paid polish.

## Scope
- **IN:** deterministic lookup of known mistranscriptions → intended technical terms, gated by a confidence score; runs on-device.
- **OUT:** no LLM, no model swap, no new download (`landa-base` unchanged, must stay invisible — no visible model fetch).

## Confidence model
Correct only when we're confident the heard text is *wrong*, not merely similar to a technical term. Two independent factors, multiplied:
- **`P_err` (0–1)** — implausibility: how unlikely the heard text is as something a person meant. Non-word / OOV ("Claude Cold", "post grass") = **1.0**; common everyday word ("cash", "route", "Jason") = low (~0.1) unless context lifts it.
- **`P_sound` (0–1)** — phonetic fidelity (Double Metaphone / phoneme edit distance). Homophone / exact code match = **1.0**.
- **Confidence % = `P_err` × `P_sound` × 100.** Example: "Claude Cold" → "Claude Code" = 1.0 × 1.0 = **100%**.

Tiers:
- **Tier 1 — unconditional (~95–100):** heard form is a non-word AND a near-perfect phonetic match. Always safe (Claude Code, kubectl, Nginx, Postgres, OAuth, …). This is the bulk of the local win and carries ~zero false-positive risk.
- **Tier 2 — context-gated:** heard form is a valid English word (cash / route / Jason). The local pass has weak context vs. an LLM, so default conservative — skip, or use only the active-app/category signal (terminal/IDE) as the context input.

Policy: auto-correct ≥ 85; ignore < 50.

## In the flow (hotkey → output)
1. Hotkey pressed → record audio.
2. `landa-base` transcribes on-device → **raw text**.
3. **← this layer:** scan the raw text, apply Tier-1 corrections (+ gated Tier-2) → **corrected text**. Pure local string work, no network.
4. *Paid path only:* cloud polish runs on the already-corrected text. *Free/offline:* skipped.
5. Paste at the cursor.

## Where it sits
After local `transcribe()` output, before paste — independent of the reformat/polish LLM path. The active-app signal from `get_active_category` ([backend/landa_core.py](../backend/landa_core.py)) is the available context input for Tier 2.

## Latency / performance
**No perceptible latency.** This runs on the finished text (a few KB), not the audio, and after the expensive audio→text step. Table matching is an O(1) hash-map lookup; phonetic comparison (Double Metaphone) runs only on the few words that sound close — realistically **sub-ms to ~1 ms total**, below human perception and below existing variance. It is the *fast* path: it avoids the cloud LLM's network round-trip + inference entirely (the polish path has a 15 s reformat timeout). Caveats are implementation-only: (1) load the table + word-list once at backend startup (one-time, not per-dictation); (2) **precompute the table entries' phonetic codes at load** — re-encoding the dictionary per dictation would manufacture slowness that needn't exist.

## Open questions for the planning session
1. **Tier-2 in v1 or not?** Recommend Tier-1 only first — highest value, zero false-positive risk.
2. **Table size + maintenance:** curated list vs. learned from real corrections; how it's updated.
3. **On-device footprint:** phonetic lib + a word list for the `P_err` dictionary check — must not introduce a visible download.
4. **Coexistence detail:** when paid polish IS running, does the local Tier-1 pass run first (then the LLM), or is it skipped to avoid double-correction?
