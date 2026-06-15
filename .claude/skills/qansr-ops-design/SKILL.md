---
name: qansr-ops-design
description: Q&ANSR enterprise-AI ops design system — the visual language for contract/AR ops screens: the numbered run, the vertical step flow with right-angled connectors, equal-height analysis boxes with a pinned AI lane, readiness gates, evidence tables. Fully themeable (logo + colour) via a --brand-* API for white-label deployments. Use when building or restyling ANY ops screen, adding a component, or rebranding for a new tenant. Stylesheet: brand/ops-design.css. Triggers — "ops screen", "analysis box", "step flow", "the run", "readiness", "rebrand", "white-label", "new client theme", "design system".
---

# Q&ANSR — Ops Design System

The look of enterprise-AI ops: dense, auditable, calm. One accent, one ink, one AI
lane. Flat (no decorative shadows). Mobile-first, every control ≥44px. Builds on
[[qansr-ui]] (responsive primitives) + ANSR brand tokens; this skill is the
**component + theming layer** on top.

**Stylesheet:** `brand/ops-design.css` (`@import`s `/brand/tokens.css`). Classes are
prefixed `ops-`. Reference page: `brand/ops-design.html`.

## The three laws
1. **One accent.** A screen has exactly one action colour (`--brand-accent`). Numbers,
   active states, primary CTAs use it. Everything else is ink, muted, or border.
2. **AI is a lane, not a colour-grab.** Anything the model produces lives in the purple
   AI lane (`--brand-ai`) — pinned, bounded, never bleeding into data. A user must
   always see where the deterministic data ends and AI begins. (Mirrors the gate in
   [[qansr-ai-pipelines]].)
3. **Trust is visible.** Every AI claim carries a confidence dot (hi/mid/lo) + a clause
   ref. Low confidence is never hidden — it's a coloured dot, not a silent guess.

## Theming contract (logo + colour flexibility)
Components NEVER use a raw hex — only `--brand-*` variables. Rebrand a whole deployment
by overriding the API in one block. Defaults = ANSR.

```css
/* per-tenant theme — drop in a <style> or a theme file, scope with [data-brand] */
[data-brand="acme"] {
  --brand-accent: #0a66c2; --brand-accent-hover:#084f99; --brand-accent-deep:#084a8c;
  --brand-accent-tint:#eaf3fb; --brand-ink:#0b1f33; --brand-secondary:#1d7a5f;
  --brand-secondary-tint:#e7f4ef;
  --brand-logo: url("/brand/clients/acme.svg"); --brand-logo-h: 64px;
}
```
```html
<body data-brand="acme"> … </body>   <!-- whole app reskins; zero component edits -->
```

**The full API** (see top of `ops-design.css`): `--brand-accent[/-hover/-deep/-tint]`,
`--brand-ink`, `--brand-secondary[/-tint]`, `--brand-ai[/-tint/-line]`, `--brand-text`,
`--brand-muted`, `--brand-surface`, `--brand-canvas`, `--brand-border`, `--brand-line`,
`--brand-radius[/-pill]`, `--brand-font`, `--brand-logo[/-h/-h-sm]`, `--box-h`, `--flow-rail`,
confidence ramp `--conf-hi/-mid/-lo`.

**Logo:** set `--brand-logo` to a `url()` and `--brand-logo-h`. The `.ops-appbar .logo`
renders it as a contained background — no markup change, no fixed dimensions. SVG preferred.

**Rules:** never hardcode a colour in a screen; if you need a shade that isn't in the API,
add it to the API (with an ANSR default) rather than inlining. Test a rebrand by flipping
`data-brand` — if anything stays orange, that's a bug (a raw hex leaked in).

## Components

### The Run — `.ops-run` (horizontal numbered stepper)
Live progress of ONE analysis run. Nodes: `.node` → `.dot` (number / ✓) + `.lbl`.
States: `.done` (teal ✓, connector fills), `.active` (accent ring, scaled). Horizontal
scroll, no wrap. Use while the engine works (intake → extract → rules → boxes → summary).

