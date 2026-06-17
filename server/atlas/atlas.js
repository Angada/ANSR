// Atlas orchestrator — classify a contract, route it to an archetype (or seed a
// new one), and serve the archetype wiki. Cross-contract meta-learning layer.
import { q } from "../db/client.js";
import { getRuleBook } from "../engine/run.js";
import { fingerprint, archetypeSlug, archetypeName, playbook } from "./fingerprint.js";
import { rank, decide } from "./match.js";

async function loadArchetypes() {
  try { return (await q(`select id, slug, name, version, fingerprint, rule_template, operators, required_inputs, normalizers, playbook_md, stats from archetype where status='active'`)).rows || []; }
  catch { return []; }
}

// classify only — no mutation
export async function classify(client) {
  const rb = await getRuleBook(client);
  const fp = fingerprint(rb);
  const archetypes = await loadArchetypes();
  const candidates = rank(fp, archetypes);
  const decision = archetypes.length ? decide(candidates[0]) : "novel";
  return { client, fingerprint: fp, candidates: candidates.slice(0, 5), decision, top: candidates[0] || null, rule_book: rb };
}

// route — adopt the matched archetype or crystallise a new one; persist + learn
export async function route(client) {
  const c = await classify(client);
  const fp = c.fingerprint, rb = c.rule_book;
  let archetype;
  if (c.decision !== "novel" && c.top) {
    archetype = (await q(`select * from archetype where id=$1`, [c.top.archetype_id])).rows[0];
  } else {
    const slug = archetypeSlug(fp), name = archetypeName(fp);
    await q(`insert into archetype(slug,name,fingerprint,rule_template,operators,required_inputs,normalizers,playbook_md)
             values($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8) on conflict (slug) do nothing`,
      [slug, name, JSON.stringify(fp), JSON.stringify(rb), fp.heads, JSON.stringify(rb.inputs || []), JSON.stringify(rb.normalizers || {}), playbook(name, fp, rb)]).catch(() => {});
    archetype = (await q(`select * from archetype where slug=$1`, [slug])).rows[0];
  }
  const sim = c.top?.sim ?? (c.decision === "novel" ? 1 : 0);
  await q(`insert into contract_fingerprint(customer_id, archetype_id, signals, similarity, decision, candidates, confidence)
           values((select id from customer where code=$1),$2,$3::jsonb,$4,$5,$6::jsonb,$4)
           on conflict (customer_id) do update set archetype_id=excluded.archetype_id, signals=excluded.signals, similarity=excluded.similarity, decision=excluded.decision, candidates=excluded.candidates`,
    [client, archetype?.id || null, JSON.stringify(fp), sim, c.decision, JSON.stringify(c.candidates)]).catch(() => {});
  // member-count stat
  if (archetype) await q(`update archetype set stats = jsonb_set(coalesce(stats,'{}'::jsonb),'{members}', (select to_jsonb(count(*)) from contract_fingerprint where archetype_id=$1)::jsonb), updated_at=now() where id=$1`, [archetype.id]).catch(() => {});
  q(`insert into audit_log(actor,action,object_type,object_id,detail) values('atlas','atlas.route','customer',$1,$2::jsonb)`,
    [client, JSON.stringify({ decision: c.decision, archetype: archetype?.slug, sim })]).catch(() => {});
  return { client, decision: c.decision, similarity: sim, archetype: archetype ? { id: archetype.id, slug: archetype.slug, name: archetype.name, version: archetype.version } : null,
    candidates: c.candidates, fingerprint: fp, preloaded: archetype?.rule_template || rb, playbook_md: archetype?.playbook_md };
}

export async function listArchetypes() {
  const rows = await loadArchetypes();
  const members = {};
  try { for (const r of (await q(`select archetype_id, count(*) n from contract_fingerprint group by archetype_id`)).rows || []) members[r.archetype_id] = Number(r.n); } catch { /* */ }
  return rows.map((a) => ({ slug: a.slug, name: a.name, version: a.version, heads: a.fingerprint?.heads || [], dims: a.fingerprint?.dims || [], inputs: (a.required_inputs || []).length, members: members[a.id] || 0 }));
}

export async function archetypeDetail(slug) {
  const a = (await q(`select * from archetype where slug=$1`, [slug])).rows[0];
  if (!a) return null;
  let members = [];
  try { members = (await q(`select c.code, c.name, f.similarity, f.decision from contract_fingerprint f join customer c on c.id=f.customer_id where f.archetype_id=$1`, [a.id])).rows || []; } catch { /* */ }
  return { ...a, members };
}
