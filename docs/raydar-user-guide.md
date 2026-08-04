# RayDar — how to use it

*Talent Trend Radar · qansr.thekettleblack.in*

RayDar tells you what to publish. It reads what job seekers are watching, asking
and complaining about, and gives you ranked ideas with the evidence behind each
one. It briefs; your writers write.

---

## Running a sweep

**1 · Demand Setting.** Pick **one content series** — 1Up, Skill Up, Interview
Lab or Resume Lab. One at a time. Then fine-tune the themes beneath it; **one
theme gives the sharpest result**, because the whole search budget goes to a
single subject rather than being thinned across twelve.

Optionally paste SEO research into Feed 02, or add a line in *Your brief*
("focus on people who were just laid off"). Press **Run the sweep**.

**2 · Sweep.** Where it lands when it finishes — the evidence. See below.

**3 · Content Ideas.** Each idea has a title, the angle and the justification.
Mark it **Used**, **Save** or **Reject** (with a reason) and it drops into a
*done* drawer, so the list shrinks as you work.

---

## Reading the Sweep page

This is the part worth learning. It answers *why do these ideas look like this?*

**What went into this sweep** — the themes armed, the exact search terms fired
at YouTube and Reddit, any research pasted, and your brief. If the ideas feel
off, the terms are usually why.

**What the feed returned** — collected, kept, filtered, repeats. Every dropped
item shows its reason (too short, wrong language, off-topic, blocked channel).
Nothing disappears silently.

**Repeats, hidden not removed** — a video surfaced by an earlier sweep is set
aside rather than shown again, so the same clip doesn't headline three months
running. It stays listed under *repeats* with a link, so nothing is lost — the
first sighting simply stays the record.

**Cached searches** — a term searched in the last 24 hours is served from cache
and costs no quota. Cache hits are labelled, so a fast free sweep can't be
mistaken for a broken one.

**Gap analysis** — the heart of it. Per theme: how many questions people asked
versus how much content already answers them, and **the real questions, quoted
from the comments**. A high gap with unanswered questions underneath is the
strongest signal to publish.

**Why these ideas scored what they did** — the four numbers in plain English:

| | |
|---|---|
| **Gap** | demand vs supply — is anyone answering this? |
| **Velocity** | how fast the conversation is moving |
| **Strategic** | how much the theme matters to you — your setting, not the internet's |
| **Historical** | how often you've accepted ideas here before |

---

## The other tabs

**Batches** — every sweep, revisitable. Also where you purge old ones (it
previews first, and never deletes a sweep holding an idea you marked Used or
Saved).

**Library** — every idea ever generated. Filter by what you decided, why you
rejected it, series, or sweep.

**Settings** — the dials, no developer needed: look-back window, videos per
term, minimum length and views, blocked channels, allowed languages, ranking
weights.

**⚙ edit concepts** — describe a theme in your own words, press **✨ Work out
the logic from this**, and RayDar proposes the search terms. You confirm before
anything saves.

---

## Two things to know

**Quota.** A YouTube search costs 100 units against 10,000 a day — roughly a
dozen sweeps. Re-running a theme within 24 hours is served from cache, free. If
the allowance runs out the page says *"youtube — out of quota"* rather than
showing an empty result.

**It tells you when it can't.** No feed keys means the run is labelled
*LLM-only*; dropped items carry reasons; a sweep producing nothing explains why.
A silent empty page is a bug worth reporting.

---

## What's wired for later

RayDar already runs through a gated integration layer, so more sources can be
switched on without a rebuild — each is a key and a toggle:

- **Reddit** — comment threads, where the honest questions live. The richest
  demand signal available, and often blunter than YouTube.
- **Google Fact Check + Wikidata** — verify claims before an idea reaches a
  writer, so nothing goes out on a shaky premise.
- **News + Google Trends** — timing. Whether a theme is rising or already peaked.
- **Research APIs** (Tavily, Serper, Perplexity, Exa, Brave) — grounded evidence
  and cited sources attached to each idea, and contradiction checks that flag an
  idea arguing against what the field already knows.

Each one sharpens a different part of the same loop: **Reddit and News sharpen
what to write about, fact-check and research sharpen whether it's right, and
Trends sharpens when to publish.** Turning them on is a Settings change, not a
development cycle — worth adding once the team has a rhythm and knows which
signal it trusts.
