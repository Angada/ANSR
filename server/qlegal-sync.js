// Q-Legal · SharePoint scanner — READ-ONLY Graph delta sync of the legal library.
// Every scan: client-credentials token → drive delta (only what changed since the
// stored cursor) → download each new/changed contract file → the SAME ingestFile
// pipeline as a manual upload (C1 → C2 → registers → obligations → links), with
// sp_item_id as the stable identity so SharePoint renames/moves never duplicate.
// Runs nightly at 02:00 IST (in-process timer) + on demand via "Scan now".
// Q-Legal never writes to SharePoint — there is no write scope to misuse.
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { q } from "./db/client.js";
import { encryptKey, decryptKey } from "./store.js";

const clip = (s, n) => String(s || "").slice(0, n);
const CONTRACT_EXT = /\.(pdf|docx?|txt|md)$/i;

// ---- config (singleton row; secret encrypted at rest) ------------------------
export async function getSyncRow() {
  return (await q(`select * from ql_sync where id=1`)).rows[0] || { config: {}, nightly: true };
}
export async function saveSyncConfig(patch) {
  const row = await getSyncRow();
  const cfg = { ...(row.config || {}) };
  for (const k of ["tenant_id", "client_id", "site_id", "drive_id", "folder"]) {
    if (patch[k] !== undefined) cfg[k] = clip(patch[k], 200).trim();
  }
  if (patch.client_secret) cfg.client_secret = encryptKey(clip(patch.client_secret, 300).trim());
  const nightly = patch.nightly !== undefined ? !!patch.nightly : row.nightly;
  await q(`update ql_sync set config=$1::jsonb, nightly=$2, updated_at=now() where id=1`, [JSON.stringify(cfg), nightly]);
  return publicSyncConfig(await getSyncRow());
}
export function publicSyncConfig(row) {
  const c = row.config || {};
  return {
    tenant_id: c.tenant_id || "", client_id: c.client_id || "", site_id: c.site_id || "",
    drive_id: c.drive_id || "", folder: c.folder || "",
    hasSecret: !!c.client_secret, nightly: row.nightly !== false,
    delta: !!row.delta_link, last_run: row.last_run || null, last_result: row.last_result || null,
  };
}
const ready = (c) => c.tenant_id && c.client_id && c.client_secret && c.site_id;

