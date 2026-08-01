# 8 · Deployment & ops

[← Mint user journey](07-mint-user-journey.md) · [Wiki home](README.md) · Next: [Glossary →](09-glossary.md)

---

Live on GCP (Mumbai) + Supabase (Mumbai). Account `angad.a@gmail.com`, TKB org.

## GCP — project `ansr-tkb`
- **Cloud Run** service `ansr`, region `asia-south1`, public. URL: `https://ansr-121188302790.asia-south1.run.app`.
- **Deploy:**
  ```bash
  CLOUDSDK_PYTHON=/opt/homebrew/bin/python3 \
  gcloud run deploy ansr --source . \
    --project ansr-tkb --region asia-south1 --account angad.a@gmail.com --quiet
  ```
  Always pass `--project ansr-tkb --account angad.a@gmail.com` (gcloud config otherwise flips to another account/project).
- **Secrets** (Secret Manager → compute SA): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CONFIG_SECRET`. Env: `PGSSL=1`, `NODE_ENV=production`, `--port 4100`.
- **Domain:** Cloud Run domain-mapping isn't supported in asia-south1 → global HTTPS LB. Static IP **8.233.13.30** (`ansr-ip`) → serverless NEG `ansr-neg` → backend `ansr-be` → urlmap `ansr-lb` → managed cert `ansr-cert` (for `qansr.thekettleblack.in`) → proxy `ansr-https` → fwd rule `ansr-fr`:443.
- **DNS: LIVE** (verified 2026-08-01). A record `qansr.thekettleblack.in` → `8.233.13.30`; managed cert ACTIVE (valid to 12 Sep 2026, auto-renews).
- **Two public front doors, one service:** `https://qansr.thekettleblack.in` (domain → LB → serverless NEG) and `https://ansr-121188302790.asia-south1.run.app` (Cloud Run direct, bypasses the LB). Same app, same database, same auth — the Cloud Run URL is the origin, not a separate environment. Give clients the domain.

## Supabase — project `ANSR` (`tjhfdpdmuntiyufomkkv`, ap-south-1)
- **Pooler host is `aws-1-ap-south-1`** (not aws-0). Sessions=5432 (migrations/DDL), transaction=6543 (app runtime). Direct `db.<ref>.supabase.co` is IPv6-only → won't resolve on this Mac; always use the pooler.
- App `DATABASE_URL` = `postgresql://postgres.tjhfdpdmuntiyufomkkv:<pw>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`.
- Private bucket `docs` (T1 originals + T2 md extracts).
- **Container = node:22-slim** (Node 20 lacks native WebSocket → `@supabase/supabase-js` crashes on upload).

## Schema management
- `server/migrate.js → runMigrations()` runs every `db/init/*.sql` **idempotently on boot** — a fresh DB (or new prod) self-provisions. No manual migration step.

## Code wiring for prod (vs dev)
- **Storage** — `server/storage.js` adapter: disk in dev, Supabase bucket in prod (by env). Cloud Run disk is ephemeral, so artifacts must go to the bucket.
- **Config/keys** — moved off `config.json` to Postgres `app_config` (migration 007) via in-memory cache in `server/store.js`; `CONFIG_SECRET` env holds the AES key (only ciphertext in the row).

## Known gotchas
| Symptom | Fix |
|---|---|
| `module 'importlib.metadata' has no attribute 'packages_distributions'` | gcloud grabbed Python 3.9; prefix `CLOUDSDK_PYTHON=/opt/homebrew/bin/python3`. Recurs after restarts. |
| gcloud deploys to wrong project/account | always pass `--project ansr-tkb --account angad.a@gmail.com`. |
| Upload crash on prod | container must be node:22-slim (WebSocket). |
| Local DB unreachable on 5433 | `open -a Docker`, wait for daemon, container `qansr-db`. |
| `node --check public/mint.js` before any deploy | a stray backtick in a template literal silently breaks all of mint.js. |

## Security TODO
- Soft login default `vik`/`thedik` (env `QANSR_USER`/`QANSR_PW`) ships on the public URL — set real creds via Cloud Run env/secret before real use. It is a prototype gate, **not hardened security**.

## Reusable package (`bigflex` branch)
The decoupled engine+Atlas package lives as the repo's `bigflex` branch (not a separate repo, to stay within the trusted ANSR repo). Mount in a new product per `bigflex/README.md`.
