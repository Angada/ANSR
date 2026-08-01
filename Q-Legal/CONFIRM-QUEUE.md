# The Confirm Queue — what's wrong and how to fix it

> A design note for Q-Legal and Contra. Nothing here is built yet.
> Written 2026-08-01 after the queue was called "uselessly floating" — which it is,
> and this explains exactly why.

---

## 1 · The critique, precisely

Today a row in the queue looks like this:

```
classification   SOW-2-Acme-Data-Migration.txt   0%
classify this document — no keyed model — classify this document manually
[ Accept ]  [ Reject ]
```

Seven things are wrong with it, and they compound:

1. **You cannot see the thing you're deciding about.** To classify a contract you must
   leave the queue, open the contract, read it, come back, and hope the row is still there.
2. **The evidence is missing.** A link proposal says *"link to parent #7"* — a database id.
   Not the document's name, not the sentence that triggered the match.
3. **The buttons don't say what they do.** Accept *what*? What changes in the product if I
   press it? Nothing on the card tells you.
4. **There is no upstream.** Nothing says which step produced this, or why it stopped and
   asked. The row appears from nowhere.
5. **There is no downstream.** Resolving it produces no visible movement. Nothing advances,
   nothing is unblocked, nothing says "good, that's now correct."
6. **Rejection teaches nothing — and worse, doesn't stick.** The sweep re-examines rejected
   documents and re-proposes the same link; a rejected classification is re-proposed on the
   next refresh. **You can reject the same thing forever.** This is the single most
   damaging defect: it turns the queue into a treadmill and quietly kills the "every
   decision teaches the system" promise the app makes on its own screen.
7. **System failures are disguised as decisions.** *"no keyed model — classify manually"*
   is not a proposal the AI is making. It is the pipeline reporting that it couldn't run.
   Putting it in the same list as genuine judgement calls, with a fake 0% confidence,
   trains people to distrust the whole queue.

At five contracts this is annoying. At the client's thousand, with roughly a hundred
arriving monthly, it is unusable — and it's the surface where the product either earns
trust or loses it, because it's the one place a lawyer is asked to do work.

---

## 2 · What the queue is actually for

It has exactly two jobs:

1. **Make the derived layer correct** — the machine proposes, a human with authority decides.
2. **Make itself smaller over time** — every decision is a label, so next month there is
   less to decide.

If job 2 isn't *visible*, job 1 feels like data entry and people abandon it. Every design
choice below serves one of those two.

Three principles follow:

> **Decide in place.** Everything needed to make the call is on the card. You never leave
> to find out what you're deciding.
>
> **State the consequence.** The card says what will be true after you press the button,
> in plain words.
>
> **A "no" is information.** Rejection captures *why*, suppresses the re-proposal, and
> tunes the rule that generated it.

---

## 3 · The card

Every decision, regardless of kind, has the same five parts:

```
┌──────────────────────────────────────────────────────────────────┐
│ WHAT WE THINK          Statement of Work · 74% confident         │
│                                                                  │
│ WHY                    "This Statement of Work is entered into   │
│                         pursuant to the Master Services          │
│                         Agreement dated 1 January 2026…"         │
│                        ── quoted from §1 of the document ──      │
│                                                                  │
│ THE DOCUMENT           SOW-2 · Acme ⟷ Kettleblack · 4 pages      │
│                        [ first 200 words, inline ]               │
│                                                                  │
│ IF YOU ACCEPT          This files under the Acme MSA. The MSA's  │
│                        terms will govern it in reviews, it joins │
│                        the Acme family, and expiry follows the   │
│                        parent unless overridden.                 │
│                                                                  │
│ [ Yes, that's right ]  [ No — something else ▾ ]  [ Skip ]       │
└──────────────────────────────────────────────────────────────────┘
```

Changes from today:

- **Evidence is quoted, not referenced.** The tell-tale sentence, the matched text, the
  first paragraph — inline.
- **Names, never ids.** "the Acme MSA", not "#7".
- **The consequence is spelled out.** This is the part that makes a non-technical user
  confident enough to press the button.
- **Three actions, not two.** "No — something else" opens the correct value directly. Today
  changing a classification is hidden *behind* Accept, which is backwards: the most common
  correction is the least accessible action.
- **Skip is explicit** and means "not now", distinct from "no". Today there's no way to
  say "I don't know" without lying.

---

## 4 · The four decisions, and their journeys

Each one gets a plain-English answer to *why am I seeing this* and *what does my answer do*.

### Classification — "what kind of document is this?"

| | |
|---|---|
| **Upstream** | C2 extraction ran and either found no type, was below the confidence bar, or proposed a type that isn't in your taxonomy yet |
| **Evidence to show** | title, parties, first 200 words, the AI's guess + confidence, the live taxonomy with counts |
| **Downstream** | the contract appears under the right filter; standing questions scoped to that type start applying to it; drafting can find it as a model; reports count it correctly |
| **Batchable** | **Yes** — "these 8 all look like SOWs, confirm all" |

### Family link — "does this sit under that?"

| | |
|---|---|
| **Upstream** | the document itself referenced a parent ("pursuant to the MSA dated…") — never topic similarity alone |
| **Evidence to show** | **the tell-tale sentence, quoted**, both documents by name, the parties on each |
| **Downstream** | the doc tree; the parent's terms govern in review; the family card appears on both pages; "what governs this?" resolves |
| **Batchable** | Partially — same parent, several children |

### Lineage — "is this signed PDF the same contract as that draft?"

