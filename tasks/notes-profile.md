# Notes profile (Smart) + Windows foreground detection

Goal: New "Notes" profile. One Smart mode — the model decides the best structure
(list/checklist for enumerations, paragraphs w/ optional title for prose), nothing
hard-coded. Auto-activates in Apple Notes (macOS) and Notepad (Windows). List marker
is OS-aware: `☐ ` on macOS, `- ` on Windows. Default OFF (like other profiles).

## Backend (backend/landa_core.py)
- [ ] DEFAULT_CONFIG.modes: add `notes` (enabled:False, selections:"smart",
      categories linkedApps ["Notes","Notepad"], toggles {smart:{}})
- [ ] `_NOTES_GUARDRAILS` + MODE_SYSTEM_PROMPTS["notes"]["smart"] w/ `{{BULLET}}`
- [ ] _migrate(): add notes selection/category/enabled for existing users
- [ ] get_mode_prompt(): per-category default style, notes fallback, OS bullet
- [ ] detect_active_app(): Windows ctypes branch (foreground PID → exe name)

## Renderer
- [ ] settings.js: MODES_CATEGORIES + DEFAULT_CATEGORIES add `notes`
- [ ] settings.js: per-category style set (notes → only `smart`)
- [ ] settings.js: notes card body (no "To:" line)
- [ ] settings.html: sidebar row for notes (📝)
- [ ] settings.js i18n EN+DE: category.notes, style.smart(+.sub), preview.notes.smart

## Verify
- [ ] Backend imports / responds on localhost:7890
- [ ] `npm start` launches
- [ ] macOS: enumeration → checklist, prose → paragraphs in Apple Notes
- [ ] Windows detection returns process name

## Review

Done & verified:
- Backend syntax OK; migration adds notes (sel=smart, cat, enabled=False) and
  leaves existing email/pm enabled flags untouched.
- get_active_category() returns "notes" for frontmost app "Notes";
  get_mode_prompt() emits ☐ marker on macOS, {{BULLET}} fully replaced.
- settings.js / settings.html parse clean; notes wired via MODES_CATEGORIES
  (generic click/toggle loops), single Smart style via stylesForCategory().
- i18n EN+DE added (category.notes, style.smart+.sub, preview.notes.smart).

Refinements after user testing (confirmed working — "funktioniert."):
- List marker plain "- " on macOS & Windows (no ☐).
- Notes profile also linked to Notion (app + notion.so); migration enriches
  existing configs.
- Notion gets a Markdown variant (_NOTES_SMART_NOTION); Apple Notes/Notepad
  keep plain text. Shared core (_NOTES_SMART_CORE).
- Title conditional (only with clear context), not forced.
- Invent content ONLY on explicit request (anti-hallucination vs agent-fill).
- Notion to-do syntax "[] item" (no leading dash) — verified vs Notion docs + live test.

Still not run here (need manual check):
- `npm start` full GUI launch + Settings → Notes card visible, toggle works.
- Real Windows test of _detect_active_app_windows() (ctypes path, win32 only).

Deferred to a later session (user's call): evals, landing-page update.
- End-to-end: dictate enumeration in Apple Notes → ☐ checklist; prose → prose.
