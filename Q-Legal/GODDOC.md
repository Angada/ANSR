# Q-Legal — God Doc

> The single source of truth for the Q-Legal plan. If it isn't in here, it isn't agreed.
> Companion checklist: [TODO.md](TODO.md). Core docs entry: [`docs/14-q-legal.md`](../docs/14-q-legal.md).
> Status: **P1 cut BUILT inside ANSR Core (2026-07-30)** — nav: RayDar · Contra · **Q-Legal** · Mint · Admin; e2e smoke-tested locally. Scope email sent to client; commercials pending alignment. Build ledger: [TODO.md](TODO.md).

---

## 1. What it is

**Q-Legal** is a standalone legal-repository intelligence app for a client legal department managing **1000+ contracts with ~100 new documents arriving every month**. It is *not* a document-management system, a workflow tool, or an e-signature platform — it is the intelligence layer that sits beside SharePoint and makes the estate searchable, self-organising, and self-explaining.

- Client contact: **Kranthi Narendra** (+ Archita, Ravi, Aloke). Requirements email received 2026-07-29.
- App home: `Q-Legal/` inside the Q&ANSR repo. Standalone deployment; rides **Q&ANSR Core platform commons** (§4.1).
- Second product on the platform after the ANSR/Mint deployment — proof that the commons transplant.

## 2. Design principles (non-negotiable)

1. **SharePoint is the source of truth.** Storage, version history, tracked changes, collaboration, permissions — all stay in SharePoint, untouched. Q-Legal has **read-only** access and cannot write to SharePoint *by construction* (no write scope exists, even in a bug).
2. **Everything derived is rebuildable.** C1/C2, wiki, trees, tags, vectors — all regenerable from SharePoint at any time. Human confirmations (links, tags, obligation owners) live in separate tables and replay on rebuild.
3. **No naked claims.** Every search hit, answer, insight, and report row carries `document → version → § anchor`, click-through to the highlighted clause and onward to the SharePoint original.
4. **Confirm, don't guess.** Auto-classification, tree links, lineage matches, new-type proposals, drift alerts — the AI *proposes* with confidence scores; a human confirms through one unified confirm queue. Every confirmation becomes a training label.
5. **Deliberate exclusions** (§7) are part of the product, not gaps.

## 3. Scope map — client requirements → delivery

| # | Client ask | Verdict | How |
|---|---|---|---|
| 1 | Searchable contract repository (keyword / doc-name / natural language; word, pdf, image; filters & sorts) | **Yes** | C1/C2 ingestion + hybrid retrieval (§4.5); vision-OCR for scans |
| 2 | Document families, dedup, signed-vs-draft | **Yes** | Doc tree + lineage matching (§4.3–4.4) |
| 3 | Due-diligence queries (data breach, change of control, insurance…) | **Yes** | Query router + clause vectors; § citations always |
| 4 | Template/clause repository + AI drafting from precedents | **Yes** | Standards library + Create-a-Draft (§4.8) |
| 5 | Workflow management (intake form, tracked changes, versions, approvals) | **No** — SharePoint/Word do it better; we harvest the history. Intake via MS Forms/SharePoint; we read it for reporting. Deviations-from-standard ARE stored (per contract, with reason). |
| 6 | Signature & execution mgmt (Zoho + stamping) | **No** — counterparties only accept authenticated platforms; keep Zoho + current stamping. Executed docs filed to SharePoint are auto-ingested. |
| 7 | Renewal & termination reminders | **Yes** | Extracted dates → task engine (§4.6) |
| 8 | Reporting (by category, stage-time, urgent counts) | **Yes** | §4.7 — stage-time requires a SharePoint Status column (rollout SOP) |
| 9 | Obligation management (deliverables/SLAs → reminders to doers) | **Yes** | Same task engine; human assigns doer |
| 10 | Vendor–client obligation gap mapping | **Yes** (most ambitious yes) | Cross-contract comparison over extracted terms + clause vectors |
| 11 | Self-config / low-code, ease of adoption, TCO, support | **Yes** | Platform commons (§4.1): editable business rules, standards, pipelines; no migration; no new login for documents |

## 4. Architecture

