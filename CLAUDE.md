# CLAUDE.md

## AI provider wiring — HARD RULE (Asa, 6 Aug 2026; clarified 9 Aug 2026, universal — every project)
Every model provider gets its OWN provider + a direct provider API key from the vault. The ban is on billing a non-Anthropic model against **Anthropic's** wallet/servers (api.anthropic.com, or the Anthropic SDK left on its default host). That is always wrong.

The wire protocol is NOT the test — the **host + billing** is. A provider's own endpoint that speaks the Anthropic protocol is still that provider's native endpoint and is ALLOWED. `api.z.ai/api/anthropic` = Z.AI's host + your Z.AI key + Z.AI's GLM Coding-Plan billing; no Anthropic involvement. Pointing the Anthropic SDK at it as a mere HTTP client is fine.

Pick the endpoint where the account's balance actually is. Z.AI has TWO products / TWO balances: `/api/anthropic` (Coding-Plan subscription) and `/api/paas/v4` (OpenAI-compatible pay-as-you-go wallet). They don't share money or, for some accounts, the same model catalogue — wrong endpoint → 429/1113 "insufficient balance" even with a funded key. **QAnsr's Z.AI balance is on the Coding Plan, so zai is wired to `/api/anthropic` by design.** To switch to the wallet, clear the zai `baseURL` in server/store.js (transport falls back to OPENAI_BASE.zai = paas/v4). Don't "fix" the Coding-Plan endpoint back to the wallet — that re-breaks it.
