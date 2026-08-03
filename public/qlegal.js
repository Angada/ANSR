// Q-Legal — legal repository intelligence.
// The journey: ASK is the front door (one command bar — live text search as you
// type, a real conversation on Enter, answers with clickable contract chips).
// BROWSE is the estate with smart filter chips. MANAGE holds the queues
// (obligations · confirm · rules · SharePoint scanner · AI activity).
// SharePoint/upload is the source of truth; everything here is the derived layer.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
// ts_headline highlights hits with <b>…</b> — escape everything else, keep the <b>s
const snip = (s) => esc(s).replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
// minimal markdown for AI answers: **bold**, bullet lines — nothing else
const mdlite = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/^[-•] (.*)$/gm, "&bull; $1").replace(/\n/g, "<br>");
// India sequence, always Asia/Kolkata. Compact dd-mm-yyyy; weekday only where a
// human plans around it (due dates): "Mon, 9 Jun, 2026".
const IST = { timeZone: "Asia/Kolkata" };
const _parts = (ts, opts) => new Intl.DateTimeFormat("en-IN", { ...IST, ...opts }).formatToParts(new Date(ts)).reduce((o, p) => ((o[p.type] = p.value), o), {});
const fmtD = (ts) => { if (!ts) return ""; const p = _parts(ts, { day: "2-digit", month: "2-digit", year: "numeric" }); return `${p.day}-${p.month}-${p.year}`; };
const fmtDay = (ts) => { if (!ts) return ""; const p = _parts(ts, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); return `${p.weekday}, ${p.day} ${p.month}, ${p.year}`; };
const fmtDT = (ts) => { if (!ts) return ""; const p = _parts(ts, { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }); return `${p.day}-${p.month}-${p.year} · ${p.hour}:${p.minute} ${(p.dayPeriod || "").toLowerCase()}`; };
const fmtNice = (ts) => { if (!ts) return "—"; const p = _parts(ts, { day: "numeric", month: "short", year: "numeric" }); return `${p.day} ${p.month}, ${p.year}`; };

let AREA = "ask";
let SUB = { ask: "chat", browse: "contracts", manage: "obligations", settings: "rules" };
let DOCS = [], BY_TYPE = [], LOADED = false;
let CATS = [];                    // the Legal Setting taxonomy (growing)
let OPEN = null;                  // wiki payload
let LIVE = null, LIVE_T = null;   // search-as-you-type hits + debounce timer
let THREAD = [], ASKING = false;  // the Ask conversation
let OBLIGS = [], CONFIRMS = [], RULES = [], LOG = [];
let REGISTERS = [], REG_TOTAL = 0, REG_OPEN = null;
let CONF_N = null;
let FILTERS = { cat: null, gem: null, text: "" };   // browse filters
let SP = null;                    // sharepoint settings payload
let SPF = { folder: "", q: "", data: null, loading: false };   // sharepoint files browser
let DOCTHREADS = {};              // per-contract Ask threads, keyed by doc id
let DRAFT = { ask: "", sugg: null, sel: [], out: null, busy: false };   // the drafting journey
let DOCASKING = null;

const VIEWS = { chat: "#view-chat", draft: "#view-draft", registers: "#view-registers", contracts: "#view-registry", map: "#view-map", spfiles: "#view-spfiles", obligations: "#view-obligations", confirm: "#view-confirm", sweep: "#view-sweep", taxonomy: "#view-taxonomy", rules: "#view-rules", sharepoint: "#view-sharepoint", log: "#view-log" };

// staggered reveal — output feels generated, not dumped
function sequenceReveal(root, sel = ".reveal", step = 140, startDelay = 60) {
  const els = [...(root || document).querySelectorAll(sel)];
  els.forEach((el) => el.classList.add("gen"));
  els.forEach((el, i) => setTimeout(() => { el.classList.remove("gen"); el.classList.add("gen--in"); }, startDelay + i * step));
}

function renderNav() {
  const needsYou = (CONF_N || 0);
  $("#mainnav").innerHTML = [["ask", "Ask"], ["browse", "Browse"], ["manage", `Manage${needsYou ? ` <span class="count" style="color:var(--org)">●${needsYou}</span>` : ""}`], ["settings", "Settings"]]
    .map(([k, l]) => `<button class="${AREA === k ? "on" : ""}" onclick="setArea('${k}')">${l}</button>`).join("");
  const subs = AREA === "ask"
    ? [["chat", "Ask the repository", null], ["draft", "Draft a contract", null], ["registers", "Standing questions", REGISTERS.length || null]]
    : AREA === "browse"
      ? [["contracts", "Contracts", LOADED ? DOCS.length : null], ["map", "Estate map", null], ["spfiles", "SharePoint files", null]]
      : AREA === "manage"
        ? [["obligations", "Obligations", null], ["confirm", "Confirm queue", CONF_N], ["sweep", "Re-index", null], ["taxonomy", "Taxonomy", null], ["log", "AI activity", null]]
        : [["rules", "Business Rules", RULES.length || null], ["sharepoint", "SharePoint", null]];
  $("#subnav").innerHTML = subs.map(([k, l, n]) => `<button class="${SUB[AREA] === k ? "on" : ""}" onclick="setSub('${k}')">${l}${n ? `<span class="count">${n}</span>` : ""}</button>`).join("");
}
window.setArea = (a) => { AREA = a; setSub(SUB[a]); };
window.setSub = (s) => { SUB[AREA] = s; renderNav(); Object.values(VIEWS).forEach((v) => ($(v).hidden = true)); $(VIEWS[s]).hidden = false; renderView(s); };
function renderView(s) { ({ chat: renderChat, draft: renderDraft, registers: renderRegisters, contracts: renderRegistry, map: renderMap, spfiles: renderSpFiles, obligations: renderObligations, confirm: renderConfirm, sweep: renderSweep, taxonomy: renderTaxonomy, rules: renderRules, sharepoint: renderSharePoint, log: renderLog }[s])(); }

async function loadRegistry() {
  try { const j = await (await fetch("/api/qlegal/registry")).json(); DOCS = j.documents || []; BY_TYPE = j.by_type || []; LOADED = true; } catch { DOCS = []; }
}
async function loadConfirmCount() { try { CONF_N = ((await (await fetch("/api/qlegal/confirms")).json()).confirms || []).length || null; } catch { CONF_N = null; } }
async function loadRegisters() { try { const j = await (await fetch("/api/qlegal/registers")).json(); REGISTERS = j.registers || []; REG_TOTAL = j.total_documents || 0; } catch { REGISTERS = []; } }
async function loadCats() { try { CATS = ((await (await fetch("/api/qlegal/categories")).json()).categories) || []; } catch { CATS = []; } }
async function init() {
  await loadRegistry();
  loadConfirmCount().then(renderNav); loadRegisters().then(renderNav); loadCats();
  renderNav();
  Object.values(VIEWS).forEach((v) => ($(v).hidden = true));
  $(VIEWS[SUB[AREA]]).hidden = false;
  renderView(SUB[AREA]);
}

