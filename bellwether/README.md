# Bellwether

Hiring signal as a buying signal. Reads other companies' open roles and says who is
expanding, contracting or standing still — before any announcement does.

Ported into ANSR Core as the fourth app, so it inherits what already exists rather than
rebuilding it: user access, the AI-pipeline registry, the Vault, business rules, the audit
log, jobs/batches and the vector spine.

## What is here

- `source/` — the original `frontline-hiring-scraper` (Python/Flask), read-only reference.
  Kept verbatim so the port can be checked against it rather than against memory.
- Schema: `db/init/041_hireaway.sql`, `db/init/042_bellwether.sql`
- Pipelines: `bw-*` in `server/store.js`

## What the original is, and what it is for

A sales-qualification signal for **Nova** (AI phone-screening for high-volume hourly
hiring). Per company it outputs `frontline_role_count` and the roles behind it. A high
count is a strong ICP match. Tiering is manual, downstream.

Four stages: **resolve** (company → ATS platform + slug) → **fetch** (public JSON) →
**filter** (frontline or not) → **output**.

## The rules the original enforces, which the port must keep

These are not preferences. Each exists because breaking it produces a confident wrong
answer, which is worse here than no answer.

**Never emit a false zero.** A company that could not be resolved is `unresolved`, never
`count = 0`. Zero means *resolved, and genuinely has none*. Sales acts on zeros.

**Never guess a slug.** Slugs are opaque, especially Greenhouse and Workday. Read the exact
slug from the careers page or its redirect, then **verify against the endpoint** before
trusting it.

**Apollo's `Technologies` column is a hint, not truth.** Often empty or vague. Use it to
choose which platform to try first; never as the sole source.

**Matching is word-prefix at a LEADING boundary only** — `\bterm`, no trailing boundary.
`clean` matches cleaner, cleaning, clean-up. The leading `\b` is what stops false friends:
ob*serv*er, re*sort*, po*rter*, ca*ree*r. Then drop anything on EXCLUDE — unless it is on
LEAD_OK, which protects hourly leads from being excluded as management.

**Roles live in `roles.txt`, not in source.** 500 terms, loaded at runtime, and versioned
in `roles_archive/` — because changing the vocabulary changes every historical count, and a
count is meaningless without knowing which vocabulary produced it.

**Locations arrive as nested objects**, not strings. Extract city/state defensively; never
`str()` the object.

**Every unresolved company is logged with a reason** — `no_careers_page`, `unknown_ats`,
`slug_unverified`. "Failed" on its own tells you nothing about what to fix.

**Cache every resolved slug, and stay idempotent.** The whole run is safe to re-run.

## The one design decision we are changing, deliberately

The original states: *"there is no LLM in the data path."* That is a good rule, and the
reason is sound — deterministic matching is reproducible, free and auditable, and a
keyword list can be read and argued with in a way a model cannot.

So the port keeps the deterministic matcher AS the data path. The registered `bw-*`
pipelines are an optional layer for the cases it cannot decide — an ATS the markers do not
recognise, a title the rules score as ambiguous, a signal that needs a series read rather
than a count. AI where judgement is genuinely required; rules everywhere else.

Anything else would trade a reproducible number for a plausible one.

## Port status

Done: schema (10 tables), the seven pipelines registered, this reference copy.

Not done: the app itself — nav and pages, the 19 sources seeded into `bw_source`, business
rules surfaced in Settings, audit-log wiring, fetchers in Node, and the port-vs-sidecar
decision (the original is Python; Core is Node).

Port the matcher regression set (`source/test_matcher.py`) FIRST. It is what proves a port
is faithful rather than merely working.
