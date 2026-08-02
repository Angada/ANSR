# RayDar — Talent Trend Radar
### Proposal · content intelligence for Talent500

---

## 1. Objective

Talent500 publishes for a demanding, fast-moving audience: Indian job seekers and GCC technology talent. Today, deciding **what to publish** depends on individual judgement, scattered research and a handoff chain across Content, SEO and Design that lives in inboxes and spreadsheets.

RayDar's objective is narrow and deliberate:

> **Tell the content team what to publish this month, show the evidence for why, and carry each idea through to a briefed, owned, dated piece of work — without taking the craft away from the writers.**

RayDar proposes and briefs. It does **not** write the finished piece. That boundary is intentional and it is not a limitation — auto-written content is low quality, and the editorial voice is the asset.

---

## 2. Goals

| # | Goal | What "done" looks like |
|---|---|---|
| 1 | **Replace the blank page** | Every month starts from ranked, evidenced topics rather than a brainstorm |
| 2 | **Make demand visible** | Each idea carries what the audience is asking, how loudly, and what already answers it |
| 3 | **Respect existing SEO work** | RayDar reads the research SEO already produces — it does not duplicate their tooling |
| 4 | **Make the handoff real** | A topic becomes an owned, dated brief with a named writer, not an inbox message |
| 5 | **Leave an audit trail** | Every decision — machine or human — is recorded and reviewable |
| 6 | **Stay self-service** | Themes, rules, weights and search terms are edited in the app, never by a developer |

---

## 3. How it works

RayDar runs two lanes over the same data. Teams use whichever suits the week.

### Lane 1 — The Sweep (fast: ideas in minutes)

**Step 1 · Arm the feeds.** The team selects the content themes to hunt. Three demand sources can be combined:

- **Trend Spotting** — the themes themselves, each carrying its own search terms
- **SEO Inputs** — keyword or competitor research pasted or uploaded
- **TalentMind** — demand read from candidate profiles *(Phase 2 — see §8)*

A free-text brief can steer any sweep (*"focus on people who were just laid off"*).

**Step 2 · Collect.** RayDar queries YouTube and Reddit with each theme's search terms, pulling videos, view velocity, comment trees and discussion threads. Items outside the audience guardrails — wrong language, Shorts, memes — are **dropped at collection with the reason recorded**, not silently filtered.

**Step 3 · Classify.** Each item is tagged to a theme, routed to a 1Up sub-series, scored across four emotional registers (FOMO · Anxiety · Optimism · Ambition), and reduced to the underlying question in the candidate's head. Comment trees are weighted heavily — that is where genuine feeling sits.

**Step 4 · Measure the gap.** Demand (unanswered questions) is measured against supply (what already exists, and how stale). Each theme is classified as *unanswered*, *stale*, *thin*, *wrong* or *emerging*.

**Step 5 · Ideate.** For each strong demand-supply gap, RayDar writes a **heading and a topic guide** — the take, the beats to cover, the register to hit, the proof points. Never the finished article.

**Step 6 · Rank.** A composite score orders every idea:

```
0.35 × gap  +  0.25 × velocity  +  0.20 × strategic weight  +  0.20 × historical acceptance
```

All four weights are editable in the app. The breakdown is shown on every idea.

### Lane 2 — The Journey (tracked: idea to published work)

Where the sweep ends at an idea, the Journey carries it to publication through six stations, each with a named owner and a human gate.

| Station | Owner | What happens | Gate |
|---|---|---|---|
| **01 Radar** | Content | Candidate topics from the sweep | — |
| **02 Shortlist** | Content | Keep · Refresh · Merge · Park · Kill. Add topics the radar missed | Only Keep/Refresh advance |
| **03 Dump** | SEO | SEO drops in the research they already produced | Confirm uncertain matches |
| **04 Brief** | SEO | The full content brief, assembled and editable | Approve to release |
| **05 Assign** | Content | Writer and due date | Mark done |
| **06 Live + Learn** | SEO | Published URL captured; performance feeds ranking | — |

**The interface guides rather than presents.** A prominent strip names the single next action and places the button on it. Explanations of *why a step exists* and *what the AI is doing* are available but folded away, so the tool leads with work, not reading.

---

## 4. Two design decisions worth stating plainly

### RayDar does not do keyword research

SEO already performs demand validation in professional tooling. Rebuilding that badly inside RayDar would waste licence spend and produce worse numbers.

Instead, **station 03 reads what SEO already made.** Drop an Ahrefs or Semrush export, a Search Console download, a SERP snapshot, a People-Also-Ask list, even a PDF audit — untidied. RayDar identifies the format, extracts typed rows (keyword, volume, difficulty, intent, position, URL) and attaches them to the correct topic.

**Recognised formats are parsed by rules — instantly, with no AI call and no token cost.** Only a genuinely new export format costs a single model call, and what it learns is stored so that format is free from then on. Anything it cannot confidently attach is presented for a human decision rather than guessed.

*Validated: Search Console and Ahrefs exports both parse deterministically with zero model calls; unstructured text degrades safely without data loss.*

### Themes are described, not configured

The content team never writes search syntax. They describe a theme in their own words —

> *"Resume tips and fixes — framing over content. How the resume is structured and worded, and the keywords that get it read."*

— and RayDar compiles that into the operational logic: the search terms fired at YouTube and Reddit, the sub-series it routes to, the emotional registers it usually carries, and what must *not* be collected under it. **Every field is proposed, then confirmed by a human before it saves.** The configuration remains the client's.

---

## 5. Outcomes

