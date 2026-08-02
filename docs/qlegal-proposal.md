# Q-Legal — Legal Repository Intelligence
### Proposal · for the Legal department

---

## 1. Objective

The legal estate runs to **1000+ contracts, with roughly 100 new documents arriving every month**. They live in SharePoint, which does storage, versions, tracked changes and permissions well. What SharePoint cannot do is *answer questions about what is in them*.

Q-Legal's objective is precise:

> **Make the entire contract estate searchable, self-organising and self-explaining — without moving a single document, changing how the team works, or introducing a second place where contracts live.**

Q-Legal is **not** a document-management system, a workflow tool, or an e-signature platform. It is the intelligence layer that sits *beside* SharePoint. SharePoint remains the source of truth, untouched.

---

## 2. Design principles

These are non-negotiable and shape everything below.

| | Principle | What it means in practice |
|---|---|---|
| 1 | **SharePoint is the source of truth** | Q-Legal has **read-only** access and cannot write to SharePoint *by construction* — no write permission exists, even in the event of a defect |
| 2 | **Everything derived is rebuildable** | Transcripts, summaries, wikis, tags and vectors can be regenerated at any time. Human confirmations are stored separately and replay on rebuild |
| 3 | **No naked claims** | Every search result, answer and report row carries *document → version → clause reference*, clicking through to the highlighted clause and onward to the SharePoint original |
| 4 | **Confirm, don't guess** | The AI *proposes* with a confidence score; a human confirms through one queue. Every confirmation becomes a training label |
| 5 | **Exclusions are product decisions** | What we deliberately do not build (§8) is a design choice, not a gap |

---

## 3. Goals

| # | Goal | What "done" looks like |
|---|---|---|
| 1 | **Find any contract, any way** | Keyword, document name or plain-English question — across Word, PDF and scanned images |
| 2 | **Answer estate-wide questions** | *"Which of our contracts allow assignment on change of control?"* answered across all 1000, with clause citations |
| 3 | **Show families, not files** | Master agreement → SOWs → amendments → the executed PDF, as one legal chain |
| 4 | **Never miss a date** | Renewals, termination notice windows and post-execution obligations become tracked, assigned reminders |
| 5 | **Capture the house standard** | Model contracts become a versioned Standards library; deviations are recorded with reasons |
| 6 | **Get smarter with use** | Every correction teaches the system — and that improvement is measurable |

---

## 4. How it works

### 4.1 The layer model

This is the core of the design and worth understanding, because everything else follows from it.

```
ORIGINAL          the authoritative file in SharePoint — never fed to a model
    ↓
C1                a complete, faithful transcript: every word, tables preserved,
                  scanned pages read by vision-OCR, images and graphs described
    ↓
C2                the concise key: summary, clause map with § anchors,
                  extracted facts, tags — plus a contents wiki and a clause wiki
    ↓
REGISTERS         standing questions YOU write, answered for EVERY contract
```

Questions are answered by climbing this ladder **cheapest rung first**, and the answer reports which rungs it climbed.

### 4.2 Ingestion — SharePoint to intelligence

A one-way, read-only sync discovers new and changed documents along with their metadata and version history. Each version is snapshotted, transcribed to C1, reduced to C2, and diffed against the previous version so the team can see *what actually changed*.

The sync is **idempotent** — unchanged files are never reprocessed — and anchored on SharePoint's stable item IDs, so tags and relationships survive folder reorganisation, renaming and moves.

**Cost control by design:** full processing runs on the *latest* and *executed* version of every document, plus any version a user opens. Historical intermediate drafts are snapshotted with metadata and a diff only. Every version of every new document is processed as it arrives.

### 4.3 Registers — the answer to "they could ask anything"

Hard-coded extraction cannot cover an infinite question set. Asking a question document-by-document only reads the handful that match.

So: **a standing question is written once, in plain English, and answered for every contract in the estate** — at ingestion for new arrivals, and backfilled across everything already held. Each answer is stored as an indexed row against its contract with clause-level evidence.

