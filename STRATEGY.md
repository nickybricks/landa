# Landa — Strategy (Source of Truth)

> Canonical strategy doc. When this conflicts with older notes (`Product Strategy …md`, `tasks/todo.md`), this wins. Last synthesized 2026-05-24.

> **How to use this.** This `STRATEGY.md` in the repo is the **single source of truth** — the Notion copy is a read-only mirror. Two sections are living and get updated **every working session**: the **Decision Log** (append a dated row whenever something is decided) and **Status by Area** (state · blocker · next). Everything else changes only when strategy genuinely shifts. Run the **Weekly Review** (bottom of this doc) once a week — 10 minutes.

---

## Exec Summary (read this first)

**What:** Landa is a cross-platform (macOS + Windows) global-hotkey voice-to-text app. Press a hotkey in any app, talk, and Landa transcribes, polishes, and pastes formatted text where your cursor is.

**Who:** Knowledge workers who type all day (PMs, founders, sales, CS), privacy-conscious professionals (lawyers, therapists, journalists, doctors), and non-native English writers.

**The wedge:** **EU-hosted cloud with zero retention** — Wispr-grade polish quality, but client emails / legal drafts never touch a US server. This is a real engineering + legal track, not a marketing line.

**Where we are:**
- ✅ Product is mature: onboarding, auto-update, stats, modes/profiles, bundled local model, landing page all shipped.
- 🟡 The EU wedge is **half-true today**: the relay runs in Frankfurt, but polish text still forwards to OpenAI-US. Transcription is local-only on-device (genuinely private).
- ❌ **No payments system** — the single biggest commercial gap, unchanged for weeks.
- ⛔ EU migration and real EU customers are **blocked on forming a legal entity** and on vendor model-access approvals (Anthropic quota was denied 2026-05-24).

**The two things that matter next:** (1) form a legal entity to unblock the entire EU/payments track; (2) build the license + payment gate so every download becomes a buying signal. Product polish is largely done; commerce and compliance are not.

**Hard rule:** users never see API keys, model names, downloads, or a local-vs-cloud toggle. Landa chooses and pays for everything invisibly.

---

## 1. North Star

Landa lets anyone **talk into any app and get polished, formatted text pasted instantly** — no config, no jargon, no waiting. The job-to-be-done is "write faster without losing my voice." It is built for people who write thousands of words a day across Slack, email, Notion, and docs, and especially for those who can't send their words to a US cloud. The experience must feel instant and "just works" from the first second — the quality bar is the latency-free feel of the best dictation apps.

**Core value prop:** *"Talk into any app. Landa types it for you — formatted, polished, and private."* The three nouns matter: *any app* (vs. browser-only rivals), *formatted* (vs. raw dictation), *private* (vs. cloud-only).

**Personas:**
- **A — Knowledge worker in Slack/email (PRIMARY).** Non-technical, has a credit card, won't blink at €9/mo. Cares only that "it just works in every app."
- **B — Privacy-conscious professional.** Lawyers, therapists, journalists, doctors. Can't send client material to a US cloud. Smaller TAM, higher willingness to pay, lower churn.
- **C — Non-native English writer.** Reformat-to-polished-email is the killer feature; large global market, low CAC via product-led growth.

---

## 2. Positioning & Wedge

**Win on:** EU-hosted, zero-retention cloud polish. Same strong rewriting quality as the US incumbents, but data stays in the EU and is never retained. Local on-device transcription is the privacy/offline proof point (and likely the free-tier path to protect margin).

**Against whom:** Wispr Flow and Willow Voice — both US/SF, cloud-first, $12–15/mo, ~2,000-words/week free tier. They cannot easily match an EU-residency + zero-retention story without re-architecting.

**Honest claim discipline:** market **"EU-hosted, zero retention,"** never "fully local & private" — polishing requires a capable cloud LLM. And today the EU claim is **not yet true** (see §5 Compliance); do not market it or onboard EU customers until the EU model flip ships under a legal entity.

**Pricing (decided 2026-05-24, billed via Lemon Squeezy):**
- **Free** — 2,000 words (reset cadence TBD; competitors are per-week), local-only.
- **Pro** — €10/mo billed annually, €13/mo billed monthly. Deliberately below Willow ($12) and Wispr ($15) on the annual plan.
- **Team** — min. 3 seats, €8/seat/mo billed annually, €10/seat/mo monthly.
- **Enterprise** — custom quote.

