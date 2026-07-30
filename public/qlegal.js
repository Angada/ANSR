// Q-Legal — legal repository intelligence. Areas: Repository (Registry · Search
// & Ask) · Tasks (Obligations) · Governance (Confirm queue · Business rules ·
// AI activity). SharePoint/upload is the source of truth; everything here is the
// derived layer: C1/C2 per version, wiki drill-in, doc tree, grounded answers.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
// ts_headline highlights hits with <b>…</b> — escape everything else, keep the <b>s
const snip = (s) => esc(s).replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
// India sequence, always Asia/Kolkata. Compact dd-mm-yyyy for timestamps/tables;
// the weekday only where a human plans around it (due dates): "Mon, 9 Jun, 2026".
const IST = { timeZone: "Asia/Kolkata" };
const _parts = (ts, opts) => new Intl.DateTimeFormat("en-IN", { ...IST, ...opts }).formatToParts(new Date(ts)).reduce((o, p) => ((o[p.type] = p.value), o), {});
const fmtD = (ts) => { if (!ts) return ""; const p = _parts(ts, { day: "2-digit", month: "2-digit", year: "numeric" }); return `${p.day}-${p.month}-${p.year}`; };
const fmtDay = (ts) => { if (!ts) return ""; const p = _parts(ts, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); return `${p.weekday}, ${p.day} ${p.month}, ${p.year}`; };
const fmtDT = (ts) => { if (!ts) return ""; const p = _parts(ts, { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }); return `${p.day}-${p.month}-${p.year} · ${p.hour}:${p.minute} ${(p.dayPeriod || "").toLowerCase()}`; };

let AREA = "repository";
let SUB = { repository: "registry", tasks: "obligations", governance: "confirm" };
let DOCS = [], BY_TYPE = [], LOADED = false;
let OPEN = null;                 // wiki payload { document, versions, c2, obligations, children, parent, confirms, registers }
let HITS = null;
let THREAD = [];                 // the Ask conversation: [{q, a, sources, rungs}] — follow-ups keep context
let ASKING = false;
let OBLIGS = [], CONFIRMS = [], RULES = [], LOG = [];
let REGISTERS = [], REG_TOTAL = 0, REG_OPEN = null;   // Registers: list + the open estate-wide answer table
let CONF_N = null;

const VIEWS = { registry: "#view-registry", search: "#view-search", registers: "#view-registers", obligations: "#view-obligations", confirm: "#view-confirm", rules: "#view-rules", log: "#view-log" };

window.filterTable = (tid, v) => {
  const term = (v || "").toLowerCase().trim();
  const rows = [...document.querySelectorAll(`#${tid} tbody tr`)];
  let shown = 0;
  rows.forEach((tr) => { const m = (tr.dataset.k || "").includes(term); const show = term ? m : shown < 12; tr.style.display = show ? "" : "none"; if (show) shown++; });
  const note = document.getElementById(tid + "-note");
  if (note) note.textContent = term ? `${shown} match${shown === 1 ? "" : "es"} of ${rows.length}` : `showing ${Math.min(12, rows.length)} of ${rows.length}`;
};
async function runWithMeter(hostId, steps, promise) {
  const host = document.getElementById(hostId); if (!host) return promise;
  let i = 0;
  const render = () => { host.innerHTML = `<div class="meter"><div class="cmeter-steps">${steps.map((s, idx) => `<div class="cmstep ${idx < i ? "done" : idx === i ? "now" : ""}"><span class="cmi">${idx < i ? '<span class="ck">✓</span>' : idx === i ? '<img class="potspin" src="/brand/assets/logos/pot.png" alt="">' : '<span class="cmdot"></span>'}</span><span>${esc(s)}</span></div>`).join("")}</div><div class="track"><div class="fill" style="width:${Math.round((i / steps.length) * 100)}%"></div></div></div>`; };
  render();
  const timer = setInterval(() => { if (i < steps.length - 1) { i++; render(); } }, 1600);
  try { const r = await promise; i = steps.length; render(); return r; }
  finally { clearInterval(timer); }
}

function renderNav() {
  $("#mainnav").innerHTML = [["repository", "Repository"], ["tasks", "Tasks"], ["governance", "Governance"]]
    .map(([k, l]) => `<button class="${AREA === k ? "on" : ""}" onclick="setArea('${k}')">${l}</button>`).join("");
  const subs = AREA === "repository"
    ? [["registry", "Registry", LOADED ? DOCS.length : null], ["search", "Search & Ask", null], ["registers", "Registers", REGISTERS.length || null]]
    : AREA === "tasks"
      ? [["obligations", "Obligations", OBLIGS.length || null]]
      : [["confirm", "Confirm queue", CONF_N], ["rules", "Business rules", RULES.length || null], ["log", "AI activity", null]];
  $("#subnav").innerHTML = subs.map(([k, l, n]) => `<button class="${SUB[AREA] === k ? "on" : ""}" onclick="setSub('${k}')">${l}${n ? `<span class="count">${n}</span>` : ""}</button>`).join("");
}
window.setArea = (a) => { AREA = a; setSub(SUB[a]); };
window.setSub = (s) => { SUB[AREA] = s; renderNav(); Object.values(VIEWS).forEach((v) => ($(v).hidden = true)); $(VIEWS[s]).hidden = false; renderView(s); };
function renderView(s) { ({ registry: renderRegistry, search: renderSearch, registers: renderRegisters, obligations: renderObligations, confirm: renderConfirm, rules: renderRules, log: renderLog }[s])(); }

async function loadRegistry() {
  try { const j = await (await fetch("/api/qlegal/registry")).json(); DOCS = j.documents || []; BY_TYPE = j.by_type || []; LOADED = true; } catch { DOCS = []; }
}
async function loadConfirmCount() {
  try { CONF_N = ((await (await fetch("/api/qlegal/confirms")).json()).confirms || []).length || null; } catch { CONF_N = null; }
}
async function init() {
  await loadRegistry(); loadConfirmCount().then(renderNav); loadRegisters().then(renderNav);
  renderNav();
  Object.values(VIEWS).forEach((v) => ($(v).hidden = true));
  $(VIEWS[SUB[AREA]]).hidden = false;
  renderView(SUB[AREA]);
}