// ---- Graph plumbing ----------------------------------------------------------
async function graphToken(c) {
  const body = new URLSearchParams({
    client_id: c.client_id, client_secret: decryptKey(c.client_secret),
    scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant_id)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`token: ${j.error_description || j.error || r.status}`.slice(0, 200));
  return j.access_token;
}
async function graph(token, url) {
  const r = await fetch(url.startsWith("http") ? url : `https://graph.microsoft.com/v1.0${url}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`graph ${r.status}: ${j.error?.message || ""}`.slice(0, 200));
  return j;
}

// a removal is a PROPOSAL — the derived layer keeps everything until a human says
// "make inactive" in the confirm queue (the ask-to-make-inactive flow)
async function proposeRemoval(spItemId, why) {
  const doc = (await q(`select id, filename from ql_document where sp_item_id=$1 and coalesce(status,'active')<>'inactive'`, [spItemId])).rows[0];
  if (!doc) return;
  const open = (await q(`select 1 from ql_confirm where document_id=$1 and kind='removal' and status='open' limit 1`, [doc.id])).rows[0];
  if (open) return;
  await q(`insert into ql_confirm(kind, document_id, proposal, confidence, why) values('removal',$1,$2::jsonb,1,$3)`,
    [doc.id, JSON.stringify({ action: "mark_inactive" }), clip(why, 200)]).catch(() => {});
}

export async function testSharePoint() {
  const row = await getSyncRow();
  const c = row.config || {};
  if (!ready(c)) return { ok: false, detail: "fill tenant, client id, secret and site id first" };
  try {
    const token = await graphToken(c);
    const site = await graph(token, `/sites/${encodeURIComponent(c.site_id)}`);
    const drive = c.drive_id
      ? await graph(token, `/sites/${encodeURIComponent(c.site_id)}/drives/${encodeURIComponent(c.drive_id)}`)
      : await graph(token, `/sites/${encodeURIComponent(c.site_id)}/drive`);
    return { ok: true, detail: `connected — site “${site.displayName || site.name}”, library “${drive.name}” (read-only)` };
  } catch (e) { return { ok: false, detail: clip(e.message, 200) }; }
}

// ---- the scan ----------------------------------------------------------------
// ingestOne is injected from qlegal.js so both paths share ONE pipeline.
export async function scanSharePoint(ingestOne, { full = false } = {}) {
  const row = await getSyncRow();
  const c = row.config || {};
  if (!ready(c)) return { ok: false, error: "SharePoint is not configured — open Manage → SharePoint" };
  const started = Date.now();
  const out = { ok: true, seen: 0, ingested: 0, versions: 0, skipped: 0, errors: [] };
  try {
    const token = await graphToken(c);
    const drivePath = c.drive_id
      ? `/sites/${encodeURIComponent(c.site_id)}/drives/${encodeURIComponent(c.drive_id)}`
      : `/sites/${encodeURIComponent(c.site_id)}/drive`;
    let url = (!full && row.delta_link) ? row.delta_link
      : `https://graph.microsoft.com/v1.0${drivePath}/root${c.folder ? `:/${encodeURIComponent(c.folder)}:` : ""}/delta`;
    let deltaLink = null;
    const seenIds = new Set();          // full walk: everything still in the library
    const tmp = mkdtempSync(join(tmpdir(), "qlsync-"));
    try {
      while (url) {
        const page = await graph(token, url);
        for (const item of page.value || []) {
          // a delta can report a deletion explicitly → propose marking inactive
          if (item.deleted && item.id) { await proposeRemoval(item.id, "removed from the SharePoint library (delta)"); out.removed = (out.removed || 0) + 1; continue; }
          if (!item.file) continue;
          if (item.id) seenIds.add(item.id);
          if (!CONTRACT_EXT.test(item.name || "")) continue;
          out.seen++;
          try {
            // unchanged since we last saw this item? (cTag moves on content change)
            const known = (await q(`select facts->>'sp_ctag' t from ql_document where sp_item_id=$1`, [item.id])).rows[0];
            if (known && known.t && known.t === item.cTag) { out.skipped++; continue; }
            const dl = item["@microsoft.graph.downloadUrl"];
            if (!dl) { out.skipped++; continue; }
            const fr = await fetch(dl, { signal: AbortSignal.timeout(60000) });
            const buf = Buffer.from(await fr.arrayBuffer());
            const p = join(tmp, `sp-${out.seen}-${clip(item.name, 80).replace(/[^\w.-]/g, "_")}`);
            writeFileSync(p, buf);
            const r = await ingestOne({ path: p, originalname: item.name }, {
              source: "sharepoint", spItemId: item.id,
              spMeta: { sp_ctag: item.cTag || "", sp_web_url: item.webUrl || "", sp_modified: item.lastModifiedDateTime || "", sp_modified_by: item.lastModifiedBy?.user?.displayName || "" },
            });
            try { rmSync(p); } catch { /* ignore */ }
            if (r.document_id) { out.ingested++; if (r.version_no > 1) out.versions++; }
            else if (r.skipped) out.skipped++;
            else if (r.error) out.errors.push(`${item.name}: ${r.error}`);
          } catch (e) { out.errors.push(`${item.name}: ${clip(e.message, 120)}`); }
        }
        deltaLink = page["@odata.deltaLink"] || deltaLink;
        url = page["@odata.nextLink"] || null;
      }
    } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } }
    // a FULL walk saw the whole library: any active SP-sourced doc we did NOT see
    // is gone from SharePoint → propose marking it inactive (never auto-delete)
    if (full) {
      const spDocs = (await q(`select id, sp_item_id, filename from ql_document where sp_item_id is not null and coalesce(status,'active')<>'inactive'`)).rows;
      for (const d of spDocs) {
        if (!seenIds.has(d.sp_item_id)) { await proposeRemoval(d.sp_item_id, "no longer found in the SharePoint library (full sweep)"); out.removed = (out.removed || 0) + 1; }
      }
    }
    if (deltaLink) await q(`update ql_sync set delta_link=$1 where id=1`, [deltaLink]);
  } catch (e) { out.ok = false; out.error = clip(e.message, 200); }
  out.ms = Date.now() - started;
  await q(`update ql_sync set last_run=now(), last_result=$1::jsonb where id=1`, [JSON.stringify(out)]).catch(() => {});
  await q(`insert into ql_log(pipeline, ref_type, input_summary, output_summary, status)
           values('qlegal-sync','sharepoint',$1,$2,$3)`,
    [full ? "full scan" : "delta scan", clip(`seen ${out.seen} · ingested ${out.ingested} · skipped ${out.skipped} · errors ${out.errors.length}`, 400),
     out.ok ? "ok" : `error: ${out.error}`]).catch(() => {});
  return out;
}

