// Fingerprint a contract's billing physiology from its compiled rule book —
// structured + comparable (not its words). Deterministic.
const uniqSort = (a) => [...new Set(a.filter(Boolean))].sort();

const HEAD_LABEL = { one_time_split: "split-fee", recurring_slab: "headcount-slab", recurring_per_unit: "per-unit", flat: "flat", clawback: "clawback", credit: "credit" };

export function fingerprint(rb) {
  const heads = uniqSort((rb.cost_heads || []).map((h) => h.kind));
  const dims = uniqSort((rb.cost_heads || []).flatMap((h) => h.rate_table?.keys || []));
  const measures = uniqSort((rb.cost_heads || []).map((h) => h.measure || h.base));
  const milestones = uniqSort((rb.cost_heads || []).flatMap((h) => (h.milestones || []).map((m) => m.code)));
  const inputs = uniqSort((rb.inputs || []).map((i) => i.field));
  return {
    heads, dims, measures, milestones, inputs,
    currency: rb.base_currency || "USD",
    flags: { milestones: milestones.length > 0, slabs: heads.includes("recurring_slab"), split: heads.includes("one_time_split") },
  };
}

// human slug/name from the head set, e.g. "split-fee+headcount-slab"
export function archetypeSlug(fp) {
  const parts = fp.heads.map((h) => HEAD_LABEL[h] || h);
  return (parts.join("+") || "flat") + (fp.currency && fp.currency !== "USD" ? `+${fp.currency.toLowerCase()}` : "");
}
export function archetypeName(fp) {
  const parts = fp.heads.map((h) => (HEAD_LABEL[h] || h).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  return parts.join(" + ") || "Flat fee";
}

export function playbook(name, fp, rb) {
  const lines = [`## ${name}`, "", `**Revenue heads:** ${fp.heads.join(", ") || "—"}`,
    `**Drivers / dimensions:** ${fp.dims.join(", ") || "—"}`,
    `**Measures:** ${fp.measures.join(", ") || "—"}`,
    `**Milestones:** ${fp.milestones.join(", ") || "—"}`,
    `**Currency:** ${fp.currency}`, "",
    `### Worksheet needs`, ...(rb.inputs || []).map((i) => `- ${i.field} — ${i.why || i.type || ""}`), "",
    `### Journey`, "1. Upload contract → boxes → rule book (pre-loaded from this archetype).",
    "2. Recalibrate → confirm the deltas (rates/slabs specific to this contract).",
    "3. Upload worksheet (file or API) → normalize → clarify → compute.",
    "4. Outputs: invoice · statement · charts."];
  return lines.join("\n");
}
