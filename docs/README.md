# Q&ANSR — Documentation Wiki

**Q&ANSR** is a contract-aware AR (accounts-receivable) engine. It reads SOW contracts + employee worksheets, reproduces the invoicing logic the contract defines (recruitment "TA" fee + operations "OSS" fee), generates a Statement of Invoicing, and answers questions with a clause + calculation audit trail.

First product on it: **Mint · AR Contract Reconciler**. The engine underneath is **BigFlex** (generic, contract-agnostic), and the cross-contract learning brain is **Atlas**.

> **One-line thesis:** a *document* defines the rules; a periodic *worksheet* supplies the data; the engine computes the bill, explains every number, learns from corrections, and locks it for audit — **the same code for 1 or 10,000 contracts.**

---

## Read in this order

| # | Doc | What's in it |
|---|---|---|
| 0 | [Overview](00-overview.md) | What Q&ANSR/Mint is, in plain language. Start here. |
| 1 | [Architecture](01-architecture.md) | The 4-tier hybrid store (vault · MD · DB · JSON), components map. |
| 2 | [BigFlex engine](02-bigflex-engine.md) | Rule book, operators, normalize, compute, clarifications, FX. |
| 3 | [Atlas](03-atlas.md) | The learning brain — archetypes + the 4 learning axes. |
| 4 | [Schema](04-schema.md) | Full Postgres schema — 38 tables + 1 view, grouped. |
| 5 | [Flows](05-flows.md) | End-to-end diagrams: intake, run, clarify, Atlas lifecycle. |
| 6 | [API reference](06-api-reference.md) | Every HTTP endpoint, grouped. |
| 7 | [Mint user journey](07-mint-user-journey.md) | The noob walkthrough — what a user does, step by step. |
| 8 | [Deployment & ops](08-deployment.md) | GCP Cloud Run, Supabase, domain/LB, secrets, gotchas. |
| 9 | [Glossary](09-glossary.md) | Every term defined in one place. |
| 10 | [AI pipelines](10-ai-pipelines.md) | The pipeline registry — gates, skills & model selector (Mint + Atlas groups). |
| 11 | [Contract Compiler](11-contract-compiler.md) | The N-dimensional rule model + coverage validation — and the **method** that built it (reusable on ESPL). |
| 12 | [Whisperer](12-whisperer.md) | Plan — demand↔supply content intelligence (ClientMind chips · cohorts · Hunger · Feed Stories); new hub agent, mock-first. |
| 13 | [Munshi-for-Mint](13-munshi-for-mint.md) | **BANKED / not built** — upgrade Mint's parser with the Munshi method (corpus parse · atomic rule-chips · re-parse on change). |

---

## The two reusable skills

BigFlex and Atlas are also packaged as **global Claude skills** (in `~/.claude/skills/`, usable on any project) and as a decoupled npm-style package on the repo's `bigflex` branch:

- **`bigflex`** skill — the engine + component kit.
- **`atlas`** skill — the cross-contract learning brain.

Both carry a plain-language explainer plus the technical reference. See [BigFlex engine](02-bigflex-engine.md) and [Atlas](03-atlas.md) for the in-repo versions.

---

## The invariants (never violated)

1. Raw user text/sheets never reach a model outside an **enabled, gated pipeline**.
2. **Rules are data.** Anything the operators can't express → an exception, **never a guess** ("flag, don't guess").
3. **Partial compute** — clean rows compute even when others fail; bad rows quarantine.
4. **Released runs are immutable** — a recompute opens a new version.
5. **Every number carries** currency + base + FX + clause + source row (a full trace).

---

_Live: `qansr.thekettleblack.in` (GCP Cloud Run `ansr`, project `ansr-tkb`, Mumbai). See [Deployment](08-deployment.md)._
