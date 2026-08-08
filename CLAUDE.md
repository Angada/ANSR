# CLAUDE.md

## AI provider wiring — HARD RULE (Asa, 6 Aug 2026, universal — applies to every project)
Every model provider gets its OWN native API endpoint + direct provider API key. NEVER route a non-Anthropic model through an Anthropic-compatible endpoint (e.g. api.z.ai/api/anthropic) or the Anthropic SDK pointed at another vendor — those bill against separate pools and fail confusingly (QAnsr error 1113: Z.AI /api/anthropic draws a "GLM Coding Plan", not the wallet; the wallet endpoint is api.z.ai/api/paas/v4). Anthropic endpoints are for Anthropic models only. Native base URL + native request shape + provider key from the vault, always.
