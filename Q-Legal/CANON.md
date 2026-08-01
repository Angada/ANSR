# CANON — the document-intelligence component

> **Legal Canon** is the first edition. **Sales Canon**, **Product Canon**, **Project Canon**
> are the same component with a different vocabulary. One engine, many canons.
>
> Status: the engine is **built and running in production** inside Q-Legal. This document
> describes what it is so it can be lifted out as a reusable component.
> Extraction has NOT started — by decision, it begins only after Q-Legal is tested on a
> real corpus.

---

## The idea in one paragraph

You have a pile of documents. They are the truth of your business, and they are unusable —
nobody can answer a question about all of them at once. **Canon turns that pile into an
authoritative body you can question.** It never touches your originals. It reads each one
properly, writes down what it found, indexes it three ways, and then answers questions in
plain English with a citation for every claim. A new document arriving tomorrow joins the
canon automatically. A correction you make today is remembered forever.

---

## The five layers

Each layer is derived from the one below it, and **every layer is rebuildable from the
originals**. Nothing here is precious. If you delete the whole derived stack, one sweep
puts it back.

### 0 · The original — the authority, never read by a model
The file itself, snapshotted into a vault. It is the thing you cite, the thing that wins
any dispute, and the thing no model is ever fed. The source of truth (SharePoint, a
folder, a bucket) is **read-only by construction** — the component holds no write scope,
so it cannot alter your documents even through a bug.

### 1 · C1 — the comprehensive read
A faithful, complete transcript. Every heading, clause, table cell, number and date, in
reading order. Born-digital files use their exact text layer (free and lossless); scanned
or image-only pages route to a vision model that preserves tables and describes what the
text layer flattens. **C1 never summarises.** It is the deep substrate everything above it
is built from and falls back to.

### 2 · C2 — the concise key, and the two wikis
Read once from C1, so nothing above ever re-reads the original:
- **The facts** — title, type, parties, dates, value, governing law, and so on.
- **The contents wiki** — the document's own structure, so you can navigate it without
  reading it.
- **The clause wiki** — every section with its topic and a one-line gist.

This is what makes an estate *fast*: most questions are answered here, across every
document, without opening a single file.

### 3 · Registers — "the C2 you define"
C1 and C2 are fixed and universal. A **register** is a standing question *you* write once,
in plain English — *"does this require notice on a change of control, and in how many
days?"* — which is then answered for **every document in the corpus**, with evidence,
and answered automatically for every document that arrives afterwards.

This is the answer to "but they could ask anything." You don't predict the questions. The
team adds them as they arise, and each one becomes a permanent, sortable column across the
whole body. A human correction to any answer is authoritative and is never overwritten.

### 4 · The vector spine — meaning, not words
Every document is embedded at **three granularities**, each carrying its section anchor:

| Granularity | What it is | What it powers |
|---|---|---|
| **document** | the key facts + summary | "nearest in the estate", the map, dedup, families |
| **section** | a heading plus what sits under it | thematic questions |
| **clause** | **the real clause text**, located in C1 by its anchor | precise retrieval, clustering, benchmarking |

**The grounding rule: a vector hit is only ever a pointer to a real section.** It locates;
it never asserts. Every answer still cites the document and the section, and you can click
through to the original.

---

## How embeddings actually work here

**What gets embedded.** Not the file, and not a summary of a summary. For each clause the
engine finds its section anchor inside the C1 transcript and embeds the *actual clause
body*, with the label and gist kept as a short prefix for context. Where an anchor can't be
located (an odd numbering scheme, a poor scan) it falls back to the gist — and **records
which**, so the coverage panel can show you exactly where the index is thin.

**Which model.** The embedding model is a named, gated, swappable pipeline. Every stored
vector records the model that wrote it, and **retrieval never compares vectors across
models**. Swap the model in settings and the estate re-embeds on the next sweep; both
generations coexist until cutover. With no key at all, the spine still runs on a
deterministic key-free embedding — weaker, free, and it never blocks the product.

