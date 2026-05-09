# Lexicons — Plan

> Goal: ship downloadable domain vocabulary packs that improve Whisper transcription accuracy. First lexicon: **German Medical**. Free for all users in v1 to gather real-world feedback. Pricing/licensing deferred to a later phase.

## Approach (decided)

- **Tier 1 only for v1:** post-processing correction. Whisper transcribes normally; a phonetic-index correction pass swaps misrecognized words to canonical lexicon terms. No coupling to whisper.cpp or faster-whisper internals — the same `.lex` file works on Mac and Windows.
- **Pricing:** **free in v1.** No license server, no checkout, no JWT gating. Lexicons download directly from our static host. We ship pricing later (likely Stripe + a 30-day trial) once the correction engine is validated.
- **First lexicon:** German Medical, sourced from ICD-10-GM, OPS, German MeSH, **PharmNet.Bund** (drug names) and **ATC/WHO active-ingredient names** — all freely redistributable. ABDA Arzneimittel confirmed not redistributable; substituted with PharmNet.Bund + ATC.

## Why post-correction (not initial_prompt or logit biasing)

- `initial_prompt` is capped at ~224 tokens (≈50–80 medical terms). Cannot host a 180k-term lexicon.
- True logit biasing requires custom decoder hooks. `faster-whisper` exposes `hotwords` (still prompt-bound under the hood). `pywhispercpp` doesn't expose a clean logits processor. Real implementation is weeks of engineering, platform-specific.
- Post-correction is backend-agnostic, ships in days. The math (180k terms / ~15 MB ≈ 85 bytes per entry) supports a phonetic-keyed dictionary + weighted edit distance comfortably.

---

## Architecture

### `.lex` file format (versioned, signed)

Single binary file (zstd-compressed msgpack):

```
{
  "manifest": {
    "id": "de.medical",
    "name": "Medical",
    "language": "de",
    "version": "2026.05.1",
    "term_count": 178432,
    "size_bytes": 15300000,
    "sources": ["ICD-10-GM 2026", "OPS 2026", "German MeSH 2026", "PharmNet.Bund 2026", "ATC/WHO 2026"],
    "issued_at": "2026-05-08T00:00:00Z"
  },
  "phonetic_index": { "<koelner_phonetik_key>": [<term_idx>, ...] },
  "terms": [
    { "surface": "Myokardinfarkt", "freq": 0.92, "tags": ["icd10"] },
    ...
  ],
  "signature": "<ed25519 signature over manifest+phonetic_index+terms>"
}
```

- **Signing:** Landa-owned ed25519 keypair. Public key embedded in the app. Tampered files refuse to load. (Keeps the format ready for paid lexicons later — same format, same signing path.)
- **Storage location:** `app.getPath('userData')/lexicons/<id>.lex`.

### Post-correction pipeline (`backend/landa_lexicon.py`)

```
load_lexicons(active_ids: list[str], language: str) -> LexiconSet
LexiconSet.correct(text: str) -> str
```

Algorithm per recognized word:
1. Skip stopwords / very common German words (small frequency dict).
2. Skip if word is already in the lexicon (Whisper got it right).
3. Compute Kölner Phonetik key (German). Other languages later: Double Metaphone.
4. Look up phonetic neighbors in active lexicons.
5. Score candidates: weighted edit distance × term frequency × source authority.
6. If best candidate scores above threshold, swap. Preserve original casing strategy.
7. Multi-word terms: after single-word pass, run a sliding-window pass over 2- and 3-grams.

Hook: called from `transcribe_audio()` in `landa_core.py` immediately after Whisper returns, **before** any LLM reformat step. Reformat then sees correctly-spelled medical terms.

### Electron UI

New Settings section: **Lexicons**.
- "Available" list (fetched from `https://lexicons.landa.app/index.json`):
  - Each entry: name, language, term count, size, sources, "Install" / "Installed ✓" / "Update available".
- "Installed" list:
  - Toggle on/off per lexicon. A German lexicon only activates when dictation language is German.
  - "Update available" badge if remote version > installed version.

Follows existing `DESIGN.md` tokens. No hard-coded colors/fonts.

### Backend integration points

- `backend/landa_core.py`:
  - Load active lexicons at app start (config key `active_lexicons: ["de.medical"]`).
  - In `transcribe_audio()`, after Whisper returns, call `LexiconSet.correct(text)` if any active lexicon matches the detected/configured language.
  - New `/lexicons` HTTP endpoints (list installed, install, toggle, uninstall).
- `renderer/`:
  - New tab/section. New IPC channels via `preload.js`.

---

