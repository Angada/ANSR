# 🧭 CATCHUP — QAnsr / Mint

> Read this first to get current in 30 seconds. (Generated 2026-06-25.)

## What it is
**Mint** — a BigFlex AR Contract Reconciler for ANSR (a Global Capability Center). Reads SOW + monthly rosters, computes TA & OSS invoicing deterministically with full clause + calc audit, then answers "why is this number?" grounded in the contract.

## Stack & where it runs
Node 22 + Express (ESM) · Postgres 15 (local Docker :5433; Supabase Mumbai prod) · Anthropic SDK + SheetJS/officeparser · Cloud Run asia-south1 (`ansr-tkb`) → `qansr.thekettleblack.in` (HTTPS LB 8.233.13.30) · Supabase bucket (vault + markdown). No GA4.

## Current state
✅ Doc intake → vault + markdown + Postgres · ✅ hybrid 4-tier store · ✅ BigFlex interpreter (SOW → typed boxes) · ✅ rule-book compiler (N-dim ruleset + sparse rate_cell + coverage) · ✅ TA/OSS calc (deterministic, FX-aware, reproduced vs workbook) · ✅ invoice + Statement/donut charts · ✅ grounded Q&A chat · ✅ admin AI-pipeline registry · ✅ Cloud Run + domain live.

## Latest work
(~Jun 18) auth default `admin`/`admin` · removed Outcomes from top nav · "View past outcomes" (client+version) · global rotating-Q spinner + Outcomes page · single robust staggered-reveal · **Contract Compiler** (N-dim rule model + coverage validation — ESPL-applicable).

## What's next / open
BigFlex revamp phase 2 (tax+FX, rule versioning, clawback/credit) · reconciliation scorecard · maker–checker + immutable release · anomaly detection · listeners/notifications · what-if simulate · self-learning loop (decisions→rule promotion) · export pack · roster↔contract gates.

## Key files & how to run
**Entry:** `server/index.js` (port 4100). **Run:** `npm start` / `npm run dev`. **DB:** `docker compose up -d db`; schema auto-applies via `server/migrate.js`. **Env:** `.env.example`→`.env` (PG* or DATABASE_URL; SUPABASE_*; CONFIG_SECRET; QANSR_USER/PW).

## Skills it uses (.claude/skills)
qansr-ai-pipelines · qansr-db · qansr-knowledge-store · qansr-roster-ingest · qansr-rule-learning · qansr-ui · qansr-ops-design · + global **bigflex** & **atlas** (engine + learning brain; npm package on `bigflex` branch).

## Gotchas
Soft login (`admin`/`admin`) is a prototype gate — set real creds in Secret Manager before prod. gcloud: pass `--project ansr-tkb --account angad.a@gmail.com`. Node ≥22. On M-Mac prefix `CLOUDSDK_PYTHON=/opt/homebrew/bin/python3`. `node --check public/mint.js` before deploy. Supabase pooler `aws-1-ap-south-1`. Released runs never recompute — open a new version.
