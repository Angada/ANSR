# ANSR

Project for **ANSR** ([ansr.com](https://ansr.com)) — Global Capability Center (GCC) enablement.

Design language, layout, and project scheme follow the Leela platform pattern,
rebranded to ANSR. App domain details TBD.

## Documentation (the wiki)
Full docs live in [`docs/`](docs/README.md). Start there. Quick links:
- [Overview](docs/00-overview.md) · [Architecture](docs/01-architecture.md)
- [BigFlex engine](docs/02-bigflex-engine.md) · [Atlas (learning brain)](docs/03-atlas.md)
- [Schema (38 tables)](docs/04-schema.md) · [Flows](docs/05-flows.md) · [API reference](docs/06-api-reference.md)
- [Mint user journey](docs/07-mint-user-journey.md) · [Deployment & ops](docs/08-deployment.md) · [Glossary](docs/09-glossary.md)

The engine + brain are also packaged as global Claude skills (`bigflex`, `atlas`) and as a decoupled package on the `bigflex` branch.

## Status
- [x] Brand kit — `brand/` (tokens, guidelines, logo, skill)
- [x] Local Docker — `docker-compose.yml` (Postgres `qansr` on host port **5433**)
- [x] App — Mint · AR Contract Reconciler (BigFlex engine + Atlas brain)
- [x] Remote staging/prod — GCP Cloud Run `ansr` (Mumbai) → `qansr.thekettleblack.in`
- [x] Full docs wiki — [`docs/`](docs/README.md)

## Brand
See [brand/SKILL.md](brand/SKILL.md). Core: orange `#FD5001`, navy `#002835`.

## Local dev
```bash
cp .env.example .env
docker compose up -d db        # Postgres on localhost:5433
```

## Repo
- GitHub: `Angada/ANSR`
- Dev branch: `Q-Ansr-tx`
