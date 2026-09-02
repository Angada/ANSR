// Contract page — Phase A boxes (explain · chat · amend · approve) + runs.
const $ = (s, r = document) => r.querySelector(s);
const id = new URLSearchParams(location.search).get("id") || "ANSR-KENVUE";
const confClass = (c) => (c >= 0.85 ? "hi" : c >= 0.6 ? "mid" : "lo");
const esc = (s) => String(s ?? "").replace(/[&<>"'`]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[m]));

// render a box content value (string | array-of-objects | object | scalar)
function renderVal(v) {
  if (Array.isArray(v)) {
    if (!v.length) return "—";
    if (typeof v[0] === "object") {
      const cols = [...new Set(v.flatMap((o) => Object.keys(o)))];
      return `<div class="scroll-x"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${v.map((o) => `<tr>${cols.map((c) => `<td>${esc(o[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    return v.map(esc).join(", ");
  }
  if (v && typeof v === "object") return `<table>${Object.entries(v).map(([k, val]) => `<tr><td class="lbl" style="padding-right:12px">${esc(k)}</td><td>${esc(val)}</td></tr>`).join("")}</table>`;
  return esc(v);
}

function renderContent(content) {
  return Object.entries(content).map(([k, v]) =>
    `<div style="margin:10px 0"><div class="lbl" style="text-transform:capitalize;color:var(--ansr-gray);margin-bottom:4px">${esc(k.replace(/_/g, " "))}</div>${renderVal(v)}</div>`
  ).join("");
}

function boxHtml(b) {
  const cc = confClass(b.confidence);
  const sugg = (b.suggestions || []).map((s) => `
    <div class="step on" style="border-left-color:var(--ansr-orange)">
      <span class="conf-dot ${confClass(s.confidence || 0.7)}"></span><strong>${esc(s.summary)}</strong>
      <div class="lbl" style="color:var(--ansr-gray)">${esc(s.rationale)} <em>(${esc(s.clause_ref || "")})</em></div>
      <div style="margin-top:6px"><button class="btn" style="padding:6px 14px;min-height:34px" onclick="decide('${b.id}','${s.id}','accept')">Accept</button>
        <button class="btn btn--ghost" style="padding:6px 14px;min-height:34px" onclick="decide('${b.id}','${s.id}','reject')">Reject</button></div>
    </div>`).join("");
  return `
  <section class="section" data-box="${b.id}">
    <summary><span><span class="conf-dot ${cc}"></span>${esc(b.title)}</span>
      <span class="chip ${b.status === "approved" ? "chip--approved" : "chip--draft"}">${esc(b.status)}</span></summary>
    <div class="body">
      <div class="conf-${cc}" style="padding:10px;border-radius:8px;margin-bottom:10px">
        <div class="lbl" style="color:var(--ansr-gray);margin-bottom:4px">AI explanation · conf ${(b.confidence * 100).toFixed(0)}% · <em>${esc(b.clause_ref)}</em></div>
        ${esc(b.ai_explain)}
      </div>
      ${renderContent(b.content)}
      ${sugg ? `<div class="lbl" style="margin:12px 0 4px;color:var(--ansr-navy)">AI suggestions</div>${sugg}` : ""}
      <div class="lbl" style="margin:12px 0 4px;color:var(--ansr-navy)">Clarify (chat)</div>
      <div id="chat-${b.id}" class="scroll-y" style="max-height:30vh;border:1px solid var(--ansr-border);border-radius:8px;padding:8px;display:none"></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input id="ask-${b.id}" placeholder="ask about this box…">
        <button class="btn" onclick="ask('${b.id}')">Ask</button>
      </div>
      <div style="margin-top:12px">
        <button class="btn btn--ghost" onclick="amend('${b.id}')">Amend</button>
        <button class="btn" onclick="approve('${b.id}')">Approve ✓</button>
      </div>
    </div>
  </section>`;
}

async function load() {
  const data = await (await fetch(`/api/contract/${id}`)).json();
  $("#cname").textContent = data.contract.name;
  $("#meta").textContent = `${data.contract.currency} · ${data.contract.tz} · ${data.contract.source_doc}`;
  $("#boxes").innerHTML = data.boxes.map(boxHtml).join("");
  const { runs } = await (await fetch(`/api/runs/${id}`)).json();
  $("#runs").innerHTML = runs.map((r) =>
    `<a class="tab" href="/invoice.html?customer=${id}&run=${r.run_no}">${r.month} · $${r.grand.toLocaleString()} <span class="chip ${r.status === "complete" ? "chip--approved" : "chip--draft"}" style="margin-left:4px">${r.status}</span></a>`
  ).join("");
}

window.ask = async (boxId) => {
  const input = $(`#ask-${boxId}`); const msg = input.value.trim(); if (!msg) return;
  const box = $(`#chat-${boxId}`); box.style.display = "block";
  box.innerHTML += `<div style="margin:4px 0"><strong>You:</strong> ${esc(msg)}</div>`;
  input.value = "";
  const r = await (await fetch(`/api/box/${boxId}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: msg }) })).json();
  box.innerHTML += `<div style="margin:4px 0;color:var(--ansr-navy)"><strong>AI:</strong> ${esc(r.reply)}</div>`;
  box.scrollTop = box.scrollHeight;
};
window.amend = (boxId) => {
  appPrompt("Amend box", "Describe the change", async (t) => {
    if (!t) return;
    await fetch(`/api/box/${boxId}/amend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ after: t }) });
    appAlert("Amendment recorded", "Recompiles the rule on the real engine.");
  }, { okLabel: "Apply" });
};
window.approve = (boxId) => {
  const s = document.querySelector(`[data-box="${boxId}"] .chip`); s.textContent = "approved"; s.className = "chip chip--approved";
};
window.decide = (boxId, sid, d) => appAlert(d === "accept" ? "Accepted" : "Rejected", `Suggestion ${sid} on ${boxId}.`);

load();
