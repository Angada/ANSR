// Mint — contract analysis. Client + run dropdowns, Generate (animated steps),
// recall past runs, purge. Renders summary box + findings + white analysis boxes.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const confClass = (c) => (c >= 0.85 ? "hi" : c >= 0.6 ? "mid" : "lo");
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
  $("#run").addEventListener("change", () => openRun($("#run").value));
  $("#gen").addEventListener("click", generate);
  $("#purge").addEventListener("click", purge);
  $("#rmap").addEventListener("click", mapRoster);
}

let ROSTER = null;
const FIELD_LABEL = { ext_id: "Employee ID", name: "Name", role: "Role / level", source: "Source", sourcing_date: "Sourcing date", offer_date: "Offer date", join_date: "Join date", exit_date: "Exit date", fixed_ctc: "Fixed CTC", variable_ctc: "Variable CTC", status: "Status" };

async function mapRoster() {
  const f = $("#rfile").files[0];
  if (!f) { appAlert("No file", "Choose a working sheet first."); return; }
  if (f.size > 25 * 1024 * 1024) { appAlert("File too large", "Max 25 MB."); return; }
  $("#rmap").disabled = true; $("#rout").innerHTML = `<p class="lbl" style="margin-top:10px">Reading + mapping…</p>`;
  const fd = new FormData(); fd.append("file", f); fd.append("client", $("#client").value);
  ROSTER = await (await fetch("/api/mint/roster/map", { method: "POST", body: fd })).json();
  $("#rmap").disabled = false;
  renderRoster();
}

function renderRoster() {
  const d = ROSTER; const s = d.summary;
  const mapRows = d.canonical.map((fld) => {
    const opts = ['<option value="">— not mapped —</option>'].concat(d.headers.map((h) => `<option value="${esc(h)}" ${d.mapping[fld] === h ? "selected" : ""}>${esc(h)}</option>`)).join("");
    return `<tr><td class="lbl" style="white-space:nowrap;padding-right:10px">${FIELD_LABEL[fld] || fld}</td><td><select data-fld="${fld}" style="min-height:36px">${opts}</select></td></tr>`;
  }).join("");
  const issuesHtml = d.issues.length ? d.issues.map((x) => `
    <div class="step on" style="border-left-color:${x.severity === "block" ? "#d6402a" : "var(--ansr-orange)"}">
      <span class="chip ${x.severity === "block" ? "chip--flag" : "chip--draft"}">row ${x.row}</span>
      <strong>${FIELD_LABEL[x.field] || x.field}</strong> — ${esc(x.issue)} ${x.value ? `<span class="lbl">(“${esc(x.value)}”)</span>` : ""}
    </div>`).join("") : `<p class="lbl" style="color:var(--ansr-teal)">No issues found.</p>`;
  $("#rout").innerHTML = `
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <span class="chip">📄 ${esc(d.filename)}</span><span class="lbl">→</span>
      <a class="chip chip--approved" href="${d.apiUrl}" target="_blank">API · ${esc(d.docId)}</a>
      <span class="lbl">${d.rowCount} rows · sheet “${esc(d.sheet || "")}”</span>
    </div>
    <details class="section" style="margin-top:12px" open><summary><b>Column mapping</b> <span class="chip">${Object.keys(d.mapping).length}/${d.canonical.length} mapped</span></summary>
      <div class="body"><table>${mapRows}</table></div></details>
    <details class="section" open><summary><b>Issues to fix</b> <span class="chip chip--flag">${s.blocks} block</span> <span class="chip chip--draft">${s.warns} warn</span></summary>
      <div class="body scroll-y">${issuesHtml}</div></details>
    <button class="btn" id="rconfirm" ${s.blocks ? "" : ""}>Confirm &amp; save to DB</button>
    <span id="rconfirm-msg" class="lbl" style="margin-left:8px">${s.blocks ? "fix blocks above, or confirm to stage anyway" : ""}</span>`;
  // mapping edits update ROSTER
  $("#rout").querySelectorAll("select[data-fld]").forEach((sel) => sel.addEventListener("change", () => {
    if (sel.value) ROSTER.mapping[sel.dataset.fld] = sel.value; else delete ROSTER.mapping[sel.dataset.fld];
  }));
  $("#rconfirm").addEventListener("click", confirmRoster);
}