### 4.1 Q&ANSR Core commons (reused, not rebuilt)
- **`lib/contra/`** — transplantable archetype/review/redline components with pluggable `llm()` (built + verified in Contra).
- **Munshi** ingestion + **vision OCR** (`server/vision.js`, provider-aware) for scanned PDFs.
- **Gated AI-pipeline registry** + Admin (every model call through a named, inspectable, swappable, logged pipeline) + **Vault** (keys, model swap).
- **RayDar shell** frontend patterns, **ops design system** (`--brand-*` white-label API), **qansr-ui** mobile-first standard.
- **Batch persistence pattern** — server-side, DB-persisted per item *as it completes*, resumable, client polls (the RayDar-sweep lesson).
- Ring-fenced: own schema (`ql_*`), own vault namespace, own access boundary, RBAC. Shared: infra, pipelines, keys, admin.

### 4.2 SharePoint integration — strictly one-way
- Azure AD app registration, **`Sites.Selected` application permission, READ role, legal site only** (fallback: delegated service account if client IT prefers).
- **Graph delta sync** (or manual "Sync now" for the pilot — see Open Items) discovers new/changed items + metadata changes. Idempotent via SP item ID + version + etag. SP item IDs are stable across renames/moves, so tags and links persist through folder reorganisation.

```
SharePoint (source of truth: storage · versions · tracked changes · workflow · permissions)
      │  READ-ONLY — Graph delta sync
      ▼
Q-Legal ring-fenced store:
   vault snapshots · C1 · C2 · wiki/doc/content trees · tags ·
   vectors · obligations · status-transition log · confirm queue
      ▼
search · NL answers · reports · reminders  (SharePoint never queried live)
```

### 4.3 Data model & per-version ingestion
- **`ql_document`** — one row per logical contract (the wiki page hangs here).
- **`ql_version`** — one row per SharePoint version: vault snapshot (+ Word→PDF conversion on demand), **C1** = full faithful markdown transcript (all text, tables as markdown, images/graphs described), **C2** = the concise key (summary, clause map with § anchors, extracted facts, tags), **AI diff summary** vs prior version.
- **Lazy versioning policy (cost control):** full C1/C2 for the **latest and executed** version of every document + any version a user opens (on demand). Historical intermediate drafts: snapshot + metadata + diff only. New documents going forward: every version processed as it arrives.
- **Word→PDF lineage:** executed PDF matched to its final Word sibling by C1 similarity (~99% match vs drafts), proposed with score, human-confirmed → wiki **version rail**: `draft v1…vN (Word) → final → executed PDF (signed date)`.
- Extracted facts (T3): parties, type, dates, value, governing law, auto-renewal + notice periods, **notice clauses + counterparty notice contacts + assignment/change-of-control clauses** (the obligations register), deliverables/SLAs.

### 4.4 Wiki, trees, tags
- **Doc tree:** counterparty → relationship → master agreement → SOWs/amendments/NDAs. Parent links inferred at ingestion ("pursuant to the MSA dated…", party-pair match, referenced doc numbers) → proposed with confidence → confirm queue. The chain is *legal* (which terms govern), not cosmetic.
- **Wiki page per contract — generated, never authored:** header facts · one-paragraph AI summary · key-terms strip · tags · tree context · backlinks · version rail · computed "nearest in estate" panel · jump-offs (original / C1 transcript / review). **Read-mostly:** facts are corrected at source (C2) via the confirm flow, not edited on the page — no drift.
- **Tags:** controlled-vocabulary auto-tags at ingestion (type, region, governing law, status, has-auto-renewal, scanned-source…) = search facets; free human tags with suggest-first UI + Admin merge tool.
- Three converging retrieval paths — **browse** (tree), **filter** (tag facets), **search/ask** — all landing on the wiki page.

