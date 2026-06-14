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
