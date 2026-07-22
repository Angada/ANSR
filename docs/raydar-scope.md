# RayDar — Scope of Work
*Talent Trend Radar · monthly content-intelligence tool*

## 1. What it is
RayDar tells you **what to publish each month**. It reads what your audience (Indian job
seekers / GCC-tech talent) is actually searching, watching and complaining about, and
produces a **ranked list of briefed content ideas** — each routed to the right 1Up
franchise, with the evidence for why it will land. Output = **ideas + briefs (heading +
topic guide), not finished content** — writers pick them up.

## 2. How it works (the "sweep")
Every step is editable in-app, no code/deploy:
1. **Hunger — where demand comes from.** Two routes live: **Trend Spotting** (pick the demand
   concepts — editable) and **SEO Inputs** (paste keyword / GSC / competitor research), plus
   a free-text brief. A third route — **TalentMind** (seed Hunger from each talent's own
   profile via the **Talent500 integration**) — is a **later phase**.
2. **Collect** — driven by the **SEO + Trend Spotting inputs**: pulls fresh YouTube videos
   (views + comments) and Reddit posts (comment trees) per each concept's editable search
   terms; optional News/Trends.
3. **Classify** — an LLM tags each item: demand topic, **1Up franchise routing**, emotional
   register, and the underlying question. Routing every idea to the right **1Up** (Skill Up,
   Stack Up, Pay Up, TrAIbe × Accelor…) is what makes the output usable, not just interesting.
4. **Ideate** — an LLM writes each idea (heading + topic-guide brief), grounded in the feed +
   research, under **editable guardrails** (audience · India-English voice · never finished copy).
5. **Rank** — a composite score (demand strength · velocity · strategic weight · historical
   acceptance; **weights editable**) orders the ideas.
6. **Review** — Used / Saved / Rejected(+reason) / Edit / build; feedback improves future
   ranking. Each idea has a **trend report** above it and an **explainable-AI "why"** popup.
   Every batch + all ideas are archived (Batches + Library).

## 3. Integrations / APIs
All keys are **BYOK (bring-your-own-key)**, stored encrypted; every call is gated and
configurable per source in **Business Rules** (query params · prompt · model · on/off · how
many results per channel).

- **AI / LLM — required (min. one):** Anthropic (Claude), Z.AI, OpenAI, Google Gemini,
  x.AI, DeepSeek — one anthropic-compatible layer; model swappable per skill.
- **Feed / demand — recommended:** YouTube Data API v3, Reddit (app id + secret);
  optional NewsAPI/GNews, SerpApi (Trends/News).
- **Research / validation — optional (evidence + contradiction checks):** Tavily, Serper,
  Perplexity, Exa, Brave Search, Google Fact Check, Wikidata.

> Without feed/research keys RayDar still produces **real LLM ideas** (grounded in the
> concepts + your brief); demand signals then show as "config" rather than "live".

## 4. What we need from the client
- **AWS hosting project + admin access** — to deploy and run the service. **Database: Postgres.**
- **API keys** for the integrations you want live: an LLM provider key (min. 1), a YouTube
  Data API key, Reddit app credentials, and any research/news keys. **The client owns and
  funds these keys** — API usage is billed to the client's own accounts.
- **User access** — the operator(s) who run the sweep and review ideas.
- **Brand inputs** — 1Up franchise names + routing, demand concepts + seed search terms,
  and the audience/voice guardrails (all editable in-app; we ship sensible defaults).

## 5. Exclusions (not in scope)
- **No live TalentMind** (audience-from-profiles / Talent500 integration) — **Phase 2 only**.
- **No SSO / enterprise identity** (SAML/OAuth) — single admin login only.
- **No RBAC / multi-tenant / audit-grade access control** beyond the single admin.
- **No Hindi / regional-language** collection or content — English / India only (v2 item).
- **No content drafting** — RayDar briefs ideas; humans write the final copy.
- **No automated publishing / scheduling** to social or CMS.
- **No paid keyword-planner / ad automation** — SEO research is pasted in (or via SerpApi).
- **API provisioning, usage costs and rate-limit quotas** are the client's (BYOK).
