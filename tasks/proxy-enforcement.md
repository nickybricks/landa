# Proxy-side enforcement — tamper-proof free tier + word metering

**Session goal (2026-05-24):** make "Pro" un-cheatable by moving usage metering and the
free-tier limit to the **server** (the `landa-proxy`). The app already *reads* entitlement
(branch `auth-supabase`); RLS forbids client writes. This builds the **authoritative writer +
gatekeeper**: the proxy verifies the user, counts words, and refuses cloud polish past the free
cap. A client can't make itself Pro or zero its counter because it never touches those numbers.

**Scope tonight = A + B** (Brevo runbook + proxy side). **App-side token plumbing = C, deferred.**

## Decisions (confirmed with Nick 2026-05-24)
- **What's metered:** cloud **polish** (the `reformat` endpoint) only. Transcription is local —
  it never hits the proxy, so it can't (and won't) be metered. "2,000 free words" = **2,000
  polished words per week.** Raw on-device transcription is unlimited and free.
- **Counting unit:** **dictated input words** (the user-turn text sent for polishing) — the
  fairest, most predictable "words used". Pro/Team are also counted (analytics/leaderboard) but
  never capped.
- **Reset cadence:** **weekly** (Monday 00:00 UTC). `period_start` = Monday of the current ISO week.
- **Soft cap:** the call that crosses the line is allowed; the *next* one is blocked until reset.
- **Over-limit:** proxy returns **402**; the app (C session) pastes the raw local transcript +
  a soft upgrade nudge. App never breaks.
- **Verification:** Supabase **ES256 JWT via JWKS** (`jose`), no shared secret.
- **🔒 Safe rollout — enforce only when a user JWT is present.** The live released app sends no
  JWT. Hard-requiring it would break production *today*. So: **no `x-landa-user-jwt` header →
  behave exactly as now** (allow, no metering). Flip to hard-require once auth ships to everyone.

## Architecture
```
 App (C, deferred): main.js holds the Supabase access token → pushes it to the Python backend →
   backend attaches  x-landa-user-jwt: <token>  on the reformat call.
        │
        ▼
 landa-proxy  api/reformat.ts
   1. LANDA_APP_SECRET check + IP rate-limit  (unchanged)
   2. if x-landa-user-jwt present:
        verify JWT (JWKS, ES256)            → 401 if invalid
        read plan + this-week words_used    (service role, PostgREST)
        if free && used >= 2000             → 402  (skip the model, no cost)
   3. call the model                         (unchanged)
   4. if metered: increment usage by input word count (atomic RPC)
        │
        ▼
 Supabase (EU)  public.profiles.plan  +  public.usage(user_id, period_start, words_used)
   increment_usage(uid, period, words)  — SECURITY DEFINER, service-role only, atomic upsert
```

## Files
**`landa-proxy` repo (build tonight, Nick deploys):**
- `lib/entitlement.ts` — NEW. `periodStart()`, `countWords()`, `verifyUserJwt()`,
  `readMeter()`, `incrementUsage()`, `FREE_WORDS_PER_WEEK`. All Edge-compatible.
- `api/reformat.ts` — wire in ~5 lines (pre-check before the model, increment after). Kept as a
  thin call into `lib/` so the stashed Vertex/Node rewrite re-wires identically.
- `.env.example` — add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FREE_WORDS_PER_WEEK`.
- `package.json` — declare `jose` (already in node_modules; declare for a clean build).

**Supabase schema (auth-supabase worktree, applied to the live DB):**
- `supabase/migrations/0002_usage_increment.sql` — NEW. Atomic `increment_usage()` RPC,
  `execute` granted to service_role only (revoked from anon/authenticated).

## Go-live — DONE + VERIFIED (2026-05-24)
1. ✅ Migration applied to the live DB (ref `lvxucmpfxdgozetqytto`).
2. ✅ Vercel Production env set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (`FREE_WORDS_PER_WEEK`
   left default 2000). **Gotcha hit:** these were NOT initially set (the key was handed over, not added
   to Vercel) → every JWT 401'd. Added them, redeployed → fixed.
3. ✅ Deployed (`vercel --prod`, aliased to `landa-proxy.vercel.app`).
4. ✅ Live harness **8/8** against production.

## Verify gates — ALL PASS
- [x] `npx tsc --noEmit` clean in `landa-proxy`.
- [x] Pure-function unit checks (8/8): `periodStart()` Monday UTC; `countWords()` ignores the system turn.
- [x] Live (8/8): real JWT under cap → 200 + `usage.words_used` += input word count; at/over cap → 402
      `free_limit_reached`; tampered JWT → 401; **absent JWT → 200, no DB write** (production-safe).

## ⚠️ Still owed
- Commit + push the deployed `~/Developer/landa-proxy` code (running in prod, not in git).
- Commit migration `0002` (currently uncommitted in the auth-supabase worktree).

## Deferred — C (app side, `auth-supabase` branch)
- `main.js`: push the access token to the backend on sign-in / refresh / startup.
- `landa_core.py`: hold it, attach `x-landa-user-jwt` on the reformat call; on **402** fall back
  to the raw transcript (the error fallback at ~line 1239 already does this) + fire a soft nudge.
- Then flip the proxy from "enforce-if-present" to "require JWT" once every shipped build sends one.