// ---- Repository · Registry (dropzone + estate table + wiki drill-in) --------
function renderRegistry() {
  const host = $("#view-registry");
  if (OPEN) { host.innerHTML = wikiView(); return; }
  const drop = `<div class="drop" onclick="document.getElementById('qfile').click()"
      ondragover="dzOver(event)" ondragenter="dzOver(event)" ondragleave="dzLeave(event)" ondrop="dzDrop(event)">
    <span class="ic">⇊</span>
    <div><div class="t">Drop contracts — or select files (up to 20)</div>
      <div class="s">PDF / DOCX / scans (vision-OCR) · each becomes C1 transcript + C2 key · same filename = a new version of that document</div></div>
    <input type="file" id="qfile" accept=".pdf,.docx,.doc,.txt,.md" multiple onchange="qUpload(this.files)">
  </div>`;
  const types = BY_TYPE.length ? `<div class="typerow">${BY_TYPE.map((t) => `<span class="typect">${esc(t.t)} <b>${t.c}</b></span>`).join("")}</div>` : "";
  const rows = DOCS.map((d) => {
    const f = d.facts || {};
    const dates = [f.effective_date, f.expiry_date].filter(Boolean).join(" → ");
    const tags = (d.tags || []).slice(0, 4).map((t) => `<span class="tagchip">${esc(t)}</span>`).join(" ");
    return `<tr class="clk" data-k="${esc([d.filename, d.title, d.doc_type, d.party1, d.party2, d.counterparty, (d.tags || []).join(" ")].join(" ").toLowerCase())}" onclick="openDoc(${d.id})">
      <td><b>${esc(d.title || d.filename)}</b>${d.title ? `<div class="am">${esc(d.filename)}</div>` : ""}</td>
      <td>${d.doc_type ? `<span class="typebadge">${esc(d.doc_type)}</span>` : "<span class='am'>—</span>"}</td>
      <td>${esc([d.party1, d.party2].filter(Boolean).join(" ⟷ ")) || "<span class='am'>—</span>"}</td>
      <td>${esc(dates) || "<span class='am'>—</span>"}</td>
      <td>${tags || "<span class='am'>—</span>"}</td>
      <td>v${d.latest_version}${d.scanned ? ' <span class="am">· scan</span>' : ""}</td>
      <td>${Number(d.open_obligations) ? `<span class="duechip due-soon">${d.open_obligations}</span>` : "<span class='am'>—</span>"}</td>
      <td class="am">${fmtD(d.updated_at)}</td>
    </tr>`;
  }).join("");
  host.innerHTML = `<p class="intro"><b>REGISTRY</b> — the estate. Every document lands once, is transcribed (C1), keyed (C2: parties, dates, clauses, notice machinery), tagged and versioned. Click a row for its wiki page.</p>`
    + drop + `<div id="qproc"></div>` + types
    + (DOCS.length
      ? `<div class="cfilter"><input placeholder="filter by name, type, party, tag…" oninput="filterTable('regtable',this.value)"><span class="am" id="regtable-note"></span></div>
         <div class="scroll-x"><table class="ctable" id="regtable"><thead><tr><th>Contract</th><th>Type</th><th>Parties</th><th>Dates</th><th>Tags</th><th>Ver</th><th>Oblig.</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty">// the repository is empty — drop the first contracts above //</div>`);
  if (DOCS.length) filterTable("regtable", "");
}
window.dzOver = (e) => { e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = "copy"); e.currentTarget.classList.add("over"); };
window.dzLeave = (e) => { e.currentTarget.classList.remove("over"); };
window.dzDrop = (e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); const fs = e.dataTransfer?.files; if (fs && fs.length) qUpload(fs); };
window.qUpload = async (files) => {
  if (!files || !files.length) return;
  const fd = new FormData(); [...files].forEach((f) => fd.append("files", f));
  const req = (async () => { const r = await fetch("/api/qlegal/upload", { method: "POST", body: fd }); return { ok: r.ok, j: await r.json() }; })();
  try {
    const { ok, j } = await runWithMeter("qproc", ["Reading file(s) · vision-OCR for scans", "Vault snapshot + C1 transcript", "Concise key (C2) · facts · tags · notice register", "Mapping obligations & deadlines", "Proposing doc-tree links"], req);
    const p = $("#qproc"); if (p) p.innerHTML = "";
    if (!ok) return rdAlert("Upload failed", j.error || "");
    const done = (j.results || []).filter((r) => r.document_id).length;
    const dups = (j.results || []).filter((r) => r.skipped).length;
    const errs = (j.results || []).filter((r) => r.error);
    await loadRegistry(); loadConfirmCount().then(renderNav); renderNav(); renderRegistry();
    let msg = `${done} document${done === 1 ? "" : "s"} indexed.`;
    if (dups) msg += ` ${dups} skipped (already in the repository).`;
    if (errs.length) msg += ` ${errs.length} failed: ${errs.map((e) => `${e.filename} — ${e.error}`).join("; ")}`;
    rdAlert("Ingestion complete", msg);
    const stub = (j.results || []).find((r) => r.mode && r.mode !== "ai");
    if (stub) rdAlert("No keyed model", "Documents landed with a generic key. Point the Q-Legal pipelines at a keyed model in AI Skills & Pipelines for the real C2 extraction.");
  } catch (e) { const p = $("#qproc"); if (p) p.innerHTML = ""; rdAlert("Upload failed", String(e.message || e)); }
};

