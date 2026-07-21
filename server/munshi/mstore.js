// Munshi persistence — contract_doc (corpus) · contract_chunk · contract_chip.
// Best-effort like the rest of Q&ANSR: every call tolerates a missing DB and the
// UI still runs on the JSON path. The one non-obvious rule lives here:
// upsertChips PRESERVES human-confirmed chips — a re-parse never clobbers a
// reading a human locked; the incoming draft is stashed as a visible "pending"
// so an amendment surfaces the conflict instead of silently overwriting.
import { q } from "../db/client.js";

const cidSub = "(select id from customer where code=$1)";

// ---- corpus (contract_doc) --------------------------------------------------
export async function listCorpus(client) {
  try {
    const r = await q(
      `select cd.*, d.filename, d.sha256 from contract_doc cd
       left join document d on d.id = cd.document_id
       where cd.customer_id=${cidSub} and cd.status<>'removed' order by cd.ord, cd.id`, [client]);
    return r.rows || [];
  } catch { return []; }
}

export async function upsertCorpusDoc(client, doc) {
  try {
    const r = await q(
      `insert into contract_doc(customer_id, document_id, doc_id, role, title, effective_date, supersedes_id, ord, source_hash, status)
       values(${cidSub},$2,$3,$4,$5,$6,$7,$8,$9,'active')
       on conflict (customer_id, doc_id) do update set
         document_id=excluded.document_id, role=excluded.role, title=excluded.title,
         effective_date=excluded.effective_date, ord=excluded.ord, source_hash=excluded.source_hash,
         status='active', updated_at=now()
       returning id`,
      [client, doc.document_id || null, doc.doc_id, doc.role || "primary_sow", doc.title || null,
       doc.effective_date || null, doc.supersedes_id || null, doc.ord ?? 0, doc.source_hash || null]);
    return r.rows?.[0]?.id || null;
  } catch { return null; }
}

// ---- chunks -----------------------------------------------------------------
export async function getChunks(client, contractDocId) {
  try {
    const r = await q(`select ref, title, body, ord, chunk_hash from contract_chunk where contract_doc_id=$1 order by ord`, [contractDocId]);
    return r.rows || [];
  } catch { return []; }
}

export async function saveChunks(client, contractDocId, chunks) {
  let n = 0;
  for (const c of chunks) {
    try {
      await q(
        `insert into contract_chunk(customer_id, contract_doc_id, ref, title, body, ord, chunk_hash)
         values(${cidSub},$2,$3,$4,$5,$6,$7)
         on conflict (contract_doc_id, ref) do update set
           title=excluded.title, body=excluded.body, ord=excluded.ord, chunk_hash=excluded.chunk_hash, updated_at=now()`,
        [client, contractDocId, c.ref, c.title || null, c.body || null, c.ord ?? 0, c.chunk_hash]);
      n++;
    } catch { /* */ }
  }
  return n;
}

// ---- chips ------------------------------------------------------------------
export async function getChips(client, { box_type, status } = {}) {
  try {
    const where = [`customer_id=${cidSub}`, `status<>'superseded'`];
    const params = [client];
    if (box_type) { params.push(box_type); where.push(`box_type=$${params.length}`); }
    if (status) { params.push(status); where.push(`status=$${params.length}`); }
    const r = await q(`select * from contract_chip where ${where.join(" and ")} order by box_type, ord`, params);
    return r.rows || [];
  } catch { return []; }
}

export async function getChip(client, id) {
  try { return (await q(`select * from contract_chip where customer_id=${cidSub} and id=$2`, [client, id])).rows?.[0] || null; }
  catch { return null; }
}

