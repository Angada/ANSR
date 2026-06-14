// Invoice Studio page. Consumes the trace contract from /api/run.
// Three features: replay slider, confidence heatmap, audit pack.
const $ = (s, r = document) => r.querySelector(s);
const money = (n, c = "USD") => (c === "USD" ? "$" : c + " ") + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const confClass = (c) => (c >= 0.85 ? "hi" : c >= 0.6 ? "mid" : "lo");
const params = new URLSearchParams(location.search);
let RUN = null, allSteps = [];

async function load() {
  const cust = params.get("customer") || "ANSR-KENVUE";
  const run = params.get("run") || "1";
  RUN = await (await fetch(`/api/run/${cust}/${run}`)).json();
  $("#runmeta").textContent = `${RUN.customer} · ${RUN.invoice_month} · ${RUN.currency} · ${RUN.status}${RUN.stub ? " · STUB" : ""}`;
  renderSummary(); collectSteps(); renderSteps(); renderTA(); renderOSS(); renderExceptions();
  wireTabs(); wireReplay(); wireAudit();
}

function renderSummary() {
  const t = RUN.totals;
  $("#summary").innerHTML = [
    ["Total OSS", money(t.oss, RUN.currency)],
    ["Total TA", money(t.ta, RUN.currency)],
    ["Grand total", money(t.grand, RUN.currency)],
  ].map(([k, v]) => `<div class="section"><div class="body"><div class="lbl">${k}</div><div style="font-size:24px;font-weight:500;color:var(--ansr-navy)">${v}</div></div></div>`).join("");
}

// gather every calc_step across OSS + TA, ordered by global seq (replay timeline)
function collectSteps() {
  allSteps = [];
  for (const s of RUN.oss.calc_steps) allSteps.push({ ...s, src: "OSS", conf: RUN.oss.confidence });
  for (const t of RUN.ta) for (const s of t.calc_steps) allSteps.push({ ...s, src: t.employee, conf: t.confidence });
  allSteps.sort((a, b) => a.seq - b.seq);
  $("#slider").max = RUN.max_seq;
}

function renderSteps() {
  const p = Number($("#slider").value);
  $("#seqlbl").textContent = `${p} / ${RUN.max_seq}`;
  $("#steps").innerHTML = allSteps.map((s) => {
    const on = s.seq <= p;
    const v = s.value === "" || s.value == null ? "" : `<span class="v">${typeof s.value === "number" ? money(s.value, RUN.currency) : s.value}</span>`;
    return `<div class="step ${on ? "on" : ""}"><span class="conf-dot ${confClass(s.conf)}"></span><strong>${s.label}</strong> <span class="lbl">${s.detail || ""}</span>${v}</div>`;
  }).join("");
  // reveal line invoice values only once their final step is past the slider
  document.querySelectorAll("[data-finalseq]").forEach((el) => {
    const done = Number(el.dataset.finalseq) <= p;
    el.textContent = done ? el.dataset.final : "—";
    el.classList.toggle("pending-val", !done);
  });
}

function renderTA() {
  const rows = RUN.ta.map((t) => {
    const finalSeq = Math.max(...t.calc_steps.map((s) => s.seq));
    return `<tr class="conf-${confClass(t.confidence)}">
      <td class="pin conf-${confClass(t.confidence)}"><span class="conf-dot ${confClass(t.confidence)}"></span>${t.employee}</td>
      <td>${t.level}</td><td>${t.referral ? "referral" : "—"}</td><td>${t.tech ? "tech" : "non-tech"}</td>
      <td>${t.ctc.ccy} ${t.ctc.amount.toLocaleString()}</td><td>${t.ta_pct}%</td>
      <td>${money(t.gross_ta_fee)}</td><td>${money(t.sourcing_billed)}</td><td>${money(t.acceptance_billed)}</td><td>${money(t.balance_billed)}</td>
      <td data-finalseq="${finalSeq}" data-final="${money(t.invoice_value)}">—</td></tr>`;
  }).join("");
  $("#pane-ta").innerHTML = `<div class="scroll-x"><table>
    <thead><tr><th class="pin">Employee</th><th>Level</th><th>Ref</th><th>Tech</th><th>CTC</th><th>TA%</th><th>Gross</th><th>Sourcing</th><th>Acceptance</th><th>Balance</th><th>Invoice</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function renderOSS() {
  const o = RUN.oss;
  $("#pane-oss").innerHTML = `<div class="scroll-x"><table>
    <thead><tr><th>Month</th><th>Opening</th><th>Joiners</th><th>Exits</th><th>Closing active</th><th>Slab</th><th>Rate</th><th>OSS</th></tr></thead>
    <tbody><tr class="conf-${confClass(o.confidence)}"><td>${o.invoice_month}</td><td>${o.opening_hc}</td><td>+${o.new_joiners}</td><td>−${o.exits}</td><td>${o.closing_active_hc}</td><td>${o.slab}</td><td>${money(o.rate)}</td><td>${money(o.amount)}</td></tr></tbody></table></div>`;
}

function renderExceptions() {
  $("#pane-exceptions").innerHTML = RUN.exceptions.length
    ? RUN.exceptions.map((e) => `<section class="section" open><summary><span>${e.ext_id} · ${e.issue}</span><span class="chip chip--flag">${e.severity}</span></summary><div class="body">${e.detail}</div></section>`).join("")
    : `<p class="lbl">No exceptions.</p>`;
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("active"); tab.setAttribute("aria-selected", "true");
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = true));
    $(`#pane-${tab.dataset.tab}`).hidden = false;
  }));
}

function wireReplay() {
  $("#slider").addEventListener("input", renderSteps);
  let timer = null;
  $("#play").addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; $("#play").textContent = "▶"; return; }
    $("#play").textContent = "⏸"; const s = $("#slider");
    if (Number(s.value) >= RUN.max_seq) s.value = 0;
    timer = setInterval(() => {
      s.value = Number(s.value) + 1; renderSteps();
      if (Number(s.value) >= RUN.max_seq) { clearInterval(timer); timer = null; $("#play").textContent = "▶"; }
    }, 450);
  });
}

// audit pack: reveal all, print-friendly view → browser Save as PDF
function wireAudit() {
  $("#audit").addEventListener("click", () => {
    $("#slider").value = RUN.max_seq; renderSteps();
    document.querySelectorAll(".section").forEach((s) => s.open = true);
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = false));
    window.print();
  });
}

load();
