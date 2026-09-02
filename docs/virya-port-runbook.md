# Virya Port Runbook

Sixteen fixes found by auditing QAnsr's Q-Legal and Contra, written so another codebase can apply them.

Each step is **CHECK** (does Virya have this) → **VERIFY** (prove it) → **EXECUTE** (the change).

**Interface work is excluded** — Virya has its own design. What follows is logic, schema, gates and behaviour. Every step has been applied and verified in QAnsr; none is theoretical.

Source: QAnsr @ `Q-Ansr-tx`, 2 September 2026. Web version: https://claude.ai/code/artifact/e778de8f-4c58-4731-9eb3-66e9c62faae2

---

## Before step 1

**Never run a CHECK against migration files.** Migrations are a diff history, not a state. Every check below runs against the live database or the running app. If you cannot get a real connection, mark the step unrun — do not infer.

**Do the whole CHECK column first.** Some of these will not exist in Virya, and step 1 makes every other gate decorative until it lands.

---

# Group A · Gates

Until these hold, nothing downstream is enforced.

## 01 · The auth gate matches lowercase; the router doesn't — CRITICAL

Express routes case-insensitively by default. If your gate tests paths with `startsWith()` against lowercase literals, every one of them is bypassable by shouting the path.

**CHECK** — sign in as your *least* privileged account, ask for something it should not have, twice:
```bash
curl -s -o/dev/null -w '%{http_code}\n' -b "$COOKIE" $BASE/api/config
curl -s -o/dev/null -w '%{http_code}\n' -b "$COOKIE" $BASE/API/config
```

**VERIFY** — two different numbers is the bug. Confirm the mechanism on your own Express version:
```js
const app = require("express")();
app.use((req,res,next)=> req.path.startsWith("/api/x") ? res.status(403).end() : next());
app.get("/api/x", (_q,r)=> r.send("reached the handler"));
app.listen(3999);
// curl localhost:3999/api/x  -> 403
// curl localhost:3999/API/x  -> reached the handler
```

**EXECUTE** — normalise once, at the top of the gate function *and* in the middleware. Do not normalise per call site; that is how one gets missed.
```js
function allowedFor(acct, rawPath) {
  const path = String(rawPath || "").toLowerCase();
  // ...every startsWith() below now tests `path`
}
```
Re-run for all accounts and all admin-only prefixes. Both casings must return the same code, and your privileged account must be unaffected.

## 02 · A disabled AI pipeline still calls the provider — CRITICAL

**CHECK** — read what the model-picking function does when the gate returns its disabled sentinel. In QAnsr it returned `"hash:v1"`, which was filtered out of the candidate list, leaving hardcoded OpenAI fallbacks that ran anyway.
```bash
grep -n "FALLBACK\|fallback" server/*vector* server/*embed*
```

**VERIFY** — disable the pipeline in admin, run one ingest, read the AI log. A provider row means the gate is decorative.
```sql
select pipeline, provider, model, status from ql_log order by created_at desc limit 5;
```

**EXECUTE** — check the gate *before* anything else and return immediately:
```js
const gate = loadConfig().pipelines["qlegal-embed"];
if (!forceModel && gate && gate.enabled === false) {
  // log it, then return the key-free path — do NOT fall through
  return { model: "hash:v1", vectors: texts.map(hashEmbed) };
}
```

## 03 · A second provider table that drifted from the registry — CRITICAL

**CHECK**
```bash
grep -rn --include="*.js" -E "api\.openai\.com|api\.anthropic\.com|generativelanguage|api\.z\.ai" server lib \
  | grep -v "server/ai.js"
```
Every hit outside your one transport module is a candidate. In QAnsr, `vision.js` sent Z.AI to the pay-as-you-go wallet while the registry routed it to the subscription endpoint; the wallet answered 429 and the failover finished the job on Anthropic's account.

**VERIFY** — if the module's host for a provider differs from `config.providers[p].baseURL`, they have drifted.