async function confirmRoster() {
  const r = await (await fetch("/api/mint/roster/confirm", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: $("#client").value, docId: ROSTER.docId, rowCount: ROSTER.rowCount, mapping: ROSTER.mapping }) })).json();
  $("#rconfirm-msg").innerHTML = `<span style="color:var(--ansr-teal)">✓ saved ${r.saved} rows · ${r.db} · source switched to API</span>`;
  runValidation();
}

// validation bar — contract terms (AI) vs the supplied data, step by step
async function runValidation() {
  const { steps, ready } = await (await fetch(`/api/mint/validate/${$("#client").value}`)).json();
  const wrap = $("#validate");
  wrap.innerHTML = `<div class="band grad-teal" style="margin-top:16px"><h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 8px">Validation — contract terms vs data</h3><div id="vsteps"></div><div id="vdone"></div></div>`;
  const vs = $("#vsteps");
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    vs.insertAdjacentHTML("beforeend", `<div class="step" id="vs-${i}"><span class="conf-dot mid"></span>${esc(s.label)} <span class="lbl">…</span></div>`);
    await new Promise((r) => setTimeout(r, 500));
    const icon = s.status === "warn" ? `<span style="color:var(--ansr-orange-deep)">⚠ ${esc(s.detail || "warning")}</span>` : `<span style="color:var(--ansr-teal)">✓ ${esc(s.detail || "pass")}</span>`;
    $(`#vs-${i}`).className = "step on";
    $(`#vs-${i}`).innerHTML = `<span class="conf-dot ${s.status === "warn" ? "mid" : "hi"}"></span>${esc(s.label)} ${icon}`;
  }
  if (ready) $("#vdone").innerHTML = `<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <span class="chip chip--approved">✓ Completed · ready to accept file</span>
    <button class="btn" id="accept">Accept file &amp; calculate</button></div>`;
  $("#accept")?.addEventListener("click", acceptFile);
}

async function acceptFile() {
  const o = $("#outcome");
  if (window.READY === false) {
    o.innerHTML = `<div class="band" style="margin-top:16px;border-left:3px solid var(--ansr-orange)"><b style="color:var(--ansr-navy)">Not ready</b><p class="lbl" style="margin:4px 0 0">Contract readiness has missing items — resolve them in the checklist above before results.</p></div>`;
    document.querySelector('.flowstep[data-n="3"] .chip--flag')?.scrollIntoView({ block: "center" });
    return;
  }
  // analyzing → fold all 4 steps behind so the result is front-and-centre
  foldFlow(true);
  o.innerHTML = `<p class="lbl" style="margin-top:16px">Calculating invoice…</p>`;
  await new Promise((r) => setTimeout(r, 800));
  o.innerHTML = `
    <div class="band" style="margin-top:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="chip chip--approved">Calculation complete</span><span class="lbl">outcome generated</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn" href="/invoice.html?customer=${$("#client").value}&run=${ROSTER?.run_no || 3}">Invoicing summary</a>
        <button class="btn btn--ghost" onclick="appAlert('Generate invoice','A4 PDF invoice — next stage.')">Generate invoice</button>
        <button class="btn btn--ghost" onclick="appAlert('Detailed calculations','Per-amount calc tables + ask chips — next stage.')">Detailed calculations</button>
      </div>
    </div>`;
}

