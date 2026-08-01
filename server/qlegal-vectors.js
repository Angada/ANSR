// Q-Legal vector spine — embeddings, hybrid retrieval, the vector wiki.
// (GODDOC §4.5.) Three granularities (document / section / clause), every row a
// POINTER to a real § — a vector hit never asserts, it locates. The embedding
// model is the gated pipeline `qlegal-embed` (Admin-swappable); rows record which
// model wrote them and retrieval NEVER compares vectors across models. With no
// key the spine still runs on a deterministic hashed embedding (hash:v1, the
// atlas-embed pattern) — point the pipeline at a real model later and the
// re-embed sweep migrates the estate.
import { q } from "./db/client.js";
import { loadConfig, getApiKey } from "./store.js";

const DIM = 1536;
const clip = (s, n) => String(s || "").slice(0, n);

// ---- feature detect: pgvector present? (cached; migration 027 may have failed
// harmlessly on a Postgres without the extension — everything degrades to FTS) --
let _ready = null;
export async function vectorsReady() {
  if (_ready !== null) return _ready;
  try {
    const r = await q(`select 1 from pg_extension where extname='vector'`);
    _ready = !!r.rows.length && !!(await q(`select 1 from information_schema.tables where table_name='ql_embedding'`)).rows.length;
  } catch { _ready = false; }
  return _ready;
}

// ---- the active embedding model (provider:model), resolved from the pipeline --
export function embedModelId() {
  const p = loadConfig().pipelines["qlegal-embed"];
  if (!p || !p.enabled) return "hash:v1";
  const key = getApiKey(p.provider);
  if (!key || !EMBEDDERS[p.provider]) return "hash:v1";
  return `${p.provider}:${p.model}`;
}

// pad/truncate to DIM, then L2-normalise (self-consistent across a model, so
// cosine stays meaningful even when a provider's native dim ≠ DIM)
function fit(vec) {
  const v = new Array(DIM).fill(0);
  for (let i = 0; i < Math.min(vec.length, DIM); i++) v[i] = Number(vec[i]) || 0;
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

// deterministic key-free fallback: word + trigram feature hashing into DIM dims.
// Weak semantics, zero cost, fully swappable — never blocks the product.
function hashEmbed(text) {
  const v = new Array(DIM).fill(0);
  const s = String(text || "").toLowerCase();
  const bump = (tok, w) => {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
    v[Math.abs(h) % DIM] += w * ((h & 1) ? 1 : -1);
  };
  for (const w of s.split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
    bump(w, 1);
    for (let i = 0; i + 3 <= w.length; i++) bump(w.slice(i, i + 3), 0.4);
  }
  return fit(v);
}

// ---- provider embedding calls (embeddings have no Anthropic-compat shape, so
// each provider gets its tiny adapter; all gated by the qlegal-embed pipeline) --
const EMBEDDERS = {
  openai: async (texts, model, key) => {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: texts, dimensions: DIM }),
    });
    if (!r.ok) throw new Error(`openai embeddings ${r.status}: ${clip(await r.text(), 140)}`);
    const j = await r.json();
    return (j.data || []).sort((a, b) => a.index - b.index).map((d) => fit(d.embedding));
  },
  google: async (texts, model, key) => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${key}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] }, outputDimensionality: DIM })) }),
    });
    if (!r.ok) throw new Error(`google embeddings ${r.status}: ${clip(await r.text(), 140)}`);
    const j = await r.json();
    return (j.embeddings || []).map((e) => fit(e.values || []));
  },
  zai: async (texts, model, key) => {
    // Z.AI's embeddings live on the paas endpoint (not the Anthropic-compat baseURL)
    const r = await fetch("https://api.z.ai/api/paas/v4/embeddings", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!r.ok) throw new Error(`zai embeddings ${r.status}: ${clip(await r.text(), 140)}`);
    const j = await r.json();
    return (j.data || []).sort((a, b) => (a.index || 0) - (b.index || 0)).map((d) => fit(d.embedding));
  },
};

// best-effort append-only log (mirrors qlegal.js logRun without the import cycle)
async function vlog({ model, ref_type, ref_id, input, output, status }) {
  try {
    await q(`insert into ql_log(pipeline,provider,model,ref_type,ref_id,input_summary,output_summary,status)
             values('qlegal-embed',$1,$2,$3,$4,$5,$6,$7)`,
      [model.split(":")[0], model.split(":")[1] || model, ref_type || null, ref_id || null, clip(input, 300), clip(output, 500), status || "ai"]);
  } catch { /* logging never blocks */ }
}

