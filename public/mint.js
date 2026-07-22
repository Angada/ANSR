// Mint — contract analysis. Client + run dropdowns, Generate (animated steps),
// recall past runs, purge. Renders summary box + findings + white analysis boxes.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const confClass = (c) => (c >= 0.85 ? "hi" : c >= 0.6 ? "mid" : "lo");
const money = (n, c = "USD") => (c === "USD" ? "$" : (c ? c + " " : "")) + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
let DATA = null;

async function init() {
  const { clients } = await (await fetch("/api/clients")).json();
  $("#client").innerHTML = clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")
    + `<option value="__new__">+ Create new client…</option>`;
  await loadRuns();
  $("#client").addEventListener("change", () => {
    if ($("#client").value === "__new__") return createClient();
    loadRuns();
  });
  $("#run").addEventListener("change", () => openRun($("#run").value, true)); // explicit switch → animate once
  $("#gen").addEventListener("click", generate);
  renderChips();
  $("#client").addEventListener("change", () => setTimeout(renderChips, 0));
  $("#mProcess")?.addEventListener("click", async () => { if (!DATA) await generate(); mTab("analysis"); });
  $("#purge").addEventListener("click", purge);
  $("#viewOutcomes").addEventListener("click", () => {
    const c = $("#client").value, r = $("#run").value;
    if (!c || c === "__new__") { appAlert("No client", "Pick a client first."); return; }
    location.href = `/invoice-doc.html?customer=${encodeURIComponent(c)}${r ? "&run=" + encodeURIComponent(r) : ""}`;
  });
  $("#rmap").addEventListener("click", mapRoster);
  $("#sowBtn").addEventListener("click", uploadSow);
  $("#ncCreate").addEventListener("click", submitNewClient);
  $("#ncCancel").addEventListener("click", cancelNewClient);
  $("#ncName").addEventListener("keydown", (e) => { if (e.key === "Enter") submitNewClient(); });
}

const SOW = {}; // client → docId
async function uploadSow() {
  const f = $("#sowFile").files[0];
  if (!f) { appAlert("No file", "Choose the SOW (contract) file first."); return; }
  if (f.size > 25 * 1024 * 1024) { appAlert("File too large", "Max 25 MB."); return; }
  $("#sowMsg").textContent = "uploading…";
  const fd = new FormData(); fd.append("file", f); fd.append("customer", $("#client").value); fd.append("docType", "sow");
  const r = await (await fetch("/api/upload", { method: "POST", body: fd })).json();
  if (r.docId) { SOW[$("#client").value] = r.docId; $("#sowMsg").innerHTML = `<span style="color:var(--ansr-teal)">✓ ${esc(f.name)} added — now Generate</span>`; }
  else $("#sowMsg").textContent = r.error || "upload failed";
}

let ROSTER = null;
const FIELD_LABEL = { ext_id: "Employee ID", name: "Name", role: "Role / level", source: "Source", sourcing_date: "Sourcing date", offer_date: "Offer date", join_date: "Join date", exit_date: "Exit date", fixed_ctc: "Fixed CTC", variable_ctc: "Variable CTC", status: "Status" };

async function mapRoster() {
  const f = $("#rfile").files[0];
  if (!f) { appAlert("No file", "Choose a working sheet first."); return; }
  if (f.size > 25 * 1024 * 1024) { appAlert("File too large", "Max 25 MB."); return; }
  $("#rmap").disabled = true;
  $("#rout").innerHTML = `<div id="rmeter" style="margin-top:12px"></div>`;
  const fd = new FormData(); fd.append("file", f); fd.append("client", $("#client").value);
  const p = fetch("/api/mint/roster/map", { method: "POST", body: fd }).then((r) => r.json());
  // AI reads + understands the sheet (meter runs over the read)
  await runMeter(["Reading the working sheet", "Understanding each column", "Checking the data row by row", "Preparing what I need to confirm"], "rmeter", "✓ Read the sheet");
  ROSTER = await p;
  $("#rmap").disabled = false;
  if (!ROSTER || ROSTER.error) { $("#rout").innerHTML = `<p class="lbl" style="color:#d6402a;margin-top:10px">${esc(ROSTER?.error || "Could not read the sheet.")}</p>`; return; }
  ROSTER.answers = {};
  // prefer the AI's natural-language read + questions; fall back to heuristics
  ROSTER._clar = ROSTER.ai
    ? (ROSTER.ai.questions || []).map((x) => ({ topic: x.topic || "note", q: esc(x.question || ""), options: (x.options && x.options.length ? x.options : ["OK"]) }))
    : rosterClarifications(ROSTER);
  renderUnderstanding();
}

// Plain-English read of the data — what we understood, no tables.
function rosterUnderstanding(d) {
  if (d.ai?.understanding?.length) return d.ai.understanding.map(esc); // natural AI read
  const m = d.mapping || {}; const out = [];
  out.push(`I read <b>${d.rowCount}</b> row${d.rowCount === 1 ? "" : "s"} from sheet “${esc(d.sheet || "")}” in <b>${esc(d.filename)}</b>.`);
  const mapped = Object.entries(m).map(([f, h]) => `<b>${FIELD_LABEL[f] || f}</b> ← “${esc(h)}”`);
  if (mapped.length) out.push(`I understood these columns: ${mapped.join(" · ")}.`);
  out.push(`Dates are read per row and normalised (dd/mm vs mm/dd resolved), and amounts convert to the billing currency via FX before any rate is applied.`);
  const s = d.summary || {};
  if (s.total) {
    const parts = Object.entries(s.byField || {}).map(([f, n]) => `${n} × ${FIELD_LABEL[f] || f}`);
    out.push(`I spotted <b>${s.total}</b> thing${s.total === 1 ? "" : "s"} to handle: ${parts.join(", ")}. Rows missing a must-have are held as exceptions (not billed) until resolved.`);
  } else out.push(`Every row has its must-have data — nothing is blocked.`);
  return out;
}

// What I need to confirm — asked as questions in English, never a table.
function rosterClarifications(d) {
  const m = d.mapping || {}; const cl = [];
  if (m.fixed_ctc && m.variable_ctc)
    cl.push({ topic: "ctc", q: `Your sheet has <b>“${esc(m.fixed_ctc)}”</b> and <b>“${esc(m.variable_ctc)}”</b>. Should <b>Total CTC = Fixed + Variable</b> (the contract usually means fixed + target bonus)?`, options: ["Yes — Fixed + Variable", "No — Fixed only"] });
  else if (m.fixed_ctc && !m.variable_ctc)
    cl.push({ topic: "ctc", q: `I mapped CTC to <b>“${esc(m.fixed_ctc)}”</b> but found no variable/bonus column. Is total CTC just this fixed amount?`, options: ["Yes — fixed only", "No — there's a variable column I missed"] });
  const unmapped = (d.headers || []).filter((h) => !Object.values(m).includes(h));
  for (const fld of ["name", "join_date", "fixed_ctc", "source", "role"]) {
    if (!m[fld] && unmapped.length) cl.push({ topic: `map:${fld}`, q: `I couldn't confidently find <b>${FIELD_LABEL[fld]}</b>. Which column holds it?`, options: ["(not in the sheet)", ...unmapped] });
  }
  const amb = (d.issues || []).find((x) => /ambiguous/.test(x.issue));
  if (amb) cl.push({ topic: "date_format", q: `Some dates are ambiguous (e.g. <b>“${esc(amb.value)}”</b> — could be DD/MM or MM/DD). Which format does your sheet use?`, options: ["DD/MM/YYYY (day first)", "MM/DD/YYYY (month first)"] });
  return cl;
}

