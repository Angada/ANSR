# ANSR — Brand Guidelines

Source: live [ansr.com](https://ansr.com) CSS (WordPress · Astra theme · Elementor
kit-20545) + the **&ANSR** logo. Pulled 2026-06-14.
Company: builds, manages, and scales high-performing **Global Capability Centers (GCCs)**.

## Logo
- File: [assets/logos/QAnsr-logo.png](assets/logos/QAnsr-logo.png) (1672×941).
- Mark: orange radial **sunburst** + **ampersand**, then **ANSR** wordmark in deep navy.
- Logo-asset hexes: orange `#FD5001`, navy `#002835` (raster match only — web UI uses the live palette below).
- **Need**: SVG + transparent PNG, reversed (white-on-dark), and mono variants.

### Usage
- Clear space ≥ wordmark cap-height around the mark.
- On white / surface (`#F9FAFB`) backgrounds, or reversed on navy (`#00242E`).
- Don't recolor, stretch, rotate, or add effects (brand is flat — no shadows).

## Color palette (live web values)

| Role | Hex | Token |
|------|-----|-------|
| Primary / CTA / link | `#FF5400` | orange |
| Orange hover / pressed | `#CF4400` · `#CE4502` | orange-hover / deep |
| Pale orange section bg | `#FFF1E9` | orange-tint |
| Primary dark | `#005465` | teal |
| Secondary / link-hover / dark sections | `#00242E` | navy |
| Ink alt | `#1E293B` | slate |
| Body text | `#1E1E1E` | text |
| Muted text | `#777777` | gray |
| Border | `#E2E8F0` | border |
| Surface | `#F9FAFB` | surface |
| White | `#FFFFFF` | white |

- **Orange** = the single loud accent: CTAs, links, key highlights. Don't overuse.
- **Teal + navy** = headings, dark hero/footer sections, link-hover.
- **Neutrals** = text, borders, alternating surfaces. Lots of white space.

## Typography
- **Moderat** for everything (headings + body). Self-hosted on ansr.com; only
  **300 (Light)** and **400 (Regular)** ship — 500/600/700 are browser-synthesized.
- Accent/button font nominally **Roboto 500**, usually overridden to Moderat 500.
- Fallback: `Inter, 'Helvetica Neue', system-ui, sans-serif`.
- Base: 18px / weight 300 / line-height 1.5.

| Use | Size / weight |
|-----|---------------|
| H1 / H2 | 40px / 700 |
| Sub-headline | 38px / 400 |
| Card title | 24px / 600 |
| Feature title | 22px / 500 |
| Small heading | 20px / 700 |
| Body | 18px / 300 |
| Small | 16px / 300 |

- **Need**: source `Moderat-Light.woff` + `Moderat-Regular.woff` (from ansr.com or a license) → drop in [assets/fonts/](assets/fonts/).

## Buttons
**Primary CTA** — orange pill:
```css
background:#FF5400; color:#fff; font-weight:500; font-size:18px;
padding:12px 24px; border:0; border-radius:100px; transition:all .2s linear;
/* hover: same bg + 1px solid #FF5400 border */
```
**Secondary** — outline → fills navy on hover:
```css
background:transparent; color:#1E1E1E; border:1px solid #1E1E1E;
border-radius:2px; font-weight:500; font-size:16px; padding:14px 28px;
/* hover: background:#00242E; color:#fff; border-color:#00242E */
```
Ready-made classes in [tokens.css](tokens.css): `.ansr-btn`, `.ansr-btn--outline`.

## Links & motion
- Links: orange `#FF5400`, **no underline**, hover → navy `#00242E`.
- Transition: `all .2s linear` (interactive), `0.3s` (sections).
- **Flat** — no box-shadows anywhere on the brand site.

## Shape & layout
- Radius: CTA pill `100px`; inputs/cards `2px`. Container max `1140px`. Widget gap `20px`.

## Voice & tone
- **Tagline**: "Empowering global team solutions with GCCs."
- Professional, strategic, aspirational. GCCs as essential business infrastructure;
  innovation, efficiency, scale, talent excellence.
- Proof points: "225K+ professionals hired · 210+ global centers established · 20+ years."

## Use in code
```css
@import 'tokens.css';
.cta { /* or just use class="ansr-btn" */ }
body { color: var(--ansr-text); background: var(--ansr-bg); font-family: var(--ansr-font); }
```