| | |
|---|---|
| **Upstream** | 85%+ text overlap between two different documents |
| **Evidence to show** | the similarity, **a diff of what actually changed**, both names and dates, which one is executed |
| **Downstream** | the two merge into one version rail; the executed version becomes authoritative; duplicate obligations collapse |
| **Batchable** | No — each needs looking at |

### Removal — "this file is gone from the source"

| | |
|---|---|
| **Upstream** | the scan didn't see it, in a delta or a full walk |
| **Evidence to show** | when last seen, who last modified it, what it was, what still points at it |
| **Downstream** | leaves the active estate; obligations dismissed; **the record and its history are kept, never deleted** |
| **Batchable** | Yes — a deleted folder produces many at once |

---

## 5 · Structure: three zones, not one list

Rename it **"Needs you."** *Confirm queue* names the mechanism; this names the person's
relationship to it — and it already matches the "Needs your eye" prompt on the Ask screen.

**Zone 1 · Decisions** — grouped by kind, not by time. Answering twelve classifications in
a row is a rhythm; alternating between a classification, a lineage match and a removal is
twelve context switches. Within each group, order by *consequence* — a proposal affecting a
live contract with obligations outranks one on an expired NDA.

**Zone 2 · Blocked** — system problems, separated out and never dressed as decisions.
*"14 documents have no real classification because no model is configured."* One line, one
fix button, not fourteen fake proposals at 0% confidence.

**Zone 3 · What your decisions changed** — the learning ledger, and the reason the whole
thing isn't a treadmill:

> *This month you made 38 decisions. Classification confidence rose from 71% to 88%.
> The AI proposed 22 fewer items than last month. Three of your corrections became
> standing rules.*

Without Zone 3 the queue is data entry. With it, it's visibly compounding — and people will
do data entry that visibly compounds.

---

## 6 · The fix that matters most: make "no" stick

This is a real defect, not a UX preference.

- `sweep/families` re-examines any document whose confirms are all `status <> 'rejected'` —
  so a rejected link is eligible again on the next sweep.
- classification re-proposes whenever no **open** row exists — a rejected one qualifies.

So today you can reject the same proposal indefinitely. Required behaviour:

1. **A rejection is remembered against (document, kind, proposed value).** That exact
   proposal is never made again.
2. **A rejection carries a reason** — *wrong parent · not that type · these aren't the same
   contract · the tell-tale is misleading* — recorded as a learning label.
3. **The same reason twice across different documents becomes a candidate rule**, surfaced
   in Business Rules for a human to promote. That is the promotion ladder actually working,
   rather than being described in a document.
4. **The generating step is told.** If linking is rejected for "topic similarity isn't
   enough" three times, the linker's operating rule tightens.

---

## 7 · Contra has the mirror-image problem

Q-Legal has **decisions without context**. Contra has **context without consequence**.

Contra's review page shows everything — the contract, the verdicts, the evidence, the
findings. But `POST /review/:id/action` with accept/reject on a section only writes a row to
the change timeline. It doesn't alter the review, doesn't resolve the finding, doesn't
suppress it on the next contract of that archetype, and doesn't teach the archetype
anything. **It is a comment log wearing the clothes of a decision.**

What Contra needs, using the same three principles:

- **Accepting a finding should resolve it** — the finding is marked handled and drops out
  of the outstanding count; the report reflects it.
- **Rejecting a finding should teach the archetype.** "This liability cap is fine for this
  counterparty" rejected three times across the same archetype is the archetype's rule
  being wrong. Surface it: *"you've dismissed this check 3 times — soften or remove it?"*
- **Archetype detection is already a proper confirm step** (proposal + confidence + a human
  pick) — it is the model the rest should follow.
- **Redlines need the same treatment** — accept/reject per proposed change, with rejections
  feeding the archetype's preferred language.

Once both apps do this, they share one shape: *propose → show evidence → decide → the
decision changes something and teaches something.* That shape is a component, and it should
be extracted alongside Canon rather than written twice.

---

## 8 · What to build, in order

Ordered by (damage removed ÷ effort), not by ambition.

| # | Change | Why first |
|---|---|---|
| 1 | **Make rejection stick and carry a reason** | It's a genuine defect; everything else is cosmetic while the queue can re-ask the same question forever |
| 2 | **Move system failures out into "Blocked"** | Removes the fake 0%-confidence rows that poison trust in the whole surface |
| 3 | **Put evidence and consequence on the card** | Turns a row you can't act on into one you can, without leaving |
| 4 | **Three actions, with "something else" first-class** | The most common correction stops being hidden behind Accept |
| 5 | **Group by kind; order by consequence** | Makes a hundred-item queue answerable in one sitting |
| 6 | **Batch confirm where evidence is homogeneous** | The only way classification survives a thousand contracts |
| 7 | **The learning ledger (Zone 3)** | Converts a chore into visible compounding — the reason anyone comes back |
| 8 | **Contra: make accept/reject consequential** | Same engine, second app, and it proves the shape generalises |

Items 1–2 are small and would remove most of the harm. Items 3–5 are the redesign proper.
6–8 are what make it hold at the client's scale.

---

## 9 · The test it has to pass

A lawyer who has never seen the system opens **Needs you**, and without asking anyone or
opening another screen:

- understands what is being asked and why it was asked,
- can see the evidence behind the proposal,
- knows what will be true after they answer,
- answers a dozen of them in a few minutes,
- and can see that last month's answers made this month's list shorter.

If any of those five fails, it's still floating.