**Staying fresh — the part that is easy to get wrong.** A document is re-embedded when:
- it has no vectors under the current model, **or**
- its vectors point at an older version, **or**
- its vectors predate the document's last update (correcting a fact changes its vector), **or**
- the **chunking recipe** changed — we changed *what we feed the model*, not the model.

That last one is the subtle one. Change how you chunk and every existing row is still
technically "fresh" while being quietly wrong. The recipe version is what catches it.

**Retrieval is hybrid, always.** Three signals — structured facts, word search, and
vectors — are fused by reciprocal rank. Words catch the exact term. Vectors catch the
paraphrase. Fusing them beats either alone, and the citation always survives.

> **The proof:** ask *"can we end the agreement early without giving a reason."* Not one of
> those words appears in the clauses. Every termination-for-convenience section in the
> corpus comes back, each with its citation.

---

## What you can do with it

**Ask, as a retrieval ladder.** One box, plain English, conversational. It climbs from
cheapest to deepest and only as far as the question needs:

```
1. registers + facts     — structured, covers EVERY document, instant
2. vectors               — the closest sections by meaning
3. contents/clause wikis — of the documents that matched
4. C1 deep text          — of the closest few
5. the original          — cited as authority, never fed to a model
```

It tells you which rungs it climbed. When it can't answer, it says exactly what is missing
and offers to make it a standing question — it does not guess.

**Search** — one field, words and meaning at once, snippets and section pointers.

**The map** — every document as a point in meaning-space. Kinds cluster; outliers are
visible. **The emergent library** — the corpus's own sections clustered by meaning, where
the centre of a cluster is your de-facto standard position and the far edge is the
non-standard drafting. Nobody defines these; they emerge.

**Nearest in the corpus** — *"what did we agree last time with someone like this?"*

**Coverage** — for any document, exactly what the index holds: the chunks, how many carry
full text versus summary only, whether it is current, and which sections never made it in
and are therefore invisible to search. **The only honest way to see your own blind spots.**

**Drafting** — describe what you need; the corpus proposes the best documents to model it
on (by meaning, not keyword); draft one comes out structurally complete, because the
skeleton comes from your own precedents rather than from remembering to ask.

---

## The rules that make it trustworthy

1. **Never write to the source of truth.** Enforced by construction, not by policy.
2. **No naked claims.** Every answer cites document → version → section.
3. **Propose, never decide.** Classifications, links and lineage are proposals in one
   confirm queue until a human accepts. Every decision becomes a training label.
4. **Corrections are permanent.** A corrected value is authoritative and is never
   re-overwritten by the extractor.
5. **Every model call is a named, gated, logged pipeline** with your editable operating
   rules injected at call time.
6. **Everything derived is rebuildable**; human confirmations live separately and replay.

These are properties of the code, not switches — which is why the settings screen states
them as facts rather than offering toggles that would be lies.

---

## Making it a different canon

The engine is already domain-neutral. What is legal-specific is thin:

| Legal Canon | Sales Canon | Project Canon |
|---|---|---|
| clause, section, counterparty | offer, account, prospect | deliverable, phase, owner |
| MSA · SOW · NDA · amendment | proposal · quote · order · renewal | brief · spec · plan · retro |
| "notice on change of control?" | "what discount was approved?" | "what did we commit to, and when?" |
| draft from precedent contracts | draft from winning proposals | draft from past project plans |

Swap the vocabulary, the taxonomy and the seeded standing questions. The five layers, the
vector spine, the ladder, the confirm queue and the learning loop are unchanged.

**The one genuinely new build for a mixed corpus** (a deck, a contract, a launch plan and a
retro all about the same project) is the **master wiki**: today the map and the library
organise by document *kind*, and a project corpus wants organising by *phase* and a
cross-document timeline. That is the real work in a general edition — worth scoping only
once the legal edition has been proven on a real corpus.
