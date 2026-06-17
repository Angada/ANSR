# 10 · AI pipelines — gates, skills & model selector

[← Glossary](09-glossary.md) · [Wiki home](README.md)

---

Every model call in Q&ANSR runs through a **registered, gated pipeline**. Raw user text never reaches a provider outside an enabled `llm`/`hybrid` pipeline. Managed on **Admin → AI Skills & Pipelines** (`public/admin.*`); registry lives in `server/store.js → config.pipelines`; the single gated entry point is `server/ai.js → runPipeline()`.

## What each pipeline carries
`{ id, product, name, kind, description, provider, model, skills[], enabled, prompt }`
- **kind** = the gate type: `deterministic` (no model — pure calc/IO) · `llm` · `hybrid` (deterministic + model phrasing).
- **gate** = only **enabled** `llm`/`hybrid` pipelines may call a provider; deterministic never does.
- **skills** = the skills that pipeline draws on (shown as chips).
- **model selector** = for `llm`/`hybrid`, a provider + model dropdown in admin (deterministic shows "no model call").

## The registry today

### Mint
| Pipeline | Gate (kind) | Model selector | Skills |
|---|---|---|---|
| Contract Intake | hybrid | ✅ | qansr-contract-intake, knowledge-store |
| Normalizer | hybrid | ✅ | qansr-normalizer |
| Calc Engine | deterministic | — | calc-engine, lifecycle-ledger |
| Invoice Assurance | hybrid | ✅ | variance, invoice-assurance, exceptions |
| Statement Generator | deterministic | — | statement-generator |
| AI Clarify | llm | ✅ | qansr-ai-clarify |
| **AR Analyst Q&A (grounded chat)** | hybrid | ✅ | knowledge-store, **bigflex**, **atlas** |

### Atlas (the learning brain)
| Pipeline | Gate (kind) | Model selector | Skills |
|---|---|---|---|
| Classify & Route | hybrid | ✅ | atlas, bigflex |
| Pre-intake (raw SOW) | llm | ✅ | atlas, knowledge-store |
| Semantic Embedding | deterministic | — | atlas |
| Federated Normalizer Learning | deterministic | — | atlas |
| Exception Epidemiology | deterministic | — | atlas |
| Drift & Fork | deterministic | — | atlas |

## The gate (non-negotiable)
1. Raw user text/sheets are **never** sent to a model outside a pipeline.
2. A pipeline call checks: enabled? provider key present? kind allows a model? → else fall back / skip.
3. Data is scoped (per customer) before any model sees it.

## Admin controls
- **Providers** (connectors row) — per provider (Claude, OpenAI, Gemini, Z.AI, x.AI, DeepSeek): set the API key (stored **AES-256-GCM encrypted**), test the connection, see model list + key hint. "Make default · apply to all journeys" sets one provider+model across every model-backed pipeline.
- **Pipelines** (grouped by product) — per pipeline: **gate** chip + "Gate enabled" toggle, **skills** chips, and for `llm`/`hybrid` a **provider + model selector** + editable prompt.
- APIs: `GET /api/config` (redacted — never ships keys) · `GET /api/ai/map` · `POST /api/pipelines/:id {provider,model,enabled,prompt}` · `POST /api/pipelines/default {provider,model}` · `POST /api/providers/:provider {apiKey}` · `POST /api/providers/:id/test`.

## Merge policy (why your settings survive deploys)
`mergeDefaults` keeps a user's **runtime choices** (provider / model / enabled / prompt) across config saves, while **code-defined descriptive fields** (name / description / skills / kind) always take the latest from `DEFAULT_CONFIG`. So new pipelines and registry edits propagate over a saved prod config **without wiping** your provider/model/enable choices (the same rule already used for provider model lists).

## Adding a new AI capability
Add a pipeline to the registry (never an ad-hoc model call): bind its skills, default a sensible model, set `kind`, ship enabled (or disabled if it needs a key). It then appears in admin with its gate + skills + model selector, and every switch is auditable.

## Model IDs
Claude: `claude-opus-4-8` (heavy reasoning — intake, clarify, qa, pre-intake), `claude-sonnet-4-6` (lighter — assure, classify), `claude-haiku-4-5`. Switchable per pipeline.
