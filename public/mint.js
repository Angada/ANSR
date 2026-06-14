// Mint — contract analysis. Client + run dropdowns, Generate (animated steps),
// recall past runs, purge. Renders summary box + findings + white analysis boxes.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const confClass = (c) => (c >= 0.85 ? "hi" : c >= 0.6 ? "mid" : "lo");
let DATA = null;

async function init() {
  const { clients } = await (await fetch("/api/clients")).json();
  $("#client").innerHTML = clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  await loadRuns();
  $("#client").addEventListener("change", loadRuns);
  $("#run").addEventListener("change", () => openRun($("#run").value));
  $("#gen").addEventListener("click", generate);
  $("#purge").addEventListener("click", purge);
  $("#rmap").addEventListener("click", mapRoster);
}

let ROSTER = null;
const FIELD_LABEL = { ext_id: "Employee ID", name: "Name", role: "Role / level", source: "Source", sourcing_date: "Sourcing date", offer_date: "Offer date", join_date: "Join date", exit_date: "Exit date", fixed_ctc: "Fixed CTC", variable_ctc: "Variable CTC", status: "Status" };

async function mapRoster() {
  const f = $("#rfile").files[0];
  if (!f) { alert("Choose a working sheet first."); return; }
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
  o.innerHTML = `<p class="lbl" style="margin-top:16px">Calculating invoice…</p>`;
  await new Promise((r) => setTimeout(r, 800));
  o.innerHTML = `
    <div class="band" style="margin-top:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span class="chip chip--approved">Calculation complete</span><span class="lbl">outcome generated</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn" href="/invoice.html?customer=${$("#client").value}&run=${ROSTER?.run_no || 3}">Invoicing summary</a>
        <button class="btn btn--ghost" onclick="alert('Invoice PDF — next stage')">Generate invoice</button>
        <button class="btn btn--ghost" onclick="alert('Detailed calculations — next stage')">Detailed calculations</button>
      </div>
    </div>`;
}

async function loadRuns(selectLast) {
  const { runs } = await (await fetch(`/api/mint/runs/${$("#client").value}`)).json();
  $("#run").innerHTML = runs.length
    ? runs.map((r) => `<option value="${r.run_no}">Run ${r.run_no} · ${r.month} · ${r.status}</option>`).join("")
    : `<option value="">— no runs —</option>`;
  if (runs.length) { if (selectLast) $("#run").value = runs[runs.length - 1].run_no; await openRun($("#run").value); }
  else { $("#result").innerHTML = `<p class="lbl" style="margin-top:14px">No runs yet — press Generate Contract Analysis.</p>`; }
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

async function purge() {
  if (!confirm(`Hard-delete every run for ${$("#client").value}? Cannot be undone.`)) return;
  await fetch("/api/mint/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: $("#client").value }) });
  DATA = null; $("#result").innerHTML = `<p class="lbl" style="margin-top:14px">All runs purged. Press Generate to start fresh.</p>`;
  $("#stepwrap").style.display = "none";
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

function boxCard(b) {
  const cc = confClass(b.confidence);
  return `
  <section class="section" style="margin:0">
    <summary><span><span class="conf-dot ${cc}"></span><b>${esc(b.title)}</b></span>
      <span class="chip ${b.status === "approved" ? "chip--approved" : "chip--draft"}">${esc(b.status)}</span></summary>
    <div class="body">
      <div class="conf-${cc}" style="padding:10px;border-radius:8px;margin-bottom:10px">
        <div class="lbl" style="color:var(--ansr-gray);margin-bottom:4px">AI · conf ${(b.confidence * 100).toFixed(0)}% · <em>${esc(b.clause_ref)}</em></div>
        ${esc(b.ai_explain)}
      </div>
      ${renderContent(b.content)}
    </div>
  </section>`;
}

function render() {
  if (!DATA) return;
  $("#result").innerHTML = `
    <section class="section" open style="margin:16px 0 0">
      <summary><b>${esc(DATA.summary.title)}</b><span class="chip">Run ${DATA.run_no}</span></summary>
      <div class="body">
        <p style="margin:0 0 10px">${esc(DATA.summary.text)}</p>
        <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-bottom:2px">Key findings</div>
        <ul class="findings">${DATA.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      </div>
    </section>
    <h3 style="color:var(--ansr-navy);font-weight:500;margin:18px 0 4px">Analysis boxes</h3>
    <div class="grid">${DATA.boxes.map(boxCard).join("")}</div>`;
}

init();
