// Atlas drift detection + fork/versioning. A contract matched to an archetype
// can mutate (rate table reshaped, a head added) until its fingerprint no longer
// fits. check() catches that; fork() crystallises a new archetype VERSION from
// the contract's current physiology and re-routes it (parent_id links lineage).
import { fingerprint, archetypeSlug, archetypeName, playbook } from "./fingerprint.js";
import { similarity, rank } from "./match.js";

const MATCH = 0.8;

// host injects getRuleBook(client) → compiled rule book (decoupled, portable).
export function createDrift({ q, getRuleBook }) {
  async function activeArchetypes() {
    try { return (await q(`select id, slug, name, version, fingerprint from archetype where status='active'`)).rows || []; }
    catch { return []; }
  }

  // has this contract drifted away from its assigned archetype?
  async function check(client) {
    let stored;
    try { stored = (await q(`select archetype_id, similarity from contract_fingerprint where customer_id=(select id from customer where code=$1)`, [client])).rows?.[0]; } catch { /* */ }
    if (!stored?.archetype_id) return { drift: false, reason: "unrouted" };
    const arch = (await q(`select id, slug, name, version, fingerprint from archetype where id=$1`, [stored.archetype_id])).rows?.[0];
    if (!arch) return { drift: false, reason: "archetype-missing" };

    const fp = fingerprint(await getRuleBook(client));
    const nowSim = Number(similarity(fp, arch.fingerprint).toFixed(4));
    const wasSim = stored.similarity != null ? Number(stored.similarity) : null;
    const headsChanged = JSON.stringify(fp.heads) !== JSON.stringify(arch.fingerprint?.heads || []);
    const drift = nowSim < MATCH || headsChanged;

    const others = (await activeArchetypes()).filter((a) => a.id !== arch.id);
    const better = rank(fp, others)[0] || null;
    const suggestion = !drift ? "stable" : (better && better.sim >= MATCH ? `reroute:${better.slug}` : "fork");

    await q(`update contract_fingerprint set drift=$2::jsonb where customer_id=(select id from customer where code=$1)`,
      [client, JSON.stringify({ drift, now_sim: nowSim, was_sim: wasSim, heads_changed: headsChanged, suggestion })]).catch(() => {});
    if (drift) q(`insert into audit_log(actor,action,object_type,object_id,detail) values('atlas','atlas.drift','customer',$1,$2::jsonb)`,
      [client, JSON.stringify({ from: arch.slug, now_sim: nowSim, suggestion })]).catch(() => {});

    return { drift, was_archetype: arch.slug, was_sim: wasSim, now_sim: nowSim, heads_changed: headsChanged, suggestion, better, current_fp: fp };
  }

  // crystallise a new archetype version from the contract's current shape + re-route
  async function fork(client) {
    const fp = fingerprint(await getRuleBook(client));
    const rb = await getRuleBook(client);
    let parentId = null;
    try { parentId = (await q(`select archetype_id from contract_fingerprint where customer_id=(select id from customer where code=$1)`, [client])).rows?.[0]?.archetype_id || null; } catch { /* */ }
    const parent = parentId ? (await q(`select slug, version from archetype where id=$1`, [parentId])).rows?.[0] : null;

    const baseSlug = archetypeSlug(fp);
    let slug = baseSlug, ver = 1;
    const fam = (await q(`select slug, version from archetype where slug like $1`, [baseSlug + "%"])).rows || [];
    if (fam.length) { ver = Math.max(...fam.map((e) => e.version || 1)) + 1; slug = `${baseSlug}-v${ver}`; }

    await q(`insert into archetype(slug,name,version,fingerprint,rule_template,operators,required_inputs,normalizers,playbook_md,parent_id)
             values($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9,$10) on conflict (slug) do nothing`,
      [slug, archetypeName(fp), ver, JSON.stringify(fp), JSON.stringify(rb), fp.heads, JSON.stringify(rb.inputs || []), JSON.stringify(rb.normalizers || {}), playbook(archetypeName(fp), fp, rb), parentId]).catch(() => {});
    const forked = (await q(`select id, slug, name, version from archetype where slug=$1`, [slug])).rows?.[0];
    if (forked) {
      await q(`update contract_fingerprint set archetype_id=$2, decision='forked', similarity=1, signals=$3::jsonb, drift=null where customer_id=(select id from customer where code=$1)`,
        [client, forked.id, JSON.stringify(fp)]).catch(() => {});
      q(`insert into audit_log(actor,action,object_type,object_id,detail) values('atlas','atlas.fork','customer',$1,$2::jsonb)`,
        [client, JSON.stringify({ forked: slug, version: ver, parent: parent?.slug || null })]).catch(() => {});
    }
    return { forked, parent: parent ? { slug: parent.slug, version: parent.version } : null };
  }

  return { check, fork };
}
