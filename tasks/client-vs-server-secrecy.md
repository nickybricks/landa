# What lives on the user's machine vs. our server

Reference note from the 2026-05-23 review of "what can users see after install."

## The one hard rule
Anything shipped inside the app — JS, the Python backend, baked-in strings — **can be
extracted** by a determined user. Obfuscation (asar packing, PyInstaller compiling)
raises the bar; it does not make anything secret. The only way to keep something
secret is to **not ship it**: keep it on the server and have the app call it.

## Three buckets

### 1. Our IP — protect by keeping it server-side
- Reformatting / mode system prompts (`MODE_SYSTEM_PROMPTS`)
- Backend business logic, model routing, the proxy architecture
- Any curated lexicons/wordlists we build (a user's *own* added vocab is NOT this)

Direction: anything that matters runs behind `landa_proxy`. Don't bundle plaintext
source. **Fixed 2026-05-23:** stopped shipping `backend/landa_core.py` as plaintext
in the app bundle (was a redundant `extraResources` copy — the app runs the compiled
`landa_backend` binary). Detection in `findBackendRoot()` now keys off the binary.

### 2. Real API keys — never in the app
- OpenAI / Anthropic keys live on the proxy server only. ✅ already correct.
- `LANDA_APP_SECRET` (app-identity token) is baked into the compiled binary →
  obscured, not secret. **Assume it can be extracted.** Defend server-side:
  rate-limit per token, rotate, monitor the proxy for abuse. Don't rely on hiding.

### 3. The user's own data — readable by them, on purpose
- `~/.landa/config.json`, `history.json`, their vocabulary, downloaded models.
- This is the user's data; hiding it from them adds no protection and is user-hostile.
  Leave it as readable JSON in their home folder.

## Minor follow-up (optional)
- `backend/requirements.txt` still ships in the bundle. Not sensitive, but it's
  redundant at runtime and advertises the stack. Can be dropped from `extraResources`
  if we want a cleaner bundle. Low priority.

## Verify after any build change
- Packaged app still starts the backend (binary detection in `findBackendRoot`).
- `Landa.app/Contents/Resources/backend/` contains no `*.py` source at top level.
