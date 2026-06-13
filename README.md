# ANSR

Project for **ANSR** ([ansr.com](https://ansr.com)) — Global Capability Center (GCC) enablement.

Design language, layout, and project scheme follow the Leela platform pattern,
rebranded to ANSR. App domain details TBD.

## Status
- [x] Brand kit — `brand/` (tokens, guidelines, logo, skill)
- [x] Local Docker — `docker-compose.yml` (Postgres `qansr` on host port **5433**)
- [ ] App — pending requirements
- [ ] Remote staging — `qansr.thekettleblack.in` (wired later)

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