### 4.5 Vector spine (first-class — user decision 2026-07-29 "go all out")
- **pgvector in the same Postgres**, HNSW. Three granularities, all carrying § anchors: **clause** (~150/doc — semantic search, clustering, benchmarking), **section** (thematic queries), **document** (C2 summary — classification, families, dedup, similarity).
- Scale math: 5,000 docs ≈ 750K clause vectors — trivial for pgvector; headroom to ~50K docs. ~100 docs/month ≈ +15K vectors/month.
- **Versioned + swappable:** every vector row stores `(embedding_model, model_version, embedded_at)`; embedding model is a gated pipeline, swapped via Vault with batch re-embed migration, both generations live until cutover. Never orphan vectors from a dead model.
- **Hybrid retrieval, always:** facts-SQL + Postgres FTS (tsvector) + vector, fused (reciprocal rank). Vectors catch paraphrase ("terminate for convenience" ≈ "without cause"); **grounding rule:** a vector hit is only ever a pointer to a real §.
- **Query router, not a search box:** NL ask → classified → fact question (SQL over C2), clause question (FTS+vector over C1), or deep single-doc read (Ask-Contract). Users never pick a mode.
- **Vector wiki:** computed nearest-neighbour panels; **emergent clause library** via clustering (cluster centroid = estate norm; distance from centroid = non-standardness → benchmarking: "this liability cap is worse than 92% of your estate and breaches your standard"); **the estate map** — 2D projection (UMAP) of doc vectors: clusters = types, families = constellations, outliers visible.

### 4.6 Task engine — renewals + obligations (one machine, two feeders)
- **Lifecycle dates (auto):** expiry, auto-renewal windows, termination-notice deadlines → tasks with lead times + escalation.
- **Post-execution obligations (extracted + confirmed):** deliverables/SLAs with what · who owes it · frequency · deadline · § cite; human assigns the **doer**; email reminders carry the clause.
- Deliberately **tiny**: a task list with states (done/snooze/escalate). No approvals, no routing — it must never grow into the workflow engine we excluded.

### 4.7 Reporting
- Estate-shaped reports = SQL over C2 facts (by category, counterparty, expiry quarter, governing law…).
- **Stage-time analytics** (legal vs business vs third-party review): driven by **one Status choice column** on the SharePoint library (Draft → Legal Review → Business Review → Third-Party Review → Executed) + an Urgent flag. Delta sync timestamps every transition → durations computed. *Honest dependency:* without column discipline the report is fiction — it's part of the rollout SOP.
- **Pin any NL question as a living report** — dashboard tile or scheduled email digest. Reporting becomes whatever the team has asked, compounding over time.

### 4.8 Standards + drafting (AI use case #2)
- **Standards tab** (the archetype maker, renamed for lawyers): upload model contracts → structure extracted (sections, required clauses, house rules, preferred language harvested from the precedent) → human confirms/tags → versioned Standards library. A deliberate user action — legal curates its own standards.
- **Create-a-Draft tab:** NL ask ("services agreement with Acme, security staffing, two Bangalore sites, 2-year term") + a Standard → **draft 1, structurally complete by construction** (definitions/notices/severability come from the standard, not the prompt), proper legal voice. Exports as .docx download; lawyer files it into SharePoint; negotiation happens there (tracked changes, no AI); executed doc syncs back in. **Q-Legal is the bookends; SharePoint is the middle.**
- **Deviations register:** approved deviations from standard positions stored per contract, with reason.

### 4.9 The organism — growth loops (all via the one confirm queue)
1. **Self-classifying intake** (per document, on arrival): embed → nearest confirmed neighbours vote on category/family/tags/standard-match → high confidence auto-files, low confidence to confirm queue. Confirmations = labels; the classifier is trained by ordinary work.
2. **Nightly gardener:** cluster health (cohesion, orphan rate) + **emergence** — N unmatched docs clustering together → "new contract type, name it?" Taxonomy grows from ~8 categories at 1K docs to the ~25 needed at 5K, discovered not guessed.
3. **Weekly drift watch:** new arrivals matching a category/Standard at steadily falling similarity → "version the standard, or fork a variant?" Standards stay alive.
4. **Monthly tag hygiene:** vector-overlap merge proposals; tag sprawl composted.
- **Monthly cohort digest** (rides pin-a-report): what arrived, how it self-classified, exceptions, emerging clusters, drift warnings.
- **Quality benchmark (Munshi maturity rule):** ~50 labelled query→expected-§ pairs; every re-embed, model swap, or taxonomy change runs against it; regression blocks the change. "Search feels worse" becomes a number.

### 4.10 The learning loop — every human touch teaches (transplants the Mint rule-learning design)