function renderUnderstanding() {
  const d = ROSTER, cl = d._clar || [];
  const pending = cl.filter((c) => !d.answers[c.topic]).length;
  const bubbles = rosterUnderstanding(d).map((t) => `<div class="bubble ai">${t}</div>`).join("");
  const qs = cl.map((c, i) => {
    const ans = d.answers[c.topic];
    return `<div class="bubble q ${ans ? "done" : ""}">
      <div class="qtxt">${c.q}</div>
      ${ans ? `<div class="qans">✓ ${esc(ans)}</div>`
            : `<div class="ai-chips">${c.options.map((o) => `<span class="ai-chip" onclick="answerRoster(${i}, this.dataset.v)" data-v="${esc(o)}">${esc(o)}</span>`).join("")}</div>`}
    </div>`;
  }).join("");
  const aiBadge = d.ai?.mode === "ai" ? `<span class="chip chip--approved" title="read by ${esc(d.ai.model || "AI")}">${ic("robot")} AI read</span>` : "";
  const head = ((!cl.length || !pending)
    ? `<span class="chip chip--approved">All columns understood ✓</span>`
    : `<span class="chip chip--flag">${pending} to confirm</span>`) + aiBadge;
  $("#rout").innerHTML = `
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <span class="chip">${ic("doc")} ${esc(d.filename)}</span>
      <a class="chip chip--approved" href="${d.apiUrl}" target="_blank">API · ${esc(d.docId)}</a>
      <span class="lbl">${d.rowCount} rows</span>${head}</div>
    <div class="chatbox">${bubbles}${qs}
      <div class="ai-row"><input id="rosterAsk" placeholder="reply or instruct in plain English…" onkeydown="if(event.key==='Enter')rosterFreeText(this.value)"><button class="send-btn" aria-label="Send" onclick="rosterFreeText(document.getElementById('rosterAsk').value)">➤</button></div>
    </div>
    <div class="recal-wrap"><button class="btn-recal ${pending ? "" : "dirty"}" id="rosterSave" onclick="recalSaveRoster()">${ic("refresh")} Recalibrate &amp; save to database</button></div>
    <div id="rsavemeter"></div>`;
}

window.answerRoster = (i, opt) => {
  const c = ROSTER._clar[i]; if (!c) return;
  ROSTER.answers[c.topic] = opt; applyRosterAnswer(c.topic, opt); renderUnderstanding();
};
window.rosterFreeText = (t) => {
  const v = (t || "").trim(); if (!v) return;
  const inp = document.getElementById("rosterAsk"); if (inp) inp.value = "";
  (ROSTER.notes ||= []).push(v);
  appAlert("Noted", "Thanks — I'll factor that in when you recalibrate & save.");
};
function applyRosterAnswer(topic, opt) {
  if (topic === "ctc") { if (/fixed only/i.test(opt)) delete ROSTER.mapping.variable_ctc; }
  else if (topic.startsWith("map:")) { const f = topic.slice(4); if (/not in the sheet/i.test(opt)) delete ROSTER.mapping[f]; else ROSTER.mapping[f] = opt; }
  else if (topic === "date_format") { ROSTER.dateFormat = opt.startsWith("DD") ? "DD/MM/YYYY" : "MM/DD/YYYY"; }
}

window.recalSaveRoster = async () => {
  const btn = document.getElementById("rosterSave"); if (btn) btn.disabled = true;
  await runMeter(["Applying your confirmations", "Mapping columns to the rule book", "Saving rows to the database"], "rsavemeter", "");
  const r = await (await fetch("/api/mint/roster/confirm", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: $("#client").value, docId: ROSTER.docId, mapping: ROSTER.mapping }) })).json();
  if (ROSTER.dateFormat) fetch("/api/mint/clarify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value, topic: "date_format", choice: ROSTER.dateFormat, month: new Date().toISOString().slice(0, 7) }) }).catch(() => {});
  document.getElementById("rsavemeter").innerHTML = `<span class="lbl" style="color:var(--ansr-teal)">✓ ${r.saved} rows saved to the database · ready to bill</span>`;
  foldFlow(true); // collapse the whole analysis flow — now we act on it
  showActions();
};

