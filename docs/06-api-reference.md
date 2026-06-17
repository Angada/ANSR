# 6 · API reference

[← Flows](05-flows.md) · [Wiki home](README.md) · Next: [Mint user journey →](07-mint-user-journey.md)

---

All routes are served by `server/index.js`. Auth is a soft cookie gate (see [Deployment](08-deployment.md)); everything except the OPEN list requires the `qansr_auth` cookie from `/api/login`.

## Auth & session
| Method · Path | Purpose |
|---|---|
| `POST /api/login` | `{user, pw}` → sets `qansr_auth` cookie |
| `GET /api/me` | current user/role |
| `POST /api/logout` | clears cookie |
| `GET /health` | liveness `{ok, service, ts}` |

## Config / AI pipelines (admin)
| Method · Path | Purpose |
|---|---|
| `GET /api/config` | public config |
| `GET /api/pipelines` · `POST /api/pipelines/:id` · `POST /api/pipelines/default` | AI-pipeline registry CRUD + default |
| `POST /api/providers/:provider` · `POST /api/providers/:id/test` | provider key set / test |
| `GET /api/ai/map` | AI column-mapping helper |

## Documents (doc×api switch)
| Method · Path | Purpose |
|---|---|
| `POST /api/upload` | multipart file → T1 vault + T2 md + `document` row |
| `GET /api/doc/:customer/:docId` | **serves the T2 md extract, never the original** |
| `GET /api/docs/:customer` | list a tenant's extracts |

## Tenants & runs
| Method · Path | Purpose |
|---|---|
| `GET /api/clients` · `POST /api/clients` | list / create customer |
| `POST /api/mint/run` | start a run; folds in Atlas route → `payload.atlas` (decision, similarity, archetype, **prewarn**) + `payload.compiled_rule_book` (template-fill on match) |
| `GET /api/mint/runs/:client` | run history |
| `GET /api/mint/run/:client/:no` | one run (real engine manifest, stub fallback) |
| `POST /api/mint/run/:client/:no/release` | freeze the run → statement |
| `POST /api/mint/purge` | clear a client's runs/data |
| `GET /api/run/:customer/:runNo` · `GET /api/runs/:customer` | legacy run reads |

## Ingest + compute
| Method · Path | Purpose |
|---|---|
| `POST /api/mint/roster/map` | infer column mapping for an uploaded worksheet (+ writes `<docId>-rows`) |
| `POST /api/mint/roster/api` | ingest a worksheet via API (rows[] or a URL returning an array) |
| `POST /api/mint/roster/confirm` | write mapped rows → placement ledger |
| `POST /api/mint/run/compute` | `{client, month}` → normalize + compute + quarantine → `{computed, exceptions, clarifications, totals}` |
| `GET /api/mint/clarifications/:client` · `POST /api/mint/clarify` | list / answer clarifications (answer → `decision` → federation promote → incremental recompute) |
| `GET /api/mint/rulebook/:client` | the compiled rule book |
| `GET /api/mint/validate/:client` | readiness / terms-vs-data validation |
| `GET /api/mint/clauses/:client` · `POST /api/mint/interpret` | clause store / interpretation upsert |

## Boxes (doc intelligence)
| Method · Path | Purpose |
|---|---|
| `POST /api/box/:id/chat` | clarify-chat on a box |
| `POST /api/box/:id/amend` | apply a suggestion/amendment (bumps version, recompiles) |

## Outputs
| Method · Path | Purpose |
|---|---|
| `GET /api/mint/invoice/:client/:no` | invoice / statement payload |
| `GET /api/mint/analytics/:client` | charts / KPI data |

## FX
| Method · Path | Purpose |
|---|---|
| `POST /api/fx/override` | pin a manual rate (`source:'manual'`) |

## Atlas
| Method · Path | Purpose |
|---|---|
| `POST /api/atlas/classify/:client` | fingerprint + match (no mutation) |
| `POST /api/atlas/route/:client` | adopt/crystallise archetype, persist, learn |
| `GET /api/atlas/archetypes` | list archetypes (+ member counts) |
| `GET /api/atlas/archetype/:slug` | archetype detail + members |
| `GET /api/atlas/wiki` · `GET /api/atlas/wiki/:slug` | relationship-graph index / per-archetype MD |
| `GET /api/atlas/epidemiology/:client` | pre-warn recurring family failures |
| `GET /api/atlas/drift/:client` | drift check (stable / reroute / fork) |
| `POST /api/atlas/fork/:client` | crystallise a new archetype version + re-route |
| `POST /api/atlas/preintake` | propose archetype from raw SOW text (persists nothing) |
| `POST /api/atlas/preintake/confirm` | adopt a token-bound proposed fingerprint |

---

### Quick live smoke (prod)
```bash
B=https://ansr-121188302790.asia-south1.run.app; J=/tmp/j
curl -s -X POST -H 'content-type: application/json' -d '{"user":"vik","pw":"thedik"}' -c $J $B/api/login
curl -s -b $J $B/api/atlas/archetypes
curl -s -b $J -X POST $B/api/atlas/route/ANSR-KENVUE
curl -s -b $J $B/api/atlas/drift/ANSR-KENVUE
```
