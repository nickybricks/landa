# Lexicons — Plan

> **Status (2026-05-09): parked for v1.** Phases 1–2 shipped (format, signing, build pipeline, real `de.medical.lex`). Empirical accuracy gating revealed an architectural limit — see [Phase 2 outcome](#phase-2-outcome--v1-decision-2026-05-09) below. Reviving the feature in v2 requires a different correction signal (Whisper per-token confidence). All work product is preserved for that.

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

### Phase 2 — Lexicon build pipeline ✅ done 2026-05-09
- [x] **`tools/build_lexicon_de_medical.py`** — parses ICD-10-GM 2026 (Klassifikationsdateien CSV), OPS 2026 (Klassifikationsdateien CSV), German MeSH 2025 (XML, filtered to clinical branches A/C/D/E, DescriptorName + ConceptName only — Term/String dropped to reduce English noise), PharmNet.Bund 2026-01-05 (bezvo.csv, HBEZ1/2/3 + SYN columns), ATC/WHO amtlich 2026 (XLSX, leaf substances only at code length ≥7). Build is reproducible — same inputs → byte-identical SHA256.
- [x] **Signing key** — ed25519 keypair generated. Private key at `~/.findmyvoice/landa_lexicon_ed25519.pem` (chmod 600, outside repo). Public key embedded in `backend/landa_lexicon.py`.
- [x] **`backend/data/german_top2000.txt`** — top-2000 German frequency list (Hermitdave OpenSubtitles 2018 derivation). Loaded into `_GERMAN_STOPWORDS` at module import.
- [x] **Length-aware threshold** — replaced flat `score_threshold=0.55` with per-input-length thresholds (`_threshold_for_length`). Threshold gates similarity directly; freq is now a tiebreaker, not a multiplier.
- [x] **v1 file built**: `tasks/lexicons-data/build/de.medical.lex` — 47,331 single-token medical terms, ~600 KB compressed, signed, loads cleanly with embedded trust root. (Multi-word entries dropped: the runtime correction pass handles single tokens only; n-gram support remains "future work" per [landa_lexicon.py](../backend/landa_lexicon.py).)

### Phase 2 outcome — v1 decision (2026-05-09)

**Empirical accuracy gate failed. Feature parked for v1.**

Before greenlighting the install UI (Phase 3), I ran the correction pipeline against ~50,000 real German sentences from Tatoeba (`/tmp/german_corpus.txt`, 768k available, 50k sampled with seed 0).

| Setting | Medical recovery | Corpus mangle rate |
|---|---|---|
| Length-aware (0.95 / 0.85 / 0.75) + 2k-word stoplist | 5/6 typo fixes | **1.61% of words** (32× the 0.05% pass criterion). 5,556 / 50,000 sentences mangled. |
| Flat 0.95 across all lengths | **0/8** real typo fixes | 0.0013% of words ✓ — but feature is dead at this setting. |

Sample false corrections at the 0.85/0.75 setting: *Australien → Australis*, *Sprachen → Sprechen*, *schwimmen → Schwämme*, *Politiker → Positiver*, *Deutschen → Duschen*, *kochen → Knochen*, *verbracht → Verdacht*. Pattern: 6–9 char German nouns/verbs collapsing into phonetically-close Latin/Greek lexicon entries within 1–2 edits.

**Architectural conclusion.** Edit-distance scoring on a 47k-term Latin/Greek lexicon cannot distinguish *"rare or inflected German word"* from *"Whisper typo of a medical term"* — they look identical at the spelling level. No threshold setting satisfies both:
- safety bar (≤0.05% of everyday words modified) **and**
- value bar (catches the actual Whisper typos: Myokardinfakt → Myokardinfarkt, Hyperthonie → Hypertonie, Bronchidis → Bronchitis, etc.)

The plan listed this as risk #2 and pushed the fix to "Phase 5 threshold tuning". Threshold tuning is what was tried — it doesn't work without an additional signal.

**What we kept** (reusable for v2):
- Build pipeline + signing key + `.lex` format — production-grade
- The 50k-sentence corpus measurement methodology
- Length-aware threshold + 2k-word stoplist in [landa_lexicon.py](../backend/landa_lexicon.py) (no behavior change because `active_lexicons` defaults to empty)

**What we did not ship:**
- Phase 3 (install UI), Phase 4 (hosting), Phase 5 (200-sentence eval set)

### Phase 3 — Settings UI + install flow (PARKED — see Phase 2 outcome)
- ~~Lexicons section in Settings.~~ Do not build until v2 has a viable correction architecture.

### Phase 4 — Hosting + release (PARKED)
- ~~Host `de.medical.lex` on R2 / S3.~~ The built file is at `tasks/lexicons-data/build/de.medical.lex` if/when needed.

### Phase 5 — Quality measurement (PARKED — but partially done)
- The 50k-sentence Tatoeba run *was* the quality measurement. It killed the feature for v1. A 200-sentence curated eval set is unnecessary unless v2 architecture changes the equation.

### Future (out of scope for now)
- **v2 — per-token Whisper confidence.** The right path forward, if we ever revisit. `faster-whisper` exposes per-token logprobs; `pywhispercpp` does not as cleanly. Architecture: only attempt correction on tokens flagged low-confidence by Whisper itself, leaving high-confidence everyday words untouched. Estimated effort: several days, requires plumbing in `landa_core.py`. Worth doing only if user feedback strongly demands medical-vocabulary accuracy and we're prepared to gate on the macOS/Windows backend asymmetry.
- **Commerce.** When we add it (post-v2), the choice is **Stripe** + a small license server (Cloudflare Worker + KV), 30-day trial, JWT-gated lexicon downloads. The `.lex` format already carries an ed25519 signature so adding license gating is additive.

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
2. ~~**False corrections on common words**~~ **Materialized 2026-05-09:** this risk killed the feature for v1. See [Phase 2 outcome](#phase-2-outcome--v1-decision-2026-05-09). Threshold tuning + 2k-word stoplist were not enough; the only setting that meets the safety bar (flat 0.95) zeroes out medical recovery. v2 needs Whisper per-token confidence as the gating signal.
3. ~~**PharmNet.Bund bulk export format**~~ **Resolved 2026-05-09:** parsed bezvo.csv (HBEZ1/2/3 + SYN columns) cleanly.

---

## Review

**2026-05-09 — feature parked for v1.**

Time spent: ~4 hours across Phase 0/1 (prior session) and Phase 2 (this session, including key generation, build script, source data download, corpus measurement).

What worked:
- The `.lex` format, signing pipeline, and reproducibility are solid. Build script is small (~250 lines), reads from local files only, fails loudly on missing inputs.
- Corpus-based accuracy measurement is the right gate. 50k Tatoeba sentences in ~10 minutes gave a clear, defensible verdict.

What didn't:
- The plan underestimated false-correction rates by ~30×. Phase 1 unit tests passed cleanly with a 22-term test fixture, which gave false confidence. Real lexicon scale (47k terms) made every common word a false-correction target.
- Threshold tuning was assumed to be sufficient; it isn't. The signal-to-noise problem requires a different signal entirely.

Lessons for v2 or similar features:
- Always validate accuracy with a real-text corpus before building UI. Synthetic tests scale nothing.
- "Phase 5 will tune the thresholds" is not a real plan — empirical gating belongs *before* commitments to UI/release.