> *"Which of our 1000 contracts have a non-solicit clause?"* becomes a single query returning cited answers — not a project.

Change-of-control and obligations tracking are simply two built-in examples of this one idea. The legal team writes new registers themselves, with no development work.

### 4.4 Families, wikis and tags

- **Document tree** — counterparty → relationship → master agreement → SOWs, amendments, NDAs. Parent relationships are inferred at ingestion (*"pursuant to the MSA dated…"*, party-pair matching, referenced document numbers), proposed with a confidence score, and confirmed by a human. The chain is *legal* — which terms actually govern — not cosmetic.
- **A wiki page per contract**, generated and never hand-authored: header facts, summary, key terms, tags, family context, version rail, nearest comparable contracts, and direct jump-offs to the original, the transcript and the review. Facts are corrected at source, so the page cannot drift.
- **Word→PDF lineage** — an executed PDF is matched to its final Word sibling by content similarity, proposed with a score, and human-confirmed, producing a clean version rail: *draft v1…vN → final → executed PDF (signed date)*.
- **Tags** — controlled-vocabulary auto-tags become search facets; free human tags are suggested-first, with an admin merge tool to prevent sprawl.

### 4.5 Search and Ask

Three routes converge on the same place: **browse** the tree, **filter** by tag, or **search and ask** in plain English.

The team never chooses a search mode. A question is classified and routed automatically — to a fact lookup, a clause search, or a deep read of a single document. Retrieval combines structured facts, full-text search and semantic vectors, fused into one ranking, so paraphrase is caught (*"terminate for convenience"* finds *"without cause"*).

**Grounding rule:** a semantic match is only ever a pointer to a real clause. It is never itself the answer.

Ask is **conversational** — a follow-up such as *"and how many days for that one?"* resolves against the thread.

### 4.6 Tasks — renewals and obligations

One small engine, two feeders:

- **Lifecycle dates**, extracted automatically — expiry, auto-renewal windows, termination-notice deadlines — with lead times and escalation
- **Post-execution obligations** — deliverables and SLAs with what, who owes it, how often, and the deadline, each carrying its clause reference. A human assigns the doer; reminders carry the clause text

Deliberately tiny: a task list with done, snooze and escalate. No approvals and no routing — it must never grow into the workflow engine we excluded.

### 4.7 Standards and drafting

- **Standards library** — upload model contracts; structure, required clauses and preferred language are extracted, confirmed by a lawyer, and versioned. Legal curates its own standards.
- **Create-a-Draft** — a plain-English request plus a chosen Standard produces a first draft that is *structurally complete by construction*: definitions, notices and severability come from the Standard rather than from the prompt. Exported as .docx.
- **Deviations register** — approved departures from standard positions, recorded per contract with the reason.

**Q-Legal is the bookends; SharePoint is the middle.** We produce draft one; negotiation happens in Word with tracked changes and no AI involvement; the executed document syncs back in.

### 4.8 Reporting

Estate-shaped reports over extracted facts — by category, counterparty, expiry quarter, governing law. Any plain-English question can be **pinned as a living report**: a dashboard tile or a scheduled email digest. Reporting becomes whatever the team has actually asked, compounding over time.

### 4.9 It gets better with use

Every human correction is captured as a structured, append-only event and travels a promotion ladder:

| Level | Scope | Example |
|---|---|---|
| **0 — Instant** | This document | A correction applies immediately and all future answers on this contract respect it |
| **1 — Type** | This contract type | A pattern recurring across one type is proposed as a type rule, confirmed by a human, and injected into that type's extraction |
| **2 — Estate** | Everything | Patterns recurring across types become an estate-wide rule or a Standards amendment |

Nothing is promoted without human confirmation. Corrections are append-only and replay on any rebuild.

**And it is measured.** A labelled benchmark of real questions and their expected clauses runs against every model change; a regression blocks the change. *"Search feels worse"* becomes a number, and *"how much smarter did the repository get this quarter?"* is itself a report.

---

## 5. Outcomes