// embed a batch of texts with the ACTIVE model; falls back to hash:v1 on any
// failure so ingestion never stalls on an embedding outage.
export async function embedTexts(texts) {
  const id = embedModelId();
  if (id !== "hash:v1") {
    const [provider, model] = [id.split(":")[0], id.split(":").slice(1).join(":")];
    try {
      const out = [];
      for (let i = 0; i < texts.length; i += 48) out.push(...await EMBEDDERS[provider](texts.slice(i, i + 48), model, getApiKey(provider)));
      if (out.length === texts.length) return { model: id, vectors: out };
    } catch (e) {
      await vlog({ model: id, ref_type: "embed", input: `${texts.length} texts`, output: clip(String(e.message || e), 200), status: "error" });
    }
  }
  return { model: "hash:v1", vectors: texts.map(hashEmbed) };
}

const vlit = (v) => `[${v.join(",")}]`;   // pgvector literal

// ---- build the embeddable items for one document (from C1/C2, § anchors kept) --
function itemsFor({ meta = {}, summary = "", tags = [], contents = [], clauses = [] }, filename) {
  const items = [];
  const docText = [meta.title || filename, meta.doc_type, [meta.party1, meta.party2].filter(Boolean).join(" / "),
    meta.governing_law, summary, (tags || []).join(" ")].filter(Boolean).join(" · ");
  items.push({ granularity: "document", ref: null, title: meta.title || filename, content: clip(docText, 1200) });
  // sections: a contents heading + the gists of the clauses whose § falls under it
  const norm = (r) => String(r || "").replace(/[§\s]/g, "");
  for (const c of (contents || []).slice(0, 80)) {
    const under = (clauses || []).filter((cl) => {
      const a = norm(cl.ref), b = norm(c.ref);
      return b && a && (a === b || a.startsWith(b + "."));
    });
    const text = [c.heading, ...under.map((cl) => cl.gist || cl.label)].filter(Boolean).join(" · ");
    if (text.trim()) items.push({ granularity: "section", ref: clip(c.ref, 60) || null, title: clip(c.heading, 200), content: clip(text, 900) });
  }
  for (const cl of (clauses || []).slice(0, 240)) {
    const text = [cl.label, cl.gist].filter(Boolean).join(": ");
    if (text.trim()) items.push({ granularity: "clause", ref: clip(cl.ref, 60) || null, title: clip(cl.label, 120), content: clip(text, 600) });
  }
  return items;
}

// ---- embed one document's latest version (called at ingestion + by the sweep).
// One live vector set per document: previous rows are replaced wholesale — the
// spine is derived and rebuildable, never precious.
export async function embedVersion({ docId, verId, c2, filename }) {
  if (!(await vectorsReady())) return null;
  const items = itemsFor(c2 || {}, filename);
  if (!items.length) return null;
  const { model, vectors } = await embedTexts(items.map((i) => i.content));
  await q(`delete from ql_embedding where document_id=$1`, [docId]);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await q(`insert into ql_embedding(document_id, version_id, granularity, ref, title, content, embedding, embedding_model)
             values($1,$2,$3,$4,$5,$6,$7::vector,$8)`,
      [docId, verId, it.granularity, it.ref, it.title, it.content, vlit(vectors[i]), model]);
  }
  await vlog({ model, ref_type: "document", ref_id: docId, input: filename, output: `${items.length} vectors (doc/section/clause)` });
  return { model, count: items.length };
}

// ---- semantic search: embed the query, knn over rows of the SAME model --------
export async function searchVectors(text, { granularities = ["clause", "section", "document"], limit = 12 } = {}) {
  if (!(await vectorsReady())) return [];
  const { model, vectors } = await embedTexts([clip(text, 1000)]);
  const rows = (await q(
    `select e.document_id, e.granularity, e.ref, e.title, e.content, (e.embedding <=> $1::vector) as distance,
            d.filename, d.title as doc_title, d.doc_type
       from ql_embedding e join ql_document d on d.id=e.document_id
      where e.embedding_model=$2 and e.granularity = any($3) and coalesce(d.status,'active')<>'inactive'
      order by e.embedding <=> $1::vector limit $4`,
    [vlit(vectors[0]), model, granularities, limit]
  )).rows;
  return rows.map((r) => ({ ...r, similarity: Math.max(0, 1 - Number(r.distance)) }));
}