// After save: collapse above, surface the action sequence — calculate → invoice → charts.
// The invoice-month picker is CALIBRATED from the worksheet's own dates.
async function showActions() {
  let r = { min: null, max: null, default: null };
  try { r = await (await fetch(`/api/mint/daterange/${$("#client").value}`)).json(); } catch { /* */ }
  const month = r.default || new Date().toISOString().slice(0, 7);
  const bounds = `${r.min ? `min="${r.min}"` : ""} ${r.max ? `max="${r.max}"` : ""}`;
  const hint = r.min && r.max
    ? (r.min === r.max ? `worksheet has data for ${r.max}` : `worksheet spans ${r.min} → ${r.max}`)
    : "no dates in the worksheet — pick any month";
  $("#validate").innerHTML = `<div class="band grad-teal" style="margin-top:16px">
    <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">Calculate the bill</h3>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div><label class="lbl">Invoice month</label><input type="month" id="calcMonth" value="${month}" ${bounds} style="min-width:150px"></div>
      <button class="btn-ai" id="runCalc"><span class="tw">${ic("spark")}</span>Calculate invoice</button>
    </div>
    <p class="lbl" style="margin:8px 0 0;color:var(--ansr-gray)">${ic("calendar")} ${hint}.</p>
    <div id="calcmeter"></div></div>`;
  $("#runCalc").addEventListener("click", runCompute);
  document.getElementById("validate").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function runCompute() {
  const month = $("#calcMonth").value || new Date().toISOString().slice(0, 7);
  $("#runCalc").disabled = true;
  await runMeter(["Normalising rows", "Active-headcount roll-forward", "TA rate lookup + FX", "Milestone split", "Building statement"], "calcmeter", "✓ Computed");
  const res = await (await fetch("/api/mint/run/compute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value, month }) })).json();
  $("#runCalc").disabled = false;
  window.RUN = res; renderRunResult(res, month);
}

function renderRunResult(res, month) {
  const cur = (res.totals && res.currency) || "USD";
  const m = money(res.totals?.grand, cur);
  const clar = (res.clarifications || []).map((c) => `
    <div class="ai-box" style="margin-top:8px">
      <div class="ai-head"><span class="tw">${ic("spark")}</span> ${esc(c.question)} <span class="chip chip--flag" style="margin-left:auto">${c.rows_affected || 1} rows</span></div>
      <div class="ai-chips">${(c.options || []).map((o) => `<span class="ai-chip" onclick="resolveClar('${esc(c.topic)}','${esc(o)}','${month}',${res.run_no})">${esc(o)}</span>`).join("")}</div>
    </div>`).join("");
  const exc = (res.exceptions || []).map((e) => `<div class="chk miss"><span class="ic">✕</span><span><b>${esc(e.ext_id || "row")}</b> — ${esc(e.issue)} <span class="lbl">${esc(e.detail || "")}</span></span></div>`).join("");
  // actual cost heads from the engine (generic) — fall back to OSS/TA for legacy runs
  const heads = (res.by_head && Object.keys(res.by_head).length)
    ? Object.entries(res.by_head)
    : [["oss", res.totals?.oss || 0], ["ta", res.totals?.ta || 0]].filter(([, v]) => v);
  const headCells = heads.map(([code, amt]) => `<div><div class="lbl" style="text-transform:capitalize">${esc(String(code).replace(/_/g, " "))}</div><b style="${amt < 0 ? "color:var(--ansr-orange-deep,#c0392b)" : ""}">${money(amt, cur)}</b></div>`).join("")
    + `<div><div class="lbl">Grand total</div><b style="color:var(--ansr-navy)">${m}</b></div>`;
  $("#outcome").innerHTML = `
    <div class="band" style="margin-top:16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <span class="chip chip--approved">Computed ${res.computed} lines</span>
        <span class="chip ${res.exceptions?.length ? "chip--flag" : "chip--draft"}">${res.exceptions?.length || 0} exceptions</span>
        <span class="chip ${res.clarifications?.length ? "chip--flag" : "chip--draft"}">${res.clarifications?.length || 0} clarifications</span>
        <span style="margin-left:auto;font-weight:500;color:var(--ansr-navy)">${month} · ${m}</span>
      </div>
      <div class="band grad-soft" style="margin:8px 0;padding:12px 14px">
        <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-bottom:6px">Summary — ${month} · by cost head</div>
        <div style="display:flex;gap:22px;flex-wrap:wrap">${headCells}</div>
      </div>
      ${res.clarifications?.length ? `<div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:8px">Clarifications — answer once, applies to all rows + future runs</div>${clar}` : ""}
      ${res.exceptions?.length ? `<div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin:10px 0 2px">Quarantined (not billed)</div>${exc}` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        <a class="btn" href="/invoice-doc.html?customer=${$("#client").value}&run=${res.run_no}#months">Invoicing summary</a>
        <a class="btn-ai" href="/invoice-doc.html?customer=${$("#client").value}&run=${res.run_no}#invoice"><span class="tw">${ic("spark")}</span>Generate invoice</a>
        <a class="btn btn--ghost" href="/invoice-doc.html?customer=${$("#client").value}&run=${res.run_no}#calc">Detailed calculations</a>
        <a class="btn btn--ghost" href="/invoice.html?customer=${$("#client").value}&run=${res.run_no}">Replay + heatmap</a>
        <button class="btn btn--ghost" id="recalRunBtn" onclick="recalibrateRun(${res.run_no},'${month}')">${ic("refresh")} Recalibrate this run</button>
        <button class="btn btn--ghost" id="releaseBtn" onclick="releaseRun(${res.run_no})" style="border-color:var(--ansr-teal);color:var(--ansr-teal)">${ic("lock")} Release &amp; lock</button>
      </div>
      <div id="releaseMsg" class="lbl" style="margin-top:8px"></div>
    </div>`;
  // generation motion on the computed outcome, then cascade the clarification chips
  sequenceReveal($("#outcome"), ".band", 0, 40);
  setTimeout(() => sequenceReveal($("#outcome"), ".ai-box, .chk", 90, 0), 380);
}

// Recalibrate an existing run in place — recompute run `no` with the current
// rules + decisions (does NOT spawn a new run). For old runs: chat, view, recal.
window.recalibrateRun = async (no, month) => {
  const btn = document.getElementById("recalRunBtn"); if (btn) { btn.disabled = true; btn.textContent = "Recalibrating…"; }
  const m = month || new Date().toISOString().slice(0, 7);
  const res = await (await fetch("/api/mint/run/compute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value, month: m, runNo: no }) })).json();
  window.RUN = res; renderRunResult(res, m);
  await loadRuns(); $("#run").value = no;
};

window.releaseRun = async (no) => {
  appConfirm("Release run", `Freeze run ${no} for ${$("#client").value}? The statement becomes immutable for audit; a later calculation opens a new version.`, async () => {
    const r = await (await fetch(`/api/mint/run/${$("#client").value}/${no}/release`, { method: "POST" })).json();
    $("#releaseMsg").innerHTML = r.released ? `<span style="color:var(--ansr-teal)">${ic("lock")} Released — run ${no} is locked.</span>` : (r.error || "release failed");
    const b = document.getElementById("releaseBtn"); if (b && r.released) { b.disabled = true; b.textContent = "Released"; }
  }, "Release", false);
};

window.resolveClar = async (topic, choice, month, runNo) => {
  const res = await (await fetch("/api/mint/clarify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value, topic, choice, month, runNo }) })).json();
  window.RUN = res; renderRunResult(res, month);
};

let _lastClient = null;
// inline new-client line entry (no popup, no currency — FX normalises per doc)
function createClient() {
  const sel = $("#client");
  sel.value = _lastClient || sel.options[0].value; // reset off __new__
  $("#newRow").style.display = "flex";
  $("#ncName").value = ""; $("#ncNotes").value = ""; $("#ncMsg").textContent = "";
  $("#ncName").focus();
}
async function submitNewClient() {
  const name = $("#ncName").value.trim();
  if (!name) { $("#ncName").focus(); return; }
  const notes = $("#ncNotes").value.trim();
  const r = await (await fetch("/api/clients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, notes }) })).json();
  const id = r.id, sel = $("#client");
  if (![...sel.options].some((o) => o.value === id)) sel.insertAdjacentHTML("afterbegin", `<option value="${id}">${esc(name)}</option>`);
  sel.value = id; _lastClient = id;
  $("#newRow").style.display = "none";
  $("#sowRow").style.display = "flex"; $("#sowMsg").textContent = ""; $("#sowFile").value = "";
  DATA = null; $("#stepwrap").style.display = "none"; $("#validate").innerHTML = ""; $("#outcome").innerHTML = "";
  if (typeof clearSteps === "function") clearSteps();
  $("#run").innerHTML = `<option value="">— no runs yet —</option>`;
  $("#result").innerHTML = `<div class="band grad-accent" style="margin-top:14px">
    <b style="color:var(--ansr-navy)">${esc(name)} created</b>
    <p class="lbl" style="margin:6px 0 0">Step 1 — upload the SOW / Contract above, then press <span style="color:#7b2dc4">${ic("spark")} Generate Contract Analysis</span>. Every step is AI-driven; document currencies are normalised via FX (today's or historical rates).</p></div>`;
}
function cancelNewClient() { $("#newRow").style.display = "none"; $("#client").value = _lastClient || $("#client").options[0].value; }

async function loadRuns(selectLast, skipOpen) {
  if ($("#client").value === "__new__") return;
  _lastClient = $("#client").value;
  $("#sowRow").style.display = "none"; // existing client → just recall/run; SOW row only on +new
  const { runs } = await (await fetch(`/api/mint/runs/${$("#client").value}`)).json();
  $("#run").innerHTML = runs.length
    ? runs.map((r) => `<option value="${r.run_no}">v${r.run_no} · ${r.month || "—"} · ${r.status}</option>`).join("")
    : `<option value="">— no runs —</option>`;
  // skipOpen → just refresh the dropdown (generate() already rendered + revealed;
  // don't re-open the run or it animates a second time).
  if (runs.length) { if (selectLast) $("#run").value = runs[runs.length - 1].run_no; if (!skipOpen) await openRun($("#run").value); }
  else if (!skipOpen) { clearSteps(); $("#result").innerHTML = `<p class="lbl" style="margin-top:14px">No runs yet — press Generate Contract Analysis.</p>`; }
}

async function openRun(no, animate) {
  if (!no) return;
  DATA = await (await fetch(`/api/mint/run/${$("#client").value}/${no}`)).json();
  $("#stepwrap").style.display = "block";
  renderStepper(DATA.steps.length); // all done
  render();
  $("#outcome").innerHTML = ""; // outputs appear only after the worksheet is processed
  // animate ONLY on an explicit run switch; page-load / client-switch show instantly
  // (one staggered reveal per deliberate action — never on every reload).
  if (animate) await revealFlowSequence(); else showFlowInstant();
}

// show all flow blocks immediately — no stagger (default CSS state is visible)
function showFlowInstant() {
  const flow = document.getElementById("flow");
  if (flow) { clearTimeout(flow._revealT); flow.classList.remove("revealing"); }
}

function renderStepper(doneUpTo, active = -1) {
  $("#stepper").innerHTML = (DATA?.steps || []).map((s, i) => {
    let cls = "node"; if (i < doneUpTo) cls += " done"; if (i === active) cls += " active";
    return `<div class="${cls}"><div class="dot">${i < doneUpTo ? "&#10003;" : i + 1}</div><div class="lbl">${esc(s)}</div></div>`;
  }).join("");
}

// RayDar-style sweep meter — a filling orange→teal bar + steps checking off.
async function sweepMeter(steps, host, doneMsg) {
  if (!host) return;
  host.innerHTML = `<div class="rd-meter"><div class="rd-bar"><div class="rd-fill" id="rdfill"></div></div><div class="rd-now" id="rdnow"></div><div id="rdlist"></div></div>`;
  const fill = host.querySelector("#rdfill"), now = host.querySelector("#rdnow"), list = host.querySelector("#rdlist");
  const dot = (typeof ic === "function") ? ic("target", 13) : "◎";
  const done = (typeof ic === "function") ? ic("check", 13) : "✓";
  for (let i = 0; i < steps.length; i++) {
    now.innerHTML = `${dot} ${esc(steps[i])}`;
    fill.style.width = Math.round(((i + 1) / steps.length) * 100) + "%";
    list.insertAdjacentHTML("beforeend", `<div class="rd-ms on" id="rdms-${i}">${esc(steps[i])} …</div>`);
    await new Promise((r) => setTimeout(r, 560));
    const el = host.querySelector(`#rdms-${i}`); if (el) { el.className = "rd-ms done"; el.innerHTML = `${done} ${esc(steps[i])}`; }
  }
  if (doneMsg) now.innerHTML = `${done} ${esc(doneMsg)}`;
}

async function generate() {
  $("#gen").disabled = true; $("#result").innerHTML = "";
  // kick off the run (returns instantly on stub); sweep over it, RayDar-style
  const runP = fetch("/api/mint/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value, sowDocId: SOW[$("#client").value] }) }).then((r) => r.json());
  DATA = await runP; // need steps list to render
  $("#stepwrap").style.display = "block";
  await sweepMeter(DATA.steps, $("#stepper"), "Analysis complete");
  await new Promise((r) => setTimeout(r, 400));           // hold on the finished sweep
  render();                                               // fill content (hidden)
  await revealFlowSequence();                             // then block 1, block 2, … (once)
  await loadRuns(false, true); $("#run").value = DATA.run_no; // refresh dropdown only — no re-open/re-reveal
  $("#gen").disabled = false;
}

// After the whole process meter is done, reveal the flow blocks one after the
// other (block 1 loads, then block 2, …); the analysis block also cascades its
// boxes once it appears.
// Pure-CSS staggered reveal: toggle one class; CSS does block-1→block-2→… with
// boxes cascading. Content is visible by default, so nothing can be stranded.
function revealFlowSequence() {
  const flow = document.getElementById("flow");
  if (!flow) return Promise.resolve();
  flow.classList.remove("revealing"); void flow.offsetWidth; // restart the animation
  flow.classList.add("revealing");
  // drop the class after the entrance finishes so later re-renders don't re-animate
  clearTimeout(flow._revealT); flow._revealT = setTimeout(() => flow.classList.remove("revealing"), 2600);
  return new Promise((r) => setTimeout(r, 2400));
}

function purge() {
  appConfirm("Purge all runs", `Hard-delete every run for ${$("#client").value}? This removes all runs, ledger rows and archives permanently and cannot be undone.`, async () => {
    await fetch("/api/mint/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value }) });
    DATA = null; if (typeof clearSteps === "function") clearSteps();
    $("#result").innerHTML = `<p class="lbl" style="margin-top:14px">All runs purged. Press Generate to start fresh.</p>`;
    $("#stepwrap").style.display = "none"; $("#validate").innerHTML = ""; $("#outcome").innerHTML = "";
  }, "Delete all", true);
}

// Staggered "generation" reveal: each element starts as a light-grey dashed
// skeleton (.gen, shimmer) then settles to a solid dark outline (.gen--in) —
// shows motion + output creation as each box/section appears.
function sequenceReveal(root, sel, step = 200, startDelay = 100) {
  const els = [...(root || document).querySelectorAll(sel)];
  els.forEach((el) => el.classList.add("gen"));
  els.forEach((el, i) => setTimeout(() => {
    el.classList.remove("gen"); el.classList.add("gen--in");
  }, startDelay + i * step));
}

// ---- render summary + findings + boxes ----
function renderContent(content) {
  return Object.entries(content).map(([k, v]) => {
    let val;
    if (Array.isArray(v) && typeof v[0] === "object") {
      const cols = [...new Set(v.flatMap((o) => Object.keys(o)))];
      val = `<div class="scroll-x"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${v.map((o) => `<tr>${cols.map((c) => `<td>${esc(o[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    } else if (Array.isArray(v)) val = v.map(esc).join(", ");
    else val = esc(v);
    return `<div style="margin:8px 0"><div class="lbl" style="text-transform:capitalize;color:var(--ansr-gray)">${esc(k.replace(/_/g, " "))}</div><div>${val}</div></div>`;
  }).join("");
}

// per-box AI shortcut chips, generated on the fly from the box
function chipsFor(b) {
  const t = b.box_type_code;
  if (t === "billing_rules") return ["Explain the TA% bands", "Why 3 milestones?", "How is CTC defined?", "Show a worked example"];
  if (t === "commercial_terms") return ["What are the revenue lines?", "Explain OSS vs TA"];
  if (t === "payment_terms") return ["When is it billed?", "What are the terms?"];
  if (t === "flags") return ["What needs a decision?", "How do I resolve these?"];
  if (t === "caveats") return ["What could go wrong?"];
  return ["Explain this box", "Which clause backs it?", "Any risks?"];
}

function boxCard(b) {
  const cc = confClass(b.confidence);
  const chips = chipsFor(b).map((q) => `<span class="ai-chip" onclick="askBox('${b.id}', this.textContent)">${esc(q)}</span>`).join("");
  // equal-height card: fixed head · scrollable data · pinned AI footer
  return `
  <div class="boxcard">
    <div class="bc-head"><span><span class="conf-dot ${cc}"></span><b>${esc(b.title)}</b></span>
      <span class="chip ${b.status === "approved" ? "chip--approved" : "chip--draft"}">${esc(b.status)}</span></div>
    <div class="bc-data">
      <div class="conf-${cc}" style="padding:10px;border-radius:8px;margin-bottom:10px">
        <div class="lbl" style="color:var(--ansr-gray);margin-bottom:4px">AI · conf ${(b.confidence * 100).toFixed(0)}% · <em>${esc(b.clause_ref)}</em></div>
        ${esc(b.ai_explain)}
      </div>
      ${renderContent(b.content)}
    </div>
    <div class="ai-box">
      <div class="ai-head"><span class="tw">${ic("spark")}</span> Ask this box</div>
      <div class="ai-chips">${chips}</div>
      <div class="ai-log" id="log-${b.id}"></div>
      <div class="ai-row"><input id="ask-${b.id}" placeholder="ask or instruct…" onkeydown="if(event.key==='Enter')askBox('${b.id}', this.value)"><button class="send-btn" aria-label="Send" onclick="askBox('${b.id}', document.getElementById('ask-${b.id}').value)">➤</button></div>
    </div>
  </div>`;
}

// Contract Compiler readiness chip — coverage % of the canonical rule set.
async function showCoverage() {
  try {
    const client = $("#client").value;
    const rs = await (await fetch(`/api/mint/ruleset/${client}`)).json();
    if (client !== $("#client").value) return; // client changed mid-fetch — drop stale result
    const sd = document.querySelector("#result .sd"); if (!sd || !rs.exists) return;
    sd.querySelector(".cov-chip")?.remove(); // idempotent — never stack chips
    const cls = rs.status === "green" ? "chip--approved" : rs.status === "amber" ? "chip--flag" : "chip--draft";
    const gaps = rs.validation?.gaps?.length || 0;
    sd.insertAdjacentHTML("beforeend", `<span class="chip cov-chip ${cls}" style="margin-left:6px" title="canonical rule set · ${rs.dimensions.map((d) => d.name).join("×") || "no dimensions"}">${ic("ruler")} coverage ${rs.coverage_pct ?? 0}%${gaps ? " · " + gaps + " gap" + (gaps > 1 ? "s" : "") : ""}</span>`);
  } catch { /* */ }
}

const INSTRUCTION = /^(set|change|add|remove|use|map|exclude|include|rename|update|make|apply|override)\b/i;

const PENDING = {};
const BOX_CLAUSE = { company: "§1", legal: "§5", payment_terms: "§5", commercial_terms: "§3.1", billing_rules: "§3.1", caveats: "§3.1", flags: "§3.1" };

window.askBox = async (boxId, text) => {
  text = (text || "").trim(); if (!text) return;
  const log = document.getElementById(`log-${boxId}`);
  const inp = document.getElementById(`ask-${boxId}`); if (inp) inp.value = "";
  log.insertAdjacentHTML("beforeend", `<div class="ai-msg"><span class="who">You:</span> ${esc(text)}</div>`);
  const isInstr = INSTRUCTION.test(text);
  const r = await (await fetch(`/api/box/${boxId}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, client: $("#client").value }) })).json();
  if (isInstr) {
    PENDING[boxId] = text;
    log.insertAdjacentHTML("beforeend", `<div class="ai-msg bot"><span class="who">${ic("spark")} AI:</span> Got it — record this as the confirmed reading of <b>${BOX_CLAUSE[boxId] || boxId}</b>? It will ground every future answer. <div style="margin-top:6px"><button class="btn-ai" style="padding:5px 12px;min-height:32px" onclick="acceptInstr('${boxId}',this)">Accept</button> <button class="btn btn--ghost" style="padding:5px 12px;min-height:32px" onclick="this.closest('.ai-msg').remove()">Discard</button></div></div>`);
  } else {
    const cite = r.cited?.length ? ` <span class="lbl">[${r.cited.join(", ")}]</span>` : "";
    log.insertAdjacentHTML("beforeend", `<div class="ai-msg bot"><span class="who">${ic("spark")} AI:</span> ${esc(r.reply)}${cite}</div>`);
  }
  log.scrollTop = log.scrollHeight;
};
window.acceptInstr = async (boxId, btn) => {
  const r = await (await fetch(`/api/mint/interpret`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: $("#client").value, clause_ref: BOX_CLAUSE[boxId] || boxId, reading: PENDING[boxId] || "user correction" }) })).json();
  btn.closest(".ai-msg").innerHTML = `<span class="who">${ic("spark")} AI:</span> <span style="color:var(--ansr-teal)">✓ Learned — ${esc(BOX_CLAUSE[boxId] || boxId)} reading saved. Recalibrate to cement it into the rules.</span>`;
  setDirty(true);
};

window.scrollRail = (dir) => { const r = $("#boxrail"); r.scrollBy({ left: dir * (r.clientWidth * 0.8), behavior: "smooth" }); };

// Touch = native swipe (scroll-snap flips one box). Mouse = click-drag to scroll
// + flick to flip. Touch is left to the browser so swipe stays smooth.
function dragScroll(el) {
  if (!el || el._drag) return; el._drag = true;
  let down = false, sx = 0, sl = 0;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return; // let touch/pen swipe natively
    if (e.target.closest("input,button,select,textarea,a,.ai-chip,summary")) return;
    down = true; sx = e.clientX; sl = el.scrollLeft; el.style.cursor = "grabbing";
    try { el.setPointerCapture(e.pointerId); } catch { /* */ }
  });
  el.addEventListener("pointermove", (e) => { if (down) el.scrollLeft = sl - (e.clientX - sx); });
  // mouse-wheel → horizontal scroll (desktop wheels only scroll vertically)
  el.addEventListener("wheel", (e) => {
    if (el.scrollWidth <= el.clientWidth) return;          // nothing to scroll
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!d) return;
    el.scrollLeft += d; e.preventDefault();                // keep the page still while over the rail
  }, { passive: false });
  const up = (e) => {
    if (!down) return; down = false; el.style.cursor = "grab";
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 40) scrollRail(dx < 0 ? 1 : -1); // flick → flip one box
  };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", () => (down = false));
  el.style.cursor = "grab";
}