// ---- wiki page ---------------------------------------------------------------
window.openDoc = async (id) => {
  try { OPEN = await (await fetch(`/api/qlegal/document/${id}`)).json(); } catch { return; }
  AREA = "repository"; SUB.repository = "registry"; renderNav();
  Object.values(VIEWS).forEach((v) => ($(v).hidden = true)); $("#view-registry").hidden = false;
  renderRegistry(); window.scrollTo({ top: 0, behavior: "smooth" });
};
window.closeDoc = () => { OPEN = null; renderRegistry(); };
// The three ways into any document + the family jump — available from every page.
function openRow(d) {
  const latest = (OPEN.versions || []).find((v) => v.version_no === d.latest_version) || (OPEN.versions || [])[0];
  if (!latest) return "";
  const fam = (OPEN.parent ? 1 : 0) + (OPEN.children || []).length;
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:-8px 0 18px">
    <button class="btn small" onclick="window.open('/api/qlegal/original/${latest.id}','_blank')" title="our vault snapshot of the file itself — the authority">📄 Open the file</button>
    <button class="btn small" onclick="window.open('/api/qlegal/c1/${latest.id}','_blank')" title="the comprehensive transcript — every clause, table and field">📖 C1 · full transcript</button>
    <button class="btn small" onclick="window.open('/api/qlegal/c2/${latest.id}','_blank')" title="the concise key + the contents and clause wikis">🔑 C2 · key + wikis</button>
    ${fam ? `<button class="btn small" onclick="document.getElementById('famcard')?.scrollIntoView({behavior:'smooth'})" title="the related contracts">🌳 Family · ${fam}</button>` : ""}
  </div>`;
}
function factCell(k, key, v) {
  return `<span class="cfact" title="click to correct" onclick="fixFact('${key}','${esc(String(v ?? "")).replace(/'/g, "&#39;")}')"><span class="cfk">${k}</span>${esc(v || "—")}</span>`;
}
function wikiView() {
  const d = OPEN.document, f = d.facts || {}, c2 = OPEN.c2 || {};
  const head = `<span class="backlnk" onclick="closeDoc()">‹ back to registry</span>
    <div class="chead">
      <div class="chead-emb">Q</div>
      <div class="chead-body">
        <div class="chead-titlerow"><span class="chead-title">${esc(d.title || d.filename)}</span>${d.doc_type ? `<span class="typebadge">${esc(d.doc_type)}</span>` : ""}${(d.tags || []).map((t) => `<span class="tagchip">${esc(t)}</span>`).join(" ")}</div>
        ${(d.party1 || d.party2) ? `<div class="chead-parties">${esc(d.party1 || "?")}<span class="vs">⟷</span>${esc(d.party2 || "?")}</div>` : ""}
        <div class="chead-facts">
          ${factCell("Effective", "effective_date", f.effective_date)}${factCell("Expiry", "expiry_date", f.expiry_date)}
          ${factCell("Governing law", "governing_law", f.governing_law)}${factCell("Value", "value", f.value)}
          ${factCell("Auto-renewal", "auto_renewal", f.auto_renewal === true ? "yes" : f.auto_renewal === false ? "no" : "")}
          ${factCell("Notice period", "notice_period", f.notice_period)}${factCell("Status", "status", d.status)}
        </div>
      </div>
      <button class="btn small" onclick="delDoc(${d.id})" title="remove from the derived layer (the original stays in the source of truth)">✕</button>
    </div>` + openRow(d);
  const summary = d.summary ? `<div class="wikicard"><div class="rsec-lbl">Summary</div><p class="rsummary">${esc(d.summary)}</p></div>` : "";
  const notice = c2.notice || {};
  const nrows = [
    ...(notice.notice_clauses || []).map((n) => `<div class="rsummary" style="margin-bottom:6px">• notify — ${esc(n.what || "")} ${n.method ? `· ${esc(n.method)}` : ""} ${n.days ? `· ${esc(String(n.days))} days` : ""} <span class="ref">${esc(n.ref || "")}</span></div>`),
    ...(notice.change_of_control || []).map((n) => `<div class="rsummary" style="margin-bottom:6px">• change of control — requires <b>${esc(n.requires || "notice")}</b> <span class="ref">${esc(n.ref || "")}</span></div>`),
  ].join("");
  const noticeCard = nrows ? `<div class="wikicard"><div class="rsec-lbl">Notice machinery · the change-of-guard register</div>${nrows}${(notice.notice_contacts || []).filter(Boolean).length ? `<div class="am" style="margin-top:6px">contacts: ${esc((notice.notice_contacts || []).filter(Boolean).join(" · "))}</div>` : ""}</div>` : "";
  const vrows = (OPEN.versions || []).map((v) => `<div class="vrow">
      <span class="vno">v${v.version_no}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
          ${v.is_executed ? '<span class="ochip o-done">executed</span>' : ""}${v.ocr ? '<span class="chip">scan · OCR</span>' : ""}
          ${v.status === "error" ? `<span class="ochip o-proposed">error: ${esc(v.error || "")}</span>` : ""}
          <a class="ref" href="/api/qlegal/c1/${v.id}" target="_blank" title="the C1 transcript (doc×api switch — never the original)">C1 transcript ↗</a>
        </div>
        ${v.diff_summary ? `<div class="vdiff" style="margin-top:6px">${esc(v.diff_summary)}</div>` : ""}
        <div class="vmeta">${fmtDT(v.created_at)} · sha ${esc((v.sha256 || "").slice(0, 10))}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">
          <a class="ref" href="/api/qlegal/original/${v.id}" target="_blank">📄 file</a>
          <a class="ref" href="/api/qlegal/c1/${v.id}" target="_blank">📖 C1</a>
          <a class="ref" href="/api/qlegal/c2/${v.id}" target="_blank">🔑 C2</a>
        </div>
      </div>
    </div>`).join("");
  const rail = `<div class="wikicard"><div class="rsec-lbl">Version rail · one document, many versions</div><div class="vrail">${vrows || "—"}</div></div>`;
  const obls = (OPEN.obligations || []).map((o) => obligationRow(o, true)).join("");
  const oblCard = `<div class="wikicard"><div class="rsec-lbl">Obligations & deadlines</div>${obls || '<span class="am">none extracted</span>'}</div>`;
  const parent = OPEN.parent ? `<div class="treecard" onclick="openDoc(${OPEN.parent.id})">↑ <b>${esc(OPEN.parent.title || OPEN.parent.filename)}</b> <span class="relk">${esc(d.relation_kind || "parent")}${d.relation_status === "confirmed" ? " ✓" : " · proposed"}</span> <span class="am" style="margin-left:auto">open ›</span></div>` : "";
  const kids = (OPEN.children || []).map((k) => `<div class="treecard" onclick="openDoc(${k.id})">↳ <b>${esc(k.title || k.filename)}</b> ${k.doc_type ? `<span class="typebadge">${esc(k.doc_type)}</span>` : ""} <span class="relk">${esc(k.relation_kind || "child")}</span> <span class="am" style="margin-left:auto">open ›</span></div>`).join("");
  const treeCard = (parent || kids) ? `<div class="wikicard" id="famcard"><div class="rsec-lbl">Document family · click through to a related contract</div>${parent}${kids}</div>` : "";
  // register answers — this contract's answer to every standing question
  const P = { yes: "due-ok", no: "due-none", unclear: "due-soon" };
  const regs = (OPEN.registers || []);
  const regCard = regs.length ? `<div class="wikicard"><div class="rsec-lbl">Standing questions · this contract's answers</div>
      ${regs.map((r) => `<div style="display:flex;align-items:flex-start;gap:9px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line)">
        <span class="duechip ${P[r.present] || "due-none"}">${esc(r.present)}</span>
        <span style="flex:1;min-width:220px;font-size:13px;line-height:1.5"><b>${esc(r.name)}</b>${r.value ? ` · ${esc(r.value)}` : ""}<div class="am" style="margin-top:2px">${esc(r.answer || "")}</div></span>
        ${(r.refs || []).map((x) => `<span class="ref">${esc(x)}</span>`).join(" ")}
        <button class="btn small" onclick="fixHit(${r.id},'${esc(r.present)}','${esc(r.answer || "").replace(/'/g, "&#39;")}','${esc(r.value || "").replace(/'/g, "&#39;")}')">Correct</button>
      </div>`).join("")}</div>` : "";
  // the contents wiki (navigate the document without re-reading it)
  const contents = (c2.contents || []);
  const contentsCard = contents.length ? `<div class="wikicard"><div class="rsec-lbl">Contents wiki · the document's own structure</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${contents.slice(0, 80).map((c) => `<span class="tagchip">${esc(c.ref || "")} ${esc(c.heading || "")}</span>`).join("")}</div>
      ${(c2.exhibits || []).length ? `<div class="am" style="margin-top:8px">exhibits &amp; schedules: ${esc((c2.exhibits || []).map((x) => `${x.ref || ""} ${x.title || ""}`.trim()).join(" · "))}</div>` : ""}</div>` : "";
  const clauses = (c2.clauses || []);
  const clauseCard = clauses.length ? `<div class="wikicard"><div class="rsec-lbl">Clause wiki · ${clauses.length} clauses (hover for what each says)</div><div style="display:flex;flex-wrap:wrap;gap:6px">${clauses.slice(0, 80).map((c) => `<span class="tagchip" title="${esc(c.gist || "")}">${esc(c.ref || "")} ${esc(c.label || "")}</span>`).join("")}${clauses.length > 80 ? `<span class="am">+ ${clauses.length - 80} more</span>` : ""}</div></div>` : "";
  const confs = (OPEN.confirms || []).length ? `<div class="wikicard" style="border-left:3px solid var(--amber)"><div class="rsec-lbl">Awaiting your confirmation</div>${OPEN.confirms.map((c) => confCard(c, true)).join("")}</div>` : "";
  return head + summary + confs + regCard + noticeCard + oblCard + treeCard + contentsCard + clauseCard + rail;
}
window.fixFact = (field, current) => rdForm(`Correct · ${field.replace(/_/g, " ")}`, [{ k: "v", label: "Correct value (applies instantly + teaches the extractor)", v: current === "—" ? "" : current }], async (o) => {
  if (o.v === undefined) return;
  await fetch("/api/qlegal/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ surface: "fact", document_id: OPEN.document.id, field, was: current, corrected: o.v }) });
  await loadRegistry(); openDoc(OPEN.document.id);
});
window.delDoc = (id) => rdConfirm("Remove from the repository?", "Only the derived layer is removed — the original file in the source of truth is untouched.", async () => {
  await fetch(`/api/qlegal/document/${id}`, { method: "DELETE" });
  OPEN = null; await loadRegistry(); renderNav(); renderRegistry();
});

// ---- Repository · Search & Ask (conversational) ---------------------------------
function renderSearch() {
  const host = $("#view-search");
  const hits = HITS === null ? "" : (HITS.length
    ? `<div class="rsec-lbl" style="margin-top:4px">Text matches · ${HITS.length}</div>` + HITS.map((h) => `<div class="hit" onclick="openDoc(${h.id})">
        <div class="hn">${esc(h.title || h.filename)} ${h.doc_type ? `<span class="typebadge">${esc(h.doc_type)}</span>` : ""} <span class="am">· ${h.via === "text" ? "clause text" : "facts"}</span></div>
        ${h.snippet ? `<div class="hs">${snip(h.snippet)}</div>` : ""}
        <div class="am" style="margin-top:4px">${esc([h.party1, h.party2].filter(Boolean).join(" ⟷ "))}</div>
      </div>`).join("")
    : `<div class="empty">// no literal text match — ask the question below instead //</div>`);
  const turns = THREAD.map((t, i) => `<div class="askbox-a">
      <div class="askbox-q">🧑 ${esc(t.q)}</div>
      <div class="askbox-ans">${esc(t.a)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
        ${(t.sources || []).map((s) => `<span class="srcchip" onclick="openDocFromAsk(${s.id})">${esc(s.name)} ↗</span>`).join("")}
        ${(t.rungs || []).length ? `<span class="am" title="the retrieval ladder this answer used">read: ${esc((t.rungs || []).join(" → "))}</span>` : ""}
        ${t.mode && t.mode !== "ai" ? `<span class="am" style="color:var(--amber)">no keyed model — add one in AI Skills &amp; Pipelines</span>` : ""}
      </div></div>`).join("");
  const ask = `<div class="askbox">
      <div class="askbox-h">✦ Ask the repository <span class="askbox-s">conversational · follow-ups keep context · cites document + § · says what's missing</span>
        ${THREAD.length ? `<button class="btn small" style="margin-left:auto" onclick="clearThread()">New conversation</button>` : ""}</div>
      ${turns}
      ${ASKING ? `<div class="askbox-a"><div class="askbox-ans"><img class="potspin" src="/brand/assets/logos/pot.png" alt=""> reading the estate…</div></div>` : ""}
      <div class="askbox-in"><input id="askin" placeholder="${THREAD.length ? "ask a follow-up…" : "e.g. which contracts require notification on change of control?"}" onkeydown="if(event.key==='Enter'){event.preventDefault();doAsk()}"><button class="btn btn--org small" onclick="doAsk()">Ask ▸</button></div>
    </div>`;
  host.innerHTML = `<p class="intro"><b>SEARCH & ASK</b> — one box, the whole estate. <b>Search</b> finds literal wording in the C1 transcripts. <b>Ask</b> answers in plain English, climbing the ladder: the structured estate (facts + register answers, covering every contract) → the contents &amp; clause wikis → the deep C1 text of the closest documents.</p>
    <div class="searchbar"><input id="qsearch" placeholder="search terms, parties, clauses… (e.g. data breach notification)" value="${esc(window._lastQ || "")}" onkeydown="if(event.key==='Enter'){event.preventDefault();doSearch()}"><button class="btn btn--primary" onclick="doSearch()">Search</button></div>
    ` + ask + `<div id="hits">${hits}</div>`;
  setTimeout(() => { const el = $("#askin"); if (el && !ASKING) el.focus(); }, 30);
}
window.doSearch = async () => {
  const term = ($("#qsearch")?.value || "").trim(); if (!term) return;
  window._lastQ = term;
  try { HITS = ((await (await fetch(`/api/qlegal/search?q=${encodeURIComponent(term)}`)).json()).hits) || []; } catch { HITS = []; }
  renderSearch();
};
window.openDocFromAsk = (id) => { SUB.repository = "registry"; openDoc(id); };
window.clearThread = () => { THREAD = []; renderSearch(); };
window.doAsk = async () => {
  const el = $("#askin"); const qtext = (el?.value || "").trim(); if (!qtext || ASKING) return;
  ASKING = true; el.value = ""; renderSearch();
  try {
    // send the last few turns so follow-ups ("and the SOW?") keep their context
    const history = THREAD.slice(-4).map((t) => ({ q: t.q, a: t.a }));
    const r = await fetch("/api/qlegal/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: qtext, history }) });
    const j = await r.json();
    ASKING = false;
    if (!r.ok) { renderSearch(); return rdAlert("Ask failed", j.error || ""); }
    THREAD.push({ q: qtext, a: j.answer, sources: j.sources || [], rungs: j.rungs || [], mode: j.mode });
    renderSearch();
  } catch (e) { ASKING = false; renderSearch(); rdAlert("Ask failed", String(e.message || e)); }
};

// ---- Repository · Registers (the open-ended layer: whatever they ask) ----------
async function loadRegisters() {
  try { const j = await (await fetch("/api/qlegal/registers")).json(); REGISTERS = j.registers || []; REG_TOTAL = j.total_documents || 0; } catch { REGISTERS = []; }
}
async function renderRegisters() {
  const host = $("#view-registers");
  if (REG_OPEN) { host.innerHTML = registerHitsView(); return; }
  host.innerHTML = `<div class="empty">loading…</div>`;
  await loadRegisters(); renderNav();
  const rows = REGISTERS.map((r) => {
    const answered = Number(r.answered), pending = Math.max(0, REG_TOTAL - answered);
    return `<tr class="clk" data-k="${esc((r.name + " " + r.question).toLowerCase())}" onclick="openRegister(${r.id})">
      <td><b>${esc(r.name)}</b>${r.builtin ? ' <span class="tagchip">built-in</span>' : ""}${r.status === "off" ? ' <span class="chip">off</span>' : ""}
        <div class="am" style="max-width:60ch;margin-top:3px">${esc(r.question)}</div></td>
      <td><span class="duechip due-ok">${r.yes_count} yes</span></td>
      <td>${Number(r.unclear_count) ? `<span class="duechip due-soon">${r.unclear_count} unclear</span>` : "<span class='am'>—</span>"}</td>
      <td class="am">${answered}/${REG_TOTAL}${pending ? ` <span style="color:var(--amber)">· ${pending} pending</span>` : ""}</td>
      <td class="tacts"><button class="btn small" onclick="event.stopPropagation();editRegister(${r.id})">Edit</button>
        <button class="btn small" onclick="event.stopPropagation();delRegister(${r.id},'${esc(r.name).replace(/'/g, "&#39;")}')">✕</button></td>
    </tr>`;
  }).join("");
  const pendingAny = REGISTERS.some((r) => Number(r.answered) < REG_TOTAL);
  host.innerHTML = `<p class="intro"><b>REGISTERS</b> — the answer to "they could ask anything". Write a standing question once in plain English; it is answered for <b>every contract</b> at ingestion and backfilled across the estate, with § evidence. That turns an infinite set of questions into instant, filterable columns — no code change, no re-reading 1,000 documents.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn btn--primary" onclick="addRegister()">+ Ask a standing question</button>
      ${pendingAny ? `<button class="btn btn--org" onclick="runRegisterSweep(null)">Answer across the estate ▸</button>` : ""}
    </div>
    <div id="regproc"></div>`
    + (REGISTERS.length
      ? `<div class="cfilter"><input placeholder="filter questions…" oninput="filterTable('regstable',this.value)"><span class="am" id="regstable-note"></span></div>
         <div class="scroll-x"><table class="ctable" id="regstable"><thead><tr><th>Standing question</th><th>Yes</th><th>Unclear</th><th>Coverage</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty">// no standing questions yet //</div>`);
  if (REGISTERS.length) filterTable("regstable", "");
}
window.openRegister = async (id) => {
  try { REG_OPEN = await (await fetch(`/api/qlegal/register/${id}/hits`)).json(); } catch { return; }
  renderRegisters(); window.scrollTo({ top: 0, behavior: "smooth" });
};
window.closeRegister = () => { REG_OPEN = null; renderRegisters(); };
function registerHitsView() {
  const r = REG_OPEN.register, hits = REG_OPEN.hits || [];
  const P = { yes: "due-ok", no: "due-none", unclear: "due-soon" };
  const rows = hits.map((h) => `<tr class="clk" data-k="${esc(((h.title || h.filename) + " " + (h.answer || "") + " " + h.present).toLowerCase())}">
      <td onclick="openDoc(${h.document_id})"><b>${esc(h.title || h.filename)}</b>${h.doc_type ? ` <span class="typebadge">${esc(h.doc_type)}</span>` : ""}
        <div class="am">${esc([h.party1, h.party2].filter(Boolean).join(" ⟷ "))}</div></td>
      <td><span class="duechip ${P[h.present] || "due-none"}">${esc(h.present)}</span>${h.status !== "auto" ? ' <span class="tagchip">confirmed</span>' : ""}</td>
      <td>${esc(h.value) || "<span class='am'>—</span>"}</td>
      <td style="max-width:44ch">${esc(h.answer || "")}</td>
      <td>${(h.refs || []).map((x) => `<span class="ref">${esc(x)}</span>`).join(" ") || "<span class='am'>—</span>"}</td>
      <td class="tacts"><button class="btn small" onclick="fixHit(${h.id},'${esc(h.present)}','${esc(h.answer || "").replace(/'/g, "&#39;")}','${esc(h.value || "").replace(/'/g, "&#39;")}')">Correct</button></td>
    </tr>`).join("");
  return `<span class="backlnk" onclick="closeRegister()">‹ back to registers</span>
    <div class="wikicard"><div class="rsec-lbl">Standing question</div>
      <p class="rsummary"><b>${esc(r.name)}</b> — ${esc(r.question)}</p>
      ${REG_OPEN.not_yet_answered ? `<div style="margin-top:10px"><button class="btn btn--org small" onclick="runRegisterSweep(${r.id})">Answer the remaining ${REG_OPEN.not_yet_answered} contract${REG_OPEN.not_yet_answered === 1 ? "" : "s"} ▸</button></div>` : ""}
    </div><div id="regproc"></div>`
    + (hits.length
      ? `<div class="cfilter"><input placeholder="filter the estate…" oninput="filterTable('hitstable',this.value)"><span class="am" id="hitstable-note"></span></div>
         <div class="scroll-x"><table class="ctable" id="hitstable"><thead><tr><th>Contract</th><th>Answer</th><th>Value</th><th>Detail</th><th>§</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty">// not answered on any contract yet — run it across the estate //</div>`);
}
window.addRegister = () => registerForm("Ask a standing question", {}, async (o) => {
  if (!o.name || !o.question) return;
  const j = await (await fetch("/api/qlegal/registers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) })).json();
  await renderRegisters();
  if (j.register) rdConfirm("Answer it across the estate now?", `“${o.name}” will be answered for every contract already in the repository (new contracts answer it automatically on ingestion).`, () => runRegisterSweep(j.register.id));
});
window.editRegister = (id) => { const r = REGISTERS.find((x) => Number(x.id) === Number(id)); if (!r) return; registerForm("Edit standing question", r, async (o) => { await fetch(`/api/qlegal/register/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) }); renderRegisters(); }); };
window.delRegister = (id, name) => rdConfirm("Delete this standing question?", `“${name}” and its answers across the estate will be removed.`, async () => { await fetch(`/api/qlegal/register/${id}`, { method: "DELETE" }); renderRegisters(); });
window.runRegisterSweep = async (registerId) => {
  const host = document.getElementById("regproc"); let total = 0;
  for (let pass = 0; pass < 40; pass++) {          // resumable: keeps going while work remains
    if (host) host.innerHTML = `<div class="meter"><div class="cmstep now"><span class="cmi"><img class="potspin" src="/brand/assets/logos/pot.png" alt=""></span><span>reading the estate — ${total} contract${total === 1 ? "" : "s"} answered…</span></div></div>`;
    let j; try { j = await (await fetch("/api/qlegal/registers/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ register_id: registerId, limit: 10 }) })).json(); } catch { break; }
    total += j.processed || 0;
    if (!j.processed || !j.remaining) break;
  }
  if (host) host.innerHTML = "";
  if (REG_OPEN) { await openRegister(REG_OPEN.register.id); } else { await renderRegisters(); }
  rdAlert("Estate answered", `${total} contract${total === 1 ? "" : "s"} answered. New contracts answer these questions automatically as they arrive.`);
};
window.fixHit = (id, present, answer, value) => {
  const { ov, close } = _ov(`<h3>Correct the answer</h3>
    <label style="font-size:12.5px;color:var(--dim)">Present?</label><select data-k="present">${["yes", "no", "unclear"].map((p) => `<option value="${p}" ${p === present ? "selected" : ""}>${p}</option>`).join("")}</select>
    <label style="font-size:12.5px;color:var(--dim)">Value</label><input data-k="value" value="${esc(value)}">
    <label style="font-size:12.5px;color:var(--dim)">Answer</label><textarea data-k="answer" rows="3">${esc(answer)}</textarea>
    <p style="font-size:12px;color:var(--dim2)">Your correction becomes authoritative and is banked as a learning label — the extractor stops overwriting it.</p>
    <div class="row"><button class="btn" data-x>Cancel</button><button class="btn btn--primary" data-ok>Save</button></div>`);
  ov.querySelector("[data-x]").onclick = close;
  ov.querySelector("[data-ok]").onclick = async () => {
    const o = {}; ov.querySelectorAll("[data-k]").forEach((el) => (o[el.dataset.k] = el.value.trim())); close();
    await fetch(`/api/qlegal/register-hit/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
    if (REG_OPEN) openRegister(REG_OPEN.register.id); else if (OPEN) openDoc(OPEN.document.id);
  };
};
function registerForm(title, r, onOk) {
  const { ov, close } = _ov(`<h3>${esc(title)}</h3>
    <label style="font-size:12.5px;color:var(--dim)">Column name (short)</label><input data-k="name" value="${esc(r.name || "")}" placeholder="e.g. Non-solicit">
    <label style="font-size:12.5px;color:var(--dim)">The question, in plain English — asked of every contract</label><textarea data-k="question" rows="3" placeholder="e.g. Does this contract restrict either party from soliciting the other's employees, and for how long after termination?">${esc(r.question || "")}</textarea>
    <label style="font-size:12.5px;color:var(--dim)">What value should it pull out? (optional)</label><input data-k="extract_hint" value="${esc(r.extract_hint || "")}" placeholder="e.g. the restriction period in months">
    <div class="row"><button class="btn" data-x>Cancel</button><button class="btn btn--primary" data-ok>Save</button></div>`);
  ov.querySelector("input")?.focus();
  ov.querySelector("[data-x]").onclick = close;
  ov.querySelector("[data-ok]").onclick = () => { const o = {}; ov.querySelectorAll("[data-k]").forEach((el) => (o[el.dataset.k] = el.value.trim())); close(); onOk(o); };
}

// ---- Tasks · Obligations -------------------------------------------------------
function dueChip(o) {
  if (!o.due_date) return `<span class="duechip due-none">${esc(o.frequency || "undated")}</span>`;
  const d = new Date(o.due_date), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const cls = days < 0 ? "due-over" : days <= (o.lead_days || 30) ? "due-soon" : "due-ok";
  return `<span class="duechip ${cls}">${fmtDay(o.due_date)}${days < 0 ? ` · ${-days}d overdue` : days <= 60 ? ` · in ${days}d` : ""}</span>`;
}
function obligationRow(o, compact) {
  const acts = o.status === "done" ? "" : `<span style="display:inline-flex;gap:5px;flex-wrap:wrap">
    ${o.status === "proposed" ? `<button class="btn small" onclick="oblAct(${o.id},'confirmed')">Confirm</button>` : ""}
    <button class="btn small" onclick="oblOwner(${o.id},'${esc(o.owner || "").replace(/'/g, "&#39;")}')">${o.owner ? "Doer: " + esc(o.owner) : "Assign doer"}</button>
    <button class="btn small" onclick="oblAct(${o.id},'done')">Done</button>
    ${compact ? "" : `<button class="btn small" onclick="oblAct(${o.id},'dismissed')">✕</button>`}</span>`;
  return `<div style="display:flex;align-items:flex-start;gap:9px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line)">
    ${dueChip(o)}<span class="ochip o-${esc(o.status)}">${esc(o.status)}</span>
    <span style="flex:1;min-width:200px;font-size:13px;line-height:1.5">${esc(o.what)} <span class="am">· ${esc(o.kind)} · ${esc(o.who_owes || "")}</span> ${o.ref ? `<span class="ref">${esc(o.ref)}</span>` : ""}${compact ? "" : ` <span class="am">— ${esc(o.title || o.filename || "")}</span>`}</span>
    ${acts}</div>`;
}
async function loadObligations() { try { OBLIGS = ((await (await fetch("/api/qlegal/obligations")).json()).obligations) || []; } catch { OBLIGS = []; } }
async function renderObligations() {
  const host = $("#view-obligations");
  host.innerHTML = `<div class="empty">loading…</div>`;
  await loadObligations(); renderNav();
  const upcoming = OBLIGS.filter((o) => o.status !== "done");
  const done = OBLIGS.filter((o) => o.status === "done");
  host.innerHTML = `<p class="intro"><b>OBLIGATIONS</b> — the task engine. Renewal & termination deadlines + post-execution deliverables/SLAs mapped from every live contract, each citing its §. Confirm, assign the doer, mark done. Deliberately tiny — workflow stays in SharePoint.</p>`
    + (upcoming.length ? `<div class="wikicard">${upcoming.map((o) => obligationRow(o)).join("")}</div>` : `<div class="empty">// nothing tracked yet — obligations appear as contracts are ingested //</div>`)
    + (done.length ? `<div class="wikicard" style="opacity:.7"><div class="rsec-lbl">Done</div>${done.map((o) => obligationRow(o)).join("")}</div>` : "");
}
window.oblAct = async (id, status) => { await fetch(`/api/qlegal/obligation/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); if (OPEN) openDoc(OPEN.document.id); else renderObligations(); };
window.oblOwner = (id, cur) => rdForm("Assign the doer", [{ k: "owner", label: "Who owns this obligation?", v: cur, ph: "name or email" }], async (o) => {
  await fetch(`/api/qlegal/obligation/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: o.owner, status: "confirmed" }) });
  if (OPEN) openDoc(OPEN.document.id); else renderObligations();
});

// ---- Governance · Confirm queue ------------------------------------------------
function confCard(c, compact) {
  const p = c.proposal || {};
  const what = c.kind === "link" ? `link to parent #${p.parent_id} as <b>${esc(p.relation_kind || "")}</b>`
    : c.kind === "lineage" ? `same contract as #${p.other_id} (draft ↔ executed)`
    : c.kind === "classification" ? `classify this document${p.doc_type ? ` as <b>${esc(p.doc_type)}</b>` : ""}`
    : esc(JSON.stringify(p));
  return `<div class="conf"><div class="conf-h"><span class="kindb">${esc(c.kind)}</span>
      ${compact ? "" : `<b style="cursor:pointer" onclick="openDoc(${c.document_id})">${esc(c.title || c.filename || "#" + c.document_id)}</b>`}
      ${c.confidence != null ? `<span class="am">${Math.round(Number(c.confidence) * 100)}%</span>` : ""}</div>
    <div class="why">${what}${c.why ? ` — ${esc(c.why)}` : ""}</div>
    <div style="display:flex;gap:7px;margin-top:9px">
      <button class="btn small btn--org" onclick="confAct(${c.id},'accept','${esc(c.kind)}')">Accept</button>
      <button class="btn small" onclick="confAct(${c.id},'reject','${esc(c.kind)}')">Reject</button></div></div>`;
}
async function renderConfirm() {
  const host = $("#view-confirm");
  host.innerHTML = `<div class="empty">loading…</div>`;
  try { CONFIRMS = ((await (await fetch("/api/qlegal/confirms")).json()).confirms) || []; } catch { CONFIRMS = []; }
  CONF_N = CONFIRMS.length || null; renderNav();
  host.innerHTML = `<p class="intro"><b>CONFIRM QUEUE</b> — the AI proposes, you decide. Classifications, document-family links and draft↔executed lineage land here; every decision teaches the system (it's recorded in the learning loop).</p>`
    + (CONFIRMS.length ? CONFIRMS.map((c) => confCard(c)).join("") : `<div class="empty">// nothing awaiting confirmation //</div>`);
}
window.confAct = async (id, action, kind) => {
  const go = async (doc_type) => {
    await fetch(`/api/qlegal/confirm/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, doc_type }) });
    if (OPEN) openDoc(OPEN.document.id); else renderConfirm();
    loadRegistry();
  };
  if (action === "accept" && kind === "classification") {
    return rdForm("Classify the document", [{ k: "t", label: "Contract type", ph: "MSA / SOW / NDA / Amendment / DPA / Employment / Lease / SaaS / Services / Supply / Other" }], (o) => go(o.t || undefined));
  }
  go();
};

// ---- Governance · Business rules ----------------------------------------------
const SCOPES = ["global", "ingestion", "search", "obligations", "drafting"];
async function renderRules() {
  const host = $("#view-rules");
  host.innerHTML = `<div class="empty">loading…</div>`;
  try { RULES = ((await (await fetch("/api/qlegal/rules")).json()).rules) || []; } catch { RULES = []; }
  renderNav();
  const byScope = SCOPES.map((s) => [s, RULES.filter((r) => r.scope === s)]).filter(([, rs]) => rs.length);
  host.innerHTML = `<p class="intro"><b>BUSINESS RULES</b> — the editable rulebook. Each rule is injected into the matching pipeline step at call time (scope <b>ingestion</b> → the C2 key & tree linker · <b>search</b> → Ask · <b>obligations</b> → the obligation mapper · <b>global</b> → every step). Edit here; the very next run obeys.</p>
    <div style="margin-bottom:16px"><button class="btn btn--primary" onclick="addRule()">+ Add a rule</button></div>`
    + byScope.map(([s, rs]) => `<div class="rsec-lbl" style="margin-top:18px">${esc(s)} · ${rs.length}</div>` + rs.map((r) => `
      <div class="rulecard ${r.status === "off" ? "off" : ""}">
        <div class="rh"><span class="rt">${esc(r.title)}</span><span class="scopeb">${esc(r.scope)}</span><span class="am">v${r.version}</span>
          <button class="btn small" onclick="editRule(${r.id})">Edit</button>
          <button class="btn small" onclick="toggleRule(${r.id},'${r.status === "active" ? "off" : "active"}')">${r.status === "active" ? "Switch off" : "Switch on"}</button></div>
        <div class="rb">${esc(r.body)}</div></div>`).join("")).join("");
}
window.addRule = () => ruleForm("Add a business rule", {}, async (o) => {
  if (!o.title || !o.body) return;
  await fetch("/api/qlegal/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
  renderRules();
});
window.editRule = (id) => { const r = RULES.find((x) => Number(x.id) === Number(id)); if (!r) return; ruleForm("Edit rule", r, async (o) => { await fetch(`/api/qlegal/rule/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) }); renderRules(); }); };
window.toggleRule = async (id, status) => { await fetch(`/api/qlegal/rule/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); renderRules(); };
function ruleForm(title, r, onOk) {
  const { ov, close } = _ov(`<h3>${esc(title)}</h3>
    <label style="font-size:12.5px;color:var(--dim)">Title</label><input data-k="title" value="${esc(r.title || "")}" placeholder="short name for the rule">
    <label style="font-size:12.5px;color:var(--dim)">The rule, in plain English</label><textarea data-k="body" rows="4" placeholder="e.g. every SaaS contract must be tagged with its data-residency region">${esc(r.body || "")}</textarea>
    <label style="font-size:12.5px;color:var(--dim)">Applies to</label><select data-k="scope">${SCOPES.map((s) => `<option value="${s}" ${r.scope === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <div class="row"><button class="btn" data-x>Cancel</button><button class="btn btn--primary" data-ok>Save</button></div>`);
  ov.querySelector("[data-x]").onclick = close;
  ov.querySelector("[data-ok]").onclick = () => { const o = {}; ov.querySelectorAll("[data-k]").forEach((el) => (o[el.dataset.k] = el.value.trim())); close(); onOk(o); };
}

// ---- Governance · AI activity ---------------------------------------------------
async function renderLog() {
  const host = $("#view-log");
  host.innerHTML = `<div class="empty">loading…</div>`;
  try { LOG = ((await (await fetch("/api/qlegal/log?limit=150")).json()).log) || []; } catch { LOG = []; }
  const rows = LOG.map((l) => `<tr>
      <td class="am" style="white-space:nowrap">${fmtDT(l.created_at)}</td>
      <td><b>${esc(l.pipeline || "—")}</b><div class="am">${esc(l.provider || "")} ${esc(l.model || "")}</div></td>
      <td>${esc(l.status || "")}</td>
      <td class="am">${esc(l.ref_type || "")}${l.ref_id ? " #" + l.ref_id : ""}</td>
      <td style="max-width:26ch">${esc(l.input_summary || "")}</td>
      <td style="max-width:30ch">${esc(l.output_summary || "")}</td>
      <td class="am">${(l.rules_applied || []).length ? esc((l.rules_applied || []).join(", ")) : "—"}</td>
    </tr>`).join("");
  host.innerHTML = `<p class="intro"><b>AI ACTIVITY</b> — every gated pipeline call, append-only: which step ran, on which model, with which business rules injected. Full traceability.</p>`
    + (LOG.length ? `<div class="scroll-x"><table class="ctable"><thead><tr><th>When</th><th>Pipeline</th><th>Mode</th><th>Ref</th><th>Input</th><th>Output</th><th>Rules applied</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty">// no AI activity yet //</div>`);
}

// ---- modals ---------------------------------------------------------------------
function _ov(inner) { const ov = document.createElement("div"); ov.className = "ov"; ov.innerHTML = `<div class="box">${inner}</div>`; document.body.appendChild(ov); const close = () => ov.remove(); ov.onclick = (e) => { if (e.target === ov) close(); }; return { ov, close }; }
function rdAlert(title, msg) { const { ov, close } = _ov(`<h3>${esc(title)}</h3>${msg ? `<p>${esc(msg)}</p>` : ""}<div class="row"><button class="btn btn--primary" data-ok>OK</button></div>`); ov.querySelector("[data-ok]").onclick = close; }
function rdConfirm(title, msg, onOk) { const { ov, close } = _ov(`<h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="row"><button class="btn" data-x>Cancel</button><button class="btn btn--org" data-ok>Confirm</button></div>`); ov.querySelector("[data-x]").onclick = close; ov.querySelector("[data-ok]").onclick = () => { close(); onOk && onOk(); }; }
function rdForm(title, fields, onOk) {
  const body = fields.map((f) => `<label style="font-size:12.5px;color:var(--dim)">${esc(f.label)}</label><input data-k="${f.k}" placeholder="${esc(f.ph || "")}" value="${esc(f.v || "")}">`).join("");
  const { ov, close } = _ov(`<h3>${esc(title)}</h3>${body}<div class="row"><button class="btn" data-x>Cancel</button><button class="btn btn--primary" data-ok>Save</button></div>`);
  ov.querySelector("input")?.focus();
  ov.querySelector("[data-x]").onclick = close;
  ov.querySelector("[data-ok]").onclick = () => { const o = {}; ov.querySelectorAll("[data-k]").forEach((el) => (o[el.dataset.k] = el.value.trim())); close(); onOk(o); };
}

init();
