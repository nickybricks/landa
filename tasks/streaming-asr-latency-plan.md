# Streaming transcription — how we match Wispr Flow / Willow Voice speed (plan)

**Status:** PLAN ONLY (2026-05-25). Architecture decided in direction; execution gated on the
EU entity + vendor track (same blockers as the polish flip). The *client-side* groundwork and the
*offline path* are buildable now; the EU streaming backend is not.

**Decision that motivates this:** the wedge is **EU-hosted + zero-retention**, NOT on-device. So
streaming audio to an EU endpoint is acceptable, and cloud streaming is now the **primary** path.
Local transcription becomes the **offline fallback**, shown in the UI. (Reverses the 2026-05-23
"streaming OUT" and 2026-05-24 "local-only" calls — see STRATEGY Decision Log 2026-05-25.)

---

## 1. How Wispr Flow actually does it (teardown of a real client log, 2026-05-25)

The whole speed story is **transcribe in the cloud while the user is still talking**, then run
ASR + formatting as **one fused server step** on warm GPU infra (Baseten / TensorRT-LLM).

### 1a. ASR time barely scales with how long you spoke
Pulled from the log's `Request completion metrics (gRPC)` blocks:

| Spoke | server ASR | format (LLM) | network | stop→paste (perceived) |
|------:|----------:|-------------:|--------:|----------------------:|
| 45.9s | **441ms** | 259ms | 153ms | ~1004ms |
| 8.2s  | 402ms | 99ms | 134ms | ~700ms |
| 8.0s  | 186ms | 71ms | 170ms | ~496ms |
| 7.8s  | 454ms | 126ms | 154ms | ~816ms |
| 2.2s  | 250ms | 58ms | 176ms | ~606ms |
| 2.0s  | 152ms | 37ms | 129ms | ~394ms |
| 1.6s  | 161ms | 43ms | 219ms | ~516ms |

A **45-second** clip transcribes in **441ms**. Only possible because audio was already being
transcribed during recording. The log's heartbeat right before stop proves it:
`server has 45.8 s, client sent 45.9 s, lag 0.1 s` — the server had processed 45.8 of 45.9 seconds
*before the key was released*. Stop→paste is therefore near-constant (~0.4–1.0s) regardless of length.

### 1b. ASR + format + post-process are ONE round-trip
Every block's `componentTimes` shows `transcribe → format → post_process → total` in a single gRPC
stream completion. There is **no second client→LLM hop**. The format step is **37–259ms** — that is
a small fine-tuned model on warm dedicated GPUs, not a big general model.

### 1c. Context is prefetched DURING recording (this is why the email formatting is good *and* fast)
Fired on hotkey-down, in parallel, streamed to the server over the open gRPC stream:
- `/llm/extract_asr_words` → pulls proper nouns from screen (`Extracted 4 proper nouns`), biases ASR toward names.
- macOS **Accessibility** scrape (`AX context collection took 512–1004ms`, `AX Context item lengths: 15,11,6,7`) → the focused field + nearby text.
- **App-type classification** (`App type: email, windowTitle: New Message`) streamed as a `context update` → the formatter knows you're composing a new email in Mail.
- Per-context **personalization styles** synced server-side: `{ work: 'formal', email: 'casual', personal: 'casual', other: 'excited' }`.

By the time the key is released, the server already has the transcript, the names, the app type, and
the style — formatting is just a 50–250ms finish.

### 1d. Warm connection + cheap transport
- gRPC `TranscribeStream` to `model-…grpc.api.baseten.co:443` opened at hotkey-down.
- TCP ping + `/warmup` fired at start (`Baseten ping time: 218`) so the stream is hot when audio flows.
- Audio: **16 kHz mono, OPUS via WebCodecs**, `echoCancellation/noiseSuppression/autoGainControl: false`.
- Steady network overhead ~130–220ms (HTTP/2, no per-request handshake).

### 1e. Privacy reality
`privacy_mode: true` and `Usage data sharing is off` **still stream the audio out** — "privacy" here
means zero-retention cloud, not on-device. Wispr does **nothing** offline. That is the exact gap Landa
keeps as a differentiator (offline fallback) while matching the speed online.

## 2. Willow Voice (from research, no log — treat as vendor claims)
Same family: cloud-first hybrid, markets ~200ms latency and per-user personalization, auto-removes
`um/uh` without dropping content, and ships an offline mode. Less verifiable than the Wispr teardown,
but architecturally the same bet: streaming cloud ASR + fast formatting + a local fallback.

---

## 3. Landa target architecture ("Wispr's model, but EU-resident")

```
hotkey-down ──► open persistent stream to EU ASR endpoint (warm it: ping/handshake)
            └─► start mic capture (16 kHz mono, OPUS) ──► stream chunks live
            └─► gather active-app context (app type, focused-field) ──► send as context msg
   …user talks; server transcribes incrementally, stays caught up…
hotkey-up  ──► flush final audio ──► server finalizes ASR ──► fused format pass ──► return final text
            └─► paste at cursor (save+restore clipboard)
OFFLINE    ──► stream can't connect ──► local landa-base (bundled, no download) [+ deterministic
               vocab correction] ──► paste raw ──► show "Offline" badge in the pill
```

