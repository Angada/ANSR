// Similarity between fingerprints (weighted Jaccard over the physiology) + ranking.
function jaccard(a = [], b = []) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const W = { heads: 0.4, dims: 0.25, inputs: 0.2, measures: 0.1, currency: 0.05 };

export function similarity(a, b) {
  if (!a || !b) return 0;
  return W.heads * jaccard(a.heads, b.heads)
    + W.dims * jaccard(a.dims, b.dims)
    + W.inputs * jaccard(a.inputs, b.inputs)
    + W.measures * jaccard(a.measures, b.measures)
    + W.currency * (a.currency === b.currency ? 1 : 0);
}

// rank archetypes by similarity to a fingerprint
export function rank(fp, archetypes) {
  return archetypes
    .map((a) => ({ archetype_id: a.id, slug: a.slug, name: a.name, version: a.version, sim: Number(similarity(fp, a.fingerprint).toFixed(4)) }))
    .sort((x, y) => y.sim - x.sim);
}

// routing decision from the top candidate
export function decide(top) {
  const sim = top?.sim || 0;
  if (sim >= 0.8) return "matched";
  if (sim >= 0.5) return "partial";
  return "novel";
}
