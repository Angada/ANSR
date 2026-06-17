// Atlas embeddings — a semantic signal on top of the structural Jaccard match.
// Deterministic, key-free: a hashed bag-of-tokens vector (signed, L2-normalised).
// Captures vocabulary overlap the fingerprint set-similarity misses (esp. on raw
// SOW text). Pluggable: swap embed() for a provider call later; cosine/blend stay.
export function createEmbedder({ dim = 256 } = {}) {
  const DIM = dim;
  const tokens = (t) => String(t || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  function hashTok(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function embed(text) {
    const v = new Array(DIM).fill(0);
    for (const tok of tokens(text)) { const h = hashTok(tok); v[h % DIM] += ((h >>> 16) & 1) ? 1 : -1; }
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    return v.map((x) => x / n);
  }
  // both vectors are L2-normalised, so cosine == dot product
  function cosine(a, b) { if (!a || !b || a.length !== b.length) return 0; let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }
  // a text view of a fingerprint to embed
  const fpText = (fp = {}) => [...(fp.heads || []), ...(fp.dims || []), ...(fp.measures || []), ...(fp.milestones || []), ...(fp.inputs || []), fp.currency || ""].join(" ");
  return { embed, cosine, fpText, DIM };
}
