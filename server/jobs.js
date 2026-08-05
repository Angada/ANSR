// ============================================================================
// Jobs — long work, recorded, for every app.
//
// The problem is identical in all three products: a browser holds a connection
// for minutes while documents are read, archetypes proposed, contracts reviewed
// or feeds swept — and if that tab is closed, reloaded or simply navigated away
// from, the run leaves no trace of what it did or where it stopped. The user's
// only signal is that something is or is not on screen.
//
// So the work is written down BEFORE it starts and each item updated as it moves.
// That buys three things immediately: a run visible from any tab or device, an
// honest record of what stopped and why, and — because each item carries the
// payload needed to redo it — the ability to RESUME rather than start over.
//
// An honest limit, stated because it decides how this is used: Cloud Run
// throttles CPU once a response is sent, so a job still needs a caller driving
// it. What lives here is the record and the resume, not a daemon. `resumable()`
// finds runs whose request died; something must still call back to continue them
// (a user pressing Resume today, Cloud Tasks later).
// ============================================================================
import { q } from "./db/client.js";

export async function startJob({ app, kind, label, items = [], actor = null, meta = null }) {
  const job = (await q(
    `insert into job(app, kind, label, total, actor, meta) values ($1,$2,$3,$4,$5,$6::jsonb) returning id`,
    [app, kind, label || kind, items.length, actor, meta ? JSON.stringify(meta) : null])).rows[0];
  for (const [i, it] of items.entries()) {
    const o = typeof it === "string" ? { label: it } : (it || {});
    await q(`insert into job_item(job_id, ord, label, payload) values ($1,$2,$3,$4::jsonb)`,
      [job.id, i, o.label || `item ${i + 1}`, o.payload ? JSON.stringify(o.payload) : null]);
  }
  return job.id;
}

// Update one item by its position. Every field is optional so a caller reports
// only what changed — a stage on its own is the commonest and cheapest update,
// and it is what turns silence into visible progress.
export async function setItem(jobId, ord, patch = {}) {
  return q(
    `update job_item set
       stage      = coalesce($3, stage),
       status     = coalesce($4, status),
       ref_id     = coalesce($5, ref_id),
       gate       = coalesce($6::jsonb, gate),
       note       = coalesce($7, note),
       attempts   = case when $8 then attempts + 1 else attempts end,
       updated_at = now()
     where job_id = $1 and ord = $2`,
    [jobId, ord, patch.stage || null, patch.status || null, patch.ref_id || null,
     patch.gate ? JSON.stringify(patch.gate) : null, patch.note || null, !!patch.attempt],
  ).catch(() => {});
}

export async function finishJob(jobId, status = "done") {
  return q(`update job set status=$2, updated_at=now() where id=$1`, [jobId, status]).catch(() => {});
}

export async function getJob(jobId) {
  const job = (await q(`select * from job where id=$1`, [jobId])).rows[0] || null;
  if (!job) return { job: null, items: [] };
  const items = (await q(`select * from job_item where job_id=$1 order by ord`, [jobId])).rows;
  // A job marked done with items still queued did not finish — its request died.
  // Saying so is the whole point: a spinner that will never resolve is worse than
  // an error, because it asks the user to keep waiting for nothing.
  const unfinished = items.filter((i) => i.stage === "queued" || (i.status === "pending" && i.stage !== "done"));
  return { job, items, stalled: job.status !== "running" && unfinished.length > 0, unfinished: unfinished.length };
}

export async function latestJob(app) {
  const r = await q(`select id from job where app=$1 order by id desc limit 1`, [app]);
  return r.rows[0] ? getJob(r.rows[0].id) : { job: null, items: [] };
}

// Runs that stopped without finishing. A job is presumed dead rather than slow
// once it has been silent for a while — `running` alone cannot distinguish "still
// working" from "the request was killed twenty minutes ago".
export async function resumableJobs(app, { staleMinutes = 10 } = {}) {
  const r = await q(
    `select j.id, j.app, j.kind, j.label, j.total, j.status, j.updated_at,
            count(i.*) filter (where i.status = 'pending' and i.stage <> 'done') as pending
       from job j join job_item i on i.job_id = j.id
      where j.app = $1
        and (j.status = 'running' and j.updated_at < now() - ($2 || ' minutes')::interval
             or j.status = 'stalled')
      group by j.id having count(i.*) filter (where i.status = 'pending' and i.stage <> 'done') > 0
      order by j.id desc limit 20`,
    [app, String(staleMinutes)]);
  return r.rows;
}

// The items a resume must redo, with the payload each needs. Nothing is inferred:
// an item is retried because it says it never finished and carries what it needs.
export async function pendingItems(jobId) {
  const r = await q(
    `select id, ord, label, payload, attempts from job_item
      where job_id=$1 and status='pending' and stage <> 'done' order by ord`, [jobId]);
  return r.rows;
}

export async function decideItem(itemId, decision) {
  const r = await q(
    `update job_item set decision=$2, decided_at=now(), updated_at=now() where id=$1 returning *`,
    [itemId, decision]);
  return r.rows[0] || null;
}

// Generic read + decide routes, mounted once per app. The apps differ in what
// they DO; they do not differ in how a run is watched or a blocked item resolved,
// and three copies of that would drift into three behaviours.
export function mountJobs(app, express) {
  express.get(`/api/${app}/jobs/latest`, async (_req, res) => {
    try { res.json(await latestJob(app)); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  express.get(`/api/${app}/jobs/resumable`, async (_req, res) => {
    try { res.json({ jobs: await resumableJobs(app) }); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  express.get(`/api/${app}/jobs/:id`, async (req, res) => {
    try { res.json(await getJob(Number(req.params.id))); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  express.post(`/api/${app}/jobs/item/:id/decide`, async (req, res) => {
    const d = String(req.body?.decision || "");
    if (!["accept", "reject"].includes(d)) return res.status(400).json({ error: "decision must be accept or reject" });
    try { res.json({ ok: true, item: await decideItem(Number(req.params.id), d) }); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
}