// fold/unfold a single step (its number title toggles its content)
window.toggleStep = (btn) => btn.closest(".flowstep")?.classList.toggle("folded");
// fold (or unfold) all 4 steps at once — used when analysis kicks off
function foldFlow(on) {
  document.querySelectorAll("#flow .flowstep").forEach((s) => { s.classList.toggle("folded", !!on); if (on) s.classList.add("done"); });
}
// empty steps 2 & 3 (step 1 gets a guidance note from the caller)
function clearSteps() {
  const b = document.getElementById("boxes"); if (b) b.innerHTML = "";
  const r = document.getElementById("ready"); if (r) r.innerHTML = "";
  document.querySelectorAll("#flow .flowstep").forEach((s) => s.classList.remove("done", "folded"));
}

// Readiness — DERIVED from this contract's rule book, not a fixed list. Each
// field the billing_rules box actually produced becomes a checklist item, so a
// contract with a "payment_structure" clause shows that, not Kenvue's TA/OSS.
const READY_LABEL = {
  ctc_definition: "CTC definition",
  ta_rate_table: "TA rate table (band × level × referral)",
  milestones: "Milestone split (sourcing / acceptance / balance)",
  oss_slabs: "OSS slabs",
  currency: "Currency / FX basis",
  payment_structure: "Payment structure",
  payment_terms: "Payment terms",
};
const humanize = (k) => READY_LABEL[k] || k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// What the monthly calc NEEDS from the worksheet — inferred from the rule book.
// Not column mapping, not rule-presence: the input fields + why each is needed.
function requiredInputs() {
  // Atlas template-fill: if a matched archetype pre-loaded a compiled rule book,
  // its required inputs are authoritative.
  if (DATA.compiled_rule_book?.inputs?.length) return DATA.compiled_rule_book.inputs.map((i) => ({ field: i.field, why: i.why || i.type || "required" }));
  const rb = DATA.boxes.find((b) => b.box_type_code === "billing_rules")?.content || {};
  const req = []; const add = (field, why) => { if (!req.some((r) => r.field === field)) req.push({ field, why }); };
  const rt = rb.ta_rate_table, ms = rb.milestones, oss = rb.oss_slabs;
  const rtArr = Array.isArray(rt) ? rt : [];
  add("Employee name / ID", "identify each placement");
  if (rb.ctc_definition || rt) { add("Fixed CTC", "base of the TA fee"); add("Variable / target bonus", "completes total CTC"); }
  if (rtArr.some((r) => "referral" in r)) add("Source / referral status", "sets the TA rate (referral vs non-referral)");
  if (rtArr.some((r) => r.level)) add("Seniority / level / role", "maps to the TA rate band");
  if (rtArr.some((r) => ("band" in r) || ("gcc_band_min" in r))) add("Active GCC headcount", "TA band + OSS slab (derived from join/exit dates)");
  if (ms) { add("Sourcing date", "triggers the sourcing milestone"); add("Offer-accepted date", "triggers the acceptance milestone"); add("Joining date", "triggers the balance milestone"); }
  if (oss) { add("Joining date", "counts into active headcount (OSS)"); add("Exit date", "removes from active headcount (OSS)"); }
  if (rb.currency) add("Salary currency", "normalised to billing currency via FX (today's / historical rates)");
  return req.length ? req : [{ field: "Employee lifecycle + CTC", why: "to compute the monthly bill" }];
}

