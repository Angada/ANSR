// Outputs: ANSR-branded A4 invoice + month-by-month breakdown + detailed calc.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const p = new URLSearchParams(location.search);
const CLIENT = p.get("customer") || p.get("client") || "ANSR-KENVUE";
const RUN = p.get("run") || "3";
const money = (n, c) => (c === "USD" ? "$" : (c ? c + " " : "")) + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

async function load() {
  const inv = await (await fetch(`/api/mint/invoice/${CLIENT}/${RUN}`)).json();
  $("#ohead").textContent = `${inv.to.name} · ${inv.invoice_month} · ${inv.currency}${inv.stub ? " · sample" : ""}`;
  renderInvoice(inv);
  renderMonths();
  renderCalc();
  wireTabs();
  $("#print").addEventListener("click", () => { showTab("invoice"); window.print(); });
}

function renderInvoice(inv) {
  const c = inv.currency;
  const rows = inv.lines.map((l) => `<tr><td><b>${esc(l.head)}</b><br><span class="lbl">${esc(l.desc)}</span></td><td>${esc(l.hsn)}</td><td class="r">${money(l.amount, c)}</td></tr>`).join("");
  $("#invoice").innerHTML = `
    <div class="inv">
      <div class="inv-head">
        <img src="/brand/assets/logos/QAnsr-logo.png" alt="ANSR">
        <div class="ttl"><h1>INVOICE</h1>
          <div class="meta">No. <b>${esc(inv.invoice_no)}</b><br>Date: ${esc(inv.invoice_month)}<br>Currency: ${esc(c)}</div></div>
      </div>
      <div class="inv-ft">
        <div class="blk"><div class="cap">From</div><div class="nm">${esc(inv.from.name)}</div>
          <div class="ln">${esc(inv.from.addr)}</div><div class="ln">GSTIN: ${esc(inv.from.gstin)}</div><div class="ln">${esc(inv.from.email)}</div></div>
        <div class="blk"><div class="cap">Bill to</div><div class="nm">${esc(inv.to.name)}</div>
          <div class="ln">${esc(inv.to.addr)}</div><div class="ln">Attn: ${esc(inv.to.attn)}</div><div class="ln">GSTIN: ${esc(inv.to.gstin)}</div></div>
      </div>
      <table>
        <thead><tr><th>Description</th><th>HSN/SAC</th><th class="r">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td></td><td class="r">Subtotal</td><td class="r">${money(inv.subtotal, c)}</td></tr>
          <tr><td></td><td class="r">${esc(inv.tax.label)} (${inv.tax.rate}%) <span class="lbl">${esc(inv.tax.note || "")}</span></td><td class="r">${money(inv.tax.amount, c)}</td></tr>
          <tr class="grand"><td></td><td class="r">Total due</td><td class="r">${money(inv.total, c)}</td></tr>
        </tfoot>
      </table>
      <div class="note">${esc(inv.notes)}</div>
    </div>`;
}

async function renderMonths() {
  const { runs } = await (await fetch(`/api/mint/runs/${CLIENT}`)).json();
  const rows = (runs || []).map((r) => `<tr><td>${esc(r.month || "—")}</td><td>Run ${r.run_no}</td><td>${esc(r.status)}</td><td class="r">${r.grand != null ? money(r.grand, "USD") : "—"}</td></tr>`).join("");
  $("#months").innerHTML = `<div class="band"><h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 8px">Month-by-month billing</h3>
    <div class="scroll-x"><table class="grid"><thead><tr><th>Month</th><th>Run</th><th>Status</th><th class="r">Grand total</th></tr></thead><tbody>${rows || `<tr><td colspan=4 class=lbl>No runs yet.</td></tr>`}</tbody></table></div></div>`;
}

async function renderCalc() {
  const r = await (await fetch(`/api/run/${CLIENT}/${RUN}`)).json();
  const c = r.currency || "USD";
  const ossSteps = (r.oss?.calc_steps || []).map((s) => `<div class="step on"><strong>${esc(s.label)}</strong> <span class="lbl">${esc(s.detail || "")}</span><span class="v">${esc(typeof s.value === "number" ? money(s.value, c) : s.value)}</span></div>`).join("");
  const ta = (r.ta || []).map((t) => `<details class="section"><summary><b>${esc(t.employee)}</b> <span class="chip">${esc(t.level)}</span><span class="chip ${t.referral ? "chip--approved" : "chip--draft"}">${t.referral ? "referral" : "non-ref"}</span></summary>
    <div class="body">${(t.calc_steps || []).map((s) => `<div class="step on"><strong>${esc(s.label)}</strong> <span class="lbl">${esc(s.detail || "")}</span><span class="v">${esc(typeof s.value === "number" ? money(s.value, c) : s.value)}</span></div>`).join("")}</div></details>`).join("");
  $("#calc").innerHTML = `
    <div class="band"><h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">OSS — headcount roll-forward</h3>${ossSteps}</div>
    <div class="band"><h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">TA — fee bridge (per placement)</h3>${ta}</div>
    <div class="ai-box"><div class="ai-head"><span class="tw">✨</span> Ask about any number</div>
      <div class="ai-chips" id="calcchips"></div>
      <div class="ai-log" id="calclog"></div>
      <div class="ai-row"><input id="calcask" placeholder="e.g. why is OSS this much?"><button class="btn-ai" onclick="askCalc(document.getElementById('calcask').value)">Ask</button></div></div>`;
  // on-the-fly chips from the actual lines
  const chips = ["Why is OSS this month's amount?", ...(r.ta || []).slice(0, 3).map((t) => `Why is ${t.employee}'s TA ${money(t.invoice_value, c)}?`)];
  $("#calcchips").innerHTML = chips.map((q) => `<span class="ai-chip" onclick="askCalc('${esc(q).replace(/'/g, "&#39;")}')">${esc(q)}</span>`).join("");
}

window.askCalc = async (q) => {
  q = (q || "").trim(); if (!q) return;
  const log = $("#calclog"); $("#calcask").value = "";
  log.insertAdjacentHTML("beforeend", `<div class="ai-msg"><span class="who">You:</span> ${esc(q)}</div>`);
  const r = await (await fetch(`/api/box/qa/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, client: CLIENT }) })).json();
  log.insertAdjacentHTML("beforeend", `<div class="ai-msg bot"><span class="who">✨ AI:</span> ${esc(r.reply)}${r.cited?.length ? ` <span class="lbl">[${r.cited.join(", ")}]</span>` : ""}</div>`);
  log.scrollTop = log.scrollHeight;
};

function showTab(t) {
  document.querySelectorAll(".tab").forEach((x) => { const on = x.dataset.tab === t; x.classList.toggle("active", on); x.setAttribute("aria-selected", on); });
  document.querySelectorAll(".pane").forEach((pp) => (pp.hidden = pp.id !== `pane-${t}`));
}
function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
  if (["months", "calc", "invoice"].includes(location.hash.slice(1))) showTab(location.hash.slice(1));
}

load();
