# ANSR — Brand Guidelines

Derived from the **&ANSR** logo and [ansr.com](https://ansr.com) on 2026-06-14.
Company: builds, manages, and scales high-performing **Global Capability Centers (GCCs)**.

## Logo
- File: [assets/logos/QAnsr-logo.png](assets/logos/QAnsr-logo.png) (1672×941, transparent/white).
- Mark: orange radial **sunburst** enclosing a hollow center, joined to an
  orange **ampersand**, followed by the **ANSR** wordmark in deep navy.
- **Need**: SVG + transparent-background PNG, plus reversed (white-on-navy) and
  mono variants. Re-export when vector source is available.

### Usage
- Keep clear space ≥ the height of the wordmark cap around the mark.
- Place on white or cloud (`#F4F6F7`) backgrounds; on dark use the navy
  (`#002835`) section with a white/reversed logo.
- Don't recolor the mark, stretch, rotate, or add effects.

## Color palette

| Role | Hex | Name |
|------|-----|------|
| Primary | `#FD5001` | Orange |
| | `#FF7338` | Orange light |
| | `#FF9466` | Orange soft |
| | `#D63F00` | Orange deep |
| Dark | `#002835` | Navy (text, dark sections) |
| Dark | `#0A3D4D` | Navy light |
| Dark | `#1B3A47` | Slate |
| Text muted | `#5B6B72` | Gray |
| Border / muted | `#9AAAB0` | Gray light |
| Background | `#FFFFFF` | White |
| Background | `#F4F6F7` | Cloud |

- **Orange** = primary CTA, links, key accents, the mark. Use deliberately —
  it's the single loud color against a restrained navy/neutral base.
- **Navy** = body text, headings, dark hero/footer sections.
- **Gray** = secondary text, captions. **Cloud** = alternating section bg.
- Keep it corporate-clean: lots of white space, 1 loud accent, no clutter.

## Typography
- **Display & Body — Inter** (placeholder): modern grotesque, professional and
  highly legible. Headlines tight/semibold, body regular.
- Fallback stack: `system-ui, -apple-system, sans-serif`.
- **Need**: confirm ANSR's licensed brand face from ansr.com CSS and swap into
  [tokens.css](tokens.css) + drop files in [assets/fonts/](assets/fonts/).

## Voice & tone
- **Tagline**: "Empowering global team solutions with GCCs."
- Professional, strategic, aspirational. Positions GCCs as essential business
  infrastructure; emphasizes innovation, efficiency, scale, talent excellence.
- Proof points (from site): "225K+ professionals hired · 210+ global centers
  established · 20+ years of experience."

## Use in code
```css
@import 'tokens.css';

button { background: var(--ansr-primary); color: var(--ansr-white); }
body   { color: var(--ansr-text); background: var(--ansr-bg);
         font-family: var(--ansr-font-body); }
```
