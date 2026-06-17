# 3 · Atlas — the cross-contract learning brain

[← BigFlex engine](02-bigflex-engine.md) · [Wiki home](README.md) · Next: [Schema →](04-schema.md)

---

Atlas sits on top of BigFlex. BigFlex computes one contract perfectly; **Atlas makes each new contract cheaper to onboard than the last.** The unit of learning is the **archetype** — a *family* of contracts that share a billing shape (e.g. "split-fee + headcount-slab" = Kenvue's shape, and every client like it).

Contract #1 (Kenvue) seeds the family; contract #2 of the same shape arrives pre-configured; the 50th is nearly zero-touch.

Atlas learns on **four axes**.

---

## Axis 1 — Matching (fingerprint → match → route)

**Fingerprint** (`server/atlas/fingerprint.js`) — a contract's "billing physiology" boiled down to a structured signature, derived from its compiled rule book:
```
heads:      [one_time_split, recurring_slab]      revenue line patterns
dims:       [gcc_band, level, referral]           rate-table drivers
measures:   [active_headcount, total_ctc]          what the fee is measured on
milestones: [sourcing, acceptance, balance]
currency:   USD
```
It's the *shape* of the billing, ignoring the specific numbers.

**Match** (`server/atlas/match.js`) — compares two fingerprints with a **weighted Jaccard similarity** (heads .4 · dims .25 · inputs .2 · measures .1 · currency .05). Output 0–1. Decision:
- ≥ 0.8 → **matched** (same archetype)
- ≥ 0.5 → **partial** (close — adopt skeleton, flag differences)
- < 0.5 → **novel** (new shape)

**Route** (`server/atlas/atlas.js`) — the action:
- *matched* → adopt the existing archetype; its **rule-book template pre-loads** into the new contract (AI fills only the deltas).
- *novel* → crystallise a **new archetype** seeded from this contract.
- Either way → write a `contract_fingerprint` row linking customer → archetype, store the embedding, bump member stats, regenerate the wikis.

`classify(client)` does the same analysis with **no mutation** (returns fingerprint + candidates + decision).

### Hybrid knowledge (regenerated every route)
The same learning, three representations at once:
- **MD wikis** — `docstore/_ATLAS/<slug>.md`: per-archetype playbook + fingerprint + recurring exceptions + member contracts + related archetypes. Served via the doc×api switch.
- **Relationship graph** — `docstore/_ATLAS/index.md`: which archetypes share heads/dims, plus the "common denominators" across all contracts (head/dim/measure frequencies).
- **DB structures** — `archetype.rule_template`, `required_inputs`, `normalizers`, and `norm_federation` dictionaries.

---

## Axis 2 — Federation (learning *labels* across siblings)

`server/atlas/federation.js → createFederation(q)`. The first compounding loop.

When you answer a clarification on Kenvue ("'GDC' = non_referral"):
1. `record()` saves it as a contract-scope mapping.
2. It counts agreement across Kenvue's archetype siblings.
3. Once **≥2 distinct contracts agree** → it **promotes** the mapping to the *archetype* scope. (If two contracts disagree → marked `conflicted`, never auto-applied.)

On the read side, `decisionsFor(client)` returns the promoted mappings; `getDecisions` (in `run.js`) merges them **underneath** the contract's own decisions (contract always overrides).

**Result:** a label confirmed on two siblings auto-applies to the *third* that never saw it. Verified: `source:zeta=non_referral` confirmed on FED-A + FED-B → FED-C inherited it untouched. Clarifications-per-contract trend toward zero.

Wire-up: `createEngine({...,federation})` and `engine.recordDecision()`.

---

## Axis 3 — Epidemiology (learning *failures* across siblings)

`server/atlas/epidemiology.js → createEpidemiology(q)`. Same idea, for exceptions instead of labels.

After every run, `record(client)` recomputes — for the contract's archetype — which exception *issues* keep happening and across how many distinct siblings. Per issue it stores: contracts_hit, occurrences, **prevalence** (% of the family), and a heuristic **suggested fix** (`suggestFix`). Persisted to `archetype.exception_patterns`.

`prewarn(client)` returns the *recurring* ones (>1 contract OR prevalence ≥ .5). So a new contract of that shape is warned **before its first run**: *"80% of contracts like you hit an 'unmapped source' problem — here's the fix."*

Verified: an issue hit by 2 siblings pre-warned a 3rd; one-off issues correctly filtered out. Surfaces in `payload.atlas.prewarn`, `GET /api/atlas/epidemiology/:client`, and the wiki MD.

Wire-up: `createEngine({...,epidemiology})` and `engine.prewarn()`.

---

## Axis 4 — Embeddings · Drift/Fork · Pre-intake

### Embeddings (`server/atlas/embed.js`)
Jaccard only sees *structural overlap*. Embeddings add a *semantic* signal — `createEmbedder()` builds a deterministic, key-free hashed vector + `cosine`. The classifier blends them: `score = 0.75·Jaccard + 0.25·cosine`. **Structural still makes the matched/partial/novel call**; semantic adds nuance + tie-breaking. Swappable for a real embedding provider later. Stored on `archetype.embedding` + `contract_fingerprint.embedding`.

### Drift + Fork (`server/atlas/drift.js`)
Contracts change. `check(client)` recomputes the fingerprint vs its assigned archetype. If similarity dropped below 0.8, or the revenue heads changed → flags **drift** and suggests:
- `reroute:<slug>` — a different existing archetype now fits better, or
- `fork` — nothing fits; spin a **new archetype version**.

`fork(client)` creates that version (e.g. `split-fee+headcount-slab-v2`), links `parent_id` (traceable lineage), and re-routes the contract. Archetypes **evolve** instead of silently mis-applying a stale template. Verified: a mis-assigned contract showed drift (sim 0.05) → fork produced `-v2` with the parent linked.

Factory is injectable: `createDrift({q, getRuleBook})`.

### Pre-intake gate (`server/atlas/preintake.js`)
Normally you fingerprint *after* compiling the rule book. Pre-intake fingerprints from the **raw SOW text**, *before* compile, via keyword heuristics ("recruitment"/"milestone" → split-fee; "headcount"/"OSS" → slab).
- `propose(client, sowText)` → guessed shape + candidate archetypes + a **confirm token** — but **persists nothing**.
- `confirm(client, {fingerprint, confirm_token, archetype_slug})` → adopts it **only if the token still matches the shown fingerprint** (so you can't confirm a different shape than you reviewed).

This is the human-approval gate before any template is applied. Verified live: propose returns the shape; a wrong token is rejected.

---

## The lifecycle (Atlas + BigFlex together)

1. **Pre-intake** (optional) — raw SOW → propose archetype → human confirms shape.
2. **Compile** rule book (BigFlex) → worked-example trust gate.
3. **Route** (Atlas) → matched archetype pre-loads template/inputs/normalizers/playbook; **epidemiology pre-warns** known failures; **federation** has pre-filled agreed labels.
4. **Run** (BigFlex) → normalize → compute → quarantine/clarify → trace.
5. Each **clarification** feeds federation; each **exception** feeds epidemiology.
6. **Release** → frozen statement.
7. Over time **drift** catches shape change → **fork** spins a new archetype version.

**The moat:** every contract that runs makes the next of its shape cheaper to onboard — on labels, failures, shape, and matching, all at once.

## Atlas invariants
- Structural similarity decides matched/partial/novel; embeddings only blend/tie-break.
- Never silently mis-apply a template — partial flags divergences, drift forks a version.
- Federation promotes only on ≥2 agreement; conflict is marked, never auto-applied.
- Epidemiology pre-warns only *recurring* issues (>1 contract or prevalence ≥ .5).
- Pre-intake persists nothing until a human confirms a token-bound fingerprint.