**EXECUTE** — the registry owns the endpoint. The wire protocol is not the test; the **host and the key** are.
```js
const prov = (loadConfig().providers || {})[provider] || {};
if (provider === "anthropic" || prov.baseURL) {
  const client = new Anthropic({ apiKey: key, baseURL: prov.baseURL || undefined });
}
```
Keep the failover if losing a page is worse than crossing a billing boundary — but return `billedTo`, `chosen` and the full chain so it can never happen silently.

## 04 · A locked setting locked to a value the lock forbids — HIGH

**CHECK** — read the lock constant and the registry default side by side, then try to save the running value:
```bash
curl -s -b "$COOKIE" $BASE/api/pipelines | jq '.pipelines["qlegal-embed"]'
```

**VERIFY** — if the save is rejected *and* the UI renders no provider/model control for a locked pipeline, it is stuck.

**EXECUTE** — make the registry default equal the lock, then coerce at config-merge time:
```js
if (LOCKED.has(id) && d.provider) {
  pipelines[id].provider = d.provider;
  pipelines[id].model    = d.model;
}
```
**Guard against a regression we hit:** only coerce where the default actually names a provider. A `deterministic` pipeline has none, and forcing `undefined` onto it blanks the row.

---

# Group B · Data integrity

Each of these silently produced a wrong answer that looked like a right one.

## 05 · Boot re-applies migrations, so a boot overwrites what the team changed — CRITICAL

**CHECK**
```bash
grep -ln "do update\|^update \|^delete " db/init/*.sql
```
Schema statements are fine. Anything touching a row a human can edit in the app is the bug.

**VERIFY** — the only honest test is a restart:
```
before restart:  Way Up = false
after  restart:  Way Up = true   <- reverted, silently
```

**EXECUTE** — a ledger that sorts first, then gate every data mutation on it:
```sql
create table if not exists schema_oneshot (
  key text primary key,
  applied_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from schema_oneshot where key = '047_way_up') then
    update wh_franchise set active = true where name = 'Way Up';
    insert into schema_oneshot(key) values ('047_way_up');
  end if;
end $$;
```
Seeds become `on conflict do nothing`. Re-run the restart test.

## 06 · A migration that has never run, invisibly — CRITICAL

If the runner logs a failure as a warning and the summary counts only successes, a permanently broken file is indistinguishable from a working one.

**CHECK** — count the `.sql` files against what the boot log claims. QAnsr said "applied 55" with 55 files, and one threw every single time.

**VERIFY**
```
migrate: applied 57 schema files, 1 FAILED
migrate FAILED 046_audit_backfill.sql: column l.input_tokens does not exist
```

**EXECUTE**
```js
const failed = [];
for (const f of files) {
  try { await pool.query(read(f)); ok++; }
  catch (e) { failed.push({ file: f, error: String(e.message).slice(0,200) }); }
}
console.log(`migrate: applied ${ok}${failed.length ? `, ${failed.length} FAILED` : ""}`);
for (const {file,error} of failed) console.error(`migrate FAILED ${file}: ${error}`);
```
Then fix whatever it names, and expose the list on `/health`.

## 07 · An upsert that never fires, because NULLs are distinct — HIGH

**CHECK**
```sql
select review_id, box_key, finding_key, count(*)
  from contra_decision group by 1,2,3 having count(*) > 1;
```

**VERIFY** — inside a rolled-back transaction, act three times on the same target:
```
3 acts (finding_key NULL) -> 3 rows: reject, accept, reject   // upsert dead
2 acts (finding_key 'cap') -> 1 row: accept                   // upsert works
```

**EXECUTE**
```sql
create unique index contra_decision_ident_idx
  on contra_decision (review_id, coalesce(box_key,''), coalesce(finding_key,''));
```
Match the `on conflict` target to the index exactly, and collapse the duplicates already on disk (newest wins).

## 08 · A count that fans out over a LATERAL — HIGH

