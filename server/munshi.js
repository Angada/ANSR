// Munshi-for-Mint — the contract corpus parser. Reads the contract (stub SOW
// until a real upload lands) and decomposes it into ATOMIC, clause-referenced
// rule-chips: each TA rate row, OSS slab, milestone, caveat, flag = one chip
// with its own clause_ref + confidence + provenance + status. Re-parse on change
// (hash-guarded) and NEVER overwrite a human-confirmed chip. Boxes = chip groups.
// See docs/13-munshi-for-mint.md.
import { q } from "./db/client.js";
import { createHash } from "node:crypto";
import { stubAnalysis } from "./stub.js";
import { runPipeline } from "./ai.js";

const hash = (s) => createHash("sha1").update(String(s || "")).digest("hex").slice(0, 16);
const BOX_ORDER = ["company", "legal", "payment_terms", "commercial_terms", "billing_rules", "caveats", "flags"];

// Decompose one analysis (7 boxes) into atomic chips. Deterministic — the
// dependable path; works with no AI key. Each chip: {box_type,key,value,clause_ref,weight}.
export function decomposeChips(analysis) {
  const chips = [];
  const add = (box, key, value, clause_ref, weight) => chips.push({ box_type: box, key, value, clause_ref: clause_ref || null, weight: weight ?? 0.8 });
  for (const b of (analysis.boxes || [])) {
    const box = b.box_type_code, cr = b.clause_ref, w = b.confidence;
    const c = b.content || {};
    if (box === "billing_rules") {
      if (c.ctc_definition) add(box, "ctc_definition", { text: c.ctc_definition }, cr, w);
      for (const r of (c.ta_rate_table || [])) add(box, `ta_rate:${r.band}|${r.level}|${r.referral ? "ref" : "noref"}`, r, "SOW §3.1 TA rate table", w);
      for (const m of (c.milestones || [])) add(box, `milestone:${m.code}`, m, "SOW §3.3 milestone split", w);
      for (const s of (c.oss_slabs || [])) add(box, `oss_slab:${s.hc}`, s, "SOW §4.2 OSS slab", w);
      if (c.currency) add(box, "fx_rule", { text: c.currency }, "SOW §3.1 FX", w);
      (c.worked_examples || []).forEach((ex, i) => add(box, `example:${i + 1}`, ex, cr, w));
    } else {
      // flat key→value boxes (company/legal/payment/commercial/caveats/flags)
      for (const [k, v] of Object.entries(c)) add(box, k, (typeof v === "object" ? v : { value: v }), cr, w);
    }
  }
  return chips;
}

// AI path (optional) — read raw corpus MD → chips. Gated by key; falls back to
// the deterministic decomposition when unavailable.
async function aiChips(md) {
  try {
    const out = await runPipeline("mint-munshi-parse", {
      system: "You are Munshi. Read the whole contract corpus and return STRICT JSON {\"chips\":[{\"box_type\":\"company|legal|payment_terms|commercial_terms|billing_rules|caveats|flags\",\"key\":\"stable atomic key\",\"value\":{...},\"clause_ref\":\"§..\",\"weight\":0-1}]}. Each rule/fact is ONE atomic chip with its clause ref. Never invent — only what the text supports.",
      user: String(md || "").slice(0, 12000), maxTokens: 3000,
    });
    if (out.mode === "ai" && out.text) {
      const j = JSON.parse((out.text.match(/\{[\s\S]*\}/) || ["{}"])[0]);
      if (Array.isArray(j.chips) && j.chips.length) return j.chips;
    }
  } catch { /* fall back */ }
  return null;
}

// Parse the corpus → upsert chips. Idempotent (hash-guarded) and preserves any
// human-confirmed chip (never overwrites status='confirmed').
export async function munshiParse(customerCode) {
  const analysis = stubAnalysis(customerCode);              // TODO: swap for uploaded corpus MD
  // record the source doc (hash-based)
  const md = JSON.stringify(analysis.boxes);
  const dh = hash(md);
  await q(`insert into mint_contract_doc(customer_code,kind,name,md,source_hash)
           select $1,'sow',$2,$3,$4 where not exists (select 1 from mint_contract_doc where customer_code=$1 and source_hash=$4)`,
    [customerCode, analysis.summary?.title || "SOW", md.slice(0, 20000), dh]).catch(() => {});
  // prefer AI chips when a real doc + key exist; else deterministic decomposition
  const aic = null; // await aiChips(...) — enable once real SOW MD is stored
  const chips = aic || decomposeChips(analysis);
  let written = 0, kept = 0;
  for (const ch of chips) {
    const sh = hash(JSON.stringify(ch.value) + (ch.clause_ref || ""));
    const r = await q(
      `insert into mint_contract_chip(customer_code,box_type,key,value,weight,clause_ref,provenance,source_hash,status)
       values($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,'draft')
       on conflict (customer_code,box_type,key) do update
         set value=excluded.value, weight=excluded.weight, clause_ref=excluded.clause_ref,
             source_hash=excluded.source_hash, updated_at=now()
         where mint_contract_chip.status <> 'confirmed'
       returning (xmax=0) as inserted`,
      [customerCode, ch.box_type, ch.key, JSON.stringify(ch.value ?? {}), ch.weight ?? 0.8, ch.clause_ref, JSON.stringify({ doc: "sow", hash: sh }), sh]
    ).catch(() => null);
    if (r?.rows?.length) written++; else kept++;
  }
  return { ok: true, parsed: chips.length, written, confirmed_kept: kept, source: aic ? "ai" : "deterministic" };
}

export async function getChips(customerCode) {
  const rows = (await q(`select id,box_type,key,value,weight,clause_ref,status,updated_at from mint_contract_chip where customer_code=$1 order by box_type, key`, [customerCode])).rows || [];
  const groups = {};
  for (const r of rows) (groups[r.box_type] ||= []).push(r);
  return BOX_ORDER.filter((b) => groups[b]).map((b) => ({ box_type: b, chips: groups[b] }));
}

export function mountMunshi(app) {
  app.post("/api/mint/munshi/parse/:client", async (req, res) => {
    const code = String(req.params.client || "").toUpperCase();
    try { const r = await munshiParse(code); res.json({ ...r, chips: await getChips(code) }); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.get("/api/mint/chips/:client", async (req, res) => res.json({ chips: await getChips(String(req.params.client || "").toUpperCase()) }));
  app.post("/api/mint/chip/:id/confirm", async (req, res) => { await q(`update mint_contract_chip set status='confirmed', updated_at=now() where id=$1`, [Number(req.params.id)]); res.json({ ok: true }); });
  app.post("/api/mint/chip/:id/amend", async (req, res) => {
    let value = req.body?.value; if (typeof value === "string") { try { value = JSON.parse(value); } catch { value = { value }; } }
    await q(`update mint_contract_chip set value=$2::jsonb, status='confirmed', updated_at=now() where id=$1`, [Number(req.params.id), JSON.stringify(value ?? {})]);
    res.json({ ok: true });
  });
}
