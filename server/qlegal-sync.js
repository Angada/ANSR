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
    const tmp = mkdtempSync(join(tmpdir(), "qlsync-"));
    try {
      while (url) {
        const page = await graph(token, url);
        for (const item of page.value || []) {
          if (!item.file || item.deleted) continue;
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