// ==========================================================================
// ASK — the front door
// ==========================================================================
const expiringIn = (days) => DOCS.filter((d) => {
  const x = (d.facts || {}).expiry_date; if (!x) return false;
  const dd = (new Date(x) - Date.now()) / 86400000; return dd >= 0 && dd <= days;
});
function docChip(d, extra = "") {
  const name = d.title || d.filename || d.name || ("#" + d.id);
  return `<span class="docchip touch" onclick="openDoc(${d.id})"><span class="emb">Q</span>${esc(String(name).slice(0, 44))}${d.doc_type ? ` <span class="am">· ${esc(d.doc_type)}</span>` : ""}${extra}</span>`;
}
function renderChat() {
  const host = $("#view-chat");
  const exp30 = expiringIn(31), exp180 = expiringIn(183);
  const catGems = BY_TYPE.filter((t) => t.t !== "unclassified").slice(0, 6)
    .map((t) => `<span class="sg touch" onclick="gemBrowse('cat','${esc(t.t)}')">${esc(t.t)} <b>${t.c}</b></span>`).join("");
  const welcome = THREAD.length ? "" : `
    <div class="hero reveal">
      <h2>What do you need?</h2>
      <p class="sub">Find a contract, explore one, or ask the whole repository — every answer cites the document and the §.</p>
    </div>`;
  const gems = THREAD.length ? "" : `
    <div class="sugg reveal">
      ${exp30.length ? `<span class="sg touch" style="color:var(--red);border-color:#F0CFCF" onclick="gemBrowse('gem','exp30')">⚠ Expiring this month · ${exp30.length}</span>` : ""}
      ${exp180.length ? `<span class="sg touch" style="color:var(--amber);border-color:#EAD3AE" onclick="gemBrowse('gem','exp180')">Expiring in 6 months · ${exp180.length}</span>` : ""}
      ${CONF_N ? `<span class="sg touch" style="color:var(--org)" onclick="setArea('manage')">Needs your eye · ${CONF_N}</span>` : ""}
      ${catGems}
      <span class="sg touch" onclick="setArea('browse')">Browse all ${DOCS.length} ▸</span>
    </div>
    <div class="sugg reveal" style="margin-top:2px">
      ${REGISTERS.slice(0, 3).map((r) => `<span class="sg touch" onclick="askPreset('${esc(r.question).replace(/'/g, "&#39;")}')">✦ ${esc(r.name)}?</span>`).join("")}
      <span class="sg touch" onclick="askPreset('What expires in the next 90 days and what must we do about each?')">✦ What's expiring soon?</span>
    </div>`;
  const turns = THREAD.map((t) => `
    <div class="msg-u reveal"><span class="b">${esc(t.q)}</span></div>
    <div class="msg-a reveal">${mdlite(t.a)}
      ${(t.sources || []).length ? `<div class="srcrow">${t.sources.map((s) => docChip(s)).join("")}</div>` : ""}
      ${(t.rungs || []).length ? `<div class="rungline">read: ${t.rungs.map((r) => `<span class="rk">✓</span> ${esc(r)}`).join(" → ")}</div>` : ""}
      ${t.mode && t.mode !== "ai" ? `<div class="rungline" style="color:var(--amber)">no keyed model — point the Q-Legal pipelines at one in Settings → AI Pipelines</div>` : ""}
    </div>`).join("");
  const thinking = ASKING ? `
    <div class="msg-u"><span class="b">${esc(ASKING)}</span></div>
    <div class="thinking" id="thinkcard">
      <div class="tstep on" data-t="0"><span class="ti"><img class="potspin" src="/brand/assets/logos/pot.png" alt=""></span>Checking the registers &amp; facts — every contract</div>
      <div class="tstep" data-t="1"><span class="ti">·</span>Reading the contents &amp; clause wikis of the closest matches</div>
      <div class="tstep" data-t="2"><span class="ti">·</span>Deep-reading the C1 transcripts</div>
      <div class="tstep" data-t="3"><span class="ti">·</span>Composing the cited answer</div>
    </div>` : "";
  const live = (!ASKING && LIVE && LIVE.q) ? `
    <div class="livehits">
      ${LIVE.hits.length
        ? `<div class="rsec-lbl">“${esc(LIVE.q)}” in the text · click to open</div>` + LIVE.hits.slice(0, 5).map((h) => `
          <div class="hit touch" onclick="openDoc(${h.id})">
            <div class="hn">${esc(h.title || h.filename)} ${h.doc_type ? `<span class="typebadge">${esc(h.doc_type)}</span>` : ""}${h.via && h.via.includes("semantic") ? ' <span class="am" title="matched by meaning, not just words">≈ semantic</span>' : ""}</div>
            ${h.snippet ? `<div class="hs">${snip(h.snippet)}</div>` : h.sem_snippet ? `<div class="hs">${h.sem_ref ? `<span class="ref">${esc(h.sem_ref)}</span> ` : ""}${esc(h.sem_snippet)}</div>` : ""}
          </div>`).join("")
        : `<div class="rungline" style="text-align:center">no literal match for “${esc(LIVE.q)}” — press Enter to ask the AI</div>`}
    </div>` : "";
  host.innerHTML = welcome + `
    <div class="chat">
      <div class="cmd reveal">
        <span class="glyph">✦</span>
        <input id="askin" placeholder="${THREAD.length ? "ask a follow-up…" : "Search a contract, or ask anything — e.g. which contracts need notice on change of control?"}"
          oninput="liveSearch(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();doAsk()}">
        <button class="go" onclick="doAsk()">Ask ▸</button>
      </div>
      ${live}
      ${gems}
      ${THREAD.length ? "" : `<div class="estateline reveal">${DOCS.length ? `<b>${DOCS.length}</b> contracts indexed · ${BY_TYPE.map((t) => `${esc(t.t)} ${t.c}`).join(" · ")}` : "the repository is empty — add contracts in Browse, or connect SharePoint in Manage"}</div>`}
      ${turns}${thinking}
      ${THREAD.length ? `<div style="text-align:center;margin-top:14px"><button class="btn small touch" onclick="clearThread()">New conversation</button></div>` : ""}
    </div>`;
  sequenceReveal(host, ".reveal", 110, 40);
  if (!ASKING) setTimeout(() => $("#askin")?.focus(), 80);
  if (ASKING) animateThinking();
}
function animateThinking() {
  const card = document.getElementById("thinkcard"); if (!card) return;
  let i = 0;
  const tick = () => {
    if (!document.getElementById("thinkcard")) return;
    const steps = [...card.querySelectorAll(".tstep")];
    if (i < steps.length - 1) {
      steps[i].classList.remove("on"); steps[i].classList.add("done");
      steps[i].querySelector(".ti").innerHTML = '<span style="color:var(--grn)">✓</span>';
      i++;
      steps[i].classList.add("on");
      steps[i].querySelector(".ti").innerHTML = '<img class="potspin" src="/brand/assets/logos/pot.png" alt="">';
      setTimeout(tick, 1500 + Math.random() * 800);
    }
  };
  setTimeout(tick, 1300);
}
window.liveSearch = (v) => {
  clearTimeout(LIVE_T);
  const term = (v || "").trim();
  if (!term || term.length < 3) { LIVE = null; const lh = document.querySelector(".livehits"); if (lh) lh.remove(); return; }
  LIVE_T = setTimeout(async () => {
    try {
      const j = await (await fetch(`/api/qlegal/search?q=${encodeURIComponent(term)}`)).json();
      LIVE = { q: term, hits: j.hits || [] };
      if (!ASKING && document.getElementById("askin")) {
        const el = document.getElementById("askin"); const pos = el.selectionStart;
        renderChat();
        const el2 = document.getElementById("askin"); if (el2) { el2.value = term; el2.focus(); el2.setSelectionRange(pos, pos); }
      }
    } catch { /* live search is best-effort */ }
  }, 350);
};
window.askPreset = (qtext) => { const el = $("#askin"); if (el) el.value = qtext; doAsk(); };
window.gemBrowse = (kind, val) => { FILTERS = { cat: kind === "cat" ? val : null, gem: kind === "gem" ? val : null, text: "" }; setArea("browse"); };
window.clearThread = () => { THREAD = []; LIVE = null; renderChat(); };
window.doAsk = async () => {
  const el = $("#askin"); const qtext = (el?.value || "").trim(); if (!qtext || ASKING) return;
  ASKING = qtext; LIVE = null; renderChat();
  try {
    const history = THREAD.slice(-4).map((t) => ({ q: t.q, a: t.a }));
    const r = await fetch("/api/qlegal/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: qtext, history }) });
    const j = await r.json();
    ASKING = false;
    if (!r.ok) { renderChat(); return rdAlert("Ask failed", j.error || ""); }
    THREAD.push({ q: qtext, a: j.answer, sources: j.sources || [], rungs: j.rungs || [], mode: j.mode });
    renderChat(); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  } catch (e) { ASKING = false; renderChat(); rdAlert("Ask failed", String(e.message || e)); }
};

// ==========================================================================
// BROWSE — the estate, with smart filter chips
// ==========================================================================
function applyFilters(docs) {
  let out = FILTERS.gem === "inactive" ? docs.filter((d) => d.status === "inactive") : docs.filter((d) => d.status !== "inactive");
  if (FILTERS.cat) out = out.filter((d) => (d.doc_type || "unclassified") === FILTERS.cat);
  if (FILTERS.gem === "exp30") out = out.filter((d) => expiringIn(31).includes(d));
  if (FILTERS.gem === "exp180") out = out.filter((d) => expiringIn(183).includes(d));
  if (FILTERS.gem === "scans") out = out.filter((d) => d.scanned);
  if (FILTERS.gem === "oblig") out = out.filter((d) => Number(d.open_obligations));
  if (FILTERS.text) { const t = FILTERS.text.toLowerCase(); out = out.filter((d) => [d.filename, d.title, d.doc_type, d.party1, d.party2, d.counterparty, (d.tags || []).join(" ")].join(" ").toLowerCase().includes(t)); }
  return out;
}
// ---- the estate table, under the Super Filter -------------------------------
// Every header is the control: sort + a searchable multi-select with live counts.
// The gem chips (expiring, scanned…) stay — they're saved questions, not column
// filters, and they compose with whatever the headers are filtering.
const CST = colfState({ sortKey: null });
const REG_COLS = [
  { key: "name", label: "Contract", get: (d) => d.title || d.filename, noFilter: true, sortLabels: ["A → Z", "Z → A"] },
  { key: "type", label: "Legal setting", get: (d) => d.doc_type || "unclassified" },
  { key: "party", label: "Parties", get: (d) => [d.party1, d.party2].filter(Boolean),
    hint: "a contract with two parties appears under both" },
  { key: "expiry", label: "Expiry", num: true, get: (d) => (d.facts || {}).expiry_date || "",
    fmt: (v) => (v && v !== "—" ? fmtNice(v) : "no date"),
    cmp: (a, b) => String((a.facts || {}).expiry_date || "9999").localeCompare(String((b.facts || {}).expiry_date || "9999")),
    sortLabels: ["Soonest first", "Latest first"] },
  { key: "source", label: "Source", get: (d) => (d.source === "sharepoint" ? "SharePoint" : "Device upload"),
    hint: "SharePoint documents are governed by the nightly scan; device uploads are not" },
  { key: "tags", label: "Tags", get: (d) => (d.tags || []).length ? d.tags : ["—"] },
  { key: "ver", label: "Ver", num: true, get: (d) => d.latest_version, sortLabels: ["Fewest versions", "Most versions"] },
  { key: "oblig", label: "Oblig.", num: true, get: (d) => Number(d.open_obligations) || 0,
    sortLabels: ["Fewest first", "Most first"] },
  { key: "updated", label: "Updated", get: (d) => d.updated_at, fmt: (v) => (v && v !== "—" ? fmtD(v) : "—"),
    cmp: (a, b) => String(a.updated_at).localeCompare(String(b.updated_at)), sortLabels: ["Oldest first", "Newest first"] },
];
function renderRegistry() {
  const host = $("#view-registry");
  if (OPEN) { host.innerHTML = wikiView(); sequenceReveal(host, ".reveal", 120, 50); return; }
  const drop = `<div class="drop touch" onclick="document.getElementById('qfile').click()"
      ondragover="dzOver(event)" ondragenter="dzOver(event)" ondragleave="dzLeave(event)" ondrop="dzDrop(event)">
    <span class="ic">⇊</span>
    <div><div class="t">Drop contracts — or select files (up to 20)</div>
      <div class="s">PDF / DOCX / scans (vision-OCR) · read once into transcript + key + wikis · same filename = a new version · or let the nightly SharePoint scan bring them in</div></div>
    <input type="file" id="qfile" accept=".pdf,.docx,.doc,.txt,.md" multiple onchange="qUpload(this.files)">
  </div>`;
  const gem = (id, label, n, color) => n ? `<span class="fchip touch ${FILTERS.gem === id ? "on" : ""}" ${color && FILTERS.gem !== id ? `style="color:${color}"` : ""} onclick="setGem('${id}')">${label}<span class="n">${n}</span></span>` : "";
  const strip = `<div class="fstrip">
      <span class="fchip touch ${!FILTERS.cat && !FILTERS.gem ? "on" : ""}" onclick="clearFilters()">All<span class="n">${DOCS.length}</span></span>
      ${BY_TYPE.map((t) => `<span class="fchip touch ${FILTERS.cat === t.t ? "on" : ""}" onclick="setCat('${esc(t.t)}')">${esc(t.t)}<span class="n">${t.c}</span></span>`).join("")}
      <span style="width:1px;height:20px;background:var(--line2)"></span>
      ${gem("exp30", "⚠ Expiring 30d", expiringIn(31).length, "var(--red)")}
      ${gem("exp180", "Expiring 6mo", expiringIn(183).length, "var(--amber)")}
      ${gem("oblig", "Has obligations", DOCS.filter((d) => Number(d.open_obligations)).length)}
      ${gem("scans", "Scanned", DOCS.filter((d) => d.scanned).length)}
      ${gem("inactive", "Inactive", DOCS.filter((d) => d.status === "inactive").length)}
      <input class="rinput" style="max-width:220px;margin-left:auto" placeholder="filter by name, party, tag…" value="${esc(FILTERS.text)}" oninput="FILTERS.text=this.value;renderRegistry()">
    </div>`;
  const base = applyFilters(DOCS);
  const list = colfSort(REG_COLS, CST, colfRows(REG_COLS, CST, base),
    (a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const rows = list.map((d) => {
    const f = d.facts || {};
    const conf = f.doc_type_confirmed ? "" : (f.doc_type_confidence ? ` <span class="am" title="AI classification — confirm it on the contract page">AI ${Math.round(Number(f.doc_type_confidence) * 100)}%</span>` : "");
    const dev = d.source !== "sharepoint";
    return `<tr class="clk touch ${dev ? "srcdev" : ""}" data-k="1" onclick="openDoc(${d.id})"
        title="${dev ? "Uploaded from a device — not governed by the SharePoint scan" : "From SharePoint — kept in step by the nightly scan"}">
      <td><b>${esc(d.title || d.filename)}</b>${d.title ? `<div class="am">${esc(d.filename)}</div>` : ""}</td>
      <td>${d.doc_type ? `<span class="typebadge">${esc(d.doc_type)}</span>${conf}` : "<span class='am'>—</span>"}</td>
      <td>${esc([d.party1, d.party2].filter(Boolean).join(" ⟷ ")) || "<span class='am'>—</span>"}</td>
      <td>${[f.effective_date, f.expiry_date].filter(Boolean).map(fmtNice).join(" → ") || "<span class='am'>—</span>"}</td>
      <td><span class="srcpill ${dev ? "dev" : "sp"}">${dev ? "device" : "SharePoint"}</span></td>
      <td>${(d.tags || []).slice(0, 3).map((t) => `<span class="tagchip">${esc(t)}</span>`).join(" ") || "<span class='am'>—</span>"}</td>
      <td>v${d.latest_version}${d.source === "sharepoint" ? ' <span class="am" title="synced from SharePoint">· SP</span>' : ""}${d.scanned ? ' <span class="am">· scan</span>' : ""}${d.status === "inactive" ? ' <span class="ochip o-dismissed">inactive</span>' : ""}</td>
      <td>${Number(d.open_obligations) ? `<span class="duechip due-soon">${d.open_obligations}</span>` : "<span class='am'>—</span>"}</td>
      <td class="am">${fmtD(d.updated_at)}</td>
    </tr>`;
  }).join("");
  host.innerHTML = `<p class="intro"><b>CONTRACTS</b> — the estate. Filter by Legal Setting, expiry, or anything; click a contract for its page.</p>`
    + drop + `<div id="qproc"></div>` + strip
    + (list.length
      ? colfChips(REG_COLS, CST, base) + `<div class="scroll-x reveal"><table class="ctable">${colfHead(REG_COLS, CST)}<tbody>${rows}</tbody></table></div>`
      : DOCS.length ? `<div class="empty">// nothing matches these filters //</div>`
      : `<div class="empty">// the repository is empty — drop the first contracts above, or connect SharePoint in Manage //</div>`);
  colfWire(REG_COLS, CST, base, renderRegistry);   // re-wire after every render
  sequenceReveal(host, ".reveal", 120, 60);
}
window.setCat = (c) => { FILTERS.cat = FILTERS.cat === c ? null : c; renderRegistry(); };
window.setGem = (g) => { FILTERS.gem = FILTERS.gem === g ? null : g; renderRegistry(); };
window.clearFilters = () => { FILTERS = { cat: null, gem: null, text: "" }; renderRegistry(); };
window.dzOver = (e) => { e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = "copy"); e.currentTarget.classList.add("over"); };
window.dzLeave = (e) => { e.currentTarget.classList.remove("over"); };
window.dzDrop = (e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); const fs = e.dataTransfer?.files; if (fs && fs.length) qUpload(fs); };
window.qUpload = async (files) => {
  if (!files || !files.length) return;
  // BATCHED, because one request cannot hold forty contracts. Each document runs
  // the full chain (transcript → key → standing questions → obligations → family
  // → vectors), which takes real model time; the load balancer's timeout is fixed
  // for serverless backends and cannot be raised. So the browser sends a few files
  // per request and keeps going — every batch that completes is already saved, so
  // a failure late in a long upload never costs you the documents that landed.
  const all = [...files];
  const SIZE = 3;
  const results = [];
  const host = $("#qproc");
  let done = 0;
  for (let i = 0; i < all.length; i += SIZE) {
    const chunk = all.slice(i, i + SIZE);
    if (host) host.innerHTML = `<div class="meter"><div class="cmstep now">
        <span class="cmi"><img class="potspin" src="/brand/assets/logos/pot.png" alt=""></span>
        <span>Reading ${done + 1}–${Math.min(done + chunk.length, all.length)} of ${all.length} · transcript, key, standing questions, obligations, family, vectors…</span></div>
      <div class="track"><div class="fill" style="width:${Math.round((done / all.length) * 100)}%"></div></div></div>`;
    const fd = new FormData();
    fd.append("paths", JSON.stringify(chunk.map((f) => f.webkitRelativePath || "")));
    chunk.forEach((f) => fd.append("files", f));
    try {
      const r = await fetch("/api/qlegal/upload", { method: "POST", body: fd });
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch {
        // a gateway timeout returns plaintext, not JSON — say so plainly instead
        // of leaking "Unexpected token 'u'" at the user
        throw new Error(r.status === 504 || /timeout/i.test(txt)
          ? `that batch took too long and was cut off by the gateway (${r.status}). The documents before it are saved — try again with fewer files at a time.`
          : `server returned ${r.status}: ${txt.slice(0, 120)}`);
      }
      if (!r.ok) throw new Error(j.error || `server returned ${r.status}`);
      results.push(...(j.results || []));
    } catch (e) {
      results.push(...chunk.map((f) => ({ filename: f.name, error: String(e.message || e) })));
    }
    done += chunk.length;
    await loadRegistry(); renderRegistry();     // show each batch as it lands
  }
  if (host) host.innerHTML = "";
  const ok = results.filter((r) => r.document_id).length;
  const dups = results.filter((r) => r.skipped).length;
  const errs = results.filter((r) => r.error);
  await loadRegistry(); loadConfirmCount().then(renderNav); loadCats(); renderNav(); renderRegistry();
  let msg = `${ok} of ${all.length} indexed and classified.`;
  if (dups) msg += ` ${dups} skipped (already in the repository).`;
  if (errs.length) msg += ` ${errs.length} failed: ${errs.slice(0, 3).map((e) => `${e.filename} — ${e.error}`).join("; ")}${errs.length > 3 ? "…" : ""}`;
  rdAlert("Ingestion complete", msg);
  const stub = results.find((r) => r.mode && r.mode !== "ai");
  if (stub) rdAlert("No keyed model", "Documents landed with a generic key. Point the Q-Legal pipelines at a keyed model in Settings → AI Pipelines for real extraction.");
};

