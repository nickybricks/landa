# Auth Foundation — Supabase (EU) accounts + entitlement plumbing

**Session goal (2026-05-24):** Build Landa's authentication foundation — Supabase (EU
region) accounts/login + entitlement plumbing (usage metering schema, "is this user Pro?"
checks) — **stopping short of live checkout/payments**. Payments are gated on forming the
legal entity, so we build *right up to that seam* so it's a later flip, not a rebuild.

**Branch / isolation:** runs in the `auth-supabase` git **worktree**
(`.claude/worktrees/auth-supabase`), parallel to the profile-section session. The worktree
gives physical file isolation so the two sessions can't clobber each other's working tree.

---

## Decisions confirmed with Nick (2026-05-24)

| # | Decision | Implication |
|---|---|---|
| 1 | **Login = magic link**, architected so **Google + Microsoft/Outlook OAuth** drop in later | Build a provider-agnostic auth module; magic-link path first, OAuth path stubbed at the seam |
| 2 | **App + Supabase this session; proxy enforcement next** | This repo only: login UI, session, schema, client-side `is-Pro` read + payment seam. Real server-side metering/enforcement = next session in the `landa-proxy` repo |
| 3 | **Create a new EU Supabase project now** | I drive the Supabase CLI; Nick must be logged into Supabase. Region = an EU one (e.g. `eu-central-1`, Frankfurt) to fit the EU-residency wedge |

**Implementation choice under "magic link" — clickable link via a `landa://` deep link**
(confirmed by Nick 2026-05-24, over the 6-digit-code alternative). Flow:
- `signInWithOtp({ email, options: { emailRedirectTo: 'landa://auth-callback' } })` with the
  client in **PKCE mode** (`flowType: 'pkce'`) — the secure flow for a public/native client.
- Electron registers `landa` as a protocol client (`app.setAsDefaultProtocolClient('landa')`).
  The clicked link returns to the app as `landa://auth-callback?code=…`; main parses it and
  calls `exchangeCodeForSession(code)`. The PKCE `code_verifier` is held by the **same**
  main-process client instance that initiated sign-in (in the safeStorage adapter) — which is
  exactly why auth lives in the main process.
- Delivery of the deep link to the running app: macOS via `app.on('open-url')`; Windows/Linux
  via argv on the existing `second-instance` event (the single-instance lock already exists).
- **Bonus, not throwaway:** this same deep-link handler is what Google / Microsoft OAuth will
  reuse later — building it now advances the OAuth seam too.
- *Dev note:* `setAsDefaultProtocolClient` behaves differently for an unpackaged dev build
  (needs the Electron binary + app-path args, esp. on Windows); handle dev vs prod registration.

---

## Scope

**In scope (this session):**
- Supabase EU project + auth (email OTP) + Postgres schema for entitlements & usage.
- Main-process Supabase client, secure session storage (Electron `safeStorage`).
- Auth window (sign-in / enter-code) shown at launch when there's no valid session.
- Client-side entitlement read (`getEntitlement()` → `free` / `pro`), cached for offline.
- Usage table + **read-only** display in settings ("X / 2,000 words"). *Writes happen
  server-side at the proxy next session — the app does NOT write usage (tamper-proof).*
- The **payment seam**: a single `startUpgrade()` stub wired so flipping it to a Lemon
  Squeezy checkout URL later is a one-function change.
- Settings "Account" section (email, plan, usage, sign out, upgrade button → seam).