**Constraints on positioning:**
- **Mature SaaS, not playful/childish** — across landing page and app, the brand must read as serious and trustworthy. Trust is the wedge; the tone has to earn it.
- Never reference SpeakUp or any competitor in plans, code, copy, or commit messages — anchor every feature in Landa users' needs.
- German-first positioning and German vertical models (Medizin/Recht) are out of scope — German is one supported language, not the wedge.

---

## 3. Roadmap

### Now (active / blocking)
- **Form a legal entity** — the keystone prerequisite for DPA, zero-retention billing, payments, and vendor model-access gates.
- **Build product EU work on interim US backend** (vendor-independent, was targeted for Tue 2026-05-26): route transcription through the proxy, retire the realtime WS path, remove BYO-key reads, switch `transcribe.ts` auth to the app secret.
- **License + payment gate** — the #1 commercial gap; nothing can be sold without it.

### Next (gated on entity / approvals)
- **Adaptive per-app writing style — TOP product priority.** Extend the existing modes so each target app gets its own tone + formatting (email vs. WhatsApp vs. Slack vs. Notion vs. Cursor, etc.). People live across all these tools and expect a tool-perfect result every time — this is the highest-leverage product bet.
- **Local vocabulary correction (no LLM)** — a deterministic on-device pass that fixes high-confidence technical mistranscriptions in raw `landa-base` output (e.g. "Claude Cold" → "Claude Code") before paste. The local/free-tier half of getting output right — improves users who get no cloud polish. Design: [tasks/local-vocab-correction.md](tasks/local-vocab-correction.md).
- **Agent mode in profiles** — let a profile either transcribe what you say *verbatim* or take an *instruction* and compose the reply (e.g. "write an answer that covers x and y, and tell her I'm sorry about yesterday"). Profiles gain a verbatim-vs-compose behavior.
- **Voice-edit selected text** — parity feature vs. Wispr Command / Willow AI mode (finicky cross-app, esp. Windows).
- **EU model flip (deferred):** deploy the stashed Vertex/Claude polish + repoint transcription upstream to an EU endpoint — one deploy each, once the Anthropic/Google quota clears.
- **Zero-retention paperwork:** DPA, subprocessor list, privacy policy, ZDR opt-out, confirm Upstash is EU-region.
- **End-to-end egress proof** (network capture: only EU endpoints touched) → then flip marketing copy to "EU-hosted."
- **Auth via Supabase (EU)** — foundational for free tier, team tier, billing.
- **Team licenses** — build alongside auth/Supabase, not deferred: EU residency, **shared team vocabulary**, **team/admin usage overview**, and an **internal usage leaderboard**; highest revenue.
- Public **free tier** (likely local-only to protect margin) — needs auth + usage metering.
- Referral / "give a friend a month free."
- **Landing page restructure** — current page lacks proof and clarity, and must read as a **mature SaaS, not a playful/childish one** (maturity builds trust). Fix: usage/social proof; replace the too-hectic demo videos with **one picture-perfect email-creation video**; clear pricing structure with tiers; case studies; explicit "who it's for"; a **"who we are / why we built it" trust section with a photo of us**; and **use cases showing which apps it works in and how**.
- **Logo refresh** — replace the voice-mark logo with an **"L" mark**.
- **App repolish pass** — bring the whole app's UI/UX up to the mature-SaaS bar as the new features (adaptive per-app style, agent mode, team) land, so it stays cohesive rather than bolted-on.
- **New hotkey / push-to-talk model** — hold a modifier to record (Fn on macOS, Ctrl on Windows): release to stop. Press a lock shortcut (e.g. Fn+Space / Ctrl+Space) to keep recording hands-free without holding. A rework of the keyboard interaction structure, not just new key bindings.
- **Resting-pill interactions** — hovering the always-on pill expands it to show options; right-click opens a context menu (Settings, Profiles, etc.) so the pill becomes a control surface, not just an indicator.
- **New onboarding flow** — refreshed first-run that showcases *all* the features (per-app styles, agent mode, profiles, the new hotkey model), aligned with the mature-SaaS brand. Needed because the current onboarding predates the feature wave.
- **Polish & review all built-in profiles** — the new `code` profile is rich and detailed; Email / Personal Message / Notes are comparatively thin. Review and strengthen each to the same quality bar (the code profile is the template for depth), with an eval per profile. **Includes the per-profile example input/output** shown in the UI — make those examples smoother and more mature, not throwaway.
- **Rethink the Profiles UX so it's distinctly Landa** — the profiles section currently resembles Wispr Flow too closely. Redesign it into something that's our own. *How is not yet decided* (see Open Questions) — this is a known dissatisfaction, not a spec.

