# Landa — Design System

This document defines the core design principles and token values for Landa. All UI changes must align with this system.

## Theme Overview

- **Brand intent**: Mature, serious, trustworthy — never playful or childish. Trust is the wedge; the design has to earn it.
- **Color Mode**: Light (dark mode is a supported override, not the default)
- **Roundedness**: Subtle (2px–4px) — tight corners read precise and serious
- **Spacing**: Normal — balanced layout with adequate breathing room
- **No liquid glass / heavy blur.** Surfaces are solid with restrained elevation (a soft shadow), not translucent glass. Blur effects read trendy and date quickly — they're off-brand for a mature product.

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

> Neutrals are intentionally **warm** (greige), not the cool blue-greys used previously — a warm brand on cool neutrals reads "off." Keep the whole system warm so it feels intentional.

### Surface Colors (Light)

| Token              | Value                 |                                                              |
|--------------------|-----------------------|--------------------------------------------------------------|
| `--bg`             | `#f0eee9`             | Cloud Dancer (PANTONE 11-4201) — warm off-white app background |
| `--bg-card`        | `#fbfaf7`             | Warm white card/panel surface                                |
| `--bg-sidebar`     | `#eae7e0`             | Slightly deeper warm surface                                 |
| `--border`         | `rgba(42,36,34,0.10)` | Warm-tinted hairline                                         |
| `--text`           | `#2a2422`             | Warm near-black                                              |
| `--text-secondary` | `#6e6a66`             | Warm greige                                                 |
| `--pill-rest-bg`   | `#262321`             | Recording-window resting pill — **solid** warm-dark lozenge (no translucency/blur); scheme-independent |

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

## Border Radius

| Token              | Value   | Usage                              |
|--------------------|---------|------------------------------------|
| `--radius-pill`    | `4px`   | Buttons, badges, interactive controls (token name is legacy — no longer a pill) |
| `--radius-card`    | `4px`   | Cards, panels, settings sections   |
| `--radius-sidebar` | `4px`   | Sidebar icon containers            |

> Subtle radii (2px–4px). Use `2px` for very small inline elements if needed; everything else is `4px`.

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
