# Windows transcription: speed + silent-loss fixes (deferred)

Status: **investigated, not yet implemented.** Picked up from the Windows tester's
backend log (see chat 2026-05-23). Implement in a dedicated session.

## TL;DR
On slow Windows hardware, recordings that take >30 s to transcribe are **silently lost**
— the user speaks, nothing pastes, no error. Two compounding problems: (a) transcription
is slow, and (b) the stop→paste path on Windows has a 30 s cliff with no fallback.

## Evidence (tester log)
- Recording 1: 37 s audio → `transcribe total: 92.781s`. `/stop` returned `text_len=0`
  at exactly 30.228 s (timeout), the work finished 62 s later, text never pasted.
- Recording 2: 28 s audio → transcribed in 29.2 s (just under the cliff) → 447 chars,
  pasted fine.
- Recording 3: 4.5 s clip → language mis-detected as Thai (`th`, prob 0.39) → empty.
- Warm transcription ≈ 1× real-time (29 s for 28 s audio) — slow for int8 "small".
  Mic is an "Intel Smart Sound" array → a modest laptop CPU.

## Root causes
1. **30 s cliff + no Windows fallback (CRITICAL — silent data loss).**
   - `/stop` runs transcription in a background thread and waits `_transcription_ready`
     up to **30 s** (`backend/landa_core.py:2845`), then returns whatever it has.
   - On Windows the ONLY paste path is the `/stop` response text (`main.js:481-487`).
   - The poll-based fallback (`status.pending_paste`) is **macOS-only** (`main.js:1493`,
     gated to `darwin`). And `paste_text` on win32 never writes the clipboard — it
     `return`s early (`backend/landa_core.py:1102-1110`), so the late result has no
     consumer. Text produced after 30 s is dropped on the floor.
2. **Slow decoding.** `beam_size=5` on the local faster-whisper path
   (`backend/landa_core.py:2305`) is ~3–5× slower than greedy for marginal dictation
   gain. Biggest single lever.
3. **Auto language detection** runs a separate pass before transcription when language is
   `auto` (~8 s on the 37 s clip). Onboarding defaults language to `auto`
   (`renderer/onboarding.js:300-301`).
4. Weak CPU — inherent; can't fix in code, but the above make it survivable.

## Proposed fixes (in priority order)
- [ ] **#2 first (quick win): `beam_size=5` → `1`** for local faster-whisper.
      `backend/landa_core.py:2305`. ~3–5× faster; most recordings stop hitting the cliff.
      Low risk. Verify transcription still accurate on a German + English sample.
- [ ] **#1 (the real fix): stop losing text on Windows.** Give Windows the same async
      paste path macOS has, carrying the text:
        - backend: add a small endpoint (e.g. `GET /consume-paste`) that returns
          `_transcription_text` and clears `_pending_paste`/`_transcription_text` atomically.
        - `main.js` status poll: add a `win32` branch — when `pending_paste` is true, fetch
          the text, `clipboard.writeText`, send Ctrl+V, then `/acknowledge-paste`.
        - dedup: fast path (`/stop` returns text within deadline) already sets
          `_pending_paste = False` (`landa_core.py:2847`), so the poll won't double-paste.
      Verify: a recording engineered to take >deadline still pastes when ready.
- [ ] **#3 (safety net): raise the 30 s deadline** (`landa_core.py:2845`) and the matching
      35 s HTTP timeout (`main.js:238` `stopRecording`). Keeps long clips working while #1
      lands. Keep HTTP timeout > backend deadline.
- [ ] **#4 (accuracy + speed): pin language when the user chose one** instead of always
      `auto`, so short clips don't mis-detect and we skip the detection pass. Touches the
      onboarding language default and/or `transcribe()` language arg.

## Verification checklist
- Backend responds on localhost:7890.
- Short clip (~3 s), medium (~30 s), long (~60 s) all paste correctly on Windows.
- Long clip that exceeds the deadline still pastes (no silent loss).
- German and English both transcribe accurately with beam_size=1.