### Later
- **Smart memory of your writing style** — the AI learns each user's writing style over time so output sounds like them, without manual setup.
- **Model-agnostic per-profile routing** — the backend picks the best model per profile (e.g. Anthropic Haiku for code, an OpenAI model for email), chosen server-side and **invisible to the user** (no model picker — consistent with the hard rule). ⚠️ **Wedge constraint:** *every* model/provider in the mix must stay **EU-resident + zero-retention**, or it breaks the "EU-hosted" claim for that profile. Lets us A/B models and use the strongest model per task.

**Explicitly NOT doing (for now):**
- Instant/streaming transcription, lexicons, German-first positioning/vertical models, mobile/iOS.
- **User-defined profile creation / custom prompts** — we ship the built-in profiles first, not user-created ones. Demand-gated: if users ask to build their own, we'll add it later.

---

## 4. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| ~mid-Apr 2026 | Original Product Strategy authored | Personas, value prop, pricing, "first 10 customers" loop |
| 2026-05-09 | Never reference competitors (SpeakUp et al.) anywhere | Treating a rival as the spec drags Landa into their positioning |
| 2026-05-20 | German-first wedge + German vertical models OUT of scope | Deprioritized in strategy review; German is one language, not the wedge |
| 2026-05-20 | Use **Stripe**, not Lemon Squeezy/Paddle, for commerce | Stated current preference (⚠️ conflicts with 05-23 below) |
| 2026-05-20 | "First 10 customers" founder-sales loop + lifetime pricing = recommended path | Still unexecuted; highest-information validation move |
| 2026-05-23 | Wedge = "EU-hosted cloud, zero retention" (not "fully local") | Polish needs a capable cloud LLM; honest claim |
| 2026-05-23 | Instant/streaming transcription OUT | Keep batch flow: record → transcribe → polish → paste |
| 2026-05-23 | Lexicons off the plan | Descoped from current roadmap |
| 2026-05-23 | Proxy investigated: Frankfurt relay BUT forwards to OpenAI-US | "Never touches a US server" is false today |
| 2026-05-23 | Backed up `landa-proxy` source to private GitHub (commit `dfe5670`) | Source had zero commits / no remote — single point of failure |
| 2026-05-23 | Forming a **legal entity** is a hard prerequisite | Needed to be GDPR controller, sign DPAs, get ZDR, take payments, pass model gates |
| 2026-05-23 | Vendor pivot: Azure → **Claude Haiku 4.5 on Google Vertex AI (EU)** for polish | Azure blocked on tenant wall + EA-gated ZDR; Vertex ZDR more attainable; Claude is EU-resident |
| 2026-05-23 | Landing-page demo transcription dropped | Closes one US surface by deletion; retire `OPENAI_API_KEY_LANDINGPAGE` |
| 2026-05-24 | OpenAI EU residency is Enterprise/Sales-gated, not self-serve | Every premium EU path is gated for a pre-company PAYG account |
| 2026-05-24 | Sequencing: build product on interim US now; EU model flip deferred | Proxy abstracts the model; product ships independent of the gated EU flip |
| 2026-05-24 | **Transcription = local-only, invisible**; polish + profiles = cloud LLM, invisible | No toggle at all — zero transcription choices for users |
| 2026-05-24 | No user-facing keys/models confirmed already done (dev-gated) | Key/model panels are `dev-only`; real users see nothing to strip |
| 2026-05-24 | GCP provisioned, Vercel EU env vars set, live Vertex call verified | Auth + model id + `eu` endpoint all valid |
| 2026-05-24 | ⚠️ Anthropic **quota request DENIED**; re-requested + emailed Google support | Typical for a brand-new PAYG project with no entity/billing history |
| 2026-05-24 | **Team licenses** built alongside auth/Supabase, not deferred to ~500 users | Auth + orgs land at the same time; no reason to gate the highest-revenue tier |
| 2026-05-24 | **Adaptive per-app writing style** back IN scope and now the TOP product priority | Email/WhatsApp/Slack/Notion/Cursor each need distinct tone + formatting; people expect a tool-perfect result everywhere |
| 2026-05-24 | **Agent mode in profiles** added | A profile can transcribe verbatim OR take an instruction and compose the reply ("write an answer covering x, y, and say sorry about yesterday") |
| 2026-05-24 | Ship built-in **profiles first, not user-created ones** | User-defined profile creation is demand-gated — add only if users ask |
| 2026-05-24 | **Landing page restructure** scoped | Page needs proof, one clean email-creation video, clear tiers, case studies, and "who it's for" |
| 2026-05-24 | **Smart memory of writing style** added to Later | AI learns each user's style over time so output sounds like them, no manual setup |
| 2026-05-24 | Commerce = **Lemon Squeezy** (for now); resolves the Stripe-vs-LS conflict | Merchant of record, remits VAT |
| 2026-05-24 | **Pricing set:** Free 2,000 words · Pro €10 annual/€13 monthly · Team (min 3 seats) €8/€10 per seat · Enterprise custom | Annual Pro undercuts Willow/Wispr; team + enterprise open higher ACV |
| 2026-05-24 | **Team features scoped:** shared vocabulary, admin usage overview, internal usage leaderboard | Differentiates the team tier and drives internal adoption |
| 2026-05-24 | Analytics = **PostHog (EU Cloud)** | EU residency fits the wedge; product analytics + funnels in one tool. Insight only — Supabase Postgres stays the billing/usage source of truth |
| 2026-05-24 | Brand = **mature SaaS, not playful/childish** (landing + app) | Trust is the wedge; the tone must earn it |
| 2026-05-24 | **Logo refresh:** replace voice-mark with an "L" mark | Cleaner, more mature brand identity |
| 2026-05-24 | **App repolish pass** as new features land | Keep the app cohesive at the mature-SaaS bar, not bolted-on |
| 2026-05-24 | Interim: polish stays on OpenAI gpt-4o (US, NOT EU-resident) | Testing only — no real EU customers until EU path is live under the entity |
| 2026-05-24 | Adaptive per-app style: **first slice = new `code` category for Cursor/VS Code, enabled ON by default**; messaging tone/format split is slice 2 | Code editors today get *raw transcription* (broken, not generic) → biggest jump, lowest regression risk, easiest eval; design doc at `tasks/adaptive-per-app-style.md` |
| 2026-05-24 | Mechanism: **extend the Notion override pattern** (shared behavioral core + swappable FORMAT/tone delta), don't reinvent | Reuses the hard-won tuning (Sie/du, anti-invention guardrails); messaging = deltas inside personal-message, code = a real new category |
| 2026-05-24 | **New hotkey / push-to-talk model** added to roadmap | Hold modifier (Fn macOS / Ctrl Windows) to record; lock shortcut (Fn+Space / Ctrl+Space) for hands-free — rework of the keyboard interaction structure |
| 2026-05-24 | **Resting-pill interactions** added to roadmap | Hover expands the pill to show options; right-click → context menu (Settings, Profiles…) — make the pill a control surface |
| 2026-05-24 | **New onboarding flow** added to roadmap | Showcase all features (per-app styles, agent mode, profiles, new hotkeys); current onboarding predates the feature wave |
| 2026-05-24 | Adaptive slice 1 **BUILT** (code category, one smart style): backend prompt + fresh-install/migration defaults + settings tile; logic unit-verified | Code editors went from raw transcription → polished; gates (eval, `/review`, mac/win smoke) still pending before the on-by-default release |
| 2026-05-24 | Code category enabled **ON for fresh installs too** (not just migrated users) — the only mode on out-of-the-box | Raw transcription in editors is the "broken" state the slice fixes; leaving new users off would re-break it for everyone installing after the migration wave |
| 2026-05-24 | Settings "linked apps" banner now shows **only installed apps** (no placeholder chips for absent apps) | Nick: ghost chips for apps the user doesn't have are confusing; matters most for the on-by-default code tile shown to the non-developer PRIMARY persona |
| 2026-05-24 | Code prompt is **active reconstruction, not light cleanup** — interprets dictated jargon (casing→identifiers, spoken operators→symbols, phonetic traps like "cores"→CORS, acronym casing) + a **Claude/Anthropic ecosystem** rule (Claude Sonnet/Opus/Haiku, CLAUDE.md, slash commands, artifact/source tags, chain-of-thought) with a guard so "cloud" infra is NOT mis-corrected to "Claude" | First build was too timid ("keep wording close") → "not changing anything"; live tests confirm userId/async/regex/req.params/MAX_RETRIES + Claude jargon all resolve, and the cloud-infra control passes |
| 2026-05-24 | **Codex** added to code-category default linkedApps (now Cursor/Code/Codex); banner matcher uses an alias map so "Code"→"Visual Studio Code" (not Codex/Xcode) | Real-machine test showed loose substring matching mis-resolved the VS Code bundle and hid the user's installed editors |
| 2026-05-24 | App-routing now matches **bidirectionally** (linkedApp⊂activeApp OR activeApp⊂linkedApp, len≥3 guard) | Root cause of "AI not used": settings picker stores the **bundle** name ("Visual Studio Code") but the OS reports the **process** name ("Code") → one-directional match missed → reformat skipped (`post+reformat: 0.000s`). Affects every app whose bundle≠process name |
| 2026-05-24 | Code category is **verbatim cleanup, NOT compose/answer** — added a "YOU ARE NOT THE AGENT" guard | Nick dictated a prompt for Claude Code and our LLM answered it instead of cleaning it for paste; the user prompts their own agent. Compose/answer is the separate future "agent mode in profiles," not this |
| 2026-05-24 | **Polish & review all built-in profiles** added to roadmap | The code profile is rich; Email/PM/Notes are thin by comparison — bring them to the same quality bar, with a per-profile eval |
| 2026-05-24 | **Rethink the Profiles UX** added to roadmap (how = open) | The profiles section resembles Wispr Flow too closely; make it distinctly Landa — direction not yet decided |
| 2026-05-24 | Profile polish scope **includes the per-profile example input/output** in the UI | Examples must be smoother and more mature, not throwaway — part of the mature-SaaS bar |
| 2026-05-24 | **Model-agnostic per-profile routing** added to roadmap (Later) | Backend picks the best model per profile (e.g. Haiku for code, OpenAI for email), invisible to the user; constraint: every model must stay EU-resident + zero-retention to keep the wedge |
| 2026-05-24 | Ran full **production-readiness review** ([tasks/review-2026-05-24.md](tasks/review-2026-05-24.md)); fixed the one slice-1-relevant item (XSS escaping of app names/URLs, `0c6892a`) | Rest are **pre-existing**, not slice-1 blockers → tracked as a **hardening backlog** (see Engineering status). Top items: localhost backend has no auth/CORS; shared `LANDA_APP_SECRET` baked in every binary; unlocked config write-race; crash-restart loop with no backoff; auto-language double-pass doubles local latency; app-wide keyboard/focus a11y gaps |

