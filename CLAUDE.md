# Landa — Electron App

## What This Is
A cross-platform Electron app for Landa — global hotkey voice-to-text that pastes into any active app. Electron + Node.js frontend communicating with the Python backend over HTTP.

## Strategy & Session Workflow (read this first)

Landa is a one-person company. To stay aligned across sessions, two docs are canonical and **must be read at the start of every session**:

- **`STRATEGY.md`** — the single source of truth for *what we're building and why*: vision, positioning, roadmap, a dated **Decision Log**, **Status by Area**, open questions, and key facts/vendors. When anything conflicts (old notes, `tasks/todo.md`, the Notion mirror), `STRATEGY.md` wins. The Notion copy is a **read-only mirror** — never treat it as authoritative; re-sync it only when asked.
- **`NEXT_SESSION.md`** — the tactical planner: the start/end-of-session checklists, the confirmed goal for the next session, an **⚠️ In flight / don't forget** list, and a session log.

**Keep the docs alive (every working session):**
- When something is **decided**, immediately append a dated row to `STRATEGY.md` → Decision Log and refresh the affected **Status by Area** line. Don't batch this for later — undocumented decisions are how changes get forgotten.
- At session end, update `NEXT_SESSION.md` (next goal, in-flight items, session log) per its End-of-session checklist.

**Alignment ritual — prevent forgotten changes from becoming bugs:**
- At session start, run `git status` + `git diff` and **reconcile every uncommitted change against the plan before writing new code**. If you find an edit that isn't explained by the plan or a logged decision, STOP and surface it — don't build on top of a change nobody remembers making.
- Never leave a change undocumented: either commit it, or record it in `NEXT_SESSION.md` → "In flight / don't forget" with file references.

## Claude Code Behavior

> These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan — don't keep pushing
- Write detailed specs upfront to reduce ambiguity

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- No temporary hacks. Find root causes. Senior developer standards.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Project-specific verification:
- Never mark a task complete without proving it works
- Backend: confirm the HTTP API responds on localhost:7890
- Electron: confirm `npm start` launches without errors
- Test the full flow: hotkey → record → transcribe → paste

### 5. Keep Every Surface in Sync

**A feature isn't done when the code works — it's done when every surface that describes or exposes it is updated.** Landa has the same feature reflected in many places; changing one without the others ships an inconsistent product.

When you add or change any user-facing behavior, check and update (or explicitly confirm "no change needed") each surface it touches:
- **Settings UI** (`renderer/settings.js` / `.html` / `.css`) — toggles, labels, new config.
- **Onboarding** (`renderer/onboarding.*`) — does first-run still teach the feature set accurately?
- **Landing page** (`website/`) — copy, feature lists, demos, pricing/tiers.
- **README.md** — features, setup, tech stack (also a release-workflow step).
- **DESIGN.md** — if anything visual/brand changed (update it *first*, per Design System).
- **In-app changelog / release notes** — what the user sees on update.
- **`STRATEGY.md` + `NEXT_SESSION.md`** — per the Strategy & Session Workflow.

State the ripple explicitly before finishing: "this change also requires updating X, Y; Z needs no change." Don't silently leave a stale surface — a landing page that promises old behavior is a bug.

### Subagents
- Use subagents to keep main context window clean when possible
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### Task Tracking
- Strategic alignment lives in `STRATEGY.md` + `NEXT_SESSION.md` (see "Strategy & Session Workflow" above) — start there.
- For the *implementation detail* of a single feature, write the plan to `tasks/todo.md` with checkable items before starting.
- Check in before starting implementation
- Mark items complete as you go
- High-level summary at each step
- Add a review section to `tasks/todo.md` when done
- When a feature is decided or finished, reflect it back up into `STRATEGY.md` (Decision Log + Status by Area) and `NEXT_SESSION.md`.



## Landing Page (`website/`)

The marketing site at `website/index.html` is **mobile-first**. Every change must look correct on phone, tablet, and desktop — verify all three before shipping.

For the "Works in every app you write in." section:
- **Desktop (>820px)**: sticky left sidebar (Mail / WhatsApp / Slack) with scroll-spy, large video on the right; active nav item enlarges and shows its description.
- **Mobile (≤820px)**: sidebar is hidden. Each app stacks vertically as `label + description → video`, in order Mail → WhatsApp → Slack. Do **not** collapse the mobile layout into a horizontal nav — keep the label+video pairing so the user always sees what they're looking at.

## Platform Support
**This app targets both macOS and Windows.** Every feature, fix, and new capability must work on both platforms. When writing any OS-level code (file paths, hotkeys, tray icons, app scanning, permissions, etc.), always implement and test both the macOS and Windows paths. Never leave a `// TODO: Windows` stub — implement it properly or raise it explicitly.

