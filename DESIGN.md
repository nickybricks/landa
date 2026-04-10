# FindMyVoice — Design System

This document defines the core design principles and token values for FindMyVoice. All UI changes must align with this system.

## Theme Overview

- **Color Mode**: Light (dark mode is a supported override, not the default)
- **Roundedness**: Maximum — pill-shaped corners for a soft, friendly feel
- **Spacing**: Normal — balanced layout with adequate breathing room

## Typography

| Role      | Font        | Usage                                      |
|-----------|-------------|--------------------------------------------|
| Headline  | **Manrope** | Major headings, strong visual presence     |
| Body      | **Inter**   | Paragraph text, longer content             |
| Label     | **Inter**   | UI labels, smaller text elements           |

Both fonts are loaded via Google Fonts. Fallback stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.

## Color Palette

| Token        | Hex       | Usage                                                         |
|--------------|-----------|---------------------------------------------------------------|
| `--primary`  | `#0088FF` | Primary CTAs, interactive elements, key branding              |
| `--secondary`| `#5978AA` | Less prominent elements, chips, secondary actions             |
| `--tertiary` | `#DF6402` | Highlights, badges, decorative accents                        |
| `--neutral`  | `#747780` | Backgrounds, surfaces, non-chromatic UI elements              |

### Surface Colors (Light)

| Token            | Value              |
|------------------|--------------------|
| `--bg`           | `#f5f5f7`          |
| `--bg-card`      | `#ffffff`          |
| `--bg-sidebar`   | `#f0f0f2`          |
| `--border`       | `rgba(0,0,0,0.08)` |
| `--text`         | `#1d1d1f`          |
| `--text-secondary` | `#86868b`        |

### Surface Colors (Dark override)

| Token            | Value                   |
|------------------|-------------------------|
| `--bg`           | `#1e1e1e`               |
| `--bg-card`      | `#2d2d2d`               |
| `--bg-sidebar`   | `#252525`               |
| `--border`       | `rgba(255,255,255,0.1)` |
| `--text`         | `#f5f5f7`               |
| `--text-secondary` | `#98989d`             |

## Border Radius

| Token              | Value   | Usage                              |
|--------------------|---------|------------------------------------|
| `--radius-pill`    | `100px` | Buttons, toggles, badges           |
| `--radius-card`    | `16px`  | Cards, panels, settings sections   |
| `--radius-sidebar` | `12px`  | Sidebar icon containers            |

## Implementation Notes

- All design tokens are defined in `renderer/settings.css` under `:root`
- Use CSS variables (e.g. `var(--primary)`) — never hard-code hex values
- Use `var(--font-headline)` for headings, `var(--font-body)` for all other text
- Prefer pill corners (`var(--radius-pill)`) for interactive controls; card corners (`var(--radius-card)`) for container surfaces
- Brand color tints for icon backgrounds: use `rgba(<brand-hex>, 0.15)` as background with the brand hex as foreground