## Phases & verification

### Phase 0 — Spec + research (½ day) ✅ done 2026-05-09

- [x] **ABDA licensing — confirmed not redistributable.** ABDATA licenses raw data to software houses under commercial agreements; no free redistribution path.
  - **Substitute:** **PharmNet.Bund** (BfArM-run, official German drug authorization DB, free for publication) + **ATC/WHO active-ingredient names** (public). Transcription only needs the *terms*, not pricing/dosage/PZN.
  - Gap: no rare trade-name synonyms; acceptable for v1, revisit on user feedback.
- [x] **Pricing — free in v1.** Strip the license server, JWT gating, and checkout from scope. Ship the lexicon to all users to validate the correction engine and gather real-world data. Revisit commerce after Phase 5.

### Phase 1 — `.lex` format + post-correction core ✅ done 2026-05-09
- [x] **`backend/landa_lexicon.py`** — combined format reader + correction pipeline. zstd+msgpack body, ed25519 signature, Kölner Phonetik index, first-letter+length fallback bucket, edit-distance scoring, German stopword skip list, case preservation.
- [x] **`backend/tests/test_lexicon.py`** — 9 tests: load valid, reject tampered, reject wrong-key signature, recover 10/10 misrecognized medical terms in canonical-form sample, **0 false corrections** on 8 control sentences of everyday German, case preservation.
- [x] **Hook in `landa_core.py`** — `apply_lexicon_correction(text)` called between `post_process` and `apply_vocabulary_replacements` in both batch and realtime paths. Lazy-loads + caches the active `LexiconSet` per language. Config key: `active_lexicons: []` (empty by default — no behavior change for existing users until Phase 3 ships the install UI).
- [x] **End-to-end smoke** verified outside tests: building a 4-term lexicon and feeding `"Myokardinfakt mit Hyperthonie. Ibuprofin."` returns all three terms correctly.
- [ ] **Real-recording verification** — deferred to after Phase 3 ships the install UI; manual test once a real `.lex` is on disk.

### Phase 2 — Lexicon build pipeline (1–2 days)
- [ ] Script `tools/build_lexicon_de_medical.py` that pulls ICD-10-GM, OPS, German MeSH, PharmNet.Bund, ATC/WHO, normalizes, deduplicates, computes phonetic keys, signs with our private key, outputs `de.medical.lex`. **Verify:** output is reproducible (same inputs → byte-identical output) and loads cleanly.
- [ ] Build the v1 file. **Verify:** term count in the right ballpark (150k–200k); spot-check 20 random terms exist in source data.

### Phase 3 — Settings UI + install flow (1–2 days)
- [ ] Lexicons section in Settings. List, install, toggle, uninstall. **Verify:** install pulls from the real host; toggle persists across restarts.

### Phase 4 — Hosting + release (½ day)
- [ ] Host `de.medical.lex` on R2 / S3 with public read. Host `index.json` listing all available lexicons.
- [ ] Add lexicon-related strings to README.
- [ ] Bump version (**minor** per `CLAUDE.md` — new feature). Tag, push, let CI build & release.

### Phase 5 — Quality measurement (ongoing)
- [ ] Build a 200-sentence German medical eval set (with ground truth). Run with/without lexicon. Publish accuracy numbers — makes any future marketing claim defensible.

### Future (out of scope for now)
- **Commerce.** When we add it, the choice is **Stripe** + a small license server (Cloudflare Worker + KV), 30-day trial, JWT-gated lexicon downloads. The `.lex` format already carries an ed25519 signature so adding license gating is additive — nothing in v1 needs to change.

---

## Things we are explicitly **not** doing in v1

- Logit biasing inside the decoder. Defer until v2 once post-correction is validated.
- Per-app context (e.g., "in Mail, prefer formal medical phrasing").
- Pricing, license server, checkout, JWT gating, device caps. Deferred.
- DRM-grade obfuscation of the `.lex` file. Signed but not encrypted.
- Lexicon authoring UI for end users.

---

## Risks / open questions

1. ~~**ABDA licensing**~~ **Resolved 2026-05-09:** using PharmNet.Bund + ATC as substitute.
2. **False corrections on common words** — biggest accuracy risk. Mitigated by: stopword skip list, threshold tuning on the eval set, never correcting Whisper-confident tokens (`faster-whisper` exposes per-token confidence; `pywhispercpp` doesn't as cleanly — fall back to length/edit-distance gating).
3. **PharmNet.Bund bulk export format** — verify the actual download endpoint and licensing fine-print before Phase 2 build pipeline.

---

## Review

(filled in when done)