## File Structure
- `main.js` — Electron main process (tray, hotkey, window management, backend subprocess)
- `preload.js` — Context bridge between main and renderer
- `renderer/` — Frontend UI (HTML/CSS/JS)
- `assets/` — Tray icons and runtime assets
- `brand-assets/` — Source brand/icon files for builds
- `build/` — electron-builder output

## Git Push & Release Workflow

When asked to push to GitHub, follow this exact process:

### 1. Version Bump (Semantic Versioning)

Determine the version bump based on scope of changes:

| Change Type | Bump | Example |
|---|---|---|
| Bug fixes, typos, minor tweaks | **Patch** (`0.2.0` → `0.2.1`) | Fix a broken API route |
| New features, significant additions | **Minor** (`0.2.0` → `0.3.0`) | Add a new phase or feature |
| Breaking changes, major rewrites | **Major** (`0.2.0` → `1.0.0`) | Complete architecture change |

- Update `"version"` in `package.json`

### 2. Update README.md

Before pushing, ensure `README.md` reflects:
- Any new features or changes
- Updated tech stack if dependencies changed
- Updated setup instructions if env vars or steps changed

### 3. Commit & Tag

```bash
# Stage all relevant files
git add -A

# Commit with version in message
git commit -m "v{VERSION}: {Brief description of changes}"

# Create a git tag
git tag v{VERSION}
```

### 4. Push

```bash
# Push to the specified remote (ask which one if not specified)
git push {remote} main --tags
```

- Default remote is `github`
- Always push tags with `--tags`

### 5. CI Builds & Publishes Automatically

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds notarized macOS and Windows artifacts on GitHub-hosted runners and uploads them to a GitHub release. **Do not build or publish locally** — let CI handle it. Local builds are only for testing.

The workflow uploads:
- `Landa-{VERSION}-arm64.dmg` + `.dmg.blockmap` + `latest-mac.yml` (macOS auto-updater metadata)
- `Landa.Setup.{VERSION}.exe` + `.exe.blockmap` + `latest.yml` (Windows auto-updater metadata)

The `.yml` and `.blockmap` files are required for `electron-updater` — without them, installed copies can't detect or download updates.

After CI finishes (5–15 min):
- Verify the release at https://github.com/nickybricks/landa/releases includes all six files
- Edit the release to add a `## Changes` section with bullet points summarizing what changed
- The release title should match the commit message format: `v{VERSION}: {Brief description}`


## Dev Commands
- `npm start` — run the app in development mode
- `npm run build` — package the app with electron-builder
- `npm run build:mac` — build macOS .dmg
- `npm run build:win` — build Windows installer
- `npm run build:linux` — build Linux AppImage

## Design System

**Every UI change must align with `DESIGN.md`.** Before touching any renderer file:

1. Read `DESIGN.md` to understand the current design tokens and principles.
2. Use CSS variables — never hard-code hex values, font names, or radius values.
   - Colors: `var(--primary)`, `var(--secondary)`, `var(--tertiary)`, `var(--neutral)`
   - Surfaces: `var(--bg)`, `var(--bg-card)`, `var(--bg-sidebar)`, `var(--border)`, `var(--text)`, `var(--text-secondary)`
   - Typography: `var(--font-headline)` for headings, `var(--font-body)` for everything else
   - Radii: `var(--radius-pill)` for controls/buttons, `var(--radius-card)` for containers
3. If a design change is needed, update `DESIGN.md` first, then update the CSS tokens.

## Code Style
- JavaScript: simple, minimal, no classes unless necessary. Use async/await over callbacks.
- No over-engineering. Keep files small and focused.
- main.js handles OS-level concerns (hotkeys, tray, subprocess). Keep renderer/ pure UI.
- Use ipcMain/ipcRenderer + contextBridge for all main↔renderer communication — never expose Node APIs directly to renderer.

## Key Constraints
- Electron 30+ minimum
- Config must have sensible defaults and be created automatically on first run (use electron's `app.getPath('userData')`)
- Backend must handle missing API key gracefully (don't crash, show error in UI)
- Tray icon must use template images (trayTemplate.png / trayTemplate@2x.png) for macOS dark mode support
- Accessibility and microphone permissions must be handled with clear alerts (use `systemPreferences.askForMediaAccess`)
- main.js spawns the Python backend as a child process and kills it on app quit
- Global hotkeys via `globalShortcut` — always unregister on app quit
- Use `contextIsolation: true` and `nodeIntegration: false` in all BrowserWindow configs