**CHECK**
```sql
select count(*), count(distinct r.id) from ql_register r
  left join lateral jsonb_array_elements_text(r.doc_types) t on true;
```
QAnsr's picker read "MSA & Services 27" against 7 real questions, so running the set showed **7/27** — telling the reviewer 20 had failed when none had.

**EXECUTE** — `count(*)` → `count(distinct r.id)`. Confirmed on real data: **27 → 7**.

---

# Group C · Journeys that cannot complete

These need no bad data. They fail on the happy path, or on the one path a stuck user is told to take.

## 09 · An expired session renders as a healthy, empty app — CRITICAL

A 401 returns valid JSON. `.json()` therefore *succeeds*, the `catch` never fires, and `|| []` swallows it.

**CHECK**
```bash
grep -c "catch { .* = \[\] }" public/*.js
```

**VERIFY** — load the app, delete the session cookie, navigate. QAnsr showed *"the repository is empty"*, 0 contracts, and no sign-in prompt anywhere.

**EXECUTE** — one interceptor in whatever script every page already loads:
```js
const _fetch = window.fetch;
let bounced = false;
window.fetch = async (input, init) => {
  const r = await _fetch(input, init);
  const url = String(typeof input === "string" ? input : input?.url || "");
  if (r.status === 401 && url.includes("/api/") && !url.includes("/api/login") && !bounced) {
    bounced = true;
    location.href = `/login.html?next=${encodeURIComponent(location.pathname)}`;
  }
  return r;
};
```
The login exclusion matters — that endpoint answers 401 for a wrong password, which is the form's business.

## 10 · A sweep whose "remaining" count can never reach zero — HIGH

**CHECK** — compare the predicate in the `remaining` query against the filter the worker applies. QAnsr's counter ignored `doc_types` scope; the worker honoured it.

**VERIFY** — ours ran all 40 passes at ~4 model calls each, then reported **"200 contracts answered"** on a five-contract estate.

**EXECUTE** — the predicate, and a belt for it:
```sql
and (coalesce(jsonb_array_length(r.doc_types),0) = 0
     or exists (select 1 from jsonb_array_elements_text(r.doc_types) t
                 where lower(t) = lower(coalesce(d.doc_type,''))))
```
```js
if (lastRemaining !== null && j.remaining >= lastRemaining) { stalled = true; break; }
lastRemaining = j.remaining;
```
When it stalls, say so — "some contracts could not be answered" beats a confident wrong number.

## 11 · A queue badge that can never be cleared — HIGH

**CHECK**
```sql
select kind, count(*) from ql_confirm where status='open' group by 1;
```
Any kind absent from the client's render list is a permanent badge.

**VERIFY** — nav shows a count; the screen says "nothing awaiting your decision".

**EXECUTE** — add the missing kind *and* a catch-all so the next new kind cannot do this again:
```js
const known = new Set(KINDS.map(([k]) => k));
const groups = [...KINDS.map(...),
  ["other", "Other decisions", CONFIRMS.filter(c => !known.has(c.kind))]
].filter(([,,g]) => g.length);
```

## 12 · Opening a deleted record shows a different record — HIGH

**VERIFY**
```
openDoc(999999)
TypeError: Cannot read properties of undefined (reading 'facts')
// screen: still showing the PREVIOUS contract, no error anywhere
```
Reachable in normal use: click a citation in an older answer after a purge.

**EXECUTE**
```js
let d = null;
try { d = await (await fetch(`/api/qlegal/document/${id}`)).json(); } catch { d = null; }
if (!d || d.error || !d.document) return rdAlert("Can't open that contract",
  "It is no longer in the repository — it may have been deleted since this link was made.");
OPEN = d;
```

## 13 · A blank key that matches every section — HIGH

`"".includes("")` is `true`, so a fuzzy matcher with no empty-string guard maps every unkeyed item onto whichever candidate comes first.

**VERIFY**
```
before: all three -> key:"particulars"   // +3 issues on an innocent section
after:  all three -> key:null, unmatched:true
```