let _lastClient = null;
function createClient() {
  const sel = $("#client");
  sel.value = _lastClient || sel.options[0].value; // reset off __new__ immediately
  appPrompt("New client", "Company name", (name) => {
    if (!name) return;
    const id = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
    sel.insertAdjacentHTML("afterbegin", `<option value="${id}">${name}</option>`);
    sel.value = id; _lastClient = id;
    DATA = null; $("#stepwrap").style.display = "none"; $("#validate").innerHTML = ""; $("#outcome").innerHTML = "";
    if (typeof clearSteps === "function") clearSteps();
    $("#run").innerHTML = `<option value="">— no runs yet —</option>`;
    $("#result").innerHTML = `<div class="band grad-accent" style="margin-top:14px">
      <b style="color:var(--ansr-navy)">${esc(name)} created.</b>
      <p class="lbl" style="margin:6px 0 0">Add the SOW (contract), then press <span style="color:#7b2dc4">✨ Generate Contract Analysis</span> — Mint derives the rule book, you review the boxes + readiness, then upload the working sheet to bill.</p></div>`;
  }, { placeholder: "e.g. Kenvue", okLabel: "Create" });
}

async function loadRuns(selectLast) {
  if ($("#client").value === "__new__") return;
  _lastClient = $("#client").value;
  const { runs } = await (await fetch(`/api/mint/runs/${$("#client").value}`)).json();
  $("#run").innerHTML = runs.length
    ? runs.map((r) => `<option value="${r.run_no}">Run ${r.run_no} · ${r.month} · ${r.status}</option>`).join("")
    : `<option value="">— no runs —</option>`;
  if (runs.length) { if (selectLast) $("#run").value = runs[runs.length - 1].run_no; await openRun($("#run").value); }
  else { clearSteps(); $("#result").innerHTML = `<p class="lbl" style="margin-top:14px">No runs yet — press Generate Contract Analysis.</p>`; }
}

async function openRun(no) {
  if (!no) return;
  DATA = await (await fetch(`/api/mint/run/${$("#client").value}/${no}`)).json();
  $("#stepwrap").style.display = "block";
  renderStepper(DATA.steps.length); // all done
  render();
}

function renderStepper(doneUpTo, active = -1) {
  $("#stepper").innerHTML = (DATA?.steps || []).map((s, i) => {
    let cls = "node"; if (i < doneUpTo) cls += " done"; if (i === active) cls += " active";
    return `<div class="${cls}"><div class="dot">${i < doneUpTo ? "&#10003;" : i + 1}</div><div class="lbl">${esc(s)}</div></div>`;
  }).join("");
}

