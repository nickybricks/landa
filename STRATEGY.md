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
- 🟡 **Auth + entitlement foundation built & verified end-to-end** (Supabase EU magic-link sign-in + hard gate, proven on a packaged build; branch `auth-supabase`). **Server-side free-tier enforcement is LIVE** on the proxy (tamper-proof weekly word metering + 402, verified 8/8 in prod) — but it only bites once the app forwards the user token (the deferred "C"), and there are **no live payments yet** (checkout gated on the legal entity).
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
- **Agent mode in profiles** — let a profile either transcribe what you say *verbatim* or take an *instruction* and compose the reply (e.g. "write an answer that covers x and y, and tell her I'm sorry about yesterday"). Profiles gain a verbatim-vs-compose behavior. **🟢 IMPLEMENTED + COMMITTED for Email + PM (2026-05-24)** as automatic intent-detection (no toggle); Notes already had a request-rule; Code excluded. Reviewed (LLM-as-judge) + adversarial misfire probe passed 4/4. **Still owed before the release that ships it:** release-surface updates (onboarding/landing/changelog).
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
- **Dedicated user Profile / account menu** — split the *user account* out of Settings into its own area: the account block (email, plan, usage, sign-out — currently the Settings "Account" section) moves into a dedicated **Profile menu**; Settings keeps the rest. Entry point = a user **avatar** (uploadable) sitting under the Feedback button at the sidebar bottom; the user can set/change a **display name** later. ⚠️ Name clash to resolve: today's "Profiles" tab = *writing modes* (Personal Message/Email/Notes/Code); this new "Profile" = the *user's* account.
- **Collapsible Profiles category drawer** — make the category column (the drawer that tucks behind the sidebar island) collapsible via a button at the **top-right of its island**, and give the drawer a **border** for cleaner definition.
- **Home rearrange — make the stats numbers the hero** — the usage numbers (transcriptions / words / time saved / streak…) read as secondary today; rework the Home layout so the numbers are prominent and present, not an afterthought.

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
| 2026-05-24 | Ran full **production-readiness review** ([tasks/review-2026-05-24.md](tasks/review-2026-05-24.md)); fixed the one slice-1-relevant item (XSS escaping of app names/URLs, `0c6892a`) | Rest are **pre-existing**, not slice-1 blockers → tracked as a **hardening backlog** (see Engineering status). Top items: localhost backend has no auth/CORS; shared `LANDA_APP_SECRET` baked in every binary; unlocked config write-race; crash-restart loop with no backoff; app-wide keyboard/focus a11y gaps |
| 2026-05-24 | **Won't pursue the transcription-latency fix** (auto-language double-pass, review finding #5) — descoped | Nick: transcription input/output quality is good; don't touch the transcription path. Removed from the hardening backlog |
| 2026-05-24 | **Agent mode IMPLEMENTED for Email + PM** (roadmap item pulled forward from "Next"). The profile auto-detects per dictation: a message spoken to the recipient is cleaned verbatim (usual path); an *instruction* ("tell her I'm sorry about yesterday…", "reply to him that…") is composed into the actual message. **No toggle** — automatic intent detection (third-person recipient + directive verb = compose), reusing the pattern Notes already had. Code stays excluded (its "YOU ARE NOT THE AGENT" guard is the opposite). | Nick: do it now, then eval. `_EMAIL_AGENT`/`_PM_AGENT` blocks in `get_mode_prompt`. Live-verified composing (EN+DE, du preserved) without inventing facts; no toggle keeps the no-config hard rule. ⚠️ When released, agent mode changes what dictation does → must hit onboarding + landing + changelog. Risk to watch: misfire (literal message ↔ instruction). **Not committed — pending blind rating.** |
| 2026-05-24 | **Keep the "Landa" name** (decided not to rename) | "Apple" logic — an empty name becomes iconic once the product earns it; renaming a shipped/released/auto-updating app is real cost for no real harm |
| 2026-05-24 | **Remove emoji used as UI icons app-wide; replace with a monochrome line-icon set** (self-hosted, e.g. Lucide). **Keep** the opt-in "Use emoji" *output* toggle (default off) — it's a user writing capability, not brand chrome. Platform glyphs (⌘⇧⌥, ✓, ↺, arrows) stay. DESIGN.md gains an Iconography section. | Emoji-as-icons read playful/childish, off the mature-SaaS brand; one line set reads designed + themes for dark mode; self-hosted icons fit the no-CDN privacy stance. ⚠️ Implementation pending: category icons in `settings.html` + `settings.js` (taxonomy is duplicated — see hardening backlog), 🕐/📖 placeholders, ✉/💬 app-chip fallbacks, website 📎. |
| 2026-05-24 | **Brand palette re-anchored to monochrome deep-red.** Primary `#4A0404` (near-black oxblood, white text AAA) + accent `--tertiary` `#A32B2B` (brighter red, used sparingly); secondary `#8C6B6E` muted mauve; background = **Cloud Dancer** `#f0eee9` (PANTONE 11-4201); warm greige neutrals (not cool greys). **Radii subtle (2–4px)**, down from 8/16px. Fonts unchanged (Manrope + Inter) but **self-hosted** (no Google Fonts CDN). **No more liquid glass** — solid surfaces + restrained shadow. Logo = "L" mark. DESIGN.md updated. | Differentiation (no one in voice-to-text owns deep red) + warm-trust matches the maturity wedge; navy is the trust cliché and fights the warm Cloud Dancer bg; monochrome red is more disciplined than red+gold; glass dates fast; Google Fonts CDN leaks user IPs, contradicting the EU-privacy wedge. ⚠️ Guardrail: reserve a **separate semantic error color** so "danger" ≠ "brand." Implementation pending: `renderer/settings.css` tokens, resting pill, onboarding, website/, logo asset |
| 2026-05-24 | **Everyday-profile polish = targeted fixes, NOT a wholesale rewrite.** Diagnosis: Email/PM aren't broken (unlike code-in-editors), they're thin-in-spec but already produce good output. Three real gaps fixed: (1) emoji now controlled solely by the toggle (Excited no longer self-sprinkles), (2) PM formal/casual/excited given a real register gradient + worked examples, (3) formal email no longer invents pleasantries ("I hope you're well") | A blind "deepen to code's depth" rewrite would add bloat + regression risk to already-good output. Built a reusable Email/PM sampler (`evals/run_profile_samples.py` + `evals/everyday_profiles.json`); guardrails 0-fail, code eval 18/18. **Not committed — pending Nick's blind A/B.** Snapshot: [tasks/profile-eval-2026-05-24.md](tasks/profile-eval-2026-05-24.md) |
| 2026-05-24 | **Notes profile eval'd clean (14/14) — NO prompt changes; preview cards (email + notes) elevated.** Built 14 Notes cases (corpus 59→73) + extended the sampler (plain-vs-Notion `target` field, category filter arg). Live run: 14/14, 0 guardrail failures — anti-invention traps held, title rule + plain/Notion branch + request rule all correct EN+DE. Per "don't fix what isn't broken," Notes left as-is. Separately, polished the per-profile UI preview cards: **email** unified across formal/casual/excited and **stripped the invented boilerplate** the old formal preview showed (now consistent with `_EMAIL_GUARDRAILS`); **notes** grocery list → professional project note. PM + code previews unchanged. | Finishes the everyday-profile-depth roadmap item minus slice 2. Notes matched the Email/PM finding (thin-in-spec but already good). Snapshots: [tasks/notes-eval-2026-05-24.md](tasks/notes-eval-2026-05-24.md), [tasks/profile-notes-and-previews.md](tasks/profile-notes-and-previews.md). **Slice 2** (Slack/Discord vs WhatsApp/Signal split) deferred to its own session — rides the most-tuned PM prompt, needs a product decision + regression budget. |
| 2026-05-24 | **Profiles tone UI redesigned: card-wall → compact segmented selector + ONE preview.** Adding the 4th tone card ("Automatic") squeezed the email/PM cards into a horizontal scroll; the card wall was also the main "looks like Wispr Flow" tell. Replaced the row of full-preview cards with a compact **tone selector** (reusing the app's native Recording-Window segmented control) + a **single full-width preview** that updates to the selected tone (toggles live inside it). Notes/Code (single Smart style) show just the preview. Also fixed an off-brand **blue selection glow** → brand red (`--tertiary`), per DESIGN.md. | Fixes the squeeze, scales to any number of tones, and is a clear step away from Wispr's card grid — a first cut at the roadmap's "rethink Profiles UX, distinctly Landa." Scoped to the tone area only; the deeper mental-model rethink stays a separate exploration. Nick picked this direction from 3 mocked options. Also refined the **apps banner**: relabeled "This profile applies to:" → **"Active in"**, **squared** the app icons (were round/social), shrank the card height, and fixed another off-brand blue hover → red. **Committed `ec89261`** (not pushed). Files: `renderer/settings.js` (`renderStyleCards`/`selectStyle` + banner i18n), `renderer/settings.css` (`.modes-tone*`, `.modes-banner*`). |
| 2026-05-24 | **Slice 2 RESHAPED + BUILT: automatic register detection ("Automatic" style), subsuming the work/personal tone split.** Instead of a manual Slack-vs-WhatsApp tone bucket under a manual formal/casual/excited switch, the LLM now **auto-picks formal↔casual per dictation** (never excited — that stays a deliberate manual pick), and the destination chat app (work: Slack/Discord/Teams vs personal: WhatsApp/Signal/Telegram) feeds the decision as a soft nudge. `auto` is a new **default** style for email + personal-message; manual formal/casual/excited remain selectable. Net-new sibling prompt → cannot regress the tuned prompts. Migration is **conservative** (explicit selections kept; only missing keys → auto). App lists aligned (Telegram/Signal/Teams added; existing PM configs enriched). | Nick: the manual switch was the friction ("I don't want to keep switching modes"). Same automatic philosophy as agent mode (which passed 4/4). Live eval **10/10, 0 guardrail failures**; German formal-vs-casual selection + greeting/sign-off variant both correct; celebratory misfire traps held (no auto-excited); Sie/du never flipped. **⚠️ Finding:** the work/personal app nudge is *subtle* — identical neutral input gave identical output across buckets; confirm on real dictations in the blind A/B. ⚠️ Unreleased like agent mode + slice 1 → onboarding/landing/changelog owed before the release that ships it. Plan + eval: [tasks/auto-register-style.md](tasks/auto-register-style.md). **Committed `b4da6b6`** (not pushed). |
| 2026-05-24 | **Everyday-profile polish + agent mode REVIEWED (LLM-as-judge) and COMMITTED.** Verdict: 53/55 clean; the 2 residuals are the known *intermittent* "loop in X → future communications" widening and a slightly prim German-excited register — neither a regression. Then expanded the corpus to **59 cases** with **4 adversarial agent-mode misfire traps** (literal message opening with "tell"; genuine message mentioning a third person; instruction with no directive verb; instruction in the second person) → **detection passed 4/4 both directions**, incl. the second-person person-shift. Only residual: compose path adds mild courtesy filler (tone padding, not invented facts) | Closes the misfire-coverage gap a live A/B would otherwise have to find. Agent-mode intent detection is robust on the heuristic boundary. ⚠️ **Agent mode is a user-facing behavior change → onboarding + landing + changelog must be updated before the release that ships it.** |
| 2026-05-24 | **Auth foundation BUILT + verified live** on Supabase (EU/Frankfurt, project `lvxucmpfxdgozetqytto`) | Magic-link (clickable `landa://` deep link, PKCE); sign-in required before use; entitlement schema (`profiles`/`usage`, RLS read-only); client-side is-Pro read + payment seam **stubbed**. Stops short of live checkout (gated on the legal entity). On branch `auth-supabase` (unmerged); details in [tasks/auth-supabase.md](tasks/auth-supabase.md) |
| 2026-05-24 | **Login = magic link** now; Google + Microsoft/Outlook OAuth later (reuse the same `landa://` deep-link handler) | Nick's call; clickable link chosen over a 6-digit OTP code |
| 2026-05-24 | **Usage metering: the app only READS; the proxy is the authoritative WRITER** (next session) + free-tier enforcement | Tamper-proof — RLS forbids client writes to plan/usage, so a client can't self-upgrade or zero its counter |
| 2026-05-24 | **Email = Brevo (EU) custom SMTP** wired into Supabase | Supabase's built-in email is throttled (testing only) regardless of plan; Brevo (EU) fits the wedge. ⚠️ Pre-launch: authenticate `landavoice.com` (SPF/DKIM/DMARC) — mail currently lands in spam |
| 2026-05-24 | **Free tier = 2,000 *polished* words/week** (not all dictation). Raw on-device transcription stays unlimited & free | Only cloud polish hits the proxy, so it's the only thing meterable tamper-proof; metering local transcription would mean trusting the client. Resolves Open Q "what the 2,000 gates" |
| 2026-05-24 | **Free-tier reset cadence = WEEKLY** (Monday 00:00 UTC) | Resolves the long-standing open question; matches Wispr/Willow's per-week free tiers. `period_start` = Monday of the ISO week |
| 2026-05-24 | **Metering unit = dictated input words; soft cap** | Input words (what the user spoke) are the fairest, most predictable "words used"; the call that crosses the line is allowed, the next is blocked until reset |
| 2026-05-24 | **Over-limit behavior = raw local fallback + soft upgrade nudge** (proxy returns 402) | App never breaks — the user still gets their raw transcript pasted; gentle conversion, not a wall |
| 2026-05-24 | **Proxy enforcement DEPLOYED + VERIFIED LIVE (proxy side).** `landa-proxy`: `lib/entitlement.ts` (Supabase ES256-JWT verify via JWKS, weekly meter read, atomic `increment_usage` RPC) wired into `api/reformat.ts`; migration `0002_usage_increment.sql` applied to the live DB; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set on Vercel Production; deployed (committed `6ff3222`, pushed) | The authoritative writer/gatekeeper that makes Pro tamper-proof. 🔒 **Safe rollout: enforced ONLY when `x-landa-user-jwt` is present** — the live released app sends none, so it's untouched today (verified live). Flip to require-JWT once auth ships to everyone. **Live harness `scripts/test-enforcement.mts` → 8/8 against production**: no-JWT→200 unmetered, valid→200+increment, over-limit→402, bad JWT→401. Plan: [tasks/proxy-enforcement.md](tasks/proxy-enforcement.md). App-side token plumbing (main→backend→proxy, the deferred "C") is next |
| 2026-05-24 | **Auth gate = fully inert until signed in** (Nick's call) | A signed-out user could still reach Settings via the tray/dock (recording was gated, the window wasn't). Fix: `openSettings()` routes signed-out users to the sign-in window — every entry point funnels through it (`3b648f0`, `auth-supabase`) |
| 2026-05-24 | **Auth foundation VERIFIED END-TO-END on a packaged macOS build** (magic-link sign-in + gate). Two pre-release bugs caught + fixed by packaging | Dev `npm start` couldn't validate it: (1) `landa://` deep link only resolves to the real app when packaged — in dev it launched a bare Electron (welcome screen); (2) `auth.js` was missing from electron-builder's `files` → packaged app crashed `Cannot find module './auth'` (`f16f49e`). Both would have shipped broken. Packaged build (`0.26.1`) signs in cleanly, gate holds. **The auth round-trip is now proven** (was the last unverified piece of the auth foundation) |
| 2026-05-24 | **Brand re-skin IMPLEMENTED** across the whole app (settings/recording/onboarding/auth/update) **and** the landing page (`website/`): the decided monochrome deep-red + Cloud Dancer system is now live in code — `:root` tokens, 4px radii in-app, dark-mode overrides, no liquid glass (one exception), emoji→Lucide line icons. **Uncommitted.** | Closes the "implementation pending" gap the earlier 2026-05-24 brand/iconography/palette rows flagged (code still shipped the old `#0088ff` blue system). Sub-decisions: (1) **semantic `--error`/`--success`/`--warning` tokens** added — error = distinct orange-red `#e5533d` so danger≠brand; (2) **resting pill KEEPS its blur** (Nick) — DESIGN.md corrected (it had said "solid"); (3) **home-tab sky photo + white glow line removed** (they *were* the liquid-glass look the brand drops); (4) recording orb rainbow ring → rotating deep-red, app + site. **Open/flagged (not yet decided):** landing CTAs kept pill-radius (app went 4px); the 5 per-app colored radials on the landing left colorful (vs. monochrome); self-hosted fonts + the "L" logo remain out of scope. **Visual QA owed** — Nick eyeballs the app + site (code-verified only). |
| 2026-05-24 | **Surfaces lightened: warm beige → light neutral grey** (Nick, via a new `design-system.html` token playground). `--bg` `#f0eee9` (Cloud Dancer) → `#f5f5f6`; cards `#fbfaf7`→`#ffffff`; sidebar `#eae7e0`→`#ededee`; border/text → neutral. Brand reds + mauve secondary + dark mode **unchanged**. Applied across all app windows + `website/` + DESIGN.md. **Uncommitted.** | Nick on seeing the live app: the warm beige read "dark beige"/off. Built a live token playground (swatches + pickers + presets + a mini app mockup) so we could pick values before baking; Nick approved the "Light grey" preset and confirmed the mockup. Only the *surfaces* went neutral — the chromatic palette stays warm. (The blue waveform app icon in Home is the **logo asset**, the still-deferred "L-mark," not a token.) |
| 2026-05-24 | **Radii kept VARIED (reverted the re-skin's "subtle 4px" flattening) + "Landa" wordmark added.** Restored the original per-element radii (cards `16px`, controls `8px`, sidebar `12px`, plus per-item exceptions) across settings/onboarding/auth/update; DESIGN.md's radius section rewritten to document the varied system (was "subtle 2–4px"). Added a "Landa" wordmark top-left: in the **sidebar on macOS** (below the traffic lights), in the **titlebar on Windows** (no traffic lights). **Uncommitted.** | Nick: the blanket 2–4px read "too small and tight" and erased intentional variation — *different roundings per element type are deliberate*, and a single global radius is **not** wanted. Wordmark matches the approved `design-system.html` mockup. |
| 2026-05-24 | **Three UI items added to the roadmap (Next), for later (not built):** (1) a **dedicated user Profile/account menu** — move the account block out of Settings into it; entry = an uploadable **avatar** under the Feedback button (sidebar bottom) + editable display name; (2) make the **Profiles category drawer collapsible** (toggle at top-right of its island) + add a border to it; (3) **rearrange Home so the stats numbers are the hero** (they're not present enough today). | End-of-design-session capture (Nick). ⚠️ Name clash to resolve when built: the existing "Profiles" tab = writing modes; the new "Profile" = the user's account. |

---

## 5. Status by Area

**Product** — *State:* Mature. Onboarding, auto-update with changelog, stats dashboard, modes/profiles (Email, Personal Message, Notes), bundled local model, vocabulary, history all shipped. Adaptive per-app style **slice 1 COMMITTED** (`10a81a9`; new `code` category for Cursor/VS Code/Codex, one smart jargon-aware prompt that is verbatim cleanup not compose, on by default; backend prompt + fresh-install/migration defaults + bidirectional routing + settings tile; banner hides non-installed apps) — live-verified working, **not yet released**. *Blocker:* on-by-default release gated on the §11 quality gates: blind A/B eval on real Cursor/VS Code dictations, `/review`, and macOS+Windows app-name/smoke verification. *Next:* run the eval (Nick's own dictations) + `/review` + cross-platform smoke; then the messaging tone/format split (slice 2), agent mode in profiles, voice-edit selected text. **Everyday-profile polish (Email + PM) done as targeted fixes** (emoji=toggle-only, PM register gradient, no invented email pleasantries) — **reviewed (LLM-as-judge, 53/55) and COMMITTED**. **Notes eval'd 14/14 clean → no prompt changes** (already good; corpus now 73 cases). **Per-profile UI preview cards polished** (email unified + boilerplate stripped, notes → project note; PM/code unchanged). **Slice 2 RESHAPED + BUILT as automatic register detection** — a new "Automatic" style (default) for email + PM that auto-picks formal↔casual per dictation (never excited), with the destination chat app (work vs personal) as a soft nudge; manual styles stay selectable; conservative migration; app lists aligned (Teams/Telegram/Signal). Live eval **10/10**, misfire traps + Sie/du held. ⚠️ The work/personal nudge is *subtle* (confirm in the blind A/B). **Profiles tone UI also redesigned** (Wispr-like card-wall → compact segmented selector + single preview) and the **apps banner refined** ("Active in", squared icons, shorter) — first cut at the "distinctly Landa" Profiles rethink. **Committed** (`b4da6b6` + `ec89261`, not pushed). **Agent mode now implemented for Email + PM** (auto compose-from-instruction, no toggle) — committed; **adversarial misfire probe passed 4/4**. ⚠️ Agent mode + the new Automatic style change what dictation does → reflect in onboarding/landing/changelog **before the release that ships them**. **Whole-app brand re-skin IMPLEMENTED (uncommitted):** the monochrome deep-red + Cloud Dancer system is now live in all five windows (tokens, 4px radii, dark mode, semantic `--error`/`--success`/`--warning`, liquid glass dropped except the resting pill, emoji→Lucide line icons). Visual QA by Nick still owed; fonts + "L" logo remain out of scope.

**Engineering** — *State:* App stable on both OSes; proxy live in Frankfurt; Vertex/Claude polish code written and verified reachable, parked in `git stash`. Adaptive code category committed. **Supabase (EU/Frankfurt) auth project live + app-side auth on branch `auth-supabase` (magic-link, encrypted session, entitlement reads, gate) — verified live.** **Proxy-side enforcement DEPLOYED + VERIFIED LIVE (`landa-proxy`): JWT verify (JWKS/ES256) + weekly word metering + free-tier 402, enforced only when a user JWT is present (production-safe). Migration `0002` applied; Supabase env set on Vercel; live harness 8/8.** *Blocker:* Anthropic quota denied → can't flip polish to EU; Vercel ~4.5 MB request body cap threatens long-dictation cloud transcription. *Next:* the **app-side token plumbing** (main→backend→proxy `x-landa-user-jwt`, 402→raw-fallback+nudge — the deferred "C"); commit the uncommitted `landa-proxy` code; land the vendor-independent backend/settings cleanup; hold the EU flip until quota clears.
- **Hardening backlog** (from [tasks/review-2026-05-24.md](tasks/review-2026-05-24.md), 2026-05-24 — pre-existing, prioritize separately; several pair naturally with the payments/EU track):
  - *Security:* localhost backend `/config` has no auth/CORS (can be repointed at an attacker proxy) → add a per-launch token + `Origin`/`Host` check; shared `LANDA_APP_SECRET` is extractable from every binary → per-install credentials (ties to abuse/billing); `execAsync` shell-injection in macOS icon scan → use `execFile`; pin model `.bin` SHA-256.
  - *Reliability:* unlocked config write-race under `threaded=True` → single lock; crash-restart loop has no cap/backoff → cap + surface error; force-kill backend on quit so the mic isn't orphaned; atomic history write.
  - *Performance:* cap history size; bound the macOS icon-scan concurrency. (~~Auto-language double-pass → one pass~~ **WON'T FIX, descoped 2026-05-24** — see Decision Log; transcription path stays as-is.)
  - *Maintainability:* category taxonomy defined twice (settings.js + landa_core.py) — slice 1 worsened this → backend owns a `/modes/schema`, renderer fetches it; extract the duplicated finalize pipeline; archive the dead lexicon code (~750 LOC).
  - *UX/a11y:* sidebar + shortcut controls are click-only `<div>`s and focus is invisible app-wide → keyboard-reachable + `:focus-visible`; loading/error states for History & Update windows.

**Compliance / Legal** — *State:* No legal entity yet; no DPA, no ZDR, no subprocessor list. EU claim is currently false (text reaches OpenAI-US). *Blocker:* legal entity is the keystone for everything (controller status, DPAs, ZDR billing, payments, model-access gates). *Next:* form the company (likely DE Einzelunternehmen → step up to UG/GmbH; confirm with a Steuerberater/lawyer).

**Marketing** — *State:* Landing page live and redesigned (mobile-first; scrollytelling + demo videos), but it lacks usage/social proof, the demo videos are too hectic, there's no clear pricing structure/tiers, no case studies, and no explicit "who it's for." *Blocker:* cannot truthfully claim "EU-hosted" until the model flip + egress proof land. *Next:* restructure the page — one picture-perfect email-creation video, add proof + tiers + case studies + "who it's for"; hold the EU copy; remove the landing-page demo UI and retire its env var. **Landing page now re-skinned to the new brand** (deep-red/Cloud Dancer tokens, blue→red glows, rainbow ring→red, 📎 emoji removed) — uncommitted; the 5 per-app colored section radials + pill-radius CTAs were left as-is pending Nick's call (the structural restructure — proof/tiers/video — is still the separate, larger task).

**Finance / Pricing** — *State:* Tiers + billing decided (Free / Pro €10–13 / Team €8–10 per seat / Enterprise; Lemon Squeezy). **Auth + entitlement foundation BUILT** (Supabase EU magic-link, `is-Pro?` reads, usage-metering schema, payment seam stubbed — branch `auth-supabase`, unmerged); live checkout still not built. **Proxy-side enforcement BUILT (server-side weekly metering + free-tier 402, not yet deployed); free tier confirmed = 2,000 polished words/week.** *Blocker:* no entity (can't take payments); hiding the key means Landa pays per cloud-transcription minute, pressuring margin. *Next:* deploy the proxy + the app-side token plumbing (deferred "C"), then wire Lemon Squeezy checkout to the seam once the entity exists; validate the Pro margin.

**Ops** — *State:* Proxy source now backed up to private GitHub; releases ship via tagged CI (notarized macOS + Windows). **Supabase project `landa` (EU/Frankfurt) provisioned; Brevo (EU) SMTP wired for auth emails.** *Blocker:* none acute. *Next:* **authenticate `landavoice.com` in Brevo (SPF/DKIM/DMARC) so auth mail leaves spam — pre-launch; runbook ready at [tasks/brevo-domain-auth.md](tasks/brevo-domain-auth.md), Nick to execute in Brevo + IONOS DNS**; confirm Upstash rate-limit region is EU; keep the rate-limit guard sized for load.

---

## 6. Open Questions & Risks

- ~~**Free-tier reset cadence:** per week / month / one-time?~~ **RESOLVED 2026-05-24 → WEEKLY** (Monday 00:00 UTC), and the 2,000 counts **polished words only** (raw transcription unlimited). See Decision Log.
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

**Tooling** — Analytics: **PostHog** (EU Cloud, product/funnel only — not billing truth). Auth: **Supabase** (EU/Frankfurt, project `lvxucmpfxdgozetqytto`) — **live**, magic-link. Auth email: **Brevo** (EU) SMTP. Billing source of truth: Supabase Postgres; merchant of record: **Lemon Squeezy**.

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