const SECDESC = {
  summary: "Plain-English read of the SOW and the key billing facts.",
  boxes: "Each clause area as a box — open one to see detail and ask its AI.",
  ready: "What the monthly calculation needs from your worksheet — discovered from this contract. When you upload the sheet, Mint validates it against these and raises any clarifications.",
};

function render() {
  if (!DATA) return;
  foldFlow(false); // fresh render → all steps open
  const req = requiredInputs();
  window.READY = req.length > 0;

  // step 1 — Contract summary
  const srcChip = DATA.source && DATA.source.startsWith("ai:")
    ? `<span class="chip chip--approved" style="margin-left:6px">live · ${esc(DATA.source.slice(3))}</span>`
    : `<span class="chip chip--draft" style="margin-left:6px">${DATA.sow ? "SOW added · set a model key for live boxes" : "sample data"}</span>`;
  const a = DATA.atlas;
  const atlasChip = a?.archetype
    ? `<a href="/atlas.html" class="chip ${a.decision === "novel" ? "chip--draft" : "chip--approved"}" style="margin-left:6px;text-decoration:none" title="Atlas archetype">${ic("compass")} ${a.decision === "novel" ? "new archetype" : "matched"} · ${esc(a.archetype.slug)}${a.similarity ? " · " + Math.round(a.similarity * 100) + "%" : ""}${DATA.compiled_rule_book ? " · rule book pre-loaded" : ""}</a>`
    : "";
  $("#result").innerHTML = `
    <div class="sd lbl" style="margin-bottom:8px">${SECDESC.summary} <span class="chip" style="margin-left:6px" title="each Calculate is a new version">v${DATA.run_no}</span>${srcChip}${atlasChip}</div>
    <p class="sum-text" style="margin:0 0 10px">${esc(DATA.summary.text)}</p>
    <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-bottom:2px">Key findings</div>
    <ul class="findings sm">${DATA.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;
  showCoverage();

  // step 2 — Analysis boxes (carousel) + recalibrate-from-analysis
  const boxesEl = document.getElementById("boxes");
  if (boxesEl) boxesEl.innerHTML = `
    <div class="sd lbl" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span>${SECDESC.boxes}</span>
      <span class="railnav"><button class="railbtn" onclick="scrollRail(-1)">‹</button><button class="railbtn" onclick="scrollRail(1)">›</button></span></div>
    <div class="boxrail" id="boxrail">${DATA.boxes.map(boxCard).join("")}</div>
    <p class="lbl" style="margin:12px 0 0;color:var(--ansr-gray)">Reviewed the boxes? Recalibrate to turn this analysis into billing rules + worksheet requirements.</p>
    <!-- boxes reveal one-by-one below: see sequenceReveal() call -->
    <div class="recal-wrap"><button class="btn-recal ${DIRTY ? "dirty" : ""}" id="recalBuild" onclick="recalBuild()">${ic("refresh")} Recalibrate from analysis${DIRTY ? " — changes pending" : ""}</button></div>
    <div id="buildmeter"></div>`;
  dragScroll(document.getElementById("boxrail"));
  // box reveal is driven by revealFlowSequence() during generate(), so the whole
  // process meter finishes first, then block 1, then block 2, …

  // step 3 — understanding + worksheet needs + clarify + lock
  renderReady();
}

// NL bullets — what we understand so far (rules / mappings / conversions / exceptions). Generic.
function understandingBullets() {
  const rb = DATA.boxes.find((b) => b.box_type_code === "billing_rules")?.content || {};
  const rt = Array.isArray(rb.ta_rate_table) ? rb.ta_rate_table : [];
  const out = [...(DATA.findings || [])];
  if (rt.some((r) => "referral" in r)) out.push("Source / hiring-channel labels are mapped to the contract's categories (e.g. referral vs non-referral) before any rate is applied.");
  if (rb.currency) out.push("Amounts in other currencies are converted to the billing currency via FX — today's rate, or the historical rate for the billed period.");
  out.push("Dates are normalised (dd/mm vs mm/dd resolved per source) so billing months and triggers compute correctly.");
  const mand = requiredInputs().slice(0, 4).map((r) => r.field.toLowerCase());
  out.push(`Mandatory to bill a row: ${mand.join(", ")}. Rows missing these are held as exceptions and not billed until resolved.`);
  return out;
}
const needBullets = () => requiredInputs().map((r) => `<b>${esc(r.field)}</b> — ${esc(r.why)}`);

function renderReady() {
  const readyEl = document.getElementById("ready"); if (!readyEl) return;
  const u = understandingBullets(), n = needBullets();
  readyEl.innerHTML = `
    <div class="sd lbl" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <span>${SECDESC.ready}</span><span class="chip" id="readyChip">${window.RECALIBRATED ? "rules locked ✓" : "review"}</span></div>
    <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin:6px 0 2px">Our understanding so far</div>
    <ul class="findings sm">${u.map((b) => `<li>${b}</li>`).join("")}</ul>
    <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin:12px 0 2px">What we'll need from your worksheet</div>
    <ul class="findings sm">${n.map((b) => `<li>${b}</li>`).join("")}</ul>
    <div class="ai-box">
      <div class="ai-head"><span class="tw">${ic("spark")}</span> Clarify or suggest — chat about the rules &amp; inputs</div>
      <div class="ai-chips">
        <span class="ai-chip" onclick="askReady('What inputs might this contract need that aren\\'t listed?')">Suggest missing inputs</span>
        <span class="ai-chip" onclick="askReady('Explain the mandatory fields and exceptions.')">Mandatory &amp; exceptions</span>
        <span class="ai-chip" onclick="askReady('How are currencies and dates normalised here?')">Conversions</span>
      </div>
      <div class="ai-log" id="readylog"></div>
      <div class="ai-row"><input id="readyask" placeholder="ask to clarify, or suggest an input…" onkeydown="if(event.key==='Enter')askReady(this.value)"><button class="btn-ai" onclick="askReady(document.getElementById('readyask').value)">Ask</button></div>
    </div>
    <p class="lbl" style="margin:10px 0 0;color:var(--ansr-gray)">When you're happy, recalibrate to lock these rules + checks. The worksheet (step 4) is then validated against them.</p>
    <div class="recal-wrap"><button class="btn-recal ${DIRTY ? "dirty" : ""}" id="recalCommit" onclick="recalCommit()">${ic("refresh")} Recalibrate &amp; lock rules${DIRTY ? " — changes pending" : ""}</button></div>
    <div id="recal"></div>`;
}

let DIRTY = false;
function setDirty(v) {
  DIRTY = v;
  ["recalBuild", "recalCommit"].forEach((id) => {
    const b = document.getElementById(id); if (!b) return;
    b.classList.toggle("dirty", v);
    b.textContent = (id === "recalBuild" ? "Recalibrate from analysis" : "Recalibrate & lock rules") + (v ? " — changes pending" : "");
  });
}

// shared meter theatre
async function runMeter(steps, hostId, doneMsg) {
  const host = document.getElementById(hostId); if (!host) return;
  host.innerHTML = `<div class="meter"><div class="meter-bar"><div class="meter-fill" id="mfill"></div></div><div class="meter-now" id="mnow"></div><div class="meter-list" id="mlist"></div></div>`;
  const fill = host.querySelector("#mfill"), now = host.querySelector("#mnow"), list = host.querySelector("#mlist");
  for (let i = 0; i < steps.length; i++) {
    now.textContent = steps[i]; fill.style.width = Math.round(((i + 1) / steps.length) * 100) + "%";
    list.insertAdjacentHTML("beforeend", `<div class="ms" id="ms-${i}">${esc(steps[i])}…</div>`);
    await new Promise((r) => setTimeout(r, 560));
    const el = list.querySelector(`#ms-${i}`); el.className = "ms done"; el.textContent = "✓ " + steps[i];
  }
  if (doneMsg) now.innerHTML = `<span style="color:var(--ansr-teal)">${doneMsg}</span>`;
}

