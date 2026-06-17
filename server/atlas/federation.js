// Federated normalizer learning — a label→canonical confirmed on one contract
// is promoted across its archetype to every sibling (with conflict detection).
// The compounding moat. BigFlex handoff: createFederation({q}) is reusable.
export function createFederation(q) {
  const splitTopic = (t) => { const i = String(t).indexOf(":"); return i < 0 ? [] : [t.slice(0, i), t.slice(i + 1)]; };
  const PROMOTE_AT = 2; // ≥2 distinct contracts agree → promote to the archetype

  async function archetypeSlug(client) {
    try { return (await q(`select a.slug from contract_fingerprint f join archetype a on a.id=f.archetype_id where f.customer_id=(select id from customer where code=$1)`, [client])).rows?.[0]?.slug || null; } catch { return null; }
  }

  // record a contract-scope confirmation, then recompute the archetype consensus
  async function record(client, topic, choice) {
    const [layer, raw] = splitTopic(topic); if (!layer || !raw || !choice) return;
    await q(`insert into norm_federation(scope,scope_ref,layer,raw_label,canonical,votes,status)
             values('contract',$1,$2,$3,$4,1,'promoted')
             on conflict (scope,scope_ref,layer,raw_label) do update set canonical=excluded.canonical, updated_at=now()`,
      [client, layer, raw, choice]).catch(() => {});
    const slug = await archetypeSlug(client); if (!slug) return;
    let rows = [];
    try {
      rows = (await q(`select canonical, count(distinct scope_ref) n from norm_federation nf
        where scope='contract' and layer=$1 and raw_label=$2 and scope_ref in (
          select c.code from contract_fingerprint f join customer c on c.id=f.customer_id join archetype a on a.id=f.archetype_id where a.slug=$3)
        group by canonical order by n desc`, [layer, raw, slug])).rows || [];
    } catch { /* */ }
    if (!rows.length) return;
    const top = rows[0], conflicts = rows.length - 1;
    const status = conflicts > 0 ? "conflicted" : (Number(top.n) >= PROMOTE_AT ? "promoted" : "proposed");
    await q(`insert into norm_federation(scope,scope_ref,layer,raw_label,canonical,votes,conflicts,status)
             values('archetype',$1,$2,$3,$4,$5,$6,$7)
             on conflict (scope,scope_ref,layer,raw_label) do update set canonical=excluded.canonical, votes=excluded.votes, conflicts=excluded.conflicts, status=excluded.status, updated_at=now()`,
      [slug, layer, raw, top.canonical, Number(top.n), conflicts, status]).catch(() => {});
  }

  // promoted mappings that should auto-apply to this client (archetype + global)
  async function decisionsFor(client) {
    const out = {};
    try {
      const r = await q(`select layer, raw_label, canonical from norm_federation where status='promoted' and (scope='global'
        or (scope='archetype' and scope_ref=(select a.slug from contract_fingerprint f join archetype a on a.id=f.archetype_id where f.customer_id=(select id from customer where code=$1))))`, [client]);
      for (const x of r.rows || []) out[`${x.layer}:${x.raw_label}`] = x.canonical;
    } catch { /* */ }
    return out;
  }
  return { record, decisionsFor };
}