### The Flow — `.ops-flow` (numbered vertical steps + right-angled connectors)
The spine of an ops screen. Each `.ops-step` is `grid: [rail] [body]`:
- `.rail` holds `.num` (the step number) + the **right-angled connector**: a vertical
  segment (`.rail::before`) down to the next number + a horizontal tick (`.rail::after`)
  into the body. An orthogonal L — never a diagonal.
- `.body` → `.title` (click to fold) + `.content`.
- States: `.folded` (collapse content, rotate caret), `.done` (number → teal).
- **Fold-on-analyze:** when the run computes, fold ALL steps so the result is front-and-
  centre; each stays individually re-openable by its number.

Canonical 4 steps (Mint): 1 Contract summary · 2 Analysis boxes · 3 Contract readiness ·
4 Working sheet. Steps are content-agnostic — reuse the flow for any ops journey.

### Analysis box — `.ops-box` (equal-height · scroll · pinned AI)
The unit of contract interpretation. A fixed-height flex column:
- `.bc-head` (fixed) — title + status chip + confidence dot.
- `.bc-data` (flex:1, **scrolls**) — the deterministic extract/facts.
- `.ops-ai` (fixed foot) — the AI lane: head, suggestion chips, `.ai-log`, input row.

ALL boxes in a rail are the SAME height (`--box-h`) so the row reads as one object; data
scrolls inside, the AI lane never moves. Lay them in `.ops-boxrail` (horizontal snap,
neighbour peeks as a scroll cue) or a vertical stack. One section = one rail.

### Section header — `.ops-sechead`
Titled lane inside a step: `.st` (title) + `.sd` (one-line description) + a status chip.
`.teal` variant for a passed/ready lane.

### Readiness — `.ops-chk` (the gate)
"Do we have everything to calculate?" One `.ops-chk` per requirement, `.ok`/`.miss` with
a ✓/✕ and (when missing) an "Ask me" chip. **DERIVE items from the contract's actual rule
book — never hardcode a checklist.** A gate that doesn't reflect this contract is theatre.
Results stay blocked until every item is `.ok`.

### Evidence table — `.ops-scroll-x`
Numbers with provenance. Horizontal scroll, sticky `thead`, optional `.pin` first column.
Never shrink financial tables to fit — let them scroll.

### Supporting
Chips (`.chip`, `--draft/--approved/--flag`), buttons (`.btn`, `.btn--ghost`, `.btn-ai`),
confidence fills (`.conf-hi/-mid/-lo`), validation steps (`.ops-vstep`), destructive modal
(`.modal-bg/.modal`), dark section (`.ops-dark`), bands/hero (`.ops-band`, `.ops-hero`).

## Density & type
Ops is dense by design: base 13.5px, boxes 13px, tables 12px, labels 11–12px. Headings
500 weight in `--brand-ink` (never 700 — this isn't marketing). Generous tap targets
despite small type: inputs/buttons ≥44px, 16px input font (stops iOS zoom).

## Motion
Calm. `--brand-transition` (.2s linear) on state changes only. The run/flow animate step-
by-step to show the engine thinking. Honour `prefers-reduced-motion` (the stylesheet kills
all motion under it). No bounce, no parallax.

## Do / Don't
- DO drive every colour through `--brand-*`; DON'T inline a hex in a screen.
- DO keep AI output inside `.ops-ai`; DON'T tint data rows with the AI colour.
- DO derive readiness from the contract; DON'T ship a fixed checklist.
- DO keep boxes equal-height with internal scroll; DON'T let one box dictate row height.
- DO use right-angled (orthogonal) connectors; DON'T use diagonals or curves.
- DO show confidence + clause ref on every AI claim; DON'T present a number without provenance.

## Adding a component
1. Build it from `--brand-*` only. 2. Add a default to the API if you need a new token.
3. Add it to `ops-design.css` under the right section + to `ops-design.html` so the
   reference page stays complete. 4. Verify a `data-brand` flip leaves nothing un-themed.