**For the Content team**
- A ranked, evidenced monthly slate instead of a brainstorm
- Every idea already routed to the right 1Up sub-series with a format recommendation
- Ideas leave the working list as they are judged, so the list shortens as work progresses
- A permanent library, filterable by outcome, rejection reason, journey stage and sweep

**For the SEO team**
- Existing research is consumed rather than repeated
- Briefs assembled from that research, editable before release
- A dated, owned handover artifact instead of an inbox thread

**For leadership**
- Visibility of what is stuck, with whom, and for how long
- A complete audit trail on every topic — who moved what, when, from what to what
- Explainable output: every idea shows its score breakdown, its sources with links, and a step-by-step trace of how it was produced
- A learning loop: rejections and published performance feed future ranking

**A note on honesty of output.** Where RayDar lacks grounding, it says so rather than inventing. If no feed keys are live it labels the run *LLM-only*. If a research dump contains no search volumes, the brief shows none rather than estimating. Dropped items show their drop reason. This is deliberate — an intelligence tool that quietly guesses is worse than none.

---

## 6. Build, deployment and access

### Deployment
Deployed into the **client's own cloud tenancy**. Application plus managed PostgreSQL database. The client retains full ownership of infrastructure, data and running costs.

### Access management
User access is governed by the **client's Active Directory**. Role-based visibility is enforced server-side: an account sees only the applications it holds — restricted roles are not shown that other modules exist, and access is blocked at the route level, not hidden in the browser.

### Keys and integrations — client provided (BYOK)
All API keys are provisioned, owned and funded by the client, stored encrypted at rest. Usage is billed to the client's own accounts.

| Category | Integrations | Requirement |
|---|---|---|
| **AI / LLM** | Anthropic · OpenAI · Google Gemini · Z.AI · x.AI · DeepSeek | **Minimum one required** |
| **Feed / demand** | YouTube Data API v3 · Reddit · Google News · SerpApi | Strongly recommended |
| **Research** | Serper · Tavily · Perplexity · Exa · Brave Search | Optional |
| **Validation** | Google Fact Check · Wikidata | Optional |

Every AI step runs through a **registered, gated pipeline** — provider and model are switchable per step from the admin console, with no code change or redeployment. Raw user text never reaches a model outside a registered pipeline.

> **Dependency to note:** RayDar's quality is bounded by its feed. Without a live YouTube key, ideas are generated by the model without real audience grounding. Provisioning that key early is the single highest-impact client action.

---

## 7. Build validation

The following has been built and verified:

| Area | Verification |
|---|---|
| **Data layer** | Every journey database operation exercised against a live database — 27 of 27 passing |
| **Schema** | All migrations idempotent; verified to re-apply cleanly across repeated restarts without data loss |
| **Dump reader** | Proven on Search Console and Ahrefs exports (deterministic, zero model calls) and on unstructured input (safe degradation) |
| **Taxonomy** | Client content structure verified to persist across restarts |
| **Access control** | Role-based visibility confirmed across all three account types |
| **Pipelines** | All AI steps registered, gated and model-swappable from the admin console |
| **Audit trail** | Append-only event log; entries cannot be edited or removed |
| **Deployment** | Deployed and serving on managed cloud infrastructure with a custom domain over HTTPS |

---

## 8. Scope boundaries

**Included**
- Both lanes — the sweep and the six-station journey
- Theme management, business rules, ranking weights, guardrails — all editable in-app
- Research dump ingestion with format learning
- Brief generation, review workflow, audit trail, library and archive
- Admin console: AI pipelines, integrations, key vault, accounts
- Deployment into the client's cloud, with AD-governed access

**Not included**
- **Content drafting** — RayDar briefs ideas; humans write the copy
- **TalentMind** (demand derived from candidate profiles via the Talent500 platform) — **Phase 2**
- **Search Console / Analytics connectors** — the published-performance loop currently accepts manual entry
- Automated publishing or scheduling to social platforms or a CMS
- Hindi or regional-language collection — English / India only
- Paid keyword-planner or advertising automation
- API provisioning, usage costs and rate-limit quotas (client-owned)

---

## 9. Commercials

### One-time build and integration fee
Covers the full build described above, integration of client-provided keys, deployment into the client's cloud, Active Directory access configuration, and handover with team walkthrough.

> *Commercial figure to be inserted.*

### Support — 30 days from go-live

**Included in support**

- Fine-tuning and enhancing the **output quality of the current scope**
- Tuning **business rules** — ranking weights, guardrails, gates, thresholds
- Refining **themes, search terms and routing**
- Adjusting **prompts and model selection** across the AI pipelines
- Defect resolution within the delivered scope
- Assistance with integration keys and configuration
- Team guidance and usage support

**Not included in support**

Any **new functionality** — new features, new screens, new integrations, new data sources, or extensions beyond the delivered scope — is treated as a **change request or product enhancement** and is subject to separate commercial alignment.

The distinction is simple:

> **Making what has been built work better is support. Making it do something new is a change request.**

Phase 2 items listed in §8 fall under change request by definition.

---

## 10. What we need from the client

1. **Cloud tenancy** with deployment access, and a managed PostgreSQL database
2. **API keys** — minimum one LLM provider; YouTube Data API and Reddit credentials strongly recommended
3. **Active Directory** integration details and the user/role mapping
4. **Brand inputs** — content series and sub-series, theme descriptions, and audience voice guardrails *(sensible defaults ship; all editable in-app)*
5. **Named operators** — the Content and SEO users who will run the sweep and review output

---

*Prepared by The Kettle Black · Bespoke AI*