---

## 5. Status by Area

**Product** — *State:* Mature. Onboarding, auto-update with changelog, stats dashboard, modes/profiles (Email, Personal Message, Notes), bundled local model, vocabulary, history all shipped. Adaptive per-app style **slice 1 COMMITTED** (`10a81a9`; new `code` category for Cursor/VS Code/Codex, one smart jargon-aware prompt that is verbatim cleanup not compose, on by default; backend prompt + fresh-install/migration defaults + bidirectional routing + settings tile; banner hides non-installed apps) — live-verified working, **not yet released**. *Blocker:* on-by-default release gated on the §11 quality gates: blind A/B eval on real Cursor/VS Code dictations, `/review`, and macOS+Windows app-name/smoke verification. *Next:* run the eval (Nick's own dictations) + `/review` + cross-platform smoke; then the messaging tone/format split (slice 2), agent mode in profiles, voice-edit selected text.

**Engineering** — *State:* App stable on both OSes; proxy live in Frankfurt; Vertex/Claude polish code written and verified reachable, parked in `git stash`. Adaptive code category committed. *Blocker:* Anthropic quota denied → can't flip polish to EU; Vercel ~4.5 MB request body cap threatens long-dictation cloud transcription. *Next:* land the vendor-independent backend/settings cleanup on the interim US backend; hold the EU flip until quota clears.
- **Hardening backlog** (from [tasks/review-2026-05-24.md](tasks/review-2026-05-24.md), 2026-05-24 — pre-existing, prioritize separately; several pair naturally with the payments/EU track):
  - *Security:* localhost backend `/config` has no auth/CORS (can be repointed at an attacker proxy) → add a per-launch token + `Origin`/`Host` check; shared `LANDA_APP_SECRET` is extractable from every binary → per-install credentials (ties to abuse/billing); `execAsync` shell-injection in macOS icon scan → use `execFile`; pin model `.bin` SHA-256.
  - *Reliability:* unlocked config write-race under `threaded=True` → single lock; crash-restart loop has no cap/backoff → cap + surface error; force-kill backend on quit so the mic isn't orphaned; atomic history write.
  - *Performance:* `language:"auto"` runs detect+transcribe = two full passes → one pass (halves local stop→paste wait); cap history size; bound the macOS icon-scan concurrency.
  - *Maintainability:* category taxonomy defined twice (settings.js + landa_core.py) — slice 1 worsened this → backend owns a `/modes/schema`, renderer fetches it; extract the duplicated finalize pipeline; archive the dead lexicon code (~750 LOC).
  - *UX/a11y:* sidebar + shortcut controls are click-only `<div>`s and focus is invisible app-wide → keyboard-reachable + `:focus-visible`; loading/error states for History & Update windows.

**Compliance / Legal** — *State:* No legal entity yet; no DPA, no ZDR, no subprocessor list. EU claim is currently false (text reaches OpenAI-US). *Blocker:* legal entity is the keystone for everything (controller status, DPAs, ZDR billing, payments, model-access gates). *Next:* form the company (likely DE Einzelunternehmen → step up to UG/GmbH; confirm with a Steuerberater/lawyer).

**Marketing** — *State:* Landing page live and redesigned (mobile-first; scrollytelling + demo videos), but it lacks usage/social proof, the demo videos are too hectic, there's no clear pricing structure/tiers, no case studies, and no explicit "who it's for." *Blocker:* cannot truthfully claim "EU-hosted" until the model flip + egress proof land. *Next:* restructure the page — one picture-perfect email-creation video, add proof + tiers + case studies + "who it's for"; hold the EU copy; remove the landing-page demo UI and retire its env var.

**Finance / Pricing** — *State:* Tiers + billing decided (Free / Pro €10–13 / Team €8–10 per seat / Enterprise; Lemon Squeezy). No payments system built yet. *Blocker:* no entity (can't take payments); hiding the key means Landa pays per cloud-transcription minute, pressuring margin. *Next:* validate the Pro margin (Lemon Squeezy ~5% + EU LLM cost), confirm free-tier = local-only and its word-reset cadence; build the gate.

**Ops** — *State:* Proxy source now backed up to private GitHub; releases ship via tagged CI (notarized macOS + Windows). *Blocker:* none acute. *Next:* confirm Upstash rate-limit region is EU; keep the rate-limit guard sized for load.

---

## 6. Open Questions & Risks

- **Free-tier reset cadence:** is the 2,000-word free allowance per week, per month, or one-time? Competitors are per-week. Needs confirming.
- **Pro margin:** does €10/mo (annual) survive Lemon Squeezy (~5%) + per-user EU LLM polish cost, especially against a free tier? Unverified.
- **Free tier shape:** local-only (protect margin) vs. cloud-polish (cash drain vs. VC-subsidized rivals)? Open.
- **Vendor approval timeline:** EU-residency depends on Google/Anthropic granting quota — their timeline, not ours. Anthropic already denied once.
- **Transcription accuracy gap:** bundled default (`landa-base` == whisper-small) is a *small* model; core accuracy vs. Wispr/Willow is unaddressed and may be a competitive gap.
- **Polish quality after EU flip:** switching off gpt-4o to Claude needs a before/after eval on real dictations to confirm parity.
- **Long-dictation cloud transcription:** Vercel ~4.5 MB body cap (16 kHz mono WAV ≈ 1.9 MB/min) overflows on long recordings — compress, raise limit, or backend-direct (credential-exposure tradeoff).
- **Multilingual quality:** rivals claim 100+ languages; where Landa stands is unmeasured.
- **Liability cleanup:** the `wispr backend log files/` folder in the working tree should be deleted (IP/trade-secret risk that contradicts the trust brand).
- **Legal-entity specifics:** entity type and jurisdiction need professional advice (not yet decided).
- **Profiles UX direction:** the section resembles Wispr Flow too closely and needs to become distinctly Landa — but *how* (layout, mental model, naming) isn't decided yet. Needs a design exploration.
- **Local vs. cloud output coherence:** "getting the output right" runs on two paths — local deterministic vocab correction (free path) and cloud-LLM profiles (paid path). The same jargon must resolve the same way on both (e.g. "Claude Cold" → "Claude Code" whether or not the user gets cloud polish). Keep them aligned as each evolves; don't let the two diverge.

---

## 7. Key Facts & Vendors

**Data flow today**
- **Polish (default, every paying user):** text → Vercel `fra1` (Frankfurt) relay → **OpenAI-US gpt-4o**. EU relay is real; the US hop one step later is the gap.
- **Transcription (default, everyone):** local `landa-base` on-device — never leaves the machine.

**Proxy** — `landa-proxy.vercel.app`, Vercel project `nickybricks-projects/landa-proxy`, region **`fra1`**. Source at `~/Developer/landa-proxy` (TypeScript; **not** in the `landa` repo), backed up to private **github.com/nickybricks/landa-proxy**. Routes: `api/reformat.ts`, `api/transcribe.ts`, `api/health.ts`; rate-limit in `lib/ratelimit.ts` via **Upstash Redis**. Auth via `LANDA_APP_SECRET` bearer.

**EU polish target (staged, not live)** — Claude **Haiku 4.5** on **Google Vertex AI**, GCP project `mail-intelligence-496114`, `VERTEX_REGION=eu` (multi-region), model `claude-haiku-4-5@20251001`. Env on Vercel Production: `GCP_PROJECT_ID`, `VERTEX_REGION`, `VERTEX_CLAUDE_MODEL`, `GCP_SERVICE_ACCOUNT_JSON`. Old `OPENAI_API_KEY` kept for rollback. **Gated:** Anthropic quota denied 2026-05-24, re-requested.

**App** — Electron 30+ main process + Python backend (`landa_core.py`) over HTTP on `localhost:7890`. Config at `~/.landa/config.json`. Releases via tagged CI → notarized macOS `.dmg` + Windows `.exe` with auto-updater metadata.

**Tooling** — Analytics: **PostHog** (EU Cloud, product/funnel only — not billing truth). Auth: **Supabase** (EU region, planned). Billing source of truth: Supabase Postgres; merchant of record: **Lemon Squeezy**.

**Vendor access reality** — every premium EU-resident path is gated for a pre-company PAYG account: Azure (tenant wall + EA-gated ZDR), Vertex/Claude (Anthropic access form + quota approval), OpenAI-EU (Enterprise/Sales). Plain US OpenAI is the only self-serve option and is not EU-resident.

---

## 8. Weekly Review (10-minute checklist)

Once a week, walk the six areas. For each, answer three questions and push any change into **Status by Area** (§5) and, if something was decided, the **Decision Log** (§4). Keep it to ~10 minutes — this is a pulse check, not a planning session.

For each area — **Product · Engineering · Compliance/Legal · Marketing · Finance/Pricing · Ops:**
- **Moved?** What advanced since last week?
- **Blocked?** What's stuck, and on whom/what (entity, vendor quota, a decision)?
- **Next?** The single most important next action.

Then, three whole-company checks:
- [ ] Does the **Exec Summary** still describe reality? If not, fix it.
- [ ] Any **Open Question** now answered → promote it to a Decision Log row and delete the question.
- [ ] Is the **#1 blocker** still the legal entity + payments? If something more urgent emerged, say so at the top.

Update the "Last synthesized" date at the top whenever the review changes anything material.
