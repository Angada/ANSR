// RayDar admin — scaffold for the new agent. MissQ AI console reuses the shared
// provider/model config (same "wealth-t" pattern as Admin: one page, apply-to-all,
// model dropdowns). Integrations / Vault / Accounts are wired-ready placeholders —
// the real Google OAuth + MissQ actions port from TKB-Admin lands once creds + a
// plan are confirmed.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
let CFG = null;

async function load() {
  CFG = await (await fetch("/api/config")).json();
  renderMissq(); renderIntegrations(); renderVault(); renderAccounts(); wireTabs();
}

// ---- MissQ · AI console (providers + apply-to-all model) --------------------
function renderMissq() {
  const provs = Object.entries(CFG.providers || {});
  const connectors = provs.map(([id, p]) => `
    <div class="conn" onclick="editKey('${id}')">
      <div class="cname">${esc(p.label || id)}</div>
      <div class="cstat lbl"><span class="dot ${p.hasKey ? "ok" : "no"}"></span>${p.hasKey ? "connected" : "no key"}</div>
      <div class="lbl" style="font-size:11px;color:var(--ansr-gray-mid);margin-top:4px">${(p.models || []).length} models</div>
    </div>`).join("");
  const modelOpts = provs.flatMap(([id, p]) => (p.models || []).map((m) => `<option value="${id}::${m}">${esc(p.label)} · ${esc(m)}</option>`)).join("");
  $("#missq").innerHTML = `
    <div class="band grad-soft">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 4px">✨ MissQ — the RayDar assistant</h3>
      <p class="lbl" style="margin:0 0 10px;color:var(--ansr-gray)">MissQ answers + acts across accounts and integrations. Connect a provider key, pick a default model, apply to every MissQ skill. (Same gated-pipeline model as Mint/Admin.)</p>
      <div class="conns" style="display:flex;gap:10px;flex-wrap:wrap;overflow-x:auto">${connectors}</div>
      <div id="keyedit"></div>
      <div style="border-top:1px solid var(--ansr-border);margin-top:12px;padding-top:10px">
        <label class="lbl">Default model · apply to all MissQ skills</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          <select id="defModel" style="flex:1;min-width:200px">${modelOpts}</select>
          <button class="btn" onclick="applyAll()">Apply to all</button>
          <span id="applyMsg" class="lbl" style="align-self:center"></span>
        </div>
      </div>
    </div>
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">MissQ skills <span class="chip chip--draft">coming soon</span></h3>
      <div class="chips">${["missq-chat", "missq-actions", "missq-inbox", "missq-calendar", "missq-vault-qa"].map((s) => `<span class="chip">${s}</span>`).join("")}</div>
      <p class="lbl" style="margin:8px 0 0;color:var(--ansr-gray)">Each becomes a registered, gated pipeline (like Mint's) once the agent scope lands.</p>
    </div>`;
}
window.editKey = (id) => {
  const p = CFG.providers[id];
  $("#keyedit").innerHTML = `
    <div class="band" style="margin:10px 0 0">
      <div style="display:flex;justify-content:space-between;align-items:center"><strong style="color:var(--ansr-navy)">${esc(p.label)}</strong>
        <span class="chip ${p.hasKey ? "chip--approved" : "chip--draft"}">${p.hasKey ? "key " + esc(p.keyHint || "") : "no key"}</span></div>
      <input type="password" id="key-${id}" placeholder="paste ${esc(p.label)} key — stored encrypted" style="margin-top:8px">
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn" onclick="saveKey('${id}')">Save key</button>
        <button class="btn btn--ghost" onclick="testKey('${id}')">Test</button><span id="test-${id}" class="lbl" style="align-self:center"></span></div>
    </div>`;
};
window.saveKey = async (id) => {
  const apiKey = $(`#key-${id}`).value; if (!apiKey) return;
  await fetch(`/api/providers/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
  CFG = await (await fetch("/api/config")).json(); renderMissq();
};
window.testKey = async (id) => {
  const el = $(`#test-${id}`); el.textContent = "testing…";
  const r = await (await fetch(`/api/providers/${id}/test`, { method: "POST" })).json();
  el.innerHTML = r.ok ? `<span style="color:var(--ansr-teal)">✓ ${esc(r.detail || "")}</span>` : `<span style="color:var(--ansr-orange-deep)">✗ ${esc(r.detail || "")}</span>`;
};
window.applyAll = async () => {
  const [provider, model] = ($("#defModel").value || "").split("::");
  const r = await (await fetch("/api/pipelines/default", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model }) })).json();
  $("#applyMsg").textContent = `applied to ${r.applied ?? 0} pipelines ✓`;
};

// ---- Integrations (Google + third-party — wire-ready placeholders) ----------
const INTEGRATIONS = [
  { group: "Google", items: [
    ["Gmail", "read + send mail, thread context for MissQ", "✉️"],
    ["Calendar", "book / move / cancel meetings", "📅"],
    ["Drive", "pull docs into the vault", "🗂️"],
    ["Sheets", "MIS export + import", "📊"],
    ["Contacts", "sync people into accounts", "👥"],
  ] },
  { group: "Workspace / SSO", items: [
    ["Google SSO", "sign in with a workspace domain", "🔐"],
  ] },
  { group: "Messaging", items: [
    ["Slack", "notifications + MissQ commands", "💬"],
    ["WhatsApp", "client comms", "🟢"],
  ] },
];
function renderIntegrations() {
  $("#integrations").innerHTML = INTEGRATIONS.map((g) => `
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 8px">${esc(g.group)}</h3>
      <div class="agents" style="grid-template-columns:1fr 1fr;gap:10px">
        ${g.items.map(([name, desc, ic]) => `
          <div class="agent coming">
            <div class="badge">${ic}</div>
            <div style="flex:1"><div class="nm"><b>${esc(name)}</b><span class="chip chip--draft" style="margin-left:auto">coming soon</span></div>
              <p class="blurb">${esc(desc)}</p></div>
            <button class="btn btn--ghost" disabled style="align-self:center">Connect</button>
          </div>`).join("")}
      </div>
    </div>`).join("") + `
    <p class="lbl" style="color:var(--ansr-gray)">Ports from the TKB-Admin integration panels (Google OAuth + connectors). Needs a Google OAuth client (id/secret) configured in the Vault + a scope decision before wiring.</p>`;
}

function renderVault() {
  $("#vault").innerHTML = `
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">Document Vault <span class="chip chip--draft">coming soon</span></h3>
      <p class="lbl" style="color:var(--ansr-gray)">Same hybrid store as Mint — originals in a vault (T1), markdown extracts (T2), facts in Postgres (T3), served via the doc×api switch. RayDar's vault will hold account docs + integration exports with provenance back to source.</p>
      <div class="chips" style="margin-top:8px">${["originals", "md extracts", "provider keys (encrypted)", "audit trail"].map((s) => `<span class="chip">${s}</span>`).join("")}</div>
    </div>`;
}
function renderAccounts() {
  $("#accounts").innerHTML = `
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">Accounts <span class="chip chip--draft">coming soon</span></h3>
      <p class="lbl" style="color:var(--ansr-gray)">Accounts + teams + roles for the new agent — each account carries its own integration connections, vault and MissQ context. Ports from TKB-Admin users/RBAC.</p>
    </div>`;
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("active"); tab.setAttribute("aria-selected", "true");
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = true));
    $(`#pane-${tab.dataset.tab}`).hidden = false;
  }));
}
load();