**For the legal team**
- Any contract found in seconds, by name, keyword or question — including scanned documents
- Estate-wide questions answered with citations, instead of commissioning a review
- Renewal and notice deadlines tracked automatically, not held in memory
- The house standard captured, versioned, and measurable against what is actually being signed

**For the business**
- Obligations assigned to named owners with clause-backed reminders
- Reporting by category, stage and urgency — including where contracts are getting stuck
- Vendor–client obligation gap mapping across the estate

**For IT and governance**
- No migration. No second document store. No new login for documents
- SharePoint permissions and workflows entirely unchanged
- Every AI call named, logged, inspectable and model-swappable from an admin console
- Complete provenance from any answer back to the source file

**A note on honesty.** Where Q-Legal cannot ground an answer, it says what is missing rather than guessing. Every claim carries its citation. Low-confidence classifications go to a human queue rather than being filed silently. For a legal repository this is not a nicety — an intelligence tool that quietly guesses is worse than none.

---

## 6. Deployment, access and client dependencies

### Deployment
Deployed into the **client's own cloud tenancy** — application plus a managed PostgreSQL database. The client retains full ownership of infrastructure, data and running costs. Q-Legal is ring-fenced: its own schema, its own key vault namespace, its own access boundary.

### 6.1 SharePoint — required from the client

**This is a hard dependency. Without it there is no repository to read.**

| Requirement | Detail |
|---|---|
| **Azure AD app registration** | Created by client IT for Q-Legal |
| **Permission scope** | `Sites.Selected`, **READ role**, **scoped to the legal library only** — no tenant-wide access |
| **No write scope, ever** | Q-Legal cannot modify SharePoint because the permission to do so is never granted |
| *Fallback* | A delegated read-only service account, if client IT prefers that model |

Per file, read-only, we require: the stable drive item ID, site and library ID, filename and folder path, **version history** (number, modified timestamp, modified by), the permalink, the file binary per version, the eTag for idempotent sync, existing metadata columns, and created date and author.

**One rollout dependency to flag honestly:** stage-time analytics — how long contracts sit in legal review versus business review versus with the counterparty — requires **one Status choice column** on the SharePoint library (Draft → Legal Review → Business Review → Third-Party Review → Executed) plus an Urgent flag, maintained with discipline. Without that column the report is fiction. Agreeing and adopting it is part of the rollout.

### 6.2 Active Directory and RBAC — required from the client

| Requirement | Why |
|---|---|
| **Entra ID (AD) read access** | Employee ID, display name, email — identity for access control, obligation ownership and attribution |
| **Department / job title** | Scoping access: legal department full; named approvers and viewers outside legal get scoped read |
| **Group membership** for the legal-library access groups | Derives who may see Q-Legal at all — mirroring SharePoint's own access rather than inventing a second permission model |
| **RBAC setup** | The role-to-permission mapping agreed with the client, configured at deployment |

Access is enforced **server-side**: an account is not shown what it does not hold. SSO handles authentication — **no passwords are ever handled by Q-Legal**.

**Explicitly not required:** write or edit scopes on SharePoint, mailbox access, tenant-wide directory read, or any user credentials.

### 6.3 AI and integration keys — client provided

All API keys are provisioned, owned and funded by the client, stored encrypted at rest, with usage billed to the client's own accounts.

| Category | Options | Requirement |
|---|---|---|
| **AI / LLM** | Anthropic · OpenAI · Google Gemini · Z.AI · x.AI · DeepSeek | **Minimum one required** |
| **Vision OCR** | Any vision-capable model from the above | Required if the estate contains scanned documents |
| **Embeddings** | OpenAI · Google | Recommended for semantic search |

Every AI step runs through a **registered, gated pipeline** — provider and model switchable per step from the admin console, with no code change or redeployment. Raw document text never reaches a model outside a registered pipeline.

### 6.4 Also required from the client