// ---- nearest documents in the estate (the wiki's computed panel) --------------
export async function nearestDocs(docId, limit = 5) {
  if (!(await vectorsReady())) return [];
  const mine = (await q(
    `select embedding, embedding_model from ql_embedding where document_id=$1 and granularity='document' limit 1`, [docId]
  )).rows[0];
  if (!mine) return [];
  return (await q(
    `select e.document_id as id, d.filename, d.title, d.doc_type, d.party1, d.party2,
            (e.embedding <=> $1::vector) as distance
       from ql_embedding e join ql_document d on d.id=e.document_id
      where e.granularity='document' and e.embedding_model=$2 and e.document_id<>$3
        and coalesce(d.status,'active')<>'inactive'
      order by e.embedding <=> $1::vector limit $4`,
    [mine.embedding, mine.embedding_model, docId, limit]
  )).rows.map((r) => ({ ...r, similarity: Math.max(0, Math.round((1 - Number(r.distance)) * 100)) }));
}

// ---- status + resumable sweep (Re-index console) ------------------------------
export async function embedStatus() {
  if (!(await vectorsReady())) return { available: false, model: embedModelId(), embedded: 0, pending: 0, vectors: 0 };
  const model = embedModelId();
  const one = async (sql, p = []) => Number((await q(sql, p)).rows[0]?.c || 0);
  const [embedded, pending, vectors] = await Promise.all([
    one(`select count(distinct document_id) c from ql_embedding where embedding_model=$1`, [model]),
    one(`select count(*) c from ql_document d
          where coalesce(d.status,'active')<>'inactive'
            and exists(select 1 from ql_version v where v.document_id=d.id and v.c1_text is not null)
            and not exists(select 1 from ql_embedding e where e.document_id=d.id and e.embedding_model=$1)`, [model]),
    one(`select count(*) c from ql_embedding`),
  ]);
  return { available: true, model, embedded, pending, vectors };
}

// documents with C1 but no vectors under the CURRENT model → embed (capped,
// call again to continue; a model swap simply makes everything pending again)
export async function embedSweep(limit = 10) {
  if (!(await vectorsReady())) return { processed: 0, remaining: 0, available: false };
  const model = embedModelId();
  const docs = (await q(
    `select d.id, d.filename, v.id as version_id, v.c2 from ql_document d
      join ql_version v on v.document_id=d.id and v.version_no=d.latest_version
     where coalesce(d.status,'active')<>'inactive' and v.c1_text is not null
       and not exists(select 1 from ql_embedding e where e.document_id=d.id and e.embedding_model=$1)
     order by d.id limit $2`, [model, Math.min(limit, 50)]
  )).rows;
  let done = 0;
  for (const d of docs) {
    const r = await embedVersion({ docId: d.id, verId: d.version_id, c2: d.c2, filename: d.filename }).catch(() => null);
    if (r) done++;
  }
  const st = await embedStatus();
  return { processed: done, remaining: st.pending, model: st.model, available: true };
}

