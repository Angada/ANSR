---
name: qansr-ai-pipelines
description: Q&ANSR AI-pipeline registry, AI switching, and model selection — managed on the Admin → AI Skills & Pipelines page. Use when adding/editing an AI step, changing provider/model, gating AI, or wiring the admin AI controls. Every model call goes through a registered, enabled pipeline; raw user text never hits a model outside one.
---

# Q&ANSR — AI Pipelines (registry + switching + model select)

Adapted from Leela ai-avenues + chatbot-gating. Single registry, admin-controlled.

## Registry (server/store.js → config.pipelines)
Each pipeline: `id, name, kind, description, provider, model, skills[], enabled`.
- **kind** = `deterministic` (no model — pure calc/IO) · `llm` · `hybrid` (deterministic + model narration).
- Only **enabled** `llm`/`hybrid` pipelines may call a provider.

Current pipelines: `contract-intake` · `normalize` · `calc` (deterministic) · `assure` ·
`statement` (deterministic) · `clarify` · `qa`.

## The gate (non-negotiable)
1. Raw user text is **never** sent to a model outside a pipeline.
2. A pipeline call checks: enabled? provider key present? kind allows model? else fall back / skip.
3. Data is scoped (per customer) before any model sees it.

## Admin → AI Skills & Pipelines (public/admin.html + admin.js)
- **Providers**: per provider (Anthropic, OpenAI…) set the API key (stored AES-256-GCM encrypted via store.js), see model list + key hint.
- **Pipelines**: per pipeline switch **provider**, **model**, and **enabled** toggle; deterministic pipelines show "no model call". Shows kind + bound skills + description.
- APIs: `GET /api/config` (redacted — never ships keys) · `POST /api/pipelines/:id {provider,model,enabled}` · `POST /api/providers/:provider {apiKey}`.

## Model IDs
Anthropic: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`. Default heavy reasoning
(contract-intake, clarify, qa) = opus; lighter (assure) = sonnet. Switchable per pipeline in admin.

## Rule
Adding a new AI capability = add a pipeline to the registry (not an ad-hoc model call), bind its
skills, default a sensible model, ship it disabled-by-default if it needs a key. It then appears in
admin for switching. Every switch is auditable.