**Explicitly OUT (this session):**
- Live checkout / Lemon Squeezy / taking money (gated on the legal entity).
- Proxy-side JWT verification, server-side word metering, free-tier hard enforcement
  (= **next session, `landa-proxy` repo** — specified below so it's a flip, not a rebuild).
- Team/org accounts (schema *reserves* a nullable `team_id`; no teams table, no team UI).
- Google / Microsoft OAuth (auth module leaves the provider seam; deep-link handler later).
- Landing-page / README / changelog copy (auth isn't released this session).

---

## Architecture

```
 Renderer (auth.html / settings Account)      ← no Node, no secrets
        │  window.landa.auth.*  (preload IPC)
        ▼
 Main process  auth.js  ──────────────────────  @supabase/supabase-js
        │  signInWithOtp / verifyOtp / getSession / signOut / getEntitlement
        │  session persisted via custom storage adapter →
        ▼                                         Electron safeStorage
 ~/.landa/auth.json  (OS-keychain-encrypted blob)

 Supabase (EU region)
   auth.users                     ← built-in
   public.profiles  (plan, team_id?) ← 1:1, trigger-created, RLS own-row read
   public.usage     (period word counts) ← RLS own-row read; writes = service role only
```

**Why the Supabase client lives in the main process:** project rule is
`contextIsolation: true`, `nodeIntegration: false`, all main↔renderer over IPC. The renderer
never sees Node, tokens, or the Supabase client. supabase-js handles token **refresh**
(hard to hand-roll), with a custom storage adapter backed by `safeStorage` so the refresh
token is encrypted at rest under `~/.landa/`, not in renderer localStorage.

**Dependency:** add `@supabase/supabase-js` (current app deps are just `@vercel/analytics`
+ `electron-updater`). Alternative considered — hand-rolled `fetch` against the Supabase
Auth REST API (no SDK, fewer deps) — rejected: we'd reimplement session refresh and risk
silent token-expiry bugs. supabase-js is the senior-engineer default here.

**Launch gate — sign-in required (confirmed by Nick 2026-05-24), offline-tolerant:** on
`app.whenReady`, if a valid cached session exists → normal launch. If not → show the auth
window and **do not enable recording until signed in** (hard gate; every user is identified so
metering/is-Pro always has someone to attribute to). A cached session + cached entitlement are
treated as valid **offline** (transcription is local anyway); we refresh against Supabase when
connectivity returns — so the gate never hard-blocks a returning user on network at startup.

---

## Supabase schema (migration `0001_auth_entitlements.sql`)

```sql
-- profiles: 1:1 with auth.users, created by trigger on signup
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  plan        text not null default 'free' check (plan in ('free','pro','team')),
  team_id     uuid,                 -- reserved for the future team tier; no teams table yet
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- usage: word metering per billing/usage period. Authoritative writer = the proxy
-- (service role) next session; the app only READS this.
create table public.usage (
  user_id       uuid not null references auth.users(id) on delete cascade,
  period_start  date not null,
  words_used    integer not null default 0,
  primary key (user_id, period_start)
);

-- RLS: a user may READ only their own rows. No client writes to plan or usage
-- (prevents a client from making itself Pro or zeroing its own counter).
alter table public.profiles enable row level security;
alter table public.usage    enable row level security;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
create policy "own usage read"   on public.usage    for select using (auth.uid() = user_id);

-- trigger: auto-create a free profile when a user signs up
create function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

*Free-tier reset cadence is still an open strategy question (per-week vs per-month vs
one-time). `period_start` as a `date` supports any of them; this session defaults to a
**monthly** period and notes it as TBD — the proxy fills the counter next session.*

---

## File-by-file plan

**NEW files (zero overlap with the profile session):**
- `renderer/auth.html` / `auth.js` / `auth.css` — sign-in (email) → enter-code screen.
  Styled with DESIGN.md tokens (no hard-coded hex/fonts).
- `auth.js` (repo root, sibling to `main.js`) — main-process Supabase auth module:
  `init`, `requestOtp(email)`, `verifyOtp(email, code)`, `signOut`, `getSession`,
  `getEntitlement`, `onAuthChange`, `startUpgrade` (seam stub), + the safeStorage adapter.
- `supabase/` — `config.toml` (from `supabase init`) + `migrations/0001_auth_entitlements.sql`.

**EDITED — conflict-free (profile session does NOT touch these):**
- `main.js` — require the auth module; register auth IPC; hard launch gate; register the
  `landa://` protocol (`setAsDefaultProtocolClient`) and handle the magic-link callback via
  `open-url` (macOS) + argv on `second-instance` (Windows/Linux). This handler is also the
  future Google/MS OAuth deep-link entry point.
- `preload.js` — expose `window.landa.auth.*` via contextBridge.
- `package.json` — add `@supabase/supabase-js` (version bump deferred to the release).
- `.env` (gitignored) — add `SUPABASE_URL`, `SUPABASE_ANON_KEY` for dev.

**EDITED — OVERLAP with the profile session, localize carefully:**
- `renderer/settings.{js,html,css}` — add a small **Account** section (email, plan, usage,
  sign out, upgrade→seam). The profile session edits `modes.preview.*` strings in the
  `settings.js` `TRANSLATIONS` block; keep all Account edits in a **separate region / new
  i18n keys** so the eventual branch merge is clean.

**NOT touched:** `backend/landa_core.py` (the profile session edits it; JWT-forwarding is
deferred to the proxy session, so this session avoids the file entirely → no merge conflict).

---

## Build sequence (each step has a verify gate)

1. **Provision Supabase EU project.** `supabase login` (needs Nick) → create project in an EU
   region → capture URL + anon key into `.env`. *Verify:* dashboard shows the project in an EU
   region.
2. **Schema.** `supabase init`; write the migration; `supabase db push`. *Verify:* `profiles`
   + `usage` + RLS + trigger exist; a test signup auto-creates a `profiles` row with
   `plan='free'`.
3. **Main-process auth module + safeStorage session store.** *Verify (Node harness):*
   `requestOtp` sends a magic-link email; feeding back a `landa://auth-callback?code=…` URL
   to `exchangeCodeForSession` returns a session; the session persists across an app restart;
   `getEntitlement()` returns `free`.
4. **preload IPC + auth window UI.** *Verify:* launch with no session shows the auth window;
   enter email → "check your inbox" state.
5. **`landa://` protocol + launch gate in `main.js`.** Register the protocol; route the
   magic-link callback (open-url / second-instance argv) into `exchangeCodeForSession`.
   *Verify:* clicking the emailed link returns to the app and signs in; signed-out launch
   gates (recording disabled); signed-in launch passes straight through; sign-out re-gates.
6. **Settings "Account" section** (plan, usage read, sign out, upgrade seam). *Verify:* shows
   email/plan/usage; the upgrade button hits the stub (no live checkout).
7. **Full-flow check.** `npm start` launches clean; backend still answers on `localhost:7890`;
   sign in via OTP, see free/pro state, restart stays signed in, sign out works.

---

## The seam — what "next session" flips (so this is not a rebuild)

**Proxy session (`landa-proxy` repo), the real enforcement:**
- App forwards the user's Supabase **access token** main → Python backend → proxy (a new
  `x-landa-user-jwt` header alongside the existing `LANDA_APP_SECRET`). *(Additive 2-line
  change at the proxy-call site in `landa_core.py` — done in the proxy session to avoid
  colliding with the profile session's edits there.)*
- Proxy **verifies** the JWT against Supabase's JWKS on every `reformat`/`transcribe`.
- Proxy **meters** words into `public.usage` (service role) and **enforces** the free-tier
  limit (return `402`/`403` when exceeded). This is the trustworthy write path; the app only
  reads.

**Payments session (post legal-entity):**
- `startUpgrade()` flips from the stub to a real Lemon Squeezy checkout URL (merchant of
  record, remits VAT — per STRATEGY pricing decision).
- A Lemon Squeezy webhook → Supabase sets `profiles.plan = 'pro'`. The app's existing
  `getEntitlement()` read then just works.

---

## Open / resolved questions

1. ~~OTP code vs clickable link~~ → **RESOLVED: clickable link** via `landa://` deep link (PKCE).
2. ~~First-run friction~~ → **RESOLVED: require sign-in first** (hard launch gate).
3. **Onboarding ordering** (minor, proceeding on default): auth gate **after** the existing
   permission-teaching onboarding. Easy to reorder later if Nick prefers.
4. **Free-tier reset cadence** (strategy open Q): per-week / per-month / one-time? Schema
   supports any; defaulting to **monthly** for now — the proxy fills the counter next session.

---

## Surfaces to sync when auth ships (CLAUDE.md §5) — mostly deferred to the release

- Onboarding: add the sign-in step. *(This session: standalone gate; full onboarding
  integration is the "new onboarding flow" roadmap item.)*
- Landing page / README / changelog: **no change this session** — auth isn't released yet.
- DESIGN.md: auth window uses existing tokens; add an "Account" pattern note if needed.
- STRATEGY.md + NEXT_SESSION.md: Decision Log row + Status (Finance/Pricing, Product) at
  session end. **Deliberately NOT edited from this branch** — the parallel profile session
  currently holds uncommitted edits to both files; editing them here would risk the very
  clobber Nick flagged. The rows to fold in at integration are below.

---

## Outcome / review (2026-05-24)

**Built and committed on branch `auth-supabase` (worktree).** Files: `auth.js` (main-process
module), `renderer/auth.{html,js,css}` (gate window), `supabase/` (config + migration
`0001_auth_entitlements.sql`), `main.js` / `preload.js` (protocol + gate + IPC),
`renderer/settings.{html,js,css}` (Account section), `package.json` (+`@supabase/supabase-js`,
+`ws`).

**Provisioned (live):** Supabase project `landa`, ref `lvxucmpfxdgozetqytto`, **Central EU
(Frankfurt)**. Schema pushed; `landa://auth-callback` added to the auth redirect allowlist.
DB password handed to Nick (not stored in repo). Anon key is committed in `auth.js` (public by
design); service_role key never enters the app.

**Verified solo:**
- Schema/trigger/RLS — Admin-API harness: signup auto-creates a `free` profile; anon can't read
  profiles (RLS). ✓
- Main-process integration — Electron harness: `safeStorage` encryption available; supabase
  client initialises (after adding the `ws` WebSocket polyfill — Electron's Node-20 main process
  has no global WebSocket); `signInWithOtp` reaches Supabase and returns a real response;
  encrypted session store writes (`enc:true`). ✓
- `node --check` clean on main.js, preload.js, settings.js, renderer/auth.js. ✓

**NOT yet verified (needs Nick + ideally a packaged build):** the live magic-link round-trip —
real email → click `landa://auth-callback?code=…` → `exchangeCodeForSession` → signed-in → gate
opens. Dev (unpackaged) `setAsDefaultProtocolClient` is unreliable on macOS; the dependable test
is a packaged build. **Live-test checklist:** launch → auth window appears (gate) → enter email →
receive link → click → app signs in → Settings ▸ Configuration ▸ Account shows email + `Free` +
usage → Sign out re-shows the gate → relaunch stays signed in (encrypted session).

**Rows to fold into STRATEGY.md → Decision Log at integration:**
- `2026-05-24 | Auth foundation BUILT on Supabase (EU/Frankfurt, project lvxucmpfxdgozetqytto) | Magic-link (clickable, landa:// deep link, PKCE); sign-in required before use; entitlement schema (profiles/usage, RLS read-only — proxy is the writer); client-side is-Pro read + payment seam stubbed. Stops short of checkout (gated on legal entity). Built on branch auth-supabase.`
- `2026-05-24 | Login = magic link now; Google + Microsoft/Outlook OAuth later (reuses the same landa:// deep-link handler) | Nick's call`
- `2026-05-24 | Usage metering: app READS only; proxy is the authoritative writer (next session) + free-tier enforcement | Tamper-proof; RLS forbids client writes to plan/usage`

**Status by Area updates to fold in:** *Finance/Pricing* — auth + entitlement plumbing built;
checkout still blocked on the entity. *Engineering* — Supabase EU project live; proxy JWT
verify + server-side metering is the next seam.

**NEXT_SESSION "Up next" to fold in:** *Proxy session (landa-proxy repo):* forward the Supabase
access token app→backend→proxy (`x-landa-user-jwt`); verify JWT (JWKS); meter words into
`public.usage` (service role); enforce the free-tier limit. Then the live magic-link round-trip
test on a packaged build.