1. **Corpus sample** — 50–100 real contracts, to set the OCR posture, seed the category list and validate the cost model. *No Standards work is done before real samples are in hand.*
2. **Existing contract index** (the current Excel, if one exists) — extraction ground truth, so accuracy can be stated as a number rather than asserted
3. **Frequently-used questions** from the legal team — these seed the query router and the accuracy benchmark
4. **Named operators** — who runs the repository and who confirms proposals

---

## 7. Build status and validation

Q-Legal is **built** and running on the platform, not a concept.

| Area | Status |
|---|---|
| **Repository** | Built — ingestion, registry, global search, wiki, document tree, obligations register, confirm queue |
| **Semantic layer** | Built — clause, section and document vectors with clause anchors; hybrid retrieval fused with full-text; nearest-in-estate panels; estate map |
| **Registers** | Built and live-verified — a new standing question was written and correctly answered across the estate in seconds |
| **Business rules** | Built — editable governance rules, scope-matched into every AI call, with applied rules logged per call |
| **Drafting** | Built — Standards library and draft generation with .docx export |
| **AI pipelines** | All steps registered, gated, model-swappable and logged |
| **Deployment** | Deployed and serving on managed cloud infrastructure over HTTPS with a custom domain |

**On verification honesty:** the build has been end-to-end smoke-tested and is running in production. Two defects were found only by testing on production infrastructure rather than locally — both fixed. Formal accuracy measurement against the client's own contract index is deliberately deferred until the corpus sample arrives, so the accuracy figure we quote is a measured one rather than a claim.

---

## 8. Deliberately not built

These are design decisions, taken because the existing tools do them better:

- **Workflow engine, approvals, intake forms** — SharePoint and MS Forms do this. We read the history for reporting; we do not replace the process
- **In-app collaborative editing and tracked changes** — Word is better, and no AI is wanted in a negotiation
- **E-signature and stamping** — counterparties require authenticated platforms; the existing Zoho process stays. Executed documents filed to SharePoint are ingested automatically
- **Writing drafts back to SharePoint** — download-first; write scope is a materially larger IT ask and would break principle #1

---

## 9. Commercials

### One-time build and integration fee
Covers the build described above, SharePoint and Active Directory integration, RBAC configuration, deployment into the client's cloud, integration of client-provided keys, and handover with team walkthrough.

> *Commercial figure to be inserted.*

### Support — 30 days from go-live

**Included**

- Fine-tuning and enhancing the **output quality of the current scope** — extraction accuracy, answer quality, summarisation, classification
- Tuning **business rules** — governance rules, confidence thresholds, gates
- Refining **registers, standing questions, tags and the category taxonomy**
- Adjusting **prompts and model selection** across the AI pipelines
- Defect resolution within the delivered scope
- Assistance with SharePoint sync, AD/RBAC configuration and integration keys
- Team guidance and usage support

**Not included**

Any **new functionality** — new features, new screens, new integrations, new data sources, or extensions beyond the delivered scope — is treated as a **change request or product enhancement**, subject to separate commercial alignment.

> **Making what has been built work better is support. Making it do something new is a change request.**

Items listed under §8 as deliberately not built fall under change request by definition, as does any extension beyond the delivered scope.

---

## 10. Summary of what we need from the client

| # | Dependency | Blocking? |
|---|---|---|
| 1 | **SharePoint** — Azure AD app registration, `Sites.Selected` READ on the legal library | **Yes** — no repository without it |
| 2 | **Active Directory** — read access to identity, department and group membership | **Yes** — no access control without it |
| 3 | **RBAC mapping** — agreed role-to-permission model | **Yes** |
| 4 | **Cloud tenancy** with deployment access and a managed PostgreSQL database | **Yes** |
| 5 | **AI/LLM key** — minimum one provider | **Yes** |
| 6 | **Corpus sample** — 50–100 real contracts | Shapes the build |
| 7 | **Status column SOP** agreed with the legal team | Required for stage-time reporting only |
| 8 | **Existing contract index** + frequently-asked questions | Enables a measured accuracy number |

---

*Prepared by The Kettle Black · Bespoke AI*