// step 2 → step 3: derive rules + exceptions + worksheet requirements from the analysis
window.recalBuild = async () => {
  const btn = document.getElementById("recalBuild"); if (btn) btn.disabled = true;
  await runMeter([
    "Reading the approved analysis", "Deriving billing rules", "Mapping labels (source · role · status)",
    "Setting conversion / FX basis", "Listing mandatory fields + exceptions", "Building worksheet requirements",
  ], "buildmeter", "✓ Rules, exceptions + worksheet requirements derived");
  setDirty(false);
  renderReady();
  const s3 = document.querySelector('.flowstep[data-n="3"]'); if (s3) { s3.classList.remove("folded"); s3.scrollIntoView({ behavior: "smooth", block: "start" }); }
  if (btn) { btn.disabled = false; }
};

// step 3 → step 4: lock the rules after clarifications, focus the worksheet
window.recalCommit = async () => {
  const btn = document.getElementById("recalCommit"); if (btn) btn.disabled = true;
  await runMeter([
    "Applying your clarifications", "Recompiling the rule book", "Locking financial rules", "Finalising worksheet checks",
  ], "recal", "✓ Rules locked · ready for the worksheet");
  setDirty(false); window.RECALIBRATED = true;
  const chip = document.getElementById("readyChip"); if (chip) { chip.textContent = "rules locked ✓"; chip.className = "chip chip--approved"; }
  if (btn) btn.disabled = false;
  [1, 2, 3].forEach((n) => document.querySelector(`.flowstep[data-n="${n}"]`)?.classList.add("folded"));
  const ws = document.querySelector('.flowstep[data-n="4"]');
  if (ws) { ws.classList.remove("folded"); ws.classList.add("focus-step"); setTimeout(() => ws.scrollIntoView({ behavior: "smooth", block: "start" }), 200); }
};