// ---- browse the library live (read-only): folder listing + Graph search ------
export async function listSharePoint({ folder = "", search = "" } = {}) {
  const row = await getSyncRow();
  const c = row.config || {};
  if (!ready(c)) return { error: "SharePoint is not configured — open Manage → SharePoint" };
  const token = await graphToken(c);
  const drivePath = c.drive_id
    ? `/sites/${encodeURIComponent(c.site_id)}/drives/${encodeURIComponent(c.drive_id)}`
    : `/sites/${encodeURIComponent(c.site_id)}/drive`;
  const base = c.folder ? `${c.folder}${folder ? "/" + folder : ""}` : folder;
  const url = search
    ? `${drivePath}/root${base ? `:/${encodeURIComponent(base)}:` : ""}/search(q='${encodeURIComponent(search.replace(/'/g, ""))}')?$top=60`
    : `${drivePath}/root${base ? `:/${encodeURIComponent(base)}:` : ""}/children?$top=200&$orderby=lastModifiedDateTime desc`;
  const page = await graph(token, url);
  const items = (page.value || []).map((i) => ({
    id: i.id, name: i.name, isFolder: !!i.folder, childCount: i.folder?.childCount || 0,
    size: i.size || 0, modified: i.lastModifiedDateTime || "", modified_by: i.lastModifiedBy?.user?.displayName || "",
    path: String(i.parentReference?.path || "").replace(/^\/drives\/[^/]+\/root:?\/?/, ""), web_url: i.webUrl || "",
  }));
  // cross-reference: which of these are already indexed in Q-Legal?
  const ids = items.filter((i) => !i.isFolder).map((i) => i.id);
  const known = ids.length ? (await q(`select id, sp_item_id, doc_type, status from ql_document where sp_item_id = any($1)`, [ids])).rows : [];
  const byItem = Object.fromEntries(known.map((k) => [k.sp_item_id, k]));
  for (const i of items) { const k = byItem[i.id]; if (k) { i.doc_id = k.id; i.doc_type = k.doc_type; i.doc_status = k.status; } }
  return { files: items.filter((i) => !i.isFolder), folders: items.filter((i) => i.isFolder), base: base || "" };
}

// pull ONE file from the library through the ingestion pipeline (the "Ingest now"
// button in the SharePoint browser) — same read-only access, same pipeline.
export async function ingestSharePointItem(ingestOne, itemId) {
  const row = await getSyncRow();
  const c = row.config || {};
  if (!ready(c)) return { error: "SharePoint is not configured" };
  const token = await graphToken(c);
  const drivePath = c.drive_id
    ? `/sites/${encodeURIComponent(c.site_id)}/drives/${encodeURIComponent(c.drive_id)}`
    : `/sites/${encodeURIComponent(c.site_id)}/drive`;
  const item = await graph(token, `${drivePath}/items/${encodeURIComponent(itemId)}`);
  if (!item.file) return { error: "that item is a folder" };
  const dl = item["@microsoft.graph.downloadUrl"];
  if (!dl) return { error: "no download url for that item" };
  const fr = await fetch(dl, { signal: AbortSignal.timeout(60000) });
  const buf = Buffer.from(await fr.arrayBuffer());
  const tmp = mkdtempSync(join(tmpdir(), "qlsp-"));
  const p = join(tmp, clip(item.name, 80).replace(/[^\w.-]/g, "_"));
  try {
    writeFileSync(p, buf);
    return await ingestOne({ path: p, originalname: item.name }, {
      source: "sharepoint", spItemId: item.id,
      spMeta: { sp_ctag: item.cTag || "", sp_web_url: item.webUrl || "", sp_modified: item.lastModifiedDateTime || "", sp_modified_by: item.lastModifiedBy?.user?.displayName || "" },
    });
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } }
}

// ---- nightly 02:00 IST scheduler (in-process) --------------------------------
// Works whenever an instance is alive. On scale-to-zero hosting, ALSO point a
// Cloud Scheduler job at POST /api/qlegal/sharepoint/scan for a guaranteed run.
function msToNext2amIST() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const next = new Date(ist);
  next.setHours(2, 0, 0, 0);
  if (ist >= next) next.setDate(next.getDate() + 1);
  return Math.max(60000, next - ist);
}
export function scheduleNightlyScan(ingestOne) {
  const arm = () => {
    const ms = msToNext2amIST();
    setTimeout(async () => {
      try {
        const row = await getSyncRow();
        if (row.nightly !== false && ready(row.config || {})) {
          console.log("qlegal-sync: nightly 02:00 IST scan starting");
          await scanSharePoint(ingestOne).catch((e) => console.warn("qlegal-sync nightly:", e.message));
        }
      } finally { arm(); }                       // re-arm for tomorrow, always
    }, ms).unref?.();
    console.log(`qlegal-sync: nightly scan armed (${Math.round(ms / 60000)} min to 02:00 IST)`);
  };
  arm();
}