async function generate() {
  $("#gen").disabled = true; $("#result").innerHTML = "";
  // kick off the run (returns instantly on stub); animate steps over it
  const runP = fetch("/api/mint/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value }) }).then((r) => r.json());
  DATA = await runP; // need steps list to render
  $("#stepwrap").style.display = "block";
  for (let i = 0; i < DATA.steps.length; i++) {
    renderStepper(i, i);
    await new Promise((r) => setTimeout(r, 650));
  }
  renderStepper(DATA.steps.length);
  render();
  await loadRuns(); $("#run").value = DATA.run_no;
  $("#gen").disabled = false;
}

function purge() {
  appConfirm("Purge all runs", `Hard-delete every run for ${$("#client").value}? This removes all runs, ledger rows and archives permanently and cannot be undone.`, async () => {
    await fetch("/api/mint/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value }) });
    DATA = null; if (typeof clearSteps === "function") clearSteps();
    $("#result").innerHTML = `<p class="lbl" style="margin-top:14px">All runs purged. Press Generate to start fresh.</p>`;
    $("#stepwrap").style.display = "none"; $("#validate").innerHTML = ""; $("#outcome").innerHTML = "";
  }, "Delete all", true);
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
      <div class="ai-head"><span class="tw">✨</span> Ask this box</div>
      <div class="ai-chips">${chips}</div>
      <div class="ai-log" id="log-${b.id}"></div>
      <div class="ai-row"><input id="ask-${b.id}" placeholder="ask or instruct…" onkeydown="if(event.key==='Enter')askBox('${b.id}', this.value)"><button class="btn-ai" onclick="askBox('${b.id}', document.getElementById('ask-${b.id}').value)">Send</button></div>
    </div>
  </div>`;
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
    log.insertAdjacentHTML("beforeend", `<div class="ai-msg bot"><span class="who">✨ AI:</span> Got it — record this as the confirmed reading of <b>${BOX_CLAUSE[boxId] || boxId}</b>? It will ground every future answer. <div style="margin-top:6px"><button class="btn-ai" style="padding:5px 12px;min-height:32px" onclick="acceptInstr('${boxId}',this)">Accept</button> <button class="btn btn--ghost" style="padding:5px 12px;min-height:32px" onclick="this.closest('.ai-msg').remove()">Discard</button></div></div>`);
  } else {
    const cite = r.cited?.length ? ` <span class="lbl">[${r.cited.join(", ")}]</span>` : "";
    log.insertAdjacentHTML("beforeend", `<div class="ai-msg bot"><span class="who">✨ AI:</span> ${esc(r.reply)}${cite}</div>`);
  }
  log.scrollTop = log.scrollHeight;
};
window.acceptInstr = async (boxId, btn) => {
  const r = await (await fetch(`/api/mint/interpret`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: $("#client").value, clause_ref: BOX_CLAUSE[boxId] || boxId, reading: PENDING[boxId] || "user correction" }) })).json();
  btn.closest(".ai-msg").innerHTML = `<span class="who">✨ AI:</span> <span style="color:var(--ansr-teal)">✓ Learned — ${esc(BOX_CLAUSE[boxId] || boxId)} reading saved. Recalibrate to cement it into the rules.</span>`;
  setDirty(true);
};

window.scrollRail = (dir) => { const r = $("#boxrail"); r.scrollBy({ left: dir * (r.clientWidth * 0.8), behavior: "smooth" }); };

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

function readiness() {
  const rb = DATA.boxes.find((b) => b.box_type_code === "billing_rules")?.content || {};
  const ok = (v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== "");
  // one item per rule-book field the contract analysis emitted
  const items = Object.keys(rb).map((k) => ({ k: humanize(k), ok: ok(rb[k]) }));
  // derived dependency: a rate table is only usable if rows carry a level
  const rt = rb.ta_rate_table;
  if (Array.isArray(rt)) items.push({ k: "Role → level map", ok: rt.some((r) => r.level) });
  return items.length ? items : [{ k: "Contract rule book", ok: false }];
}

const SECDESC = {
  summary: "Plain-English read of the SOW and the key billing facts.",
  boxes: "Each clause area as a box — open one to see detail and ask its AI.",
  ready: "Everything Mint needs from the contract before it can calculate. Missing items must be resolved first.",
};

function render() {
  if (!DATA) return;
  foldFlow(false); // fresh render → all steps open
  const chk = readiness();
  const allOk = chk.every((c) => c.ok);
  window.READY = allOk;
  const chkHtml = chk.map((c) => `<div class="chk ${c.ok ? "ok" : "miss"}"><span class="ic">${c.ok ? "✓" : "✕"}</span><span>${esc(c.k)}</span>${c.ok ? "" : `<button class="chip ask" onclick="askMissing('${esc(c.k)}')">Ask me</button>`}</div>`).join("");

  // step 1 — Contract summary
  $("#result").innerHTML = `
    <div class="sd lbl" style="margin-bottom:8px">${SECDESC.summary} <span class="chip" style="margin-left:6px">Run ${DATA.run_no}</span></div>
    <p class="sum-text" style="margin:0 0 10px">${esc(DATA.summary.text)}</p>
    <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-bottom:2px">Key findings</div>
    <ul class="findings sm">${DATA.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;

  // step 2 — Analysis boxes (carousel)
  const boxesEl = document.getElementById("boxes");
  if (boxesEl) boxesEl.innerHTML = `
    <div class="sd lbl" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span>${SECDESC.boxes}</span>
      <span class="railnav"><button class="railbtn" onclick="scrollRail(-1)">‹</button><button class="railbtn" onclick="scrollRail(1)">›</button></span></div>
    <div class="boxrail" id="boxrail">${DATA.boxes.map(boxCard).join("")}</div>`;

  // step 3 — Contract readiness (+ recalibrate box + meter)
  const readyEl = document.getElementById("ready");
  if (readyEl) readyEl.innerHTML = `
    <div class="sd lbl" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span>${SECDESC.ready}</span>
      <span class="chip ${allOk ? "chip--approved" : "chip--flag"}" id="readyChip">${allOk ? "ready to analyse" : chk.filter((c) => !c.ok).length + " missing"}</span></div>
    ${chkHtml}
    <div class="recal-wrap"><button class="btn-recal ${DIRTY ? "dirty" : ""}" id="recalBtn" onclick="recalibrate()">↻ Recalibrate${DIRTY ? " — changes pending" : ""}</button></div>
    <div id="recal"></div>`;
}

let DIRTY = false;
function setDirty(v) {
  DIRTY = v;
  const b = document.getElementById("recalBtn");
  if (b) { b.classList.toggle("dirty", v); b.textContent = v ? "↻ Recalibrate — changes pending" : "↻ Recalibrate"; }
}

// real-time recalibration after corrections — cements rules, then unlocks step 4
const RECAL_STEPS = ["Re-reading contract clauses", "Applying confirmed interpretations", "Recompiling rate + slab tables", "Cementing financial rules", "Recalibration complete"];
window.recalibrate = async () => {
  const host = document.getElementById("recal"); if (!host) return;
  const btn = document.getElementById("recalBtn"); if (btn) btn.disabled = true;
  host.innerHTML = `<div class="meter"><div class="meter-bar"><div class="meter-fill" id="mfill"></div></div>
    <div class="meter-now" id="mnow"></div><div class="meter-list" id="mlist"></div></div>`;
  const fill = document.getElementById("mfill"), now = document.getElementById("mnow"), list = document.getElementById("mlist");
  for (let i = 0; i < RECAL_STEPS.length; i++) {
    now.textContent = RECAL_STEPS[i];
    fill.style.width = Math.round(((i + 1) / RECAL_STEPS.length) * 100) + "%";
    list.insertAdjacentHTML("beforeend", `<div class="ms" id="ms-${i}">${esc(RECAL_STEPS[i])}…</div>`);
    await new Promise((r) => setTimeout(r, 620));
    const el = document.getElementById(`ms-${i}`); el.className = "ms done"; el.textContent = "✓ " + RECAL_STEPS[i];
  }
  now.innerHTML = `<span style="color:var(--ansr-teal)">✓ Financial rules cemented · contract recalibrated</span>`;
  setDirty(false); window.RECALIBRATED = true;
  const chip = document.getElementById("readyChip"); if (chip) { chip.textContent = "recalibrated ✓"; chip.className = "chip chip--approved"; }
  if (btn) { btn.disabled = false; btn.textContent = "↻ Recalibrate"; btn.classList.remove("dirty"); }
  // unlock step 4 — working sheet
  const ws = document.querySelector('.flowstep[data-n="4"]');
  if (ws) { ws.classList.remove("folded"); ws.scrollIntoView({ behavior: "smooth", block: "start" }); }
};

window.askMissing = (item) => {
  appPrompt(`Add ${item}`, `Tell me the ${item} for this contract and I'll add it to the rule book before analysis.`, (v) => {
    if (!v) return;
    appAlert("Recorded", `“${item}” noted — it'll ground the analysis.`);
    setDirty(true);
  });
};

init();
