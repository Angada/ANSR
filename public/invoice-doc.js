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
  renderStatement();
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

// ---------- Statement & charts (generic, from /analytics) ----------
let STMT = null; const FILT = { month: null, head: null, referral: null, level: null };
const HEAD_COLOR = { "OSS": "#005465", "TA · Sourcing": "#FF9466", "TA · Acceptance": "#FF5400", "TA · Balance": "#CF4400" };

async function renderStatement() {
  STMT = await (await fetch(`/api/mint/analytics/${CLIENT}`)).json();
  paintStatement();
}
function uniq(a) { return [...new Set(a.filter((x) => x !== null && x !== undefined && x !== ""))]; }

function paintStatement() {
  const host = $("#statement"); if (!host || !STMT) return;
  const c = STMT.currency || "USD";
  if (!STMT.months.length) { host.innerHTML = `<p class="lbl" style="margin-top:14px">No computed runs yet. Run a calculation in Mint to populate the statement.</p>`; return; }
  const lines = STMT.lines.filter((l) =>
    (!FILT.month || l.month === FILT.month) && (!FILT.head || l.head === FILT.head) &&
    (FILT.referral === null || String(l.referral) === FILT.referral) && (!FILT.level || l.level === FILT.level));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  // KPIs
  const grand = STMT.months.reduce((s, m) => s + m.grand, 0);
  const kpis = [["Billed to date", money(grand, c)], ["Months", STMT.months.length], ["This view", money(total, c)], ["Lines", lines.length]]
    .map(([k, v]) => `<div class="kpi"><div class="kv">${v}</div><div class="kl">${k}</div></div>`).join("");
  // cost-head donut (filtered)
  const byHead = {}; lines.forEach((l) => (byHead[l.head] = (byHead[l.head] || 0) + l.amount));
  const donutParts = Object.entries(byHead).map(([label, value]) => ({ label, value, color: HEAD_COLOR[label] || "#94A3B8" }));
  // filter chips
  const chip = (key, val, label) => `<span class="chipf ${FILT[key] === val ? "on" : ""}" onclick="setFilt('${key}',${val === null ? "null" : `'${esc(String(val))}'`})">${esc(label)}</span>`;
  const monthChips = `<div class="chips" style="margin:4px 0">${chip("month", null, "All months")}${STMT.months.map((m) => chip("month", m.month, m.month)).join("")}</div>`;
  const headChips = `<div class="chips" style="margin:4px 0">${chip("head", null, "All heads")}${uniq(STMT.lines.map((l) => l.head)).map((h) => chip("head", h, h)).join("")}</div>`;
  const refVals = uniq(STMT.lines.map((l) => l.referral)).length ? `<div class="chips" style="margin:4px 0">${chip("referral", null, "Any referral")}${chip("referral", "true", "referral")}${chip("referral", "false", "non-referral")}</div>` : "";
  const levels = uniq(STMT.lines.map((l) => l.level));
  const lvlChips = levels.length ? `<div class="chips" style="margin:4px 0">${chip("level", null, "Any level")}${levels.map((l) => chip("level", l, l)).join("")}</div>` : "";
  // table
  const rows = lines.map((l) => `<tr><td>${esc(l.month)}</td><td>${esc(l.head)}</td><td>${esc(l.name || "")}</td><td>${esc(l.level || "")}</td><td>${l.referral === null ? "" : (l.referral ? "ref" : "non-ref")}</td><td class="r">${money(l.amount, c)}</td></tr>`).join("");
  host.innerHTML = `
    <div class="kpis">${kpis}</div>
    <div class="band"><h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 8px">Monthly billing (OSS + TA)</h3>${barChart(STMT.months, c)}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div class="band" style="flex:1;min-width:240px"><h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 8px">Cost-head split${FILT.month ? " · " + FILT.month : ""}</h3>${donut(donutParts, c)}</div>
      <div class="band" style="flex:2;min-width:280px">
        <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">Filtered bill</h3>
        ${monthChips}${headChips}${refVals}${lvlChips}
        <div class="scroll-x" style="margin-top:8px"><table class="grid"><thead><tr><th>Month</th><th>Head</th><th>Name</th><th>Level</th><th>Ref</th><th class="r">Amount</th></tr></thead>
          <tbody>${rows || `<tr><td colspan=6 class=lbl>No lines match the filter.</td></tr>`}</tbody>
          <tfoot><tr><td colspan=5 class="r"><b>Total (view)</b></td><td class="r"><b>${money(total, c)}</b></td></tr></tfoot></table></div>
      </div>
    </div>`;
}
window.setFilt = (k, v) => { FILT[k] = v; paintStatement(); };

function barChart(months, c) {
  const max = Math.max(1, ...months.map((m) => m.grand));
  const bw = 54, gap = 18, h = 150, pad = 24, w = Math.max(320, months.length * (bw + gap) + pad);
  const bars = months.map((m, i) => {
    const x = pad + i * (bw + gap);
    const ossH = (m.oss / max) * h, taH = (m.ta / max) * h;
    const yO = pad + h - ossH, yT = yO - taH;
    return `<rect x="${x}" y="${yO}" width="${bw}" height="${ossH}" fill="#005465"/>
      <rect x="${x}" y="${yT}" width="${bw}" height="${taH}" fill="#FF5400"/>
      <text x="${x + bw / 2}" y="${pad + h + 14}" text-anchor="middle" font-size="10" fill="#777">${esc(m.month.slice(2))}</text>
      <text x="${x + bw / 2}" y="${yT - 4}" text-anchor="middle" font-size="9.5" fill="#00242E">${money(m.grand, c)}</text>`;
  }).join("");
  return `<div class="scroll-x"><svg viewBox="0 0 ${w} ${h + pad * 2}" style="max-width:100%;height:auto;min-width:${w}px">
    ${bars}</svg></div>
    <div class="lbl" style="margin-top:4px"><span style="color:#005465">■</span> OSS &nbsp; <span style="color:#FF5400">■</span> TA</div>`;
}
function donut(parts, c) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  const segs = parts.map((p) => { const frac = p.value / total; const seg = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${frac * C} ${C}" stroke-dashoffset="${-acc * C}" transform="rotate(-90 70 70)"/>`; acc += frac; return seg; }).join("");
  const legend = parts.map((p) => `<div class="lbl" style="display:flex;gap:6px;align-items:center"><span style="width:10px;height:10px;background:${p.color};border-radius:2px;display:inline-block"></span>${esc(p.label)} · ${money(p.value, c)} (${Math.round(p.value / total * 100)}%)</div>`).join("");
  return `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><svg width="140" height="140" viewBox="0 0 140 140">${segs}<circle r="30" cx="70" cy="70" fill="var(--ansr-white)"/></svg><div>${legend}</div></div>`;
}

function showTab(t) {
  document.querySelectorAll(".tab").forEach((x) => { const on = x.dataset.tab === t; x.classList.toggle("active", on); x.setAttribute("aria-selected", on); });
  document.querySelectorAll(".pane").forEach((pp) => (pp.hidden = pp.id !== `pane-${t}`));
}
function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
  if (["months", "calc", "invoice"].includes(location.hash.slice(1))) showTab(location.hash.slice(1));
}

load();