**EXECUTE**
```js
const n = norm(v.key);
if (n.length < 3) return { ...v, key: null, unmatched: true };
```
Exclude unmatched items from any coverage calculation, or a half-keyed reply looks complete. De-duplicate keeping the worst verdict per key.

---

# Group D · Contra — the accept/reject loop

A feature spec, not a fix. Build the controls to Virya's own design; this is the contract underneath them.

## 14 · Accept, Reject and Note on every finding — FEATURE

In QAnsr the entire loop existed server-side — table, endpoints, and the query that detects a rule going wrong across contracts — and had no way in. The handlers were defined and called by nothing, so a reviewer could not resolve a finding and the next contract of the same archetype re-raised it forever.

**CHECK**
```bash
grep -rn "accept\|reject" public/contra.js | grep -v 'accept="'
```
```sql
select count(*) from contra_decision;
```
Handlers that exist with no caller, beside an empty decisions table and a populated reviews table, is the signature.

**VERIFY** — post one decision and read it back. Send a `by` field deliberately; it must be ignored.
```bash
curl -X POST $BASE/api/contra/review/1/act -b "$COOKIE" \
  -H 'content-type: application/json' \
  -d '{"kind":"reject","box_key":"liability","finding_key":"cap-exceeds-12-months","by":"IMPERSONATED"}'

curl $BASE/api/contra/review/1/decisions -b "$COOKIE"
# actor must be the SIGNED-IN user, never "IMPERSONATED"
```

**EXECUTE**

1 · Three attachment points:

| Attaches to | box_key | finding_key |
|---|---|---|
| A section as a whole | the section key | `null` |
| One rule-check | `c.section_key` | slug of the rule text |
| One finding | `"whole-contract"` | slug of kind + note |

2 · Derive a stable finding key — the model returns no ids:
```js
const fkey = (s) => String(s || "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150);
```

3 · Take the actor from the session, never the request body — otherwise a user can attribute their rejection to a colleague, in the table built to record who decided what:
```js
req.acct = acct;                        // in the auth middleware
const by = req.acct?.user || "unknown"; // in the route — never req.body.by
```

4 · Load existing decisions when the review opens and render the current state inline. Key them `` `${box_key}|${finding_key}` ``.

5 · Then surface the signal. Count it as `count(distinct review_id)`, never `count(*)`, or one reviewer changing their mind twice reads as two contracts disagreeing.

---

# Group E · Long work

## 15 · A sweep that outlives the platform's request timeout — CRITICAL

Cloud Run kills a request at 900s. Anything longer dies mid-flight with no record of what it finished.

**CHECK**
```bash
time curl -s -X POST -b "$COOKIE" $BASE/api/wh/feedstories/<batchId> >/dev/null
grep -rn "startJob\|finishJob" server | grep -v "server/jobs.js"
```
Ours was imported in two files and invoked in none.

**VERIFY**
```
measured:  ~1,060s   ceiling: 900s
generation phase alone: ~928s   <- the outer loop was serial

after a kill:  job row?  none   ideas written?  some
               UI:       spinner, forever
```

**EXECUTE**

1 · Write the work down before doing it, one item per unit, each carrying what it needs to be redone:
```js
const jobId = await startJob({
  app: "wh", kind: "sweep", label: `Sweep · batch ${bid}`,
  items: topicRows.map(t => ({ label: t.name, payload: { topic: t.name } })),
});
```

2 · Skip what already succeeded, so a re-run after a timeout costs only what never ran:
```js
const alreadyDone = new Set((await wq(
  `select distinct demand_topic from wh_feed_story where batch_id=$1 and status<>'deleted'`, [bid]
)).rows.map(r => r.demand_topic));
```