// Upsert a batch of freshly-atomized chips. Returns {inserted, updated, preserved,
// conflicts}. A confirmed chip is never overwritten: if the incoming value
// differs, it's parked in provenance.pending and flagged as a conflict.
export async function upsertChips(client, chips, { runId = null, by = "ai" } = {}) {
  const out = { inserted: 0, updated: 0, preserved: 0, conflicts: [] };
  for (const ch of chips) {
    try {
      const existing = (await q(
        `select id, value, status from contract_chip where customer_id=${cidSub} and box_type=$2 and key=$3`,
        [client, ch.box_type, ch.key])).rows?.[0];
      const prov = { ...(ch.provenance || {}) };
      if (existing && existing.status === "confirmed") {
        // human-locked — keep their reading; surface the incoming as pending.
        const changed = JSON.stringify(existing.value) !== JSON.stringify(ch.value);
        if (changed) {
          await q(`update contract_chip set provenance = jsonb_set(coalesce(provenance,'{}'::jsonb),'{pending}',$2::jsonb), updated_at=now() where id=$1`,
            [existing.id, JSON.stringify({ value: ch.value, clause_ref: ch.clause_ref, source_hash: ch.source_hash, at: new Date().toISOString() })]).catch(() => {});
          out.conflicts.push({ box_type: ch.box_type, key: ch.key, clause_ref: ch.clause_ref });
        }
        out.preserved++;
        continue;
      }
      await q(
        `insert into contract_chip(customer_id, box_type, key, value, confidence, clause_ref, provenance, status, source_hash, ord, run_id, created_by)
         values(${cidSub},$2,$3,$4::jsonb,$5,$6,$7::jsonb,'draft',$8,$9,$10,$11)
         on conflict (customer_id, box_type, key) do update set
           value=excluded.value, confidence=excluded.confidence, clause_ref=excluded.clause_ref,
           provenance=excluded.provenance, source_hash=excluded.source_hash, ord=excluded.ord,
           run_id=excluded.run_id, updated_at=now()`,
        [client, ch.box_type, ch.key, JSON.stringify(ch.value), ch.confidence ?? null, ch.clause_ref || null,
         JSON.stringify(prov), ch.source_hash || null, ch.ord ?? 0, runId, by]);
      existing ? out.updated++ : out.inserted++;
    } catch { /* */ }
  }
  await audit(client, "chips.upsert", "corpus", `${client}`, { ...out, conflicts: out.conflicts.length, runId }).catch(() => {});
  return out;
}

// Mark chips for clauses that vanished from the corpus as superseded (kept for lineage).
export async function supersedeMissing(client, keepKeys, boxTypes) {
  try {
    const keep = new Set(keepKeys);
    const rows = (await q(`select id, box_type, key, status from contract_chip where customer_id=${cidSub} and box_type = any($2) and status<>'superseded'`, [client, boxTypes])).rows || [];
    let n = 0;
    for (const r of rows) if (!keep.has(`${r.box_type}::${r.key}`) && r.status !== "confirmed") {
      await q(`update contract_chip set status='superseded', updated_at=now() where id=$1`, [r.id]).catch(() => {});
      n++;
    }
    return n;
  } catch { return 0; }
}

export async function confirmChip(client, id, by = "vik") {
  try {
    // confirming resolves any pending amendment proposal (clear the flag).
    const r = await q(`update contract_chip set status='confirmed', created_by=$3, provenance = (coalesce(provenance,'{}'::jsonb) - 'pending'), updated_at=now() where customer_id=${cidSub} and id=$2`, [client, id, by]);
    if (!r.rowCount) return false;
    await audit(client, "chip.confirm", "chip", String(id), {});
    return true;
  } catch { return false; }
}

export async function amendChip(client, id, value, by = "vik") {
  try {
    const prev = (await q(`select value from contract_chip where customer_id=${cidSub} and id=$2`, [client, id])).rows?.[0]?.value;
    // record what we amended from, lock it, and clear any pending proposal.
    const r = await q(`update contract_chip set value=$3::jsonb, status='confirmed', created_by=$5, provenance = (jsonb_set(coalesce(provenance,'{}'::jsonb),'{amended_from}',$4::jsonb) - 'pending'), updated_at=now() where customer_id=${cidSub} and id=$2`,
      [client, id, JSON.stringify(value), JSON.stringify(prev ?? null), by]);
    if (!r.rowCount) return false;
    await audit(client, "chip.amend", "chip", String(id), { prev });
    return true;
  } catch { return false; }
}

async function audit(client, action, objType, objId, detail) {
  return q(`insert into audit_log(actor, action, object_type, object_id, detail) values('vik',$1,$2,$3,$4::jsonb)`,
    [action, objType, `${client}#${objId}`, JSON.stringify(detail || {})]).catch(() => {});
}
