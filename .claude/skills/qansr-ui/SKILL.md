---
name: qansr-ui
description: Q&ANSR UI standard — mobile-first, 100% responsive. Use whenever building ANY screen (ops hub, contract boxes, roster, SOA result sheet, admin panel). Mandates scrollable tabs, collapsible/expandible sections, horizontal-scroll tables, 44px touch targets, ANSR brand tokens.
---

# Q&ANSR — UI Standard (mobile-first, 100% responsive)

Every screen across all ~20 operations MUST be fully usable on a phone. Build on
[public/app.css](../../../public/app.css) primitives + the [[ansr-brand]] tokens.

## Non-negotiables
1. **Mobile-first** — design for ~360px wide first; scale up. No fixed pixel layouts that overflow.
2. **Easy scroll** — momentum scrolling (`-webkit-overflow-scrolling: touch`), `overscroll-behavior: contain` on scroll areas, no scroll-jacking.
3. **Scrollable tabs** — tab strips never wrap; they scroll horizontally with swipe + scroll-snap. Use `.tabs` / `.tab`.
4. **Collapsible + expandible sections** — native `<details class="section">` + `<summary>`; chevron rotates on open. Boxes, evidence, exceptions all collapse.
5. **Wide tables (SOA result sheet)** — wrap in `.scroll-x`; sticky header row; freeze first column with `.pin`. Never squash a numbers grid on mobile.
6. **Touch targets ≥ 44px** — buttons, tabs, inputs (`min-height: 44px`).
7. **No iOS zoom-on-focus** — form fonts ≥ 16px.
8. **Safe-area insets** — respect notches (`env(safe-area-inset-*)`).

## Primitives (classes in app.css)
- `.wrap` fluid container · `.topbar` sticky header
- `.tabs` / `.tab[aria-selected]` scrollable tabs
- `<details class="section"><summary>…</summary><div class="body">…</div></details>` collapsible
- `.scroll-y` (lists/chat, max 60vh) · `.scroll-x` (tables) · `.pin` (freeze first col)
- `.grid` auto-fit cards (1-col mobile → multi-col ≥600px)
- `.btn` / `.btn--ghost` brand buttons · `.chip--draft|approved|flag` status
- Inputs are full-width, 44px, 16px font by default.

## Wiring
- Server serves `/brand/tokens.css` + `public/` static. Pages: `<link rel="stylesheet" href="/app.css">`.
- Colors/fonts/buttons come from brand tokens — never hardcode hex; use `var(--ansr-*)`.

## Test before shipping a screen
Resize to 360px: tabs swipe, sections collapse, tables scroll horizontally with frozen first col, no element overflows the viewport, all tap targets ≥44px.
