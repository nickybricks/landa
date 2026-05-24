# Landa — Design System

This document defines the core design principles and token values for Landa. All UI changes must align with this system.

## Theme Overview

- **Brand intent**: Mature, serious, trustworthy — never playful or childish. Trust is the wedge; the design has to earn it.
- **Color Mode**: Light (dark mode is a supported override, not the default)
- **Roundedness**: Varied per element type — cards/panels are notably rounded, controls moderate, with smaller radii for compact/inline items. Different element types intentionally use different radii; do not flatten them to one value.
- **Spacing**: Normal — balanced layout with adequate breathing room
- **No liquid glass / heavy blur.** Surfaces are solid with restrained elevation (a soft shadow), not translucent glass. Blur effects read trendy and date quickly — they're off-brand for a mature product. **One deliberate exception:** the recording window's resting pill (see Surface Colors) stays a soft translucent lozenge — it's an ambient always-on indicator that must read as "seen but not seen," not a surface.

## Typography

| Role      | Font        | Usage                                      |
|-----------|-------------|--------------------------------------------|
| Headline  | **Manrope** | Major headings, strong visual presence     |
| Body      | **Inter**   | Paragraph text, longer content             |
| Label     | **Inter**   | UI labels, smaller text elements           |

Fonts are **self-hosted** (bundled with the app and the website), not loaded from the Google Fonts CDN — calling Google on every load leaks user IPs and contradicts the EU-privacy wedge. Fallback stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.

## Color Palette

The brand is a **monochrome deep-red** system — premium, heritage, warm-trust, deliberately differentiated (no one in voice-to-text owns deep red). A near-black oxblood (`--primary`) grounds it as the serious base; a single brighter red (`--tertiary`) supplies the accent/highlight energy. Hover/active on the primary lifts slightly (≈`#6E1212`). **Reserve a separate semantic error color** (a distinctly different orange-red) so "danger/delete" never reads as "brand," and use the bright accent sparingly so the UI doesn't feel alarming.

| Token         | Hex       | Usage                                                              |
|---------------|-----------|-------------------------------------------------------------------|
| `--primary`   | `#4A0404` | Primary CTAs, interactive elements, key branding (near-black oxblood; white text passes AAA) |
| `--secondary` | `#8C6B6E` | Less prominent elements, chips, secondary actions (muted mauve)    |
| `--tertiary`  | `#A32B2B` | Accent — badges, highlights, active/selected indicators, decorative emphasis (used sparingly) |
| `--neutral`   | `#747067` | Non-chromatic UI elements (warm greige, not a cool grey)           |

> The **chromatic** palette stays warm — the reds, the mauve `--secondary`, and the greige `--neutral` are deliberately warm so the brand reads intentional. The **surfaces**, however, are light, near-white neutral greys (`--bg #f5f5f6` / cards `#ffffff`), lightened from the earlier warm Cloud Dancer beige for a cleaner, brighter, more product-like canvas.

### Surface Colors (Light)

| Token              | Value                 |                                                              |
|--------------------|-----------------------|--------------------------------------------------------------|
| `--bg`             | `#f5f5f6`             | Light neutral grey — app background (lightened from the earlier warm Cloud Dancer beige) |
| `--bg-card`        | `#ffffff`             | White card/panel surface                                     |
| `--bg-sidebar`     | `#ededee`             | Slightly deeper light grey surface                           |
| `--border`         | `rgba(20,20,22,0.10)` | Neutral hairline                                            |
| `--text`           | `#20201f`             | Near-black                                                  |
| `--text-secondary` | `#6c6a68`             | Mid grey                                                    |
| `--pill-rest-bg`   | `rgba(38,35,33,0.55)` | Recording-window resting pill — a calm **translucent** warm-dark glass lozenge. This is the one intentional blur we keep (`backdrop-filter`), because the ambient always-on pill should read as "seen but not seen"; scheme-independent |

### Surface Colors (Dark override)

| Token              | Value                   |                                            |
|--------------------|-------------------------|--------------------------------------------|
| `--primary`        | `#c0453f`               | Lifted red so CTAs stay visible on dark    |
| `--bg`             | `#1c1a19`               | Warm near-black                            |
| `--bg-card`        | `#262321`               |                                            |
| `--bg-sidebar`     | `#211f1e`               |                                            |
| `--border`         | `rgba(255,250,245,0.10)`|                                            |
| `--text`           | `#f0eee9`               | Cloud Dancer as text on dark               |
| `--text-secondary` | `#a39e99`               |                                            |

### Semantic / Status Colors

Status colors are **deliberately kept off the brand reds** — with a deep-red brand, a red "error" would otherwise read as "brand," so danger gets a distinct orange-red. Use these only for their meaning, never as decoration.

| Token        | Light     | Dark      | Usage                                                        |
|--------------|-----------|-----------|--------------------------------------------------------------|
| `--error`    | `#e5533d` | `#f26b54` | Errors, destructive/delete actions — distinct from the brand reds |
| `--success`  | `#2f9e44` | `#51cf66` | Confirmations, ready/installed states                        |
| `--warning`  | `#e8920c` | `#ffc247` | Paused / attention states                                    |

## Border Radius

| Token              | Value   | Usage                              |
|--------------------|---------|------------------------------------|
| `--radius-pill`    | `8px`   | Buttons, badges, interactive controls   |
| `--radius-card`    | `16px`  | Cards, panels, settings sections        |
| `--radius-sidebar` | `12px`  | Sidebar icon containers                 |

> These are the base tokens. Individual components legitimately set their own radius — e.g. small chips/keys (`4–6px`), inline bars/indicators (`2–3px`), pills & toggles (full-round), app-icon images (`9–18px`), the always-on recording lozenge (`100px`). **Different roundings per element are intentional**, not drift — match the element's existing radius rather than forcing one global value.

## Iconography

- **No emoji as UI icons.** Emoji read playful/childish and are off-brand. Category icons, empty-state placeholders, and app-chip fallbacks all use the icon set below, never emoji.
- **One monochrome line-icon set**, self-hosted (e.g. Lucide — open-source, fits the no-CDN privacy stance). Tint with `var(--text-secondary)` at rest and a brand tint when active; never multicolor.
- **Platform/typographic glyphs stay** — these are conventions, not decoration: keyboard modifiers (⌘ ⇧ ⌥, and the Windows equivalents), ✓ checkmarks, ↺ reset, ← → arrows.
- **Emoji only ever appear in user *output*** — and only when the user opts in via the "Use emoji" toggle (default off). They never appear in Landa's own interface.

## Implementation Notes

- All design tokens are defined in `renderer/settings.css` under `:root`
- Use CSS variables (e.g. `var(--primary)`) — never hard-code hex values
- Use `var(--font-headline)` for headings, `var(--font-body)` for all other text
- Use `var(--radius-pill)` for interactive controls (buttons, badges); card corners (`var(--radius-card)`) for container surfaces
- Surfaces are solid — convey depth with a restrained shadow, **not** `backdrop-filter`/blur or translucency
- Brand color tints for icon backgrounds: use `rgba(<brand-hex>, 0.15)` as background with the brand hex as foreground
