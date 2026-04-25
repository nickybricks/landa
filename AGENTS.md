# Landa — Electron App

## What This Is
A cross-platform Electron app for Landa — global hotkey voice-to-text that pastes into any active app. Electron + Node.js frontend communicating with the Python backend over HTTP.

## Codex Behavior

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

### Subagents
- Use subagents to keep main context window clean when possible
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Check in before starting implementation
- Mark items complete as you go
- High-level summary at each step
- Add a review section to `tasks/todo.md` when done



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

### 5. Create GitHub Release

```bash
# Create a release on GitHub with release notes
gh release create v{VERSION} --title "v{VERSION}: {Brief description}" --notes "{Release notes in markdown}"
```

- Always create a GitHub release after pushing a new tag
- Include a `## Changes` section with bullet points summarizing what changed
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

