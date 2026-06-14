---
name: ansr-brand
description: ANSR brand kit — colors, fonts, buttons, hover/link effects, logo, voice. Use whenever building UI, marketing pages, emails, decks, or any visual/written asset for ANSR / Q&ANSR so output matches brand. Triggers — "ANSR", "Q&ANSR", "brand colors", "logo", "brand font", "make it on-brand", "button style".
---

# ANSR — Brand Skill

Global Capability Center (GCC) enablement company. Builds, manages, scales
high-performing GCCs for enterprises. Voice: professional, strategic,
aspirational, enterprise-grade.

Source: live ansr.com CSS (Elementor + Astra) + &ANSR logo, 2026-06-14.

## When building anything for this brand
1. Load tokens from [tokens.css](tokens.css) (CSS vars + ready-made `.ansr-btn`) or [tokens.json](tokens.json).
2. Font = **Moderat** (300/400 self-hosted; 500–700 synthesized). Drop `Moderat-*.woff` in [assets/fonts/](assets/fonts/); fallback = Inter/grotesque.
3. Logo from [assets/logos/](assets/logos/).
4. Follow [brand-guidelines.md](brand-guidelines.md) for usage + voice.

## Quick reference
- **Orange (primary/CTA/links)**: `#FF5400` · hover/pressed `#CF4400` · tint bg `#FFF1E9`
- **Teal (primary dark)**: `#005465` · **Navy (secondary / link-hover)**: `#00242E` · slate `#1E293B`
- **Text**: `#1E1E1E` · muted `#777777` · border `#E2E8F0` · surface `#F9FAFB` · white `#FFFFFF`
- **Font**: Moderat (fallback Inter), body 18px/300, h1/h2 40px/700, line-height 1.5
- **CTA button**: orange pill, `border-radius:100px`, `12px 24px`, weight 500, white text
- **Outline button**: transparent, 1px `#1E1E1E`, radius 2px → hover fills navy `#00242E`
- **Links**: orange, no underline, hover → navy, `transition: all .2s linear`
- **Shape**: flat (no shadows); CTA pill 100px, inputs/cards 2px; container 1140px; gap 20px
- **Rule**: restrained teal/navy/neutral base, ONE loud orange accent, lots of white space.

## Logo-asset note
The raster logo uses orange `#FD5001` / navy `#002835`. Use those ONLY to color-match the logo file; all web UI uses the live values above.