window.askReady = async (q) => {
  q = (q || "").trim(); if (!q) return;
  const log = document.getElementById("readylog"); const inp = document.getElementById("readyask"); if (inp) inp.value = "";
  log.insertAdjacentHTML("beforeend", `<div class="ai-msg"><span class="who">You:</span> ${esc(q)}</div>`);
  const isSuggest = /^(add|include|use|suggest|need|also|require)\b/i.test(q);
  const r = await (await fetch(`/api/box/billing_rules/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, client: $("#client").value }) })).json();
  log.insertAdjacentHTML("beforeend", `<div class="ai-msg bot"><span class="who">${ic("spark")} AI:</span> ${esc(r.reply)}${r.cited?.length ? ` <span class="lbl">[${r.cited.join(", ")}]</span>` : ""}</div>`);
  if (isSuggest) { setDirty(true); log.insertAdjacentHTML("beforeend", `<div class="ai-msg bot"><span class="lbl">Noted as a change — Recalibrate to apply it to the inputs.</span></div>`); }
  log.scrollTop = log.scrollHeight;
};

window.askMissing = (item) => {
  appPrompt(`Add ${item}`, `Tell me the ${item} for this contract and I'll add it to the rule book before analysis.`, (v) => {
    if (!v) return;
    appAlert("Recorded", `“${item}” noted — it'll ground the analysis.`);
    setDirty(true);
  });
};