3 · Stop running independent units one at a time. This is the actual timeout fix — the record above only makes the failure survivable. Bounded, not unbounded: research hits rate-limited APIs, and firing sixteen at once trades a timeout for a 429.
```js
const LANE = 3;
let next = 0;
await Promise.all(Array.from({ length: Math.min(LANE, topicRows.length) }, async () => {
  for (;;) {
    const ord = next++;
    if (ord >= topicRows.length) return;
    if (alreadyDone.has(topicRows[ord].name)) continue;
    try { await runTopic(topicRows[ord], ord); }
    catch (e) { await setItem(jobId, ord, { stage:"failed", status:"error", note:String(e).slice(0,200) }); }
  }
}));
```

4 · Fix the stall check. `status !== 'running'` misses the commonest death: a request killed by the platform never moves the job off `running`, so it sits looking busy forever.
```js
const silentMin = (Date.now() - new Date(job.updated_at)) / 60000;
const stalled = unfinished.length > 0 && (job.status !== "running" || silentMin > 10);
```

Verify by killing a run after two of five units: the job must report stalled with three unfinished, and your resumable query must name exactly the three that never ran.

## 16 · A review that read only part of the contract, and said nothing — CRITICAL

Two independent ways the input is already partial before the model sees it. A "clean" verdict on a fraction of a document is worse than no verdict, because it is trusted.

**CHECK** — look for a character cap on the stored extract and the review prompt, then look for extracts sitting *exactly* at it:
```bash
grep -n "slice(0, [0-9]\{4,\})" server/contra.js
```
```sql
select contract_name, length(extract_md) from contra_review order by 2 desc limit 10;
-- four of ours read exactly 60000. None of them is 60000 characters long.
```
Then check whether your extractor already reports what it could not read, and whether anything consumes it:
```bash
grep -n "unread_pages\|figure_pages" server/extract.js server/contra.js
```

**VERIFY** — ours returned both and Contra took only `.text`:
```
extract.text         -> used
extract.unread_pages -> dropped   ("the honest gap, surfaced loudly downstream")
extract.figure_pages -> dropped
```
So a 60-page agreement whose Schedule B is a scan was reviewed on the 50 readable pages and could come back clean, with nothing anywhere saying so.

**EXECUTE** — keep the cap; something has to bound the prompt. Measure the cut instead of just making it:
```js
const fullText = String(extract.text || "");
const CAP = 60000;
const text = fullText.slice(0, CAP);
const truncated = fullText.length > CAP;
const unreadPages = extract.unread_pages || [];
```
Store `extract_chars`, the full length before the cap, the truncation flag and the unread pages on the review. Then make the verdict depend on them:
```js
const inputPartial = !!rev.extract_truncated || unread.length > 0;
const complete = coverage.sections_returned >= coverage.sections_expected
              && coverage.rules_returned >= coverage.rules_expected
              && !inputPartial;
```
A review whose *input* was partial cannot be written `done`, however well the model performed on the part it saw. Say which reason applied and by how much, and put it where a reader looks — **above** the issue counts, and in the exported document:
```
PARTIAL READ — only the first 60,000 of 184,220 characters were read.
Anything in the unread portion was not assessed.
```

This is step 14's defect one layer earlier: that one was the model never running, this is the model running on a fragment. Both end in a confident clean.

---

# Order of work

Dependencies, not severity.

| Do | Steps | Why this order |
|---|---|---|
| First | 01 | Until the gate holds, every other gate is decorative |
| Then | 06 → 05 | Make migrations report failure before trusting any migration you write |
| Then | 02, 03, 04 | Provider and gate correctness — cheap, and they stop money leaking |
| Then | 09 | One interceptor; makes every later manual test trustworthy |
| Then | 07, 08, 10, 11, 12, 13 | Independent of each other — any order |
| Then | 14 | A feature, and step 07 must land first or its decisions duplicate |
| Then | 15 | The largest change — easier once the rest is stable |
| Last | 16 | Do it alongside step 14 if you can — same defect, one layer earlier |

---

# Not covered

Interface work is excluded throughout. Two QAnsr findings were interface-only and are omitted: five tables whose headers sat over the wrong columns, and emoji in shipped UI.

Mint and Atlas are out of scope.
