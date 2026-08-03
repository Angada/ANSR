# RayDar output baseline — 03-08-2026

**Why this exists.** The ideas RayDar produces right now are good. Several planned
changes touch the prompts that produce them, and prompt edits degrade output
quietly — there is no error, the writing just gets worse. This folder is the
before-picture, so "did that change make it worse?" is answerable instead of
a matter of opinion.

## What's here

| File | What it is |
|---|---|
| `prompts-2026-08-03.json` | The exact prompt, provider and model of all 7 RayDar AI steps, as of the last known-good output |
| `golden-ideas-2026-08-03.json` | 36 real ideas from batches **19** and **3** — headings, summaries, registers, gap types, scores and score breakdowns |

Batch 19 (18 ideas, avg score 0.574) and batch 3 (18 ideas, avg 0.507) were
chosen because they are the largest batches carrying human acceptance — a
`used` or `saved` verdict — so they reflect taste, not just volume.

## How to use it before changing any prompt

1. **Restore point.** `prompts-2026-08-03.json` holds the current prompt text
   verbatim. If a change makes things worse, paste the old prompt back in
   Admin → AI & Pipelines. It applies to the next run — **no deploy needed**.
2. **Change one thing.** Especially: never alter the JSON output contract of
   `feedstory-generate`. Everything downstream — cards, filters, scoring, the
   Library — reads those fields.
3. **Re-run the same demand settings** as the golden batch, then compare against
   `golden-ideas-2026-08-03.json`:
   - Are headings still specific, or have they drifted generic?
   - Is the emotional register still a short label, not a paragraph?
   - Are `why_now` justifications still grounded in the feed?
   - Has the score distribution moved without the inputs changing?
4. **If it's worse, revert.** Seconds, from the UI.

## Which planned changes can affect output

**Only one.** Of the nine outstanding items, eight cannot change a word of the
output — they are error handling, reporting, config UI and layout. The single
exception is writing the Content Series voice (1Up = punchy listicle, Way Up =
documentary) into `feedstory-generate`.

Do the safe eight first. Treat that one on its own, against this baseline.

## Worth building next

A real regression benchmark: a handful of saved demand-setting inputs with their
known-good outputs, re-run automatically after any prompt change, so drift
becomes a number rather than a feeling. Q-Legal uses this pattern already
(~50 labelled query→expected-§ pairs; a regression blocks the change). Static
snapshots like this one catch an obvious break; only a benchmark catches slow
decay.