// ---- Rule chips (Munshi) — atomic clause-referenced rules, confirm/amend ----
async function mintIntake(client){ return (await fetch('/api/mint/corpus/intake',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client})})).json(); }
async function renderChips() {
  const host = $("#chips"); if (!host) return;
  const client = $("#client")?.value; if (!client || client === "__new__") return;
  let { chips } = await (await fetch(`/api/mint/chips/${encodeURIComponent(client)}`)).json();
  let total = (chips || []).reduce((n, g) => n + g.chips.length, 0);
  if (!total) { await mintIntake(client); ({ chips } = await (await fetch(`/api/mint/chips/${encodeURIComponent(client)}`)).json()); total = (chips || []).reduce((n, g) => n + g.chips.length, 0); }
  const confirmed = (chips || []).reduce((n, g) => n + g.chips.filter((c) => c.status === "confirmed").length, 0);
  const badge = (typeof ic === "function" ? ic : () => "");
  const chip = (c) => `<div class="mchip ${c.status === "confirmed" ? "ok" : ""}">
      <div class="mchip-h"><b>${esc(c.key)}</b>${c.clause_ref ? `<span class="chip">${esc(c.clause_ref)}</span>` : ""}
        <span class="chip ${c.status === "confirmed" ? "chip--approved" : "chip--draft"}" style="margin-left:auto">${esc(c.status)}${c.status !== "confirmed" ? " · " + Math.round((c.weight || 0) * 100) + "%" : ""}</span></div>
      <div class="mchip-v">${esc(JSON.stringify(c.value))}</div>
      <div class="mchip-a"><button class="btn small" onclick="confirmChip(${c.id})">${badge("check", 12)} Confirm</button>
        <button class="btn small" onclick="amendChip(${c.id}, ${JSON.stringify(JSON.stringify(c.value)).replace(/"/g, "&quot;")})">${badge("edit", 12)} Amend</button></div>
    </div>`;
  host.innerHTML = `<p class="lbl" style="margin:0 0 8px">The contract corpus decomposed into <b>atomic, clause-referenced rule-chips</b> (Munshi method). Confirm locks a chip; a re-parse re-derives the rest but never overwrites a confirmed chip.</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn" onclick="reparseCorpus()">${badge("refresh", 13)} Re-parse corpus</button>
      <span class="lbl">${total} chips · ${confirmed} confirmed</span><span id="chipMsg" class="lbl"></span></div>` +
    (chips || []).map((g) => `<div class="grp" style="margin:14px 0 6px;font-weight:600;color:var(--ansr-navy);text-transform:capitalize">${esc(g.box_type.replace(/_/g, " "))} <span class="lbl" style="font-weight:400">· ${g.chips.length}</span></div>
      <div class="mchips">${g.chips.map(chip).join("")}</div>`).join("");
}
window.reparseCorpus = async () => {
  const client = $("#client").value; const m = $("#chipMsg"); if (m) m.textContent = "parsing…";
  const r = await (await fetch(`/api/mint/corpus/reparse`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client }) })).json();
  if (m) m.textContent = r.totals ? `re-parsed · +${r.totals.inserted} ~${r.totals.updated} · kept ${r.totals.preserved}` : "re-parsed";
  renderChips();
};
window.confirmChip = async (id) => { await fetch(`/api/mint/chip/${id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value }) }); renderChips(); };

// ---- Mint tabs: Contract Reconciler · Analysis · Rule book ------------------
window.mTab = (t) => {
  document.querySelectorAll(".tab[data-mtab]").forEach((b) => { const on = b.dataset.mtab === t; b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
  document.querySelectorAll(".mpane").forEach((p) => (p.hidden = p.id !== `mpane-${t}`));
  if (t === "rulebook") renderRulebook();
};
// Rule book — the executable rule-chips Munshi captured (calc runs from these)
// ---- Rule book — turn atomic chips into plain-English rules -----------------
const BOX_NAMES = { billing_rules: "Billing rules & formulas", commercial_terms: "Commercial terms", payment_terms: "Payment terms", company: "Company", legal: "Legal terms", caveats: "Caveats", flags: "Flags to resolve" };
const titleCase = (s) => String(s || "").replace(/[_:|]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
function readableValue(v) {
  if (v == null) return "—";
  if (typeof v !== "object") return String(v);
  if (v.text) return v.text;
  if (v.ta_pct !== undefined) return `${v.ta_pct}% of Total Annual CTC`;
  if (v.rate !== undefined) return [v.rate ? `$${Number(v.rate).toLocaleString()}` : "", v.logic ? `(${v.logic})` : ""].filter(Boolean).join(" ");
  if (v.scenario !== undefined) return `${v.scenario} → expected ${v.expected}`;
  if (v.trigger !== undefined) return [v.trigger, v.tech ? `tech $${v.tech}` : "", v.nontech ? `non-tech $${v.nontech}` : "", v.amount || ""].filter(Boolean).join(" · ");
  if (v.value !== undefined) return typeof v.value === "object" ? readableValue(v.value) : String(v.value);
  return Object.entries(v).map(([k, val]) => `${titleCase(k)}: ${typeof val === "object" ? JSON.stringify(val) : val}`).join(" · ");
}
function ruleLabel(box, key, v) {
  v = v || {};
  if (box === "billing_rules") {
    if (key.startsWith("ta_rate")) return `TA fee rate — ${v.band || "?"} headcount · ${titleCase(v.level) || "?"} · ${v.referral ? "referral" : "non-referral"}`;
    if (key.startsWith("milestone")) return `Milestone billing — ${titleCase(v.code || key.split(":")[1] || "")}`;
    if (key.startsWith("oss_slab")) return `OSS fee slab — ${v.hc || "?"} active headcount`;
    if (key === "ctc_definition") return "How Total Annual CTC is defined";
    if (key === "fx_rule") return "Currency / FX conversion";
    if (key.startsWith("example")) return "Worked example (trust test)";
  }
  return titleCase(key);
}
async function renderRulebook() {
  const host = $("#rulebook"); if (!host) return;
  const client = $("#client")?.value; if (!client || client === "__new__") return;
  let { chips } = await (await fetch(`/api/mint/chips/${encodeURIComponent(client)}`)).json();
  if (!chips || !chips.length) { await mintIntake(client); ({ chips } = await (await fetch(`/api/mint/chips/${encodeURIComponent(client)}`)).json()); }
  const order = ["billing_rules", "commercial_terms", "payment_terms", "company", "legal", "caveats", "flags"];
  chips = (chips || []).slice().sort((a, b) => order.indexOf(a.box_type) - order.indexOf(b.box_type));
  const total = chips.reduce((n, g) => n + g.chips.length, 0);
  const confirmed = chips.reduce((n, g) => n + g.chips.filter((c) => c.status === "confirmed").length, 0);
  host.innerHTML = `<div class="band grad-soft"><h3 style="margin:0 0 4px;color:var(--ansr-navy)">Rule book</h3>
      <p class="lbl" style="margin:0">The contract's billing rules, read out in plain English — ${total} rules, ${confirmed} confirmed. Mint's calc engine bills from <b>exactly these</b>, and every one traces back to its clause. Confirm a rule to lock it; re-parsing an amendment won't overwrite it.</p></div>` +
    chips.map((g) => `<div class="grp" style="margin:18px 0 8px;font-weight:600;font-size:15px;color:var(--ansr-navy)">${esc(BOX_NAMES[g.box_type] || titleCase(g.box_type))} <span class="lbl" style="font-weight:400">· ${g.chips.length}</span></div>
      <div class="rb-list">${g.chips.map((c) => {
        const v = c.value || {};
        return `<div class="rb-row ${c.status === "confirmed" ? "ok" : ""}">
          <div class="rb-main"><div class="rb-rule">${esc(ruleLabel(g.box_type, c.key, v))}</div>
            <div class="rb-val">${esc(readableValue(v))}</div></div>
          <div class="rb-meta">${c.clause_ref ? `<span class="rb-clause">${esc(c.clause_ref)}</span>` : ""}
            <span class="chip ${c.status === "confirmed" ? "chip--approved" : "chip--draft"}">${esc(c.status)}</span></div>
        </div>`;
      }).join("")}</div>`).join("");
}
window.amendChip = (id, cur) => appPrompt("Amend rule chip", "Value (JSON)", async (v) => { if (!v) return; await fetch(`/api/mint/chip/${id}/amend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value, value: v }) }); renderChips(); }, { value: cur });

init();