// ---- emergent clause library: k-means over clause vectors ---------------------
// cluster centroid = the estate's norm; a member's distance from it = how
// non-standard that clause is. Deterministic seeding → stable clusters.
export async function clauseLibrary({ k } = {}) {
  if (!(await vectorsReady())) return { available: false, clusters: [] };
  const model = embedModelId();
  const rows = (await q(
    `select e.id, e.document_id, e.ref, e.title, e.content, e.embedding::text as emb,
            d.filename, d.title as doc_title
       from ql_embedding e join ql_document d on d.id=e.document_id
      where e.granularity='clause' and e.embedding_model=$1 and coalesce(d.status,'active')<>'inactive'
      limit 4000`, [model]
  )).rows;
  if (rows.length < 6) return { available: true, model, clusters: [], total: rows.length };
  const vecs = rows.map((r) => JSON.parse(r.emb));
  const K = Math.max(2, Math.min(k || Math.round(Math.sqrt(rows.length / 2)), 24));
  // deterministic spread seeding, then Lloyd's
  let centroids = Array.from({ length: K }, (_, i) => vecs[Math.floor((i * vecs.length) / K)].slice());
  let assign = new Array(vecs.length).fill(0);
  const d2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const t = a[i] - b[i]; s += t * t; } return s; };
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < vecs.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < K; c++) { const dd = d2(vecs[i], centroids[c]); if (dd < bd) { bd = dd; best = c; } }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    if (!moved) break;
    centroids = Array.from({ length: K }, () => new Array(DIM).fill(0));
    const counts = new Array(K).fill(0);
    for (let i = 0; i < vecs.length; i++) { counts[assign[i]]++; const c = centroids[assign[i]]; for (let j = 0; j < DIM; j++) c[j] += vecs[i][j]; }
    for (let c = 0; c < K; c++) if (counts[c]) for (let j = 0; j < DIM; j++) centroids[c][j] /= counts[c];
  }
  const clusters = [];
  for (let c = 0; c < K; c++) {
    const members = [];
    for (let i = 0; i < vecs.length; i++) if (assign[i] === c) members.push({ i, dist: Math.sqrt(d2(vecs[i], centroids[c])) });
    if (!members.length) continue;
    members.sort((a, b) => a.dist - b.dist);
    const label = rows[members[0].i].title || rows[members[0].i].content.slice(0, 40);
    clusters.push({
      label, size: members.length,
      // nearest to centroid = the estate norm; farthest = the outliers worth a look
      norm: members.slice(0, 3).map((m) => memberOut(rows[m.i], m.dist)),
      outliers: members.slice(-3).reverse().filter((m) => m.dist > members[0].dist * 1.25).map((m) => memberOut(rows[m.i], m.dist)),
    });
  }
  clusters.sort((a, b) => b.size - a.size);
  return { available: true, model, clusters, total: rows.length };
}
const memberOut = (r, dist) => ({ document_id: r.document_id, doc: r.doc_title || r.filename, ref: r.ref, title: r.title, gist: r.content, distance: Math.round(dist * 100) / 100 });

// ---- the estate map: 2D projection of document vectors (PCA, implicit power
// iteration — honest label: PCA, not UMAP; upgrade later without schema change) --
export async function estateMap() {
  if (!(await vectorsReady())) return { available: false, points: [] };
  const model = embedModelId();
  const rows = (await q(
    `select e.document_id as id, e.embedding::text as emb, d.filename, d.title, d.doc_type
       from ql_embedding e join ql_document d on d.id=e.document_id
      where e.granularity='document' and e.embedding_model=$1 and coalesce(d.status,'active')<>'inactive'
      limit 2000`, [model]
  )).rows;
  if (rows.length < 3) return { available: true, model, points: [] };
  const X = rows.map((r) => JSON.parse(r.emb));
  const n = X.length, d = X[0].length;
  const mean = new Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) x[j] -= mean[j];
  const project = (v) => X.map((x) => { let s = 0; for (let j = 0; j < d; j++) s += x[j] * v[j]; return s; });
  const powerIter = (deflate) => {
    let v = new Array(d).fill(0).map((_, j) => Math.sin(j + 1));   // deterministic start
    for (let it = 0; it < 18; it++) {
      const s = project(v);                                        // X v
      const nv = new Array(d).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) nv[j] += X[i][j] * s[i];   // Xᵀ(Xv)
      if (deflate) { let dp = 0; for (let j = 0; j < d; j++) dp += nv[j] * deflate[j]; for (let j = 0; j < d; j++) nv[j] -= dp * deflate[j]; }
      let norm = Math.sqrt(nv.reduce((a, x) => a + x * x, 0)) || 1;
      v = nv.map((x) => x / norm);
    }
    return v;
  };
  const p1 = powerIter(null), p2 = powerIter(p1);
  const xs = project(p1), ys = project(p2);
  const span = (a) => { const mn = Math.min(...a), mx = Math.max(...a); const s = mx - mn || 1; return a.map((v) => (v - mn) / s); };
  const nx = span(xs), ny = span(ys);
  return { available: true, model, points: rows.map((r, i) => ({ id: r.id, name: r.title || r.filename, type: r.doc_type || "unclassified", x: Math.round(nx[i] * 1000) / 1000, y: Math.round(ny[i] * 1000) / 1000 })) };
}