The organism loops (§4.9) learn *classification*. This loop learns *everything else*. The principle: **no correction is ever consumed once** — every human touch is captured as a structured, append-only feedback event (`ql_feedback`: what was wrong, what's right, where, why) and then travels a **promotion ladder**:

```
Level 0 — INSTANT (this document):  correction applies immediately — fact fixed at source,
          answer note pinned to the contract's C2 ("§7.2 means X, per Archita 2026-08-04"),
          future answers on THIS contract must respect it.
Level 1 — TYPE (this contract type): the same correction pattern recurring across documents of
          one type → system proposes a TYPE RULE ("in staffing SOWs, 'engagement fee' = the
          placement fee, not the monthly fee") → human confirms → rule injects into the
          extraction + answer prompts for that type. (= Munshi parse-recipe versioning.)
Level 2 — ESTATE (all documents):   patterns recurring across types → proposed as an
          estate-wide rule or a Standards amendment → confirmed → global.
```

**The five learning surfaces feeding the ladder:**
1. **Extraction corrections** — fixing a party/date/notice-period in the confirm queue fixes the fact *and* banks a labelled example; examples become few-shot context for that document type's extraction pipeline (the Munshi recipe idea: per-type recipes that version and improve).
2. **Answer corrections** — "wrong — this clause means X" on any NL answer → Level 0 instantly, ladder upward if recurring. The two-loop Mint design (intra-run refine + MINT-wide promote), verbatim.
3. **Retrieval feedback** — clicked vs ignored results, thumbs on answers, and *failed queries* (asked, found nothing, human later found it manually) are logged; failures convert into new labelled benchmark pairs, so the benchmark grows from real usage instead of staying a static 50.
4. **Classification confirmations** — already Loop 1 (§4.9); same event store.
5. **Negotiation outcomes** — deviations register + executed-version diffs reveal what counterparties actually accepted across the estate → drift watch proposes Standards updates ("you hold a 12-month cap on paper but concede 24 in 78% of executed deals — update the standard or arm the negotiators?").

**Guarantees:** corrections are append-only and replayable (a derived-layer rebuild replays them — principle #2); promoted rules are versioned, attributed, and visible in Admin like any pipeline; nothing promotes without human confirmation; and the benchmark measures whether learning is actually working — accuracy per type should visibly climb month over month, and that chart is itself a pinned report ("how much smarter did the repo get this quarter?").

## 5. Screens / IA (indicative)

- **Repository** — registry table (filterable/sortable) · estate map · tree browser · global search+ask bar (router behind it)
- **Contract wiki page** — the hub (facts, summary, version rail, neighbours, jump-offs)
- **Tasks** — renewals/terminations · obligations (assign doer, done/snooze)
- **Standards** — library · maker (model-contract upload → confirm) · deviations register
- **Draft** — NL ask → standard pick → draft 1 → .docx download
- **Reports** — canned + pinned questions + cohort digest
- **Confirm queue** — classifications · tree links · lineage · new-type & drift proposals · tag merges
- **Admin** — pipelines/gates, Vault, activity log, RBAC, benchmark scores

## 6. Cost & scale posture
- The expensive step is **C1 generation** (LLM transcription + OCR), not search — vectors and FTS are rounding errors. Lazy versioning is the lever.
- Per-run cost visible via the pipeline log → growth is priced, not surprising.
- Segmentation at scale = namespace column + filter (business unit / region / entity) inside the ring-fence; architecture unchanged.

## 7. Deliberately NOT built
- Workflow engine / approvals / intake forms (SharePoint + MS Forms; we read, we don't replace)
- In-app collaborative editing / tracked changes (Word is better; no AI needed)
- E-signature + stamping (Zoho + current process; counterparties demand authenticated platforms)
- Draft write-back to SharePoint (download-first; write scope is a bigger IT ask — revisit later)

## 8. Decisions log
| Date | Decision |
|---|---|
| 2026-07-29 | Standalone app (not a Contra tab extension); registry-first priority; corpus not yet in hand → corpus-agnostic design, no Standards until real samples |
| 2026-07-29 | SharePoint = mandatory source of truth + workflow home; Q-Legal strictly read-only (`Sites.Selected`) |
| 2026-07-29 | C1/C2 naming (user's "Concise 1/2"); per-version ingestion with lazy-versioning cost policy |
| 2026-07-29 | Vectors upgraded to first-class ("go all out") — pgvector, 3 granularities, hybrid always, organism loops |
| 2026-07-29 | Exclusions confirmed: workflow, e-sign/stamping, in-app editing |
| 2026-07-29 | "Archetypes" presented to client as **Standards**; drafting = bookends model |
| 2026-07-29 | Scope email sent (plain-English version); commercials to follow client alignment |
| 2026-07-30 | **Built inside ANSR Core as a product surface** (user: "fire it up within ANSR Core") — `server/qlegal.js` + `public/qlegal.*` + `db/init/022_qlegal.sql`, not a separate server; standalone client deployment = same codebase ring-fenced at deploy time |
| 2026-07-30 | **Business rules are first-class**: `ql_rule` table, Governance editor, scope-matched injection into every pipeline call, applied codes logged per call — "each step owned, each step's rules editable" |
| 2026-07-30 | Pipeline naming: `qlegal-key` (C2) · `qlegal-obligations` · `qlegal-link` · `qlegal-diff` · `qlegal-ask` (obligations split from key for per-step ownership) |
| 2026-07-30 | Search = OR-ranked websearch_to_tsquery (AND semantics silently missed "liability cap"); vectors still arrive P2 |
| 2026-07-30 | Dates: compact `dd-mm-yyyy` (+ time) everywhere; weekday only where humans plan (due dates: "Mon, 9 Jun, 2026"); IST always |

## 9. Open items (blocking or shaping the build)
1. **Commercials** — user proposes after client scope alignment. *(Client status: awaiting reply.)*
2. **Corpus sample** — 50–100 real contracts for the P0 corpus study (format mix, scan ratio, distinct types). *No Standards/archetype design before this — the read-before-you-write rule.*
3. **Client's existing contract-index Excel** — extraction ground truth → "here's our accuracy number".
4. **SharePoint access mechanism** — Graph app registration timing with client IT; pilot may start on manual sync.
5. **Status-column SOP** — agree the choice values + Urgent flag with the legal team at rollout.
6. **Frequently-used prompts** — Kranthi to share; feeds the query-router design + the labelled benchmark.

## 9b. SharePoint + AD — the data checklist (what we need to confirm exists, before any API work)

**From SharePoint, per file (read-only; we parse into C1/C2 — no edit scope ever):**
| Field | Why we need it |
|---|---|
| Drive item **ID** (stable across rename/move) | our `sp_item_id` anchor — tags/links survive reorganisation |
| Site ID + drive/library ID | scope the read permission to the legal library only |
| Filename + folder path | registry display + family hints |
| **Version history**: version number, modified timestamp, modified-by | the version rail; one doc ↔ many versions |
| **Permalink** (webUrl) | click-through from every answer back to the source of truth |
| File binary per version (download) | vault snapshot → C1/C2 per version |
| sha/eTag/cTag | idempotent delta sync — never re-process unchanged files |
| **Metadata columns** incl. any existing tags + the Status choice column (once adopted) + Urgent flag | meta-tag persistence + stage-time analytics |
| Created date/by | provenance |
| Content type / template info (if used) | classification hints |

**From Active Directory (Entra ID), read-only:**
| Field | Why |
|---|---|
| Employee ID · display name · email | identity for RBAC, obligation "doer" assignment, feedback attribution |
| Department / role (job title) | limit access: legal department = full; named approvers/viewers outside legal = scoped read |
| **Group membership** for the legal-library-access groups | derive who may see Q-Legal at all (mirror SharePoint's own access) |

**Explicitly NOT needed:** write/edit scopes on SharePoint, mailbox access, tenant-wide directory read (a scoped group read suffices), or any user passwords (SSO handles auth).

## 10. Phases
- **P0 — Corpus study:** obtain sample → study mix → set OCR posture, category seed list, cost model. *(First real build step.)*
- **P1 — Repository:** app scaffold (schema, pipelines, shell) → ingestion (sync → snapshot → C1/C2 → diff → enrich) → registry + global search + wiki/tree + obligations register + confirm queue. One ingestion pass, many views. *Visible value in week one.*
- **P2 — Intelligence:** vector spine + query router + estate map + benchmarking → Standards library from client precedents → estate-wide risk sweep report → reporting + pinned questions → organism loops + cohort digest + benchmark.
- **P3 — BAU:** Create-a-Draft → task engine live (renewals + obligations w/ doers) → vendor–client gap mapping → stage-time analytics (after Status SOP lands).

*(Granular checklist: [TODO.md](TODO.md).)*