// ==========================================================================
// The contract page — blocks by importance
// ==========================================================================
let COVER = null;   // "what the search sees" for the open contract
window.openDoc = async (id) => {
  try { OPEN = await (await fetch(`/api/qlegal/document/${id}`)).json(); } catch { return; }
  COVER = null;
  fetch(`/api/qlegal/coverage/${id}`).then((r) => r.json()).then((c) => {
    if (OPEN?.document?.id && Number(OPEN.document.id) === Number(id)) { COVER = c; renderRegistry(); }
  }).catch(() => {});
  AREA = "browse"; SUB.browse = "contracts"; renderNav();
  Object.values(VIEWS).forEach((v) => ($(v).hidden = true)); $("#view-registry").hidden = false;
  renderRegistry(); window.scrollTo({ top: 0, behavior: "smooth" });
};
window.closeDoc = () => { OPEN = null; renderRegistry(); };
function factCell(k, key, v) {
  return `<span class="cfact" title="click to correct" onclick="fixFact('${key}','${esc(String(v ?? "")).replace(/'/g, "&#39;")}')"><span class="cfk">${k}</span>${esc(v || "—")}</span>`;
}
function wikiView() {
  const d = OPEN.document, f = d.facts || {}, c2 = OPEN.c2 || {};
  const latest = (OPEN.versions || []).find((v) => v.version_no === d.latest_version) || (OPEN.versions || [])[0];
  const expDays = f.expiry_date ? Math.round((new Date(f.expiry_date) - Date.now()) / 86400000) : null;

  // ---- HIGHLIGHT block: the dates that run the contract + the document reel
  const dtile = (label, val, warnDays) => `<div class="dtile ${warnDays != null && warnDays <= 31 ? "warn" : warnDays != null && warnDays <= 183 ? "soon" : ""}">
      <div class="dl">${label}</div><div class="dv">${val ? fmtDay(val) : "—"}</div>
      ${warnDays != null ? `<div class="dd">${warnDays < 0 ? `expired ${-warnDays}d ago` : `in ${warnDays} days`}</div>` : ""}</div>`;
  const reel = (OPEN.versions || []).map((v) => `<div class="vcard touch ${v.is_executed ? "exec" : ""}">
      <div class="vhead"><span class="vno">v${v.version_no}</span>${v.is_executed ? '<span class="ochip o-done">signed</span>' : ""}${v.ocr ? '<span class="am">scan</span>' : ""}</div>
      <div class="vmeta">${fmtD(v.created_at)}</div>
      ${v.diff_summary ? `<div class="vdiff">${esc(v.diff_summary).slice(0, 160)}</div>` : ""}
      <div class="vlinks"><a class="ref" href="/api/qlegal/original/${v.id}" target="_blank">📄 file</a><a class="ref" href="/api/qlegal/c1/${v.id}" target="_blank">📖 C1</a><a class="ref" href="/api/qlegal/c2/${v.id}" target="_blank">🔑 C2</a></div>
    </div>`).join("");
  const highlight = `<div class="wikicard reveal hl">
      <div class="hlrow">
        ${dtile("Starts", f.effective_date)}
        ${dtile("Ends", f.expiry_date, expDays)}
        <div class="dtile"><div class="dl">Status</div><div class="dv">${esc(d.status || "active")}${f.auto_renewal ? '<div class="dd">auto-renews</div>' : ""}</div></div>
      </div>
      <div class="rsec-lbl" style="margin-top:14px">Document reel · every version, three ways in</div>
      <div class="reel">${reel || "—"}</div>
    </div>`;

  // ---- PARTIES block
  const parties = `<div class="wikicard reveal"><div class="rsec-lbl">Parties</div>
      <div class="chead-facts">
        ${factCell("Party 1", "party1", d.party1)}${factCell("Party 2", "party2", d.party2)}
        ${factCell("ANSR party", "ansr_party", f.ansr_party)}${factCell("Counterparty", "counterparty", d.counterparty)}
        ${factCell("Nationality / jurisdiction", "jurisdiction", f.jurisdiction)}${factCell("Governing law", "governing_law", f.governing_law)}
        ${factCell("Value", "value", f.value)}${factCell("Notice period", "notice_period", f.notice_period)}
      </div></div>`;

  // ---- LEGAL SETTING block: AI classification + confidence + the growing taxonomy
  const confPct = f.doc_type_confidence ? Math.round(Number(f.doc_type_confidence) * 100) : null;
  const confirmed = !!f.doc_type_confirmed;
  const catChips = CATS.map((c) => `<span class="fchip touch ${d.doc_type === c.name ? "on" : ""}" onclick="setDocCategory(${d.id},'${esc(c.name).replace(/'/g, "&#39;")}')">${esc(c.name)}${Number(c.docs) ? `<span class="n">${c.docs}</span>` : ""}</span>`).join("");
  const setting = `<div class="wikicard reveal"><div class="rsec-lbl">Legal setting · the classification</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:11px">
        ${d.doc_type ? `<span class="typebadge" style="font-size:13px;padding:6px 14px">${esc(d.doc_type)}</span>` : '<span class="am">unclassified</span>'}
        ${confirmed ? '<span class="ochip o-done">confirmed by you</span>'
          : confPct != null ? `<span class="am">AI recommendation · ${confPct}% confident — pick to confirm or change:</span>`
          : '<span class="am">pick the category:</span>'}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:7px">${catChips}
        <span class="fchip touch" style="border-style:dashed" onclick="addCategory(${d.id})">+ new category</span></div>
    </div>`;

  const summary = d.summary ? `<div class="wikicard reveal"><div class="rsec-lbl">What this contract is</div><p class="rsummary">${esc(d.summary)}</p></div>` : "";
  const confs = (OPEN.confirms || []).length ? `<div class="wikicard reveal" style="border-left:3px solid var(--amber)"><div class="rsec-lbl">Awaiting your confirmation</div>${OPEN.confirms.map((c) => confCard(c, true)).join("")}</div>` : "";

  // registers · notice · obligations · family · wikis (importance order)
  const P = { yes: "due-ok", no: "due-none", unclear: "due-soon" };
  const regs = (OPEN.registers || []);
  const regCard = regs.length ? `<div class="wikicard reveal"><div class="rsec-lbl">Standing questions · this contract's answers</div>
      ${regs.map((r) => `<div style="display:flex;align-items:flex-start;gap:9px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line)">
        <span class="duechip ${P[r.present] || "due-none"}">${esc(r.present)}</span>
        <span style="flex:1;min-width:220px;font-size:13px;line-height:1.5"><b>${esc(r.name)}</b>${r.value ? ` · ${esc(r.value)}` : ""}<div class="am" style="margin-top:2px">${esc(r.answer || "")}</div></span>
        ${(r.refs || []).map((x) => `<span class="ref">${esc(x)}</span>`).join(" ")}
        <button class="btn small touch" onclick="fixHit(${r.id},'${esc(r.present)}','${esc(r.answer || "").replace(/'/g, "&#39;")}','${esc(r.value || "").replace(/'/g, "&#39;")}')">Correct</button>
      </div>`).join("")}</div>` : "";
  const notice = c2.notice || {};
  const nrows = [
    ...(notice.notice_clauses || []).map((n) => `<div class="rsummary" style="margin-bottom:6px">• notify — ${esc(n.what || "")} ${n.method ? `· ${esc(n.method)}` : ""} ${n.days ? `· ${esc(String(n.days))} days` : ""} <span class="ref">${esc(n.ref || "")}</span></div>`),
    ...(notice.change_of_control || []).map((n) => `<div class="rsummary" style="margin-bottom:6px">• change of control — requires <b>${esc(n.requires || "notice")}</b> <span class="ref">${esc(n.ref || "")}</span></div>`),
  ].join("");
  const noticeCard = nrows ? `<div class="wikicard reveal"><div class="rsec-lbl">Notice machinery · the change-of-guard register</div>${nrows}${(notice.notice_contacts || []).filter(Boolean).length ? `<div class="am" style="margin-top:6px">contacts: ${esc((notice.notice_contacts || []).filter(Boolean).join(" · "))}</div>` : ""}</div>` : "";
  const obls = (OPEN.obligations || []).map((o) => obligationRow(o, true)).join("");
  const oblCard = `<div class="wikicard reveal"><div class="rsec-lbl">Deliverables, SLAs &amp; deadlines</div>${obls || '<span class="am">none extracted</span>'}</div>`;
  const parent = OPEN.parent ? `<div class="treecard touch" onclick="openDoc(${OPEN.parent.id})">↑ <b>${esc(OPEN.parent.title || OPEN.parent.filename)}</b> <span class="relk">${esc(d.relation_kind || "parent")}${d.relation_status === "confirmed" ? " ✓" : " · proposed"}</span> <span class="am" style="margin-left:auto">open ›</span></div>` : "";
  const kids = (OPEN.children || []).map((k) => `<div class="treecard touch" onclick="openDoc(${k.id})">↳ <b>${esc(k.title || k.filename)}</b> ${k.doc_type ? `<span class="typebadge">${esc(k.doc_type)}</span>` : ""} <span class="relk">${esc(k.relation_kind || "child")}</span> <span class="am" style="margin-left:auto">open ›</span></div>`).join("");
  const treeCard = (parent || kids) ? `<div class="wikicard reveal" id="famcard"><div class="rsec-lbl">Document family</div>${parent}${kids}</div>` : "";
  const near = (OPEN.nearest || []);
  const nearCard = near.length ? `<div class="wikicard reveal"><div class="rsec-lbl">Nearest in the estate · by meaning</div>
      ${near.map((n) => `<div class="treecard touch" onclick="openDoc(${n.id})">≈ <b>${esc(n.title || n.filename)}</b> ${n.doc_type ? `<span class="typebadge">${esc(n.doc_type)}</span>` : ""} <span class="am">${n.similarity}% similar</span> <span class="am" style="margin-left:auto">open ›</span></div>`).join("")}
      <div class="am" style="margin-top:8px">computed from the vector spine — useful for “what did we agree last time with someone like this”</div></div>` : "";
  const contents = (c2.contents || []);
  const contentsCard = contents.length ? `<div class="wikicard reveal"><div class="rsec-lbl">Contents wiki</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${contents.slice(0, 80).map((c) => `<span class="tagchip">${esc(c.ref || "")} ${esc(c.heading || "")}</span>`).join("")}</div>
      ${(c2.exhibits || []).length ? `<div class="am" style="margin-top:8px">exhibits &amp; schedules: ${esc((c2.exhibits || []).map((x) => `${x.ref || ""} ${x.title || ""}`.trim()).join(" · "))}</div>` : ""}</div>` : "";
  const clauses = (c2.clauses || []);
  const clauseCard = clauses.length ? `<div class="wikicard reveal"><div class="rsec-lbl">Clause wiki · ${clauses.length} clauses (hover for the gist)</div><div style="display:flex;flex-wrap:wrap;gap:6px">${clauses.slice(0, 80).map((c) => `<span class="tagchip" title="${esc(c.gist || "")}">${esc(c.ref || "")} ${esc(c.label || "")}</span>`).join("")}${clauses.length > 80 ? `<span class="am">+ ${clauses.length - 80} more</span>` : ""}</div></div>` : "";

  const head = `<span class="backlnk" onclick="closeDoc()">‹ all contracts</span>
    <div class="chead reveal">
      <div class="chead-emb">Q</div>
      <div class="chead-body">
        <div class="chead-titlerow"><span class="chead-title">${esc(d.title || d.filename)}</span>${d.doc_type ? `<span class="typebadge">${esc(d.doc_type)}</span>` : ""}${(d.tags || []).map((t) => `<span class="tagchip">${esc(t)}</span>`).join(" ")}</div>
        ${(d.party1 || d.party2) ? `<div class="chead-parties">${esc(d.party1 || "?")}<span class="vs">⟷</span>${esc(d.party2 || "?")}</div>` : ""}
        ${d.source === "sharepoint"
          ? `<div class="am" style="margin-top:6px"><span class="srcpill sp">SharePoint</span> the source of truth — kept in step by the nightly scan${f.sp_web_url ? ` · <a class="ref" href="${esc(f.sp_web_url)}" target="_blank">open in SharePoint ↗</a>` : ""}</div>`
          : `<div class="am" style="margin-top:6px"><span class="srcpill dev">device upload</span> ${esc(d.source_location || d.filename)}${(d.source_detail || {}).by ? ` · added by ${esc(d.source_detail.by)}` : ""}${(d.source_detail || {}).at ? ` · ${fmtD(d.source_detail.at)}` : ""} — <b>not</b> governed by the SharePoint scan; there is no original to re-fetch, so the vault snapshot is the only copy</div>`}
      </div>
      <button class="btn small touch" onclick="delDoc(${d.id})" title="remove from the derived layer only">✕</button>
    </div>`;
  // ---- COVERAGE: what the semantic search can actually match on for this contract
  const cv = COVER;
  const coverCard = (cv && cv.available) ? (() => {
    const c = cv.counts || {};
    const gap = (cv.missing_clauses || []).length;
    return `<div class="wikicard reveal"><div class="rsec-lbl">What the search sees · the semantic index for this contract</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <span class="duechip ${cv.fresh ? "due-ok" : "due-soon"}">${cv.fresh ? "up to date" : "needs re-indexing"}</span>
        <span class="tagchip">${c.document || 0} document</span>
        <span class="tagchip">${c.section || 0} sections</span>
        <span class="tagchip">${c.clause || 0} clauses</span>
        ${cv.from_c1 ? `<span class="tagchip" title="indexed on the real clause text from the transcript">${cv.from_c1} full clause text</span>` : ""}
        ${cv.from_gist ? `<span class="tagchip" style="color:var(--amber);border-color:#EAD3AE" title="the § anchor could not be located in the transcript, so only the one-line summary is indexed">${cv.from_gist} summary only</span>` : ""}
        <span class="am" style="margin-left:auto">${esc(cv.model || "—")}${cv.embedded_at ? ` · ${fmtDT(cv.embedded_at)}` : ""}</span>
      </div>
      ${gap ? `<div class="rsummary" style="color:var(--amber);margin-bottom:8px">⚠ ${gap} clause${gap === 1 ? "" : "s"} in the clause wiki never made it into the index — invisible to semantic search: ${(cv.missing_clauses || []).slice(0, 12).map((r) => `<span class="ref">${esc(r)}</span>`).join(" ")}</div>` : ""}
      ${!cv.fresh ? `<div style="margin-bottom:9px"><button class="btn small btn--org touch" onclick="reindexDoc(${d.id})">Re-index this contract ▸</button>
        <span class="am" style="margin-left:8px">the nightly scan and any new version do this automatically</span></div>` : ""}
      <details><summary style="cursor:pointer;font-size:12.5px;color:var(--org)">▸ show the ${(cv.chunks || []).length} indexed chunks</summary>
        <div style="max-height:40vh;overflow-y:auto;margin-top:9px">
          ${(cv.chunks || []).map((k) => `<div style="padding:7px 0;border-bottom:1px solid var(--line)">
            <span class="tagchip">${esc(k.granularity)}</span>${k.ref ? ` <span class="ref">${esc(k.ref)}</span>` : ""}
            ${k.source === "gist" ? ' <span class="am" style="color:var(--amber)">summary only</span>' : ""}
            <b style="font-size:12.5px"> ${esc(k.title || "")}</b>
            <div class="am" style="margin-top:2px;line-height:1.5">${esc(k.preview)}${k.chars > 300 ? "…" : ""}</div></div>`).join("")}
        </div></details></div>`;
  })() : "";
  return head + askDocBox(d) + highlight + setting + parties + summary + confs + regCard + noticeCard + oblCard + treeCard + nearCard + coverCard + contentsCard + clauseCard;
}
// re-embed just this contract (the sweep is estate-wide; this is the one-doc door)
window.reindexDoc = async (id) => {
  const j = await (await fetch("/api/qlegal/sweep/embed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 50 }) })).json();
  if (j.error) return rdAlert("Re-index failed", j.error);
  openDoc(id);
};
window.setDocCategory = async (id, name) => {
  await fetch(`/api/qlegal/document/${id}/category`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc_type: name }) });
  await loadRegistry(); await loadCats(); loadConfirmCount().then(renderNav); openDoc(id);
};
window.addCategory = (docId) => rdForm("New category (Legal Setting)", [{ k: "name", label: "Category name — it joins the taxonomy for every future contract", ph: "e.g. Welfare Agreement" }], async (o) => {
  if (!o.name) return;
  await fetch("/api/qlegal/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: o.name }) });
  if (docId) setDocCategory(docId, o.name); else { await loadCats(); if (OPEN) openDoc(OPEN.document.id); }
});
window.fixFact = (field, current) => rdForm(`Correct · ${field.replace(/_/g, " ")}`, [{ k: "v", label: "Correct value (applies instantly + teaches the extractor)", v: current === "—" ? "" : current }], async (o) => {
  if (o.v === undefined) return;
  await fetch("/api/qlegal/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ surface: "fact", document_id: OPEN.document.id, field, was: current, corrected: o.v }) });
  await loadRegistry(); openDoc(OPEN.document.id);
});
window.delDoc = (id) => rdConfirm("Remove from the repository?", "Only the derived layer is removed — the original in the source of truth is untouched.", async () => {
  await fetch(`/api/qlegal/document/${id}`, { method: "DELETE" });
  OPEN = null; await loadRegistry(); loadCats(); renderNav(); renderRegistry();
});

// ==========================================================================
// Standing questions (registers)
// ==========================================================================
const QST = colfState();
const REGQ_COLS = [
  { key: "name", label: "Standing question", get: (r) => r.name, noFilter: true },
  { key: "builtin", label: "Origin", get: (r) => (r.builtin ? "built-in" : "yours") },
  { key: "yes", label: "Yes", num: true, get: (r) => Number(r.yes_count) || 0, sortLabels: ["Fewest yes", "Most yes"] },
  { key: "unclear", label: "Unclear", num: true, get: (r) => Number(r.unclear_count) || 0, sortLabels: ["Fewest unclear", "Most unclear"] },
  { key: "coverage", label: "Coverage", num: true, get: (r) => Number(r.answered) || 0, sortLabels: ["Least answered", "Most answered"] },
];
async function renderRegisters() {
  const host = $("#view-registers");
  if (REG_OPEN) {
    host.innerHTML = registerHitsView();
    colfWire(HIT_COLS, HST, REG_OPEN.hits || [], renderRegisters);
    sequenceReveal(host, ".reveal", 100, 40); return;
  }
  host.innerHTML = `<div class="empty">loading…</div>`;
  await loadRegisters(); renderNav();
  const QROWS = colfSort(REGQ_COLS, QST, colfRows(REGQ_COLS, QST, REGISTERS));
  const rows = QROWS.map((r) => {
    const answered = Number(r.answered), pending = Math.max(0, REG_TOTAL - answered);
    return `<tr class="clk touch" data-k="${esc((r.name + " " + r.question).toLowerCase())}" onclick="openRegister(${r.id})">
      <td><b>${esc(r.name)}</b>${r.builtin ? ' <span class="tagchip">built-in</span>' : ""}
        <div class="am" style="max-width:60ch;margin-top:3px">${esc(r.question)}</div></td>
      <td><span class="duechip due-ok">${r.yes_count} yes</span></td>
      <td>${Number(r.unclear_count) ? `<span class="duechip due-soon">${r.unclear_count} unclear</span>` : "<span class='am'>—</span>"}</td>
      <td class="am">${answered}/${REG_TOTAL}${pending ? ` <span style="color:var(--amber)">· ${pending} pending</span>` : ""}</td>
      <td class="tacts"><button class="btn small touch" onclick="event.stopPropagation();editRegister(${r.id})">Edit</button>
        <button class="btn small touch" onclick="event.stopPropagation();delRegister(${r.id},'${esc(r.name).replace(/'/g, "&#39;")}')">✕</button></td>
    </tr>`;
  }).join("");
  const pendingAny = REGISTERS.some((r) => Number(r.answered) < REG_TOTAL);
  host.innerHTML = `<p class="intro"><b>STANDING QUESTIONS</b> — write a question once, in plain English; it is answered for <b>every contract</b> (now and future) with § evidence. An infinite set of "which of our contracts…" becomes instant, filterable columns.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn btn--primary touch" onclick="addRegister()">+ Ask a standing question</button>
      ${pendingAny ? `<button class="btn btn--org touch" onclick="runRegisterSweep(null)">Answer across the estate ▸</button>` : ""}
    </div><div id="regproc"></div>`
    + (REGISTERS.length
      ? `<div class="cfilter"><input placeholder="filter questions…" oninput="filterTable('regstable',this.value)"><span class="am" id="regstable-note"></span></div>
         ${colfChips(REGQ_COLS, QST, REGISTERS)}<div class="scroll-x reveal"><table class="ctable" id="regstable">${colfHead(REGQ_COLS, QST, "", "<th></th>")}<tbody>${rows}</tbody></table></div>`
      : `<div class="empty">// no standing questions yet //</div>`);
  if (REGISTERS.length) colfWire(REGQ_COLS, QST, REGISTERS, renderRegisters);
  sequenceReveal(host, ".reveal", 120, 60);
}
window.openRegister = async (id) => {
  try { REG_OPEN = await (await fetch(`/api/qlegal/register/${id}/hits`)).json(); } catch { return; }
  renderRegisters(); window.scrollTo({ top: 0, behavior: "smooth" });
};
window.closeRegister = () => { REG_OPEN = null; renderRegisters(); };
const HST = colfState();
const HIT_COLS = [
  { key: "doc", label: "Contract", get: (h) => h.title || h.filename, noFilter: true },
  { key: "type", label: "Type", get: (h) => h.doc_type || "unclassified" },
  { key: "present", label: "Answer", get: (h) => h.present || "—",
    opts: [{ id: "yes", label: "yes" }, { id: "no", label: "no" }, { id: "unclear", label: "unclear" }],
    sortLabels: ["yes → unclear", "unclear → yes"] },
  { key: "value", label: "Value", get: (h) => h.value || "—" },
  { key: "detail", label: "Detail", get: (h) => h.answer || "", noFilter: true },
  { key: "refs", label: "§", get: (h) => (h.refs || []).length ? h.refs : ["—"] },
  { key: "status", label: "Source", get: (h) => (h.status === "auto" ? "AI" : "confirmed by you") },
];
function registerHitsView() {
  const r = REG_OPEN.register, allHits = REG_OPEN.hits || [];
  const hits = colfSort(HIT_COLS, HST, colfRows(HIT_COLS, HST, allHits));
  const P = { yes: "due-ok", no: "due-none", unclear: "due-soon" };
  const rows = hits.map((h) => `<tr class="clk touch" data-k="${esc(((h.title || h.filename) + " " + (h.answer || "") + " " + h.present).toLowerCase())}">
      <td onclick="openDoc(${h.document_id})"><b>${esc(h.title || h.filename)}</b>${h.doc_type ? ` <span class="typebadge">${esc(h.doc_type)}</span>` : ""}
        <div class="am">${esc([h.party1, h.party2].filter(Boolean).join(" ⟷ "))}</div></td>
      <td><span class="duechip ${P[h.present] || "due-none"}">${esc(h.present)}</span>${h.status !== "auto" ? ' <span class="tagchip">confirmed</span>' : ""}</td>
      <td>${esc(h.value) || "<span class='am'>—</span>"}</td>
      <td style="max-width:44ch">${esc(h.answer || "")}</td>
      <td>${(h.refs || []).map((x) => `<span class="ref">${esc(x)}</span>`).join(" ") || "<span class='am'>—</span>"}</td>
      <td class="tacts"><button class="btn small touch" onclick="fixHit(${h.id},'${esc(h.present)}','${esc(h.answer || "").replace(/'/g, "&#39;")}','${esc(h.value || "").replace(/'/g, "&#39;")}')">Correct</button></td>
    </tr>`).join("");
  return `<span class="backlnk" onclick="closeRegister()">‹ all standing questions</span>
    <div class="wikicard reveal"><div class="rsec-lbl">Standing question</div>
      <p class="rsummary"><b>${esc(r.name)}</b> — ${esc(r.question)}</p>
      ${REG_OPEN.not_yet_answered ? `<div style="margin-top:10px"><button class="btn btn--org small touch" onclick="runRegisterSweep(${r.id})">Answer the remaining ${REG_OPEN.not_yet_answered} ▸</button></div>` : ""}
    </div><div id="regproc"></div>`
    + (hits.length
      ? `<div class="cfilter"><input placeholder="filter the estate…" oninput="filterTable('hitstable',this.value)"><span class="am" id="hitstable-note"></span></div>
         ${colfChips(HIT_COLS, HST, allHits)}<div class="scroll-x reveal"><table class="ctable" id="hitstable">${colfHead(HIT_COLS, HST, "", "<th></th>")}<tbody>${rows}</tbody></table></div>`
      : `<div class="empty">// not answered on any contract yet — run it across the estate //</div>`);
}
window.addRegister = () => registerForm("Ask a standing question", {}, async (o) => {
  if (!o.name || !o.question) return;
  const j = await (await fetch("/api/qlegal/registers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) })).json();
  await renderRegisters();
  if (j.register) rdConfirm("Answer it across the estate now?", `“${o.name}” will be answered for every contract already in the repository (new arrivals answer it automatically).`, () => runRegisterSweep(j.register.id));
});
window.editRegister = (id) => { const r = REGISTERS.find((x) => Number(x.id) === Number(id)); if (!r) return; registerForm("Edit standing question", r, async (o) => { await fetch(`/api/qlegal/register/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) }); renderRegisters(); }); };
window.delRegister = (id, name) => rdConfirm("Delete this standing question?", `“${name}” and its answers across the estate will be removed.`, async () => { await fetch(`/api/qlegal/register/${id}`, { method: "DELETE" }); renderRegisters(); });
window.runRegisterSweep = async (registerId) => {
  const host = document.getElementById("regproc"); let total = 0;
  for (let pass = 0; pass < 40; pass++) {
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

// ==========================================================================
// MANAGE — obligations (task manager) · confirm · rules · sharepoint · log
// ==========================================================================
function dueChip(o) {
  if (!o.due_date) return `<span class="duechip due-none">${esc(o.frequency || "undated")}</span>`;
  const d = new Date(o.due_date), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const cls = days < 0 ? "due-over" : days <= (o.lead_days || 30) ? "due-soon" : "due-ok";
  return `<span class="duechip ${cls}">${fmtDay(o.due_date)}${days < 0 ? ` · ${-days}d overdue` : days <= 60 ? ` · in ${days}d` : ""}</span>`;
}
function obligationRow(o, compact) {
  const acts = o.status === "done" ? "" : `<span style="display:inline-flex;gap:5px;flex-wrap:wrap">
    ${o.status === "proposed" ? `<button class="btn small touch" onclick="oblAct(${o.id},'confirmed')">Track it</button>` : ""}
    <button class="btn small touch" onclick="oblOwner(${o.id},'${esc(o.owner || "").replace(/'/g, "&#39;")}')">${o.owner ? "Doer: " + esc(o.owner) : "Assign doer"}</button>
    <button class="btn small btn--org touch" onclick="oblAct(${o.id},'done')">✓ Completed</button>
    <button class="btn small touch" onclick="oblAct(${o.id},'dismissed')">Dismiss</button></span>`;
  return `<div data-k="${esc([o.what, o.kind, o.status, o.owner, o.who_owes, o.title, o.filename].join(" ").toLowerCase())}" style="display:flex;align-items:flex-start;gap:9px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line)">
    ${dueChip(o)}<span class="ochip o-${esc(o.status)}">${esc(o.status)}</span>
    <span style="flex:1;min-width:200px;font-size:13px;line-height:1.5">${esc(o.what)} <span class="am">· ${esc(o.kind)} · ${esc(o.who_owes || "")}</span> ${o.ref ? `<span class="ref">${esc(o.ref)}</span>` : ""}${compact ? "" : ` <span class="am">— <span style="cursor:pointer;color:var(--org)" onclick="openDoc(${o.document_id})">${esc(o.title || o.filename || "")}</span></span>`}</span>
    ${acts}</div>`;
}
async function loadObligations() { try { OBLIGS = ((await (await fetch("/api/qlegal/obligations")).json()).obligations) || []; } catch { OBLIGS = []; } }
async function renderObligations() {
  const host = $("#view-obligations");
  host.innerHTML = `<div class="empty">loading…</div>`;
  await loadObligations(); renderNav();
  const upcoming = OBLIGS.filter((o) => o.status !== "done");
  const done = OBLIGS.filter((o) => o.status === "done");
  host.innerHTML = `<p class="intro"><b>OBLIGATIONS</b> — the task manager. Renewal &amp; termination deadlines and each contract's deliverables/SLAs, every one citing its §. Track it → assign the doer → ✓ Completed (or Dismiss). Reminders ride these dates.</p>`
    + `<div class="cfilter"><input placeholder="filter by task, contract, kind, doer…" oninput="filterCards('oblist',this.value)"></div>`
    + (upcoming.length ? `<div class="wikicard reveal" id="oblist">${upcoming.map((o) => obligationRow(o)).join("")}</div>` : `<div class="empty">// nothing tracked yet — obligations appear as contracts are ingested //</div>`)
    + (done.length ? `<div class="wikicard reveal" style="opacity:.7"><div class="rsec-lbl">Completed</div>${done.map((o) => obligationRow(o)).join("")}</div>` : "");
  sequenceReveal(host, ".reveal", 120, 60);
}
window.oblAct = async (id, status) => { await fetch(`/api/qlegal/obligation/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); if (OPEN) openDoc(OPEN.document.id); else renderObligations(); };
window.oblOwner = (id, cur) => rdForm("Assign the doer", [{ k: "owner", label: "Who owns this obligation?", v: cur, ph: "name or email" }], async (o) => {
  await fetch(`/api/qlegal/obligation/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: o.owner, status: "confirmed" }) });
  if (OPEN) openDoc(OPEN.document.id); else renderObligations();
});

function confCard(c, compact) {
  const p = c.proposal || {};
  const parent = c.parent_title || c.parent_filename || (p.parent_id ? `#${p.parent_id}` : "");
  const what = c.kind === "link" ? `files under <b>${esc(parent)}</b> as <b>${esc(p.relation_kind || "references")}</b>`
    : c.kind === "lineage" ? `the same contract as <b>${esc(c.other_name || ("#" + p.other_id))}</b> (draft ↔ signed)`
    : c.kind === "classification" ? `classify this document${p.doc_type ? ` as <b>${esc(p.doc_type)}</b>` : ""}`
    : c.kind === "removal" ? `mark <b>inactive</b> — the file is gone from SharePoint (record + history kept here)`
    : esc(JSON.stringify(p));
  return `<div class="conf reveal" data-k="${esc([c.kind, c.filename, c.title, c.why].join(" ").toLowerCase())}"><div class="conf-h"><span class="kindb">${esc(c.kind)}</span>
      ${compact ? "" : `<b style="cursor:pointer" onclick="openDoc(${c.document_id})">${esc(c.title || c.filename || "#" + c.document_id)}</b>`}
      ${c.confidence != null ? `<span class="am">${Math.round(Number(c.confidence) * 100)}%</span>` : ""}</div>
    <div class="why">${what}${c.why ? ` — ${esc(c.why)}` : ""}</div>
    ${consequence(c)}
    <div style="display:flex;gap:7px;margin-top:9px;align-items:center;flex-wrap:wrap">
      ${picker(c)}
      <button class="btn small btn--org touch" onclick="confAct(${c.id},'accept','${esc(c.kind)}')">Accept</button>
      <button class="btn small touch" onclick="confAct(${c.id},'reject','${esc(c.kind)}')">Not this</button></div></div>`;
}
// What becomes true if you accept — stated in plain words, so the button is safe
// to press without opening anything else.
function consequence(c) {
  const p = c.proposal || {};
  const t = c.kind === "classification"
      ? "It files under this category, standing questions scoped to that type start applying, and drafting can use it as a model."
    : c.kind === "link"
      ? "It joins that family — the parent's terms govern it in reviews, and both pages link to each other."
    : c.kind === "lineage"
      ? "The two merge into one version rail; the signed copy becomes authoritative and duplicate obligations collapse."
    : c.kind === "removal"
      ? "It leaves the active estate and its obligations are dismissed. The record and its history are kept — nothing is deleted."
    : "";
  return t ? `<div class="am" style="margin-top:7px;line-height:1.5"><b>If you accept:</b> ${esc(t)}</div>` : "";
}
// The choice, inline. Classification is the common case: the AI's guess is
// preselected, and picking a different one is one click — not hidden behind Accept.
function picker(c) {
  if (c.kind !== "classification") return "";
  const guess = (c.proposal || {}).doc_type || "";
  const names = CATS.map((x) => x.name);
  if (guess && !names.some((n) => n.toLowerCase() === String(guess).toLowerCase())) names.unshift(guess);
  return `<select id="confpick-${c.id}" style="max-width:230px;font-size:13px;border:1px solid var(--line2);border-radius:9px;padding:8px 10px">
      ${names.map((n) => `<option ${String(n).toLowerCase() === String(guess).toLowerCase() ? "selected" : ""}>${esc(n)}</option>`).join("")}
      ${names.length ? "" : `<option value="">— no categories yet —</option>`}
    </select>`;
}
async function renderConfirm() {
  const host = $("#view-confirm");
  host.innerHTML = `<div class="empty">loading…</div>`;
  let LED = {};
  try { CONFIRMS = ((await (await fetch("/api/qlegal/confirms")).json()).confirms) || []; } catch { CONFIRMS = []; }
  try { LED = await (await fetch("/api/qlegal/confirms/ledger")).json(); } catch { LED = {}; }
  CONF_N = CONFIRMS.length || null; renderNav();

  // Grouped by KIND, not by time: twelve classifications in a row is a rhythm;
  // alternating kinds is twelve context switches.
  const KINDS = [["classification", "What kind of document is this?"], ["link", "Does this sit under that?"],
    ["lineage", "Are these the same contract?"], ["removal", "Gone from the source"]];
  const groups = KINDS.map(([k, q]) => [k, q, CONFIRMS.filter((c) => c.kind === k)]).filter(([, , g]) => g.length);

  const ledger = (LED.decided_30d || LED.open != null) ? `
    <div class="wikicard reveal" style="border-left:3px solid var(--grn)">
      <div class="rsec-lbl">What your decisions changed</div>
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:8px">
        <span class="tagchip">${LED.decided_30d || 0} decided in 30 days</span>
        <span class="tagchip">${LED.decided_7d || 0} this week</span>
        ${LED.suppressed ? `<span class="tagchip">${LED.suppressed} suggestion${LED.suppressed === 1 ? "" : "s"} retired for good</span>` : ""}
        ${LED.confidence_pct != null ? `<span class="tagchip">classifier now ${LED.confidence_pct}% confident</span>` : ""}
        ${LED.confirmed ? `<span class="tagchip">${LED.confirmed} of ${LED.classified} confirmed by a human</span>` : ""}
      </div>
      <div class="am" style="line-height:1.55">Every "not this" is remembered — that exact suggestion is never made again, so this list gets shorter as you work.</div>
      ${(LED.reasons || []).length ? `<div style="margin-top:9px"><div class="rsec-lbl">Reasons you gave — a repeat is a rule worth writing</div>
        ${LED.reasons.map((r) => `<div class="am" style="padding:3px 0">• ${esc(r.reason)} <b>×${r.c}</b></div>`).join("")}</div>` : ""}
    </div>` : "";

  const blocked = LED.blocked ? `
    <div class="wikicard reveal" style="border-left:3px solid var(--amber)">
      <div class="rsec-lbl">Blocked — not decisions, system problems</div>
      <p class="rsummary">${LED.blocked} document${LED.blocked === 1 ? "" : "s"} couldn't be classified because the pipeline couldn't run — usually no keyed model. That isn't a judgement call, so it isn't in the list below.</p>
      <button class="btn small touch" onclick="setArea('settings');setSub('pipelines')">Check AI Pipelines ▸</button>
    </div>` : "";

  host.innerHTML = `<p class="intro"><b>NEEDS YOU</b> — the AI proposes, you decide. Everything you need is on the card; every answer teaches the system.</p>`
    + ledger + blocked
    + (groups.length
      ? groups.map(([k, question, g]) => `
        <div class="rsec-lbl" style="margin:20px 0 8px">${esc(question)} · ${g.length}</div>
        ${g.length > 1 ? `<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn small btn--org touch" onclick="confBatch('${k}','accept')">Accept all ${g.length}</button>
          <span class="am">only when the evidence below reads the same for each</span></div>` : ""}
        <div id="conflist-${k}">${g.map((c) => confCard(c)).join("")}</div>`).join("")
      : `<div class="empty">// nothing awaiting your decision //</div>`);
  sequenceReveal(host, ".reveal", 110, 50);
}
// accept a whole group at once — same resolve path as a single decision
window.confBatch = (kind, action) => {
  const ids = CONFIRMS.filter((c) => c.kind === kind).map((c) => c.id);
  rdConfirm(`Accept all ${ids.length}?`, "Each one resolves exactly as if you pressed Accept on it individually. Classifications use the AI's proposed category — change any you disagree with first.", async () => {
    await fetch("/api/qlegal/confirms/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action }) });
    renderConfirm(); loadRegistry(); loadCats(); loadConfirmCount().then(renderNav);
  });
};
window.confAct = async (id, action, kind) => {
  if (action === "reject") return rdForm("Not this — why?", [{ k: "reason",
    label: "One line. This is remembered: the same suggestion won't be made again, and a reason that recurs becomes a business rule.",
    ph: "e.g. wrong parent · not that type · these aren't the same contract" }], (o) => confSend(id, "reject", kind, o.reason));
  confSend(id, action, kind);
};
window.confSend = async (id, action, kind, reason) => {
  // the dropdown IS the answer — no second modal asking what you already picked
  const picked = document.getElementById(`confpick-${id}`)?.value;
  await fetch(`/api/qlegal/confirm/${id}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, reason, doc_type: (action === "accept" && kind === "classification") ? (picked || undefined) : undefined }) });
  if (OPEN) openDoc(OPEN.document.id); else renderConfirm();
  loadRegistry(); loadCats(); loadConfirmCount().then(renderNav);
};

const SCOPES = ["global", "ingestion", "registers", "search", "obligations", "drafting", "vectors", "sync"];
// The levers, in the order a document moves through the engine. Each param gets
// a human label + unit so the screen reads as controls, not JSON.
const RULE_ORDER = ["c1-read", "c2-key", "families", "obligations", "registers", "vectors", "ask", "drafting", "sharepoint-scan"];
const PARAM_LABEL = {
  max_transcript_chars: ["Transcribe at most", "characters per file"],
  ocr_fallback: ["Vision-OCR scanned pages", ""],
  ocr_when_text_under_chars: ["Treat as a scan below", "characters of text"],
  read_chars: ["Model reads", "characters of the contract"],
  max_tokens: ["Answer budget", "tokens"],
  classify_confidence_min: ["Send to Confirm queue below", "confidence (0-1)"],
  max_clauses: ["Clause wiki cap", "clauses"],
  max_contents: ["Contents wiki cap", "headings"],
  max_per_contract: ["Obligations cap", "per contract"],
  default_lead_days: ["Warn me", "days before a due date"],
  sweep_batch: ["Backfill batch", "contracts per pass"],
  keep_corrected: ["Never overwrite a corrected answer", ""],
  candidates_considered: ["Compare against", "recent contracts"],
  lineage_similarity_min: ["Same contract above", "text overlap (0-1)"],
  require_explicit_reference: ["Only link on an explicit reference", ""],
  documents_read: ["Ask opens", "contracts per question"],
  semantic_candidates: ["Consider", "semantic matches"],
  deep_text_chars: ["Deep-read", "characters per contract"],
  register_answers: ["Carry", "standing answers into context"],
  history_turns: ["Remember", "turns of conversation"],
  obligations_horizon_days: ["Surface obligations due within", "days"],
  granularities: ["Embed at", "(document · section · clause)"],
  max_clause_vectors: ["Clause vectors cap", "per contract"],
  max_section_vectors: ["Section vectors cap", "per contract"],
  nearest_in_estate: ["“Nearest in estate” shows", "contracts"],
  embed_batch: ["Embed", "texts per API call"],
  candidates_ranked: ["Rank", "contracts as possible models"],
  max_models: ["Draft from at most", "model contracts"],
  model_read_chars: ["Read", "characters of each model"],
  nightly_hour_ist: ["Nightly scan at", ":00 IST"],
  file_types: ["Pick up", "file types"],
  removal_detection: ["Propose inactive when a file disappears", ""],
  max_files_per_scan: ["Scan at most", "files per run"],
};
let RULE_DEFAULTS = {};
async function renderRules() {
  const host = $("#view-rules");
  host.innerHTML = `<div class="empty">loading…</div>`;
  try { RULES = ((await (await fetch("/api/qlegal/rules")).json()).rules) || []; } catch { RULES = []; }
  try { RULE_DEFAULTS = ((await (await fetch("/api/qlegal/rule-defaults")).json()).defaults) || {}; } catch { RULE_DEFAULTS = {}; }
  renderNav();
  const field = (code, k, v) => {
    const [label, unit] = PARAM_LABEL[k] || [k.replace(/_/g, " "), ""];
    const def = (RULE_DEFAULTS[code] || {})[k];
    const isB = typeof v === "boolean", isArr = Array.isArray(v);
    const input = isB ? `<input type="checkbox" data-p="${k}" data-t="b" ${v ? "checked" : ""} style="width:16px;height:16px">`
      : isArr ? `<input data-p="${k}" data-t="l" value="${esc(v.join(", "))}" style="width:100%;font-size:13px">`
      : `<input data-p="${k}" data-t="n" value="${esc(String(v))}" style="width:96px;font-size:13px">`;
    return `<label style="display:flex;flex-direction:column;gap:4px;${isArr ? "flex-basis:100%" : ""}">
      <span class="am">${esc(label)}${unit ? ` <span style="color:var(--dim2)">${esc(unit)}</span>` : ""}${def !== undefined && !isB && !isArr ? ` <span style="color:var(--dim2)">· default ${esc(String(def))}</span>` : ""}</span>${input}</label>`;
  };
  const card = (r) => {
    const P = r.params || {};
    return `<div class="rulecard reveal ${r.status === "off" ? "off" : ""}" data-rule="${r.id}">
      <div class="rh"><span class="rt">${esc(r.title)}</span><span class="scopeb">${esc(r.scope)}</span><span class="am">v${r.version}</span>
        <button class="btn small touch" style="margin-left:auto" onclick="toggleRule(${r.id},'${r.status === "active" ? "off" : "active"}')">${r.status === "active" ? "Use defaults" : "Switch on"}</button></div>
      ${r.explain ? `<div class="rb" style="margin-bottom:10px">${esc(r.explain)}</div>` : ""}
      ${Object.keys(P).length ? `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:11px">${Object.entries(P).map(([k, v]) => field(r.code, k, v)).join("")}</div>` : ""}
      ${r.body !== "" && r.body != null ? `<label class="am">The instruction this step runs on — edit freely</label>
        <textarea data-body rows="3" style="width:100%;font-size:12.5px;margin:4px 0 8px;border:1px solid var(--line2);border-radius:9px;padding:9px 11px">${esc(r.body)}</textarea>` : ""}
      <div style="display:flex;gap:8px;align-items:center"><button class="btn small btn--primary touch" onclick="saveRuleLevers(${r.id})">Save</button><span data-msg class="am" style="color:var(--grn)"></span></div>
    </div>`;
  };
  const ordered = [...RULES].sort((a, b) => {
    const i = RULE_ORDER.indexOf(a.code), j = RULE_ORDER.indexOf(b.code);
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
  });
  host.innerHTML = `<p class="intro"><b>BUSINESS RULES</b> — the operating controls of the engine, in the order a contract moves through it: how much of a document each step reads, the confidence below which something goes to the Confirm queue, the overlap at which two files are the same contract, how wide Ask searches. Change a dial, and the very next ingestion or question obeys it.</p>
    <div class="wikicard reveal" style="border-left:3px solid var(--line2)"><div class="rsec-lbl">Not settings — how Q-Legal is built</div>
      <p class="rsummary" style="margin:0">SharePoint / the original file is <b>the source of truth</b> and is never written to (Q-Legal holds no write scope — there is no switch for this). Every classification, family link and lineage match is a <b>proposal</b> that lands in the Confirm queue. Every answer <b>cites its document and §</b>. Corrections are kept and replayed on rebuild. These are properties of the code, not toggles.</p></div>
    ${ordered.map(card).join("")}
    <div style="margin:18px 0"><button class="btn touch" onclick="addRule()">+ Add a house instruction</button>
      <span class="am" style="margin-left:8px">a plain-English instruction injected into a step (no dials)</span></div>`;
  sequenceReveal(host, ".reveal", 90, 50);
}
window.saveRuleLevers = async (id) => {
  const el = document.querySelector(`[data-rule="${id}"]`); if (!el) return;
  const params = {};
  el.querySelectorAll("[data-p]").forEach((f) => {
    const k = f.dataset.p, t = f.dataset.t;
    params[k] = t === "b" ? f.checked : t === "l" ? f.value.split(",").map((x) => x.trim()).filter(Boolean) : Number(f.value);
  });
  const body = { params };
  const ta = el.querySelector("[data-body]"); if (ta) body.body = ta.value;
  const r = await fetch(`/api/qlegal/rule/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const m = el.querySelector("[data-msg]"); if (m) m.textContent = r.ok ? "saved ✓ — the next run obeys" : "error";
};
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

// ---- SharePoint scanner (settings + instructions) ----------------------------
async function renderSharePoint() {
  const host = $("#view-sharepoint");
  host.innerHTML = `<div class="empty">loading…</div>`;
  try { SP = await (await fetch("/api/qlegal/sharepoint")).json(); } catch { SP = {}; }
  const lr = SP.last_result;
  const fld = (k, label, ph, type = "text") => `<div class="arch-meta-row" style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
      <label style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim2);width:110px;flex:0 0 auto">${label}</label>
      <input id="sp-${k}" type="${type}" value="${type === "password" ? "" : esc(SP[k] || "")}" placeholder="${ph}" style="flex:1;font-family:var(--sans);font-size:13px;border:1px solid var(--line2);border-radius:9px;padding:9px 12px"></div>`;
  host.innerHTML = `<p class="intro"><b>SHAREPOINT SCANNER</b> — read-only. Every night at <b>2:00 AM IST</b> Q-Legal scans the legal library for new and changed files and runs each through the full pipeline (transcript → key → standing questions → obligations → family links). SharePoint remains the source of truth; Q-Legal cannot write to it.</p>
    <div class="wikicard reveal"><div class="rsec-lbl">Connection (from your IT — see the setup guide below)</div>
      ${fld("tenant_id", "Tenant ID", "xxxxxxxx-xxxx-…")}
      ${fld("client_id", "Client ID", "the app registration's id")}
      ${fld("client_secret", "Client secret", SP.hasSecret ? "•••••• saved — type to replace" : "paste the secret", "password")}
      ${fld("site_id", "Site ID", "contoso.sharepoint.com,guid,guid — or the site's Graph id")}
      ${fld("drive_id", "Library ID", "optional — blank = the site's default document library")}
      ${fld("folder", "Folder", "optional — e.g. Contracts/Live (blank = whole library)")}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <button class="btn btn--primary touch" onclick="spSave()">Save</button>
        <button class="btn touch" onclick="spTest()">Test connection</button>
        <button class="btn btn--org touch" onclick="spScan()">Scan now ▸</button>
        <label style="display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--dim);margin-left:auto">
          <input type="checkbox" id="sp-nightly" ${SP.nightly ? "checked" : ""} onchange="spSave()" style="width:16px;height:16px"> nightly 2:00 AM scan</label>
      </div>
      <div id="sp-msg" style="margin-top:10px"></div>
      <div class="am" style="margin-top:8px">${SP.last_run ? `last scan ${fmtDT(SP.last_run)} — ${lr ? (lr.ok ? `${lr.ingested} ingested · ${lr.skipped} unchanged/skipped · ${(lr.errors || []).length} errors` : `failed: ${esc(lr.error || "")}`) : ""}` : "never scanned yet"}${SP.delta ? " · delta cursor saved (scans only see changes)" : ""}</div>
    </div>
    <div class="wikicard reveal"><div class="rsec-lbl">Setup guide — the 4 flows (send this to IT)</div>
      <div class="rsummary" style="line-height:1.8">
      <b>1 · One-time access (IT, ~15 minutes).</b> In Entra ID create an <b>app registration</b> ("Q-Legal Scanner"). Add the <b>Application</b> permission <code>Sites.Selected</code> (Microsoft Graph) and grant admin consent. Then grant that app <b>read</b> on the legal site only (Graph: <code>POST /sites/{site-id}/permissions</code> with roles ["read"]). Create a <b>client secret</b>. Hand over: tenant ID, client ID, secret, site ID, library ID. Nothing outside the legal site is ever visible, and there is no write scope.<br><br>
      <b>2 · Connect &amp; first scan.</b> Fill the form above → Test connection → <b>Scan now</b>. The first scan walks the whole library (every existing contract is read once: transcript, key, wikis, standing questions, obligations, family links). After that a delta cursor means each scan sees only what changed.<br><br>
      <b>3 · The nightly flow.</b> Every night at 2:00 AM IST the scanner picks up new files, new <b>versions</b> of known files (same document, version rail grows, diff computed), renames/moves (identity = the SharePoint item id, so nothing duplicates), and freshly signed PDFs (matched to their final draft via lineage → confirm queue). Anything low-confidence lands in Manage → Confirm queue, never silently.<br><br>
      <b>4 · The working flow for the legal team.</b> Keep working entirely in SharePoint/Word — drafting, tracked changes, approvals, e-sign via Zoho — and just file executed contracts into the library as today. They appear here, indexed and answerable, by the next morning. Corrections you make here (categories, facts, register answers) stay here and teach the extractor; the originals are never touched.
      </div></div>`;
  sequenceReveal(host, ".reveal", 130, 60);
}
window.spSave = async () => {
  const val = (k) => document.getElementById("sp-" + k)?.value?.trim();
  const body = { tenant_id: val("tenant_id"), client_id: val("client_id"), site_id: val("site_id"), drive_id: val("drive_id"), folder: val("folder"), nightly: document.getElementById("sp-nightly")?.checked };
  const sec = val("client_secret"); if (sec) body.client_secret = sec;
  await fetch("/api/qlegal/sharepoint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const m = document.getElementById("sp-msg"); if (m) m.innerHTML = `<span class="am" style="color:var(--grn)">saved</span>`;
};
window.spTest = async () => {
  const m = document.getElementById("sp-msg"); if (m) m.innerHTML = `<img class="potspin" src="/brand/assets/logos/pot.png" alt=""> testing…`;
  const j = await (await fetch("/api/qlegal/sharepoint/test", { method: "POST" })).json();
  if (m) m.innerHTML = `<span style="color:${j.ok ? "var(--grn)" : "var(--red)"};font-size:13px">${j.ok ? "✓ " : "✕ "}${esc(j.detail)}</span>`;
};
window.spScan = async () => {
  const m = document.getElementById("sp-msg"); if (m) m.innerHTML = `<img class="potspin" src="/brand/assets/logos/pot.png" alt=""> scanning the library — new files run the full pipeline, this can take a while…`;
  try {
    const j = await (await fetch("/api/qlegal/sharepoint/scan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    if (j.error) { if (m) m.innerHTML = `<span style="color:var(--red);font-size:13px">✕ ${esc(j.error)}</span>`; return; }
    if (m) m.innerHTML = `<span style="color:var(--grn);font-size:13px">✓ scan done — ${j.ingested} ingested, ${j.skipped} unchanged, ${(j.errors || []).length} errors</span>`;
    loadRegistry(); loadCats(); renderNav();
  } catch (e) { if (m) m.innerHTML = `<span style="color:var(--red)">✕ ${esc(String(e.message || e))}</span>`; }
};


// ---- Re-index & sweep console -------------------------------------------------
async function renderSweep() {
  const host = $("#view-sweep");
  host.innerHTML = `<div class="empty">loading…</div>`;
  let st = {}; try { st = await (await fetch("/api/qlegal/sweep/status")).json(); } catch { /* tiles show 0 */ }
  const sp = st.sharepoint || {};
  const tile = (v, label, warn) => `<div class="reveal" style="background:#fff;padding:13px 16px;border:1px solid var(--line);border-radius:12px;min-width:128px">
      <div style="font-size:24px;font-weight:700;line-height:1;color:${warn && Number(v) ? "var(--amber)" : "var(--txt)"}">${v}</div>
      <div class="am" style="margin-top:4px">${label}</div></div>`;
  const card = (title, desc, btns) => `<div class="wikicard reveal"><div class="rsec-lbl">${title}</div>
      <p class="rsummary" style="margin-bottom:10px">${desc}</p><div style="display:flex;gap:8px;flex-wrap:wrap">${btns}</div></div>`;
  host.innerHTML = `<p class="intro"><b>RE-INDEX &amp; SWEEP</b> — the repo's health console. Every action is capped and resumable, runs the <b>same pipeline as ingestion</b> (never a diverging copy), and anything uncertain lands in the Confirm queue — including files gone from SharePoint (proposed <b>inactive</b>, never deleted).</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
      ${tile(st.total ?? 0, "active contracts")}${tile(st.inactive ?? 0, "inactive")}
      ${tile(st.unclassified ?? 0, "unclassified", 1)}${tile(st.stub_keyed ?? 0, "need a real key (C2)", 1)}
      ${tile(st.unlinked ?? 0, "no family yet", 1)}${tile(st.registers_pending ?? 0, "register answers pending", 1)}
      ${tile((st.vectors || {}).pending ?? 0, "vectors pending", 1)}${tile(st.error_versions ?? 0, "failed versions", 1)}
    </div>
    <div id="swproc"></div>
    ${card("Legal sweep of SharePoint", `Full walk of the library: <b>new files</b>, <b>updated files</b> (new version + diff), renames/moves, and <b>removals</b> (proposed inactive in the Confirm queue). ${sp.configured ? `Last scan: ${sp.last_run ? fmtDT(sp.last_run) : "never"}.` : "<span style='color:var(--amber)'>SharePoint not configured — set it up in Settings → Integrations.</span>"} The nightly 2:00 AM scan does the delta version automatically.`,
      `<button class="btn btn--org touch" onclick="sweepSharePoint()">Full sweep now ▸</button>`)}
    ${card("Build families &amp; dependencies", `Proposes parent links ("pursuant to the MSA dated…") and draft↔signed lineage for every contract that has neither — each lands in the Confirm queue for your yes/no.`,
      `<button class="btn btn--primary touch" onclick="sweepFamilies()">Propose families ▸</button>`)}
    ${card("Refresh C1 → C2 keys", `Re-runs the concise key, classification, obligations and standing questions from the stored transcripts (no re-download, no re-OCR). Use after changing business rules, categories, or adding a keyed model. Human-confirmed values are never overwritten.`,
      `<button class="btn btn--primary touch" onclick="sweepRefresh('stub')">Refresh the ${st.stub_keyed ?? 0} needing it ▸</button>
       <button class="btn touch" onclick="rdConfirm('Re-derive everything?','One capped batch of the full estate re-derives per click (cost-conscious). Human-confirmed values are never overwritten.',()=>sweepRefresh('all'))">Re-derive all (batch)</button>`)}
    ${card("Answer standing questions", `Backfills every active register across contracts that haven't answered them yet (${st.registers_pending ?? 0} pending).`,
      `<button class="btn btn--primary touch" onclick="sweepRegisters()">Answer pending ▸</button>`)}
    ${(() => { const v = st.vectors || {};
      return card("Semantic vectors · the meaning spine",
        v.available === false
          ? `<span style="color:var(--amber)">pgvector is not installed in this database — search runs on words alone (FTS). Install the extension (Supabase/Cloud SQL have it; local dev uses the pgvector image) and restart to switch the spine on.</span>`
          : `Every contract embedded at three granularities — <b>document · section · clause</b>, each keeping its § anchor — so search, Ask, “nearest in estate” and the Estate map match by <b>meaning</b>, not just words. Model: <b>${esc(v.model || "—")}</b>${v.model === "hash:v1" ? ` <span style="color:var(--amber)">— key-free fallback; point <b>qlegal-embed</b> at a real embedding model in Settings → AI Pipelines, then re-embed here</span>` : ""} · ${v.vectors ?? 0} vectors across ${v.embedded ?? 0} contracts. Swapping the model makes the estate pending again — this sweep IS the re-embed migration.`,
        v.available === false ? "" : `<button class="btn btn--primary touch" onclick="sweepEmbed()">Embed the ${v.pending ?? 0} pending ▸</button>`); })()}`;
  sequenceReveal(host, ".reveal", 90, 40);
}
function swMeter(msg) { const h = document.getElementById("swproc"); if (h) h.innerHTML = `<div class="meter"><div class="cmstep now"><span class="cmi"><img class="potspin" src="/brand/assets/logos/pot.png" alt=""></span><span>${esc(msg)}</span></div></div>`; }
window.sweepSharePoint = async () => {
  swMeter("full sweep of the SharePoint library — new, updated, removed…");
  try {
    const j = await (await fetch("/api/qlegal/sharepoint/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ full: true }) })).json();
    if (j.error) { renderSweep(); return rdAlert("Sweep failed", j.error); }
    await loadRegistry(); loadConfirmCount().then(renderNav); renderSweep();
    rdAlert("SharePoint sweep done", `${j.ingested} ingested · ${j.skipped} unchanged · ${j.removed || 0} removal${(j.removed || 0) === 1 ? "" : "s"} proposed · ${(j.errors || []).length} errors`);
  } catch (e) { renderSweep(); rdAlert("Sweep failed", String(e.message || e)); }
};
window.sweepFamilies = async () => {
  swMeter("reading tell-tales — proposing families & dependencies…");
  try {
    const j = await (await fetch("/api/qlegal/sweep/families", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 15 }) })).json();
    loadConfirmCount().then(renderNav); renderSweep();
    rdAlert("Families proposed", `${j.examined} contract${j.examined === 1 ? "" : "s"} examined — ${j.open_proposals} proposal${j.open_proposals === 1 ? "" : "s"} open in the Confirm queue.`);
  } catch (e) { renderSweep(); rdAlert("Failed", String(e.message || e)); }
};
window.sweepRefresh = async (scope) => {
  let total = 0;
  for (let pass = 0; pass < 40; pass++) {
    swMeter(`re-deriving keys — ${total} contract${total === 1 ? "" : "s"} refreshed…`);
    let j; try { j = await (await fetch("/api/qlegal/sweep/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope, limit: 5 }) })).json(); } catch { break; }
    total += j.processed || 0;
    if (scope === "all" || !j.processed || !j.remaining) break;
  }
  await loadRegistry(); loadCats(); renderSweep();
  rdAlert("Refresh done", `${total} contract${total === 1 ? "" : "s"} re-derived (key, classification, obligations, registers).`);
};
window.sweepEmbed = async () => {
  let total = 0;
  for (let pass = 0; pass < 60; pass++) {
    swMeter(`embedding the estate — ${total} contract${total === 1 ? "" : "s"} vectorised…`);
    let j; try { j = await (await fetch("/api/qlegal/sweep/embed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 10 }) })).json(); } catch { break; }
    total += j.processed || 0;
    if (!j.processed || !j.remaining) break;
  }
  renderSweep();
  rdAlert("Vectors built", `${total} contract${total === 1 ? "" : "s"} embedded. New contracts embed automatically at ingestion.`);
};
window.sweepRegisters = async () => {
  let total = 0;
  for (let pass = 0; pass < 40; pass++) {
    swMeter(`answering standing questions — ${total} contract${total === 1 ? "" : "s"} done…`);
    let j; try { j = await (await fetch("/api/qlegal/registers/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 10 }) })).json(); } catch { break; }
    total += j.processed || 0;
    if (!j.processed || !j.remaining) break;
  }
  renderSweep();
  rdAlert("Registers answered", `${total} contract${total === 1 ? "" : "s"} answered.`);
};

// ---- Taxonomy: categories (Legal Setting) + the tag vocabulary ----------------
async function renderTaxonomy() {
  const host = $("#view-taxonomy");
  host.innerHTML = `<div class="empty">loading…</div>`;
  await loadCats();
  let tags = []; try { tags = ((await (await fetch("/api/qlegal/tags")).json()).tags) || []; } catch { /* empty */ }
  const catRow = (c) => `<div data-k="${esc(c.name.toLowerCase())}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
      <span class="typebadge">${esc(c.name)}</span>
      <span class="am">${c.docs} contract${Number(c.docs) === 1 ? "" : "s"} · ${esc(c.source)}</span>
      ${c.status === "off" ? '<span class="ochip o-dismissed">off</span>' : ""}
      <span style="margin-left:auto"></span>
      <button class="btn small touch" onclick="catToggle(${c.id},'${c.status === "active" ? "off" : "active"}')">${c.status === "active" ? "Switch off" : "Switch on"}</button>
    </div>`;
  host.innerHTML = `<p class="intro"><b>TAXONOMY</b> — the controls behind classification. <b>Legal Setting</b> is the growing category list every upload (and every re-index) is auto-classified into: the AI recommends with confidence, proposes new categories (marked "ai"), you add your own, switch off what shouldn't be offered — and your override on any contract is always final. <b>Tags</b> are the free vocabulary the extractor draws from.</p>
    <div class="wikicard reveal"><div class="rsec-lbl">Legal Setting · contract categories (${CATS.length})</div>
      <div class="cfilter" style="margin-bottom:8px"><input placeholder="filter categories…" oninput="filterCards('catlist',this.value)"><button class="btn btn--primary small touch" style="margin-left:auto" onclick="addCategory(null)">+ Add category</button></div>
      <div id="catlist">${CATS.map(catRow).join("")}</div>
      <div class="am" style="margin-top:10px">To re-classify existing contracts against an updated list, run <b>Refresh C1 → C2</b> in Re-index.</div>
    </div>
    <div class="wikicard reveal"><div class="rsec-lbl">Tag vocabulary (${tags.length})</div>
      <div class="cfilter" style="margin-bottom:8px"><input placeholder="filter tags…" oninput="filterCards('taglist',this.value)"></div>
      <div id="taglist" style="display:flex;flex-wrap:wrap;gap:7px">${tags.map((t) => `<span data-k="${esc(t.tag.toLowerCase())}" class="tagchip" style="font-size:11.5px;padding:4px 10px">${esc(t.tag)} · ${t.docs} <a style="cursor:pointer;color:var(--red);margin-left:4px" title="remove this tag everywhere" onclick="delTag('${esc(t.tag).replace(/'/g, "&#39;")}')">×</a></span>`).join("") || '<span class="am">no tags yet</span>'}</div>
    </div>`;
  sequenceReveal(host, ".reveal", 120, 50);
}
window.catToggle = async (id, status) => { await fetch(`/api/qlegal/category/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); renderTaxonomy(); };
window.delTag = (tag) => rdConfirm("Remove tag everywhere?", `“${tag}” will be removed from the vocabulary and from every contract carrying it.`, async () => {
  await fetch(`/api/qlegal/tag/${encodeURIComponent(tag)}`, { method: "DELETE" }); await loadRegistry(); renderTaxonomy();
});
window.filterCards = (cid, v) => {
  const term = (v || "").toLowerCase().trim();
  document.querySelectorAll(`#${cid} [data-k]`).forEach((el) => { el.style.display = !term || (el.dataset.k || "").includes(term) ? "" : "none"; });
};

// ---- Draft a contract: ask → suggested models → select → draft 1 ---------------
async function renderDraft() {
  const host = $("#view-draft");
  const step1 = `<div class="wikicard reveal"><div class="rsec-lbl">1 · What do you need drafted?</div>
    <textarea id="draftask" rows="3" style="width:100%;font-family:var(--sans);font-size:14px;border:1px solid var(--line2);border-radius:10px;padding:11px 13px;resize:vertical" placeholder="e.g. a Partnership Agreement with Northwind Labs for a joint IP product — 3-year term, Bangalore governing law, revenue share 60/40">${esc(DRAFT.ask)}</textarea>
    <div style="margin-top:10px"><button class="btn btn--primary touch" onclick="draftSuggest()">Suggest model contracts ▸</button></div></div>`;
  const sugg = DRAFT.sugg === null ? "" : `<div class="wikicard reveal"><div class="rsec-lbl">2 · Model it on (pick up to 3 — structure &amp; standard positions come from these)</div>
    ${DRAFT.sugg.length ? DRAFT.sugg.map((m) => {
      const on = DRAFT.sel.includes(Number(m.id));
      return `<div class="treecard touch" style="${on ? "border-color:var(--org);background:#FFF7F1" : ""}" onclick="draftToggle(${m.id})">
        <span style="width:18px;height:18px;border-radius:5px;border:1.5px solid ${on ? "var(--org)" : "var(--line2)"};background:${on ? "var(--org)" : "#fff"};color:#fff;display:grid;place-items:center;font-size:12px;flex:0 0 auto">${on ? "✓" : ""}</span>
        <b>${esc(m.name)}</b>${m.doc_type ? ` <span class="typebadge">${esc(m.doc_type)}</span>` : ""}${m.fit ? ` <span class="am">${Math.round(m.fit * 100)}% fit</span>` : ""}
        <span class="am" style="flex-basis:100%;margin-top:3px">${esc(m.why || "")}</span></div>`;
    }).join("") : `<div class="empty">// nothing suitable in the repository — ingest model contracts first, then draft from them //</div>`}
    ${DRAFT.sugg.length ? `<div style="margin-top:10px"><button class="btn btn--org touch" ${DRAFT.sel.length ? "" : "disabled"} onclick="draftRun()">Draft it from ${DRAFT.sel.length} model${DRAFT.sel.length === 1 ? "" : "s"} ▸</button></div>` : ""}</div>` ;
  const busy = DRAFT.busy ? `<div class="wikicard reveal"><div class="cmstep now"><span class="cmi"><img class="potspin" src="/brand/assets/logos/pot.png" alt=""></span><span>${esc(DRAFT.busy)}</span></div></div>` : "";
  const out = DRAFT.out ? `<div class="wikicard reveal"><div class="rsec-lbl">3 · Draft 1 — modelled on ${esc((DRAFT.out.models || []).map((m) => m.name).join(" + "))}</div>
    <div style="background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:16px 18px;max-height:56vh;overflow-y:auto;font-size:13.5px;line-height:1.7">${mdlite(DRAFT.out.draft_md)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <a class="btn btn--primary touch" style="text-decoration:none" href="/api/qlegal/draft/${DRAFT.out.id}/docx">⤓ Open in Word (.docx)</a>
      <button class="btn touch" onclick="DRAFT={ask:DRAFT.ask,sugg:null,sel:[],out:null,busy:false};renderDraft()">New draft</button>
      <span class="am" style="align-self:center">file it into SharePoint and run your normal tracked-changes process — Q-Legal never writes there</span>
    </div></div>` : "";
  host.innerHTML = `<p class="intro"><b>DRAFT A CONTRACT</b> — describe what you need; the repository <b>suggests the contracts to model it on</b>; you pick; draft 1 comes out structurally complete — definitions, notices, severability appear because your models have them, not because someone remembered to ask. Gaps become [BRACKETED PLACEHOLDERS].</p>`
    + step1 + sugg + busy + out;
  sequenceReveal(host, ".reveal", 120, 50);
}
window.draftSuggest = async () => {
  const ask = (document.getElementById("draftask")?.value || "").trim();
  if (!ask) return rdAlert("Describe it first", "Say what contract you need — type, counterparty, subject, key commercial terms.");
  DRAFT = { ask, sugg: null, sel: [], out: null, busy: "reading the estate — finding the best contracts to model on…" }; renderDraft();
  try {
    const j = await (await fetch("/api/qlegal/draft/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ask }) })).json();
    DRAFT.busy = false;
    if (j.error) { renderDraft(); return rdAlert("Suggest failed", j.error); }
    DRAFT.sugg = j.suggestions || [];
    DRAFT.sel = DRAFT.sugg.slice(0, 2).map((m) => Number(m.id));   // top picks pre-selected
    renderDraft();
  } catch (e) { DRAFT.busy = false; renderDraft(); rdAlert("Suggest failed", String(e.message || e)); }
};
window.draftToggle = (id) => {
  id = Number(id);
  const i = DRAFT.sel.indexOf(id);
  if (i >= 0) DRAFT.sel.splice(i, 1);
  else { if (DRAFT.sel.length >= 3) return rdAlert("Max 3", "Model on up to 3 contracts."); DRAFT.sel.push(id); }
  renderDraft();
};
window.draftRun = async () => {
  if (!DRAFT.sel.length) return;
  DRAFT.busy = "drafting — skeleton from your models, particulars from the ask…"; DRAFT.out = null; renderDraft();
  try {
    const j = await (await fetch("/api/qlegal/draft/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ask: DRAFT.ask, model_ids: DRAFT.sel }) })).json();
    DRAFT.busy = false;
    if (j.error) { renderDraft(); return rdAlert("Draft failed", j.error); }
    DRAFT.out = j.draft; renderDraft(); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  } catch (e) { DRAFT.busy = false; renderDraft(); rdAlert("Draft failed", String(e.message || e)); }
};

// ---- Ask THIS contract — conversational, grounded solely in the open document --
function askDocBox(d) {
  const th = DOCTHREADS[d.id] || [];
  const turns = th.map((t) => `<div class="askbox-a"><div class="askbox-q">🧑 ${esc(t.q)}</div><div class="askbox-ans">${mdlite(t.a)}</div></div>`).join("");
  return `<div class="askbox reveal" style="margin-bottom:18px">
    <div class="askbox-h">✦ Ask this contract <span class="askbox-s">grounded only in ${esc(d.title || d.filename)} · cites the §§ · follow-ups keep context</span></div>
    ${turns}
    ${DOCASKING === d.id ? `<div class="askbox-a"><div class="askbox-ans"><img class="potspin" src="/brand/assets/logos/pot.png" alt=""> reading the contract…</div></div>` : ""}
    <div class="askbox-in"><input id="dockaskin" placeholder="${th.length ? "ask a follow-up…" : "e.g. can we terminate early, and what would it cost us?"}" onkeydown="if(event.key==='Enter'){event.preventDefault();doAskDoc(${d.id})}"><button class="btn btn--org small touch" onclick="doAskDoc(${d.id})">Ask ▸</button></div>
  </div>`;
}
window.doAskDoc = async (id) => {
  const el = document.getElementById("dockaskin"); const qtext = (el?.value || "").trim(); if (!qtext || DOCASKING) return;
  DOCASKING = id; renderRegistry();
  try {
    const history = (DOCTHREADS[id] || []).slice(-4).map((t) => ({ q: t.q, a: t.a }));
    const r = await fetch(`/api/qlegal/document/${id}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: qtext, history }) });
    const j = await r.json();
    DOCASKING = null;
    if (!r.ok) { renderRegistry(); return rdAlert("Ask failed", j.error || ""); }
    (DOCTHREADS[id] = DOCTHREADS[id] || []).push({ q: qtext, a: j.answer });
    renderRegistry();
    setTimeout(() => { const e2 = document.getElementById("dockaskin"); if (e2) e2.focus(); }, 80);
  } catch (e) { DOCASKING = null; renderRegistry(); rdAlert("Ask failed", String(e.message || e)); }
};

// ---- Browse · Estate map + emergent clause library (the vector wiki) -----------
const MAP_COLORS = ["#E8734A", "#4A7DE8", "#3FA36B", "#B04AE8", "#E8B04A", "#4AC2E8", "#E84A8F", "#8FA33F", "#7A6FE8", "#A0522D"];
async function renderMap() {
  const host = $("#view-map");
  host.innerHTML = `<div class="empty"><img class="potspin" src="/brand/assets/logos/pot.png" alt=""> computing the estate map…</div>`;
  let map = {}, lib = {};
  try { [map, lib] = await Promise.all([
    (await fetch("/api/qlegal/estate-map")).json(),
    (await fetch("/api/qlegal/clause-library")).json(),
  ]); } catch { /* cards say why below */ }
  const intro = `<p class="intro"><b>ESTATE MAP</b> — every contract as a point in meaning-space (2D projection of its document vector). Contracts of a kind cluster; the outliers are the ones worth a look. Below it, the <b>emergent clause library</b>: the estate's clauses clustered by meaning — the centre of a cluster is your de-facto standard position, the far edge is the non-standard drafting.</p>`;
  if (map.available === false) { host.innerHTML = intro + `<div class="empty">// pgvector is not installed in this database — the map needs the vector spine (see Manage → Re-index) //</div>`; return; }
  const pts = map.points || [];
  const types = [...new Set(pts.map((p) => p.type))];
  const color = (t) => MAP_COLORS[types.indexOf(t) % MAP_COLORS.length];
  const dots = pts.map((p) => {
    const dev = p.source !== "sharepoint";
    return `<span class="touch" onclick="openDoc(${p.id})" title="${esc(p.name)} · ${esc(p.type)} · ${dev ? "device upload (not governed by the scan)" : "from SharePoint"}"
      style="position:absolute;left:${4 + p.x * 92}%;top:${4 + (1 - p.y) * 88}%;width:13px;height:13px;border-radius:50%;background:${color(p.type)};border:2px solid ${dev ? "var(--srcdev)" : "#fff"};box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:pointer;transform:translate(-50%,-50%)"></span>`;
  }).join("");
  const legend = types.map((t) => `<span class="tagchip"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color(t)};margin-right:5px"></span>${esc(t)}</span>`).join(" ");
  const mapCard = pts.length >= 3
    ? `<div class="wikicard reveal"><div class="rsec-lbl">The estate in meaning-space · ${pts.length} contracts ${map.model === "hash:v1" ? '· <span style="color:var(--amber)">key-free embedding — clusters sharpen with a real model</span>' : ""}</div>
        <div style="position:relative;height:min(58vh,480px);background:var(--bg2);border:1px solid var(--line);border-radius:12px;overflow:hidden">${dots}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${legend}
          <span class="tagchip" style="border-color:var(--srcdev);color:var(--srcdev)">◯ dark ring = device upload</span></div>
        <div class="am" style="margin-top:7px">Colour is the contract type; the ring is its <b>source</b>. ${pts.filter((p) => p.source !== "sharepoint").length} of ${pts.length} came from a device rather than SharePoint — those aren't kept in step by the nightly scan.</div></div>`
    : `<div class="empty">// not enough embedded contracts to map — run the embed sweep in Manage → Re-index //</div>`;
  const clusters = (lib.clusters || []);
  const cRow = (m) => `<div class="treecard touch" onclick="openDoc(${m.document_id})">${m.ref ? `<span class="ref">${esc(m.ref)}</span>` : ""} <b>${esc(m.title || "")}</b> <span class="am">${esc(m.doc)}</span><span class="am" style="flex-basis:100%;margin-top:2px">${esc((m.gist || "").slice(0, 140))}</span></div>`;
  const libCard = clusters.length
    ? `<div class="wikicard reveal"><div class="rsec-lbl">Emergent clause library · ${lib.total} clauses in ${clusters.length} clusters</div>
        ${clusters.slice(0, 12).map((c) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap"><b>${esc(c.label)}</b><span class="am">${c.size} clause${c.size === 1 ? "" : "s"}</span></div>
          <div class="rsec-lbl" style="margin-top:7px">the estate norm (cluster centre)</div>${c.norm.map(cRow).join("")}
          ${c.outliers.length ? `<div class="rsec-lbl" style="margin-top:7px;color:var(--amber)">non-standard (far from the norm — worth a look)</div>${c.outliers.map(cRow).join("")}` : ""}
        </div>`).join("")}</div>`
    : "";
  host.innerHTML = intro + mapCard + libCard;
  sequenceReveal(host, ".reveal", 130, 60);
}

// ---- Browse · SharePoint files (live, read-only, with the library's own facets) --
const FST = colfState();
const SPF_COLS = [
  { key: "name", label: "File", get: (f) => f.name, noFilter: true },
  { key: "folder", label: "Folder", get: (f) => f.path || "/" },
  { key: "by", label: "Modified by", get: (f) => f.modified_by || "—" },
  { key: "modified", label: "Modified", get: (f) => f.modified, fmt: (v) => (v && v !== "—" ? fmtDT(v) : "—"),
    cmp: (a, b) => String(a.modified).localeCompare(String(b.modified)), sortLabels: ["Oldest first", "Newest first"] },
  { key: "size", label: "Size", num: true, get: (f) => f.size || 0, fmt: (v) => `${Math.max(1, Math.round(+v / 1024))} KB`,
    sortLabels: ["Smallest first", "Largest first"] },
  { key: "indexed", label: "In Q-Legal", get: (f) => (f.doc_id ? (f.doc_type || "indexed") : "not indexed") },
];
async function renderSpFiles() {
  const host = $("#view-spfiles");
  if (!SPF.data && !SPF.loading) { SPF.loading = true; host.innerHTML = `<div class="empty"><img class="potspin" src="/brand/assets/logos/pot.png" alt=""> reading the SharePoint library…</div>`; try { SPF.data = await (await fetch(`/api/qlegal/sharepoint/files?folder=${encodeURIComponent(SPF.folder)}&q=${encodeURIComponent(SPF.q)}`)).json(); } catch (e) { SPF.data = { error: String(e.message || e) }; } SPF.loading = false; }
  const d = SPF.data || {};
  if (d.error) { host.innerHTML = `<p class="intro"><b>SHAREPOINT FILES</b> — browse the live library.</p><div class="empty">${esc(d.error)} — configure it in Manage → SharePoint.</div>`; return; }
  const crumbs = [`<span class="fchip touch ${!SPF.folder ? "on" : ""}" onclick="spfGo('')">Library root</span>`]
    .concat(SPF.folder.split("/").filter(Boolean).map((seg, i, arr) => `<span class="fchip touch" onclick="spfGo('${esc(arr.slice(0, i + 1).join("/"))}')">${esc(seg)}</span>`)).join(" / ");
  const folders = (d.folders || []).map((f) => `<span class="fchip touch" onclick="spfGo('${esc((SPF.folder ? SPF.folder + "/" : "") + f.name)}')">📁 ${esc(f.name)}<span class="n">${f.childCount}</span></span>`).join("");
  const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const SPROWS = colfSort(SPF_COLS, FST, colfRows(SPF_COLS, FST, d.files || []));
  const rows = SPROWS.map((f) => `<tr data-k="${esc([f.name, f.path, f.modified_by, f.doc_type].join(" ").toLowerCase())}">
      <td><b>${esc(f.name)}</b><div class="am">${esc(f.path || "/")}</div></td>
      <td class="am">${fmtDT(f.modified)}<div>${esc(f.modified_by)}</div></td>
      <td class="am">${kb(f.size)}</td>
      <td>${f.doc_id ? `<span class="typebadge">${esc(f.doc_type || "indexed")}</span>${f.doc_status === "inactive" ? ' <span class="ochip o-dismissed">inactive</span>' : ""}` : '<span class="am">not indexed</span>'}</td>
      <td class="tacts">${f.doc_id ? `<button class="btn small touch" onclick="openDoc(${f.doc_id})">Open in Q-Legal ▸</button>` : `<button class="btn small btn--org touch" onclick="spfIngest('${esc(f.id)}',this)">Ingest now</button>`}
        <a class="btn small touch" style="text-decoration:none" href="${esc(f.web_url)}" target="_blank">SharePoint ↗</a></td>
    </tr>`).join("");
  host.innerHTML = `<p class="intro"><b>SHAREPOINT FILES</b> — the live library, read-only: browse its folders, search it, see what's indexed here, pull anything in on the spot. The nightly scan keeps the rest in step.</p>
    <div class="fstrip" style="margin-bottom:10px">${crumbs}
      <input class="rinput" style="max-width:240px;margin-left:auto" placeholder="search the library…" value="${esc(SPF.q)}" onkeydown="if(event.key==='Enter'){event.preventDefault();spfSearch(this.value)}">
      <button class="btn small touch" onclick="spfSearch(document.querySelector('#view-spfiles .rinput').value)">Search</button>
      ${SPF.q ? `<button class="btn small touch" onclick="spfSearch('')">✕ clear</button>` : ""}
    </div>
    ${folders ? `<div class="fstrip" style="margin-bottom:12px">${folders}</div>` : ""}
    <div class="cfilter"><input placeholder="filter this list by name, path, person, type…" oninput="filterTable('spftable',this.value)"><span class="am" id="spftable-note"></span></div>
    ${(d.files || []).length
      ? colfChips(SPF_COLS, FST, d.files || []) + `<div class="scroll-x reveal"><table class="ctable" id="spftable">${colfHead(SPF_COLS, FST, "", "<th></th>")}<tbody>${rows}</tbody></table></div>`
      : `<div class="empty">// ${SPF.q ? "no results in the library for that search" : "no files in this folder"} //</div>`}`;
  colfWire(SPF_COLS, FST, d.files || [], renderSpFiles);
  sequenceReveal(host, ".reveal", 120, 50);
}
window.spfGo = (folder) => { SPF = { folder, q: "", data: null, loading: false }; renderSpFiles(); };
window.spfSearch = (q) => { SPF = { ...SPF, q: (q || "").trim(), data: null, loading: false }; renderSpFiles(); };
window.spfIngest = async (itemId, btn) => {
  if (btn) { btn.disabled = true; btn.innerHTML = '<img class="potspin" src="/brand/assets/logos/pot.png" alt=""> ingesting…'; }
  try {
    const j = await (await fetch("/api/qlegal/sharepoint/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item_id: itemId }) })).json();
    if (j.error) { rdAlert("Ingest failed", j.error); if (btn) { btn.disabled = false; btn.textContent = "Ingest now"; } return; }
    await loadRegistry(); loadConfirmCount().then(renderNav); loadCats();
    SPF.data = null; renderSpFiles();
    if (j.document_id) rdAlert("Ingested", `${j.filename} is indexed${j.doc_type ? ` as ${j.doc_type}` : ""} — open it from the table.`);
    else if (j.skipped) rdAlert("Already in", `${j.filename} was already in the repository (${j.skipped}).`);
  } catch (e) { rdAlert("Ingest failed", String(e.message || e)); if (btn) { btn.disabled = false; btn.textContent = "Ingest now"; } }
};

const LST = colfState();
const LOG_COLS = [
  { key: "when", label: "When", get: (l) => l.created_at, fmt: (v) => (v && v !== "—" ? fmtDT(v) : "—"),
    cmp: (a, b) => String(a.created_at).localeCompare(String(b.created_at)), sortLabels: ["Oldest first", "Newest first"] },
  { key: "pipeline", label: "Pipeline", get: (l) => l.pipeline || "—" },
  { key: "model", label: "Model", get: (l) => [l.provider, l.model].filter(Boolean).join(" ") || "—" },
  { key: "mode", label: "Mode", get: (l) => l.status || "—" },
  { key: "ref", label: "Ref", get: (l) => l.ref_type || "—" },
  { key: "input", label: "Input", get: (l) => l.input_summary || "", noFilter: true },
  { key: "output", label: "Output", get: (l) => l.output_summary || "", noFilter: true },
  { key: "rules", label: "Rules applied", get: (l) => (l.rules_applied || []).length ? l.rules_applied : ["none"] },
];
async function renderLog() {
  const host = $("#view-log");
  host.innerHTML = `<div class="empty">loading…</div>`;
  try { LOG = ((await (await fetch("/api/qlegal/log?limit=150")).json()).log) || []; } catch { LOG = []; }
  const LROWS = colfSort(LOG_COLS, LST, colfRows(LOG_COLS, LST, LOG), (a, b) => b.id - a.id);
  const rows = LROWS.map((l) => `<tr data-k="${esc([l.pipeline, l.provider, l.model, l.status, l.ref_type, l.input_summary, l.output_summary].join(" ").toLowerCase())}">
      <td class="am" style="white-space:nowrap">${fmtDT(l.created_at)}</td>
      <td><b>${esc(l.pipeline || "—")}</b><div class="am">${esc(l.provider || "")} ${esc(l.model || "")}</div></td>
      <td>${esc(l.status || "")}</td>
      <td class="am">${esc(l.ref_type || "")}${l.ref_id ? " #" + l.ref_id : ""}</td>
      <td style="max-width:26ch">${esc(l.input_summary || "")}</td>
      <td style="max-width:30ch">${esc(l.output_summary || "")}</td>
      <td class="am">${(l.rules_applied || []).length ? esc((l.rules_applied || []).join(", ")) : "—"}</td>
    </tr>`).join("");
  host.innerHTML = `<p class="intro"><b>AI ACTIVITY</b> — every gated pipeline call, append-only: which step, which model, which business rules were injected.</p>`
    + `<div class="cfilter"><input placeholder="filter by pipeline, model, status…" oninput="filterTable('logtable',this.value)"><span class="am" id="logtable-note"></span></div>`
    + (LOG.length ? colfChips(LOG_COLS, LST, LOG) + `<div class="scroll-x"><table class="ctable" id="logtable">${colfHead(LOG_COLS, LST)}<tbody>${rows}</tbody></table></div>`
      : `<div class="empty">// no AI activity yet //</div>`);
  colfWire(LOG_COLS, LST, LOG, renderLog);
}

// ---- shared bits --------------------------------------------------------------
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