The five levers, mapped to what we already have:
1. **Stream during recording** — the core win. New: persistent connection + live chunking. (Today `landa_streamer.py` buffers everything and transcribes after stop.)
2. **One fused ASR→format step server-side** — eliminates Landa's current second hop (local transcribe → separate proxy `/api/reformat` round-trip to gpt-4o).
3. **Context prefetch during recording** — extend the existing `get_active_category()` / kicked-off active-app detection to send the app-type/style signal up the stream.
4. **Warm connection at hotkey-down** — pre-open + ping the endpoint (Wispr's `/warmup`).
5. **Offline fallback + UI** — bundled `landa-base` (already ships, ~490 MB, **zero extra download**) + the planned deterministic vocab correction (no model). Surface an offline indicator.

## 4. Component build plan

**Client (Electron renderer / `main.js` / `backend`):**
- Capture 16 kHz mono; OPUS-encode (WebCodecs `AudioEncoder`, or an opus lib) for a small wire payload.
- Open a **persistent streaming connection at hotkey-down** (WebSocket is simplest in Electron; gRPC-web is the alternative) and warm it (handshake/ping) before first audio.
- Stream encoded chunks as they arrive; on hotkey-up send an end-of-stream marker and await the final formatted text.
- Send a **context message** (app type from `get_active_category`, optionally focused-field text) early in the stream.
- **Offline detection:** if the connection can't be established/keeps failing, fall back to the local path and set an "Offline" UI state on the recording pill.

**Backend ASR service (NEW, EU-resident, zero-retention — the gated piece):**
- A **persistent streaming service** — NOT Vercel serverless (the ~4.5 MB body cap + request/response model don't fit streaming audio). A small EU GPU/CPU box or a managed EU streaming-STT vendor.
- Streaming ASR model (RNNT/transducer streams partial results well): self-hosted faster-whisper/whisper-streaming or NVIDIA Parakeet-streaming, or a managed **EU-resident** STT (e.g. Gladia (FR), Speechmatics — must sign zero-retention/no-train, no disk persistence of audio).
- **Fused formatting** in the same service: as soon as ASR finalizes, run the format/style prompt on the transcript and return the final text in one response. Reuse Landa's existing mode prompts (`MODE_SYSTEM_PROMPTS`); the style/app-type comes from the context message. Prompt-cache the static rules.
- Format model must also be **EU-resident + zero-retention** (same gated track as the Vertex/Claude polish flip).

**Offline path (buildable NOW, unblocked):**
- Keep `landa-base` local transcription as the fallback (already bundled).
- Add the deterministic **vocab correction** pass (`tasks/local-vocab-correction.md`) so offline output is still cleaned up without a model — no download, no LLM.
- UI: an "Offline — local transcription, no polish" badge on the pill so the user understands the degraded mode (per Nick's call to surface it).

## 5. Latency budget we're aiming for (mirrors the teardown)
- Stop→paste: **< ~1s** for any clip length (constant, because ASR is streamed).
- Server format: **< 300ms** (small/fast model, warm, prompt-cached).
- Network: **< 200ms** (EU box, warm connection).
- Offline: bounded by local CPU (~1× realtime today) — acceptable as the fallback, and improvable later by overlapping local transcription with recording.

## 6. Dependencies / blockers
- **EU streaming-ASR + format backend** is the critical new piece and is **gated on the legal entity + EU vendor approvals** (Anthropic quota denied; OpenAI-EU sales-gated). Until then there is no EU streaming endpoint to point at.
- Persistent-connection infra (a real service, not Vercel) must be stood up EU-side, zero-retention (no audio at rest).
- Windows stop→paste path needs parity (today it has the 30s cliff / silent-loss issue — see `tasks/windows-transcription-speed-plan.md`); streaming changes the stop path, fix together.

## 7. Open questions
1. Transport: **WebSocket vs gRPC-web** in Electron (lean WebSocket for simplicity unless gRPC buys us something).
2. **Self-host ASR vs managed EU STT vendor** — cost/control/zero-retention contract trade-off.
3. **Fused vs two-hop** format — fused (one service does ASR+format) is what makes Wispr a single round-trip; confirm we can host both in one EU service rather than re-introducing a second hop.
4. End-to-end **zero-retention** guarantee (no audio/text written to disk server-side) — required to keep the wedge honest before marketing "EU-hosted."
5. How much **context** to send (app type only, vs focused-field text vs proper-noun biasing) — start with app type (we already have it), add the rest if accuracy needs it.

## 8. Phasing
- **Phase 0 (now, unblocked):** offline-path quality (deterministic vocab correction) + offline UI badge; client plumbing groundwork (OPUS encode, persistent-connection + warm-at-hotkey scaffolding) behind a flag.
- **Phase 1 (gated on entity/vendor):** stand up the EU streaming ASR+format service; flip the primary path to streaming; context prefetch over the stream.
- **Phase 2:** tune the latency budget, proper-noun biasing, richer per-app context; Windows stop-path parity.
