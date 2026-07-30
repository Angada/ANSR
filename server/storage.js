// Persistent artifact store for the hybrid knowledge store.
//   T1 originals  → <customer>/originals/<sha>.<ext>
//   T2 md extract → <customer>/extracts/<docId>.md
// Two backends, chosen by env: local disk (dev) or a Supabase Storage bucket
// (prod — Cloud Run disk is ephemeral, so persisted docs MUST live in a bucket).
// Interface is async + backend-agnostic; callers pass an already-slugged customer.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET = process.env.SUPABASE_BUCKET || "docs";

// ---- backend selection ------------------------------------------------------
let _sb = null;
function supa() {
  if (_sb !== null) return _sb || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _sb = false; return null; }
  // dynamic import keeps the dep optional for pure-local dev.
  // (createClient is loaded lazily on first use below.)
  _sb = { url, key, client: null };
  return _sb;
}
async function client() {
  const s = supa();
  if (!s) return null;
  if (!s.client) {
    const { createClient } = await import("@supabase/supabase-js");
    s.client = createClient(s.url, s.key, { auth: { persistSession: false } });
  }
  return s.client;
}

export const usingBucket = () => Boolean(supa());

// ---- T1 originals -----------------------------------------------------------
export async function putOriginal(customer, sha256, ext, buf) {
  const e = (ext || "").replace(/^\./, "");
  const path = `${customer}/originals/${sha256}${e ? "." + e : ""}`;
  const c = await client();
  if (c) {
    await c.storage.from(BUCKET).upload(path, buf, { upsert: true });
    return `bucket:${BUCKET}/${path}`;
  }
  const abs = join(root, "uploads", customer, "originals", `${sha256}${e ? "." + e : ""}`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buf);
  return abs;
}

// Read back a T1 original by the storage_path putOriginal returned (disk path in
// dev, `bucket:<bucket>/<key>` in prod). Returns a Buffer, or null if it's gone.
export async function getOriginal(storagePath) {
  const p = String(storagePath || "");
  if (!p) return null;
  if (p.startsWith("bucket:")) {
    const c = await client();
    if (!c) return null;
    const rest = p.slice("bucket:".length);
    const bucket = rest.slice(0, rest.indexOf("/"));
    const key = rest.slice(rest.indexOf("/") + 1);
    const { data, error } = await c.storage.from(bucket).download(key);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }
  return existsSync(p) ? readFileSync(p) : null;
}

// ---- T2 markdown extracts ---------------------------------------------------
export async function putExtract(customer, docId, md) {
  const path = `${customer}/extracts/${docId}.md`;
  const c = await client();
  if (c) {
    await c.storage.from(BUCKET).upload(path, Buffer.from(md, "utf8"), {
      upsert: true, contentType: "text/markdown; charset=utf-8",
    });
    return `bucket:${BUCKET}/${path}`;
  }
  const abs = join(root, "docstore", customer, `${docId}.md`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, md);
  return abs;
}

export async function getExtract(customer, docId) {
  docId = String(docId || "").replace(/[^A-Za-z0-9._-]/g, "").replace(/\.\.+/g, "."); // no path traversal
  const c = await client();
  if (c) {
    const { data, error } = await c.storage.from(BUCKET).download(`${customer}/extracts/${docId}.md`);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer()).toString("utf8");
  }
  const abs = join(root, "docstore", customer, `${docId}.md`);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

export async function listExtracts(customer) {
  const c = await client();
  if (c) {
    const { data, error } = await c.storage.from(BUCKET).list(`${customer}/extracts`, { limit: 1000 });
    if (error || !data) return [];
    return data.filter((o) => o.name.endsWith(".md")).map((o) => o.name.replace(/\.md$/, ""));
  }
  const dir = join(root, "docstore", customer);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => extname(f) === ".md").map((f) => f.replace(/\.md$/, ""));
}
