// Admin — AI Skills & Pipelines.
// Connectors row (all providers) → pipelines grouped by product → each AI gate
// with provider/model dropdowns + enable + editable prompt.
const $ = (s, r = document) => r.querySelector(s);
let CFG = null;

async function load() {
  CFG = await (await fetch("/api/config")).json();
  renderAiWriteup(); renderConnectors(); renderProducts();
  renderIntegrations(); renderRules(); renderVault(); renderAccounts(); wireTabs();
}

// ---- Business Rules: per-integration collection rules + prompt + model gate ---
async function renderRules() {
  const host = document.getElementById("rules"); if (!host) return;
  const { rules } = await (await fetch("/api/wh/rules")).json();
  const cfg = CFG || (CFG = await (await fetch("/api/config")).json());
  const modelOpts = `<option value="">Default (pipeline model)</option>` + Object.entries(cfg.providers).flatMap(([id, p]) => (p.models || []).map((m) => `<option value="${id}::${m}">${p.label} · ${m}</option>`)).join("");
  host.innerHTML = `<p class="lbl" style="color:var(--ansr-gray)">How RayDar queries each external API (business rules), the AI prompt that processes it, its model (default pipeline model or a custom one), and the gate. All config — no deploy needed.</p>` +
    Object.entries(rules || {}).map(([id, r]) => `
    <section class="pipe" data-rule="${id}">
      <div class="pipe-head" onclick="this.parentElement.classList.toggle('open')">
        <b>${id}</b>
        <span class="chip">${esc(r.pipeline || "")}</span>
        <span class="chip ${r.model ? "chip--approved" : "chip--draft"}">${r.model ? esc(r.model.split("::")[1] || r.model) : "default model"}</span>
        <span class="chip ${r.enabled ? "chip--approved" : "chip--draft"}" style="margin-left:auto">${r.enabled ? "on" : "off"}</span>
        <span class="caret">⌄</span>
      </div>
      <div class="pipe-body">
        <label class="lbl">Collection rules (how we query it)</label>
        <textarea id="rc-${id}" rows="4" style="font-family:ui-monospace,monospace;font-size:12px">${esc(JSON.stringify(r.collection || {}, null, 2))}</textarea>
        <label class="lbl" style="margin-top:8px">Processing prompt</label>
        <textarea id="rp-${id}" rows="3">${esc(r.prompt || "")}</textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">
          <div style="flex:1;min-width:200px"><label class="lbl">Model</label><select id="rm-${id}">${modelOpts.replace(`value="${r.model || ""}"`, `value="${r.model || ""}" selected`)}</select></div>
          <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="re-${id}" ${r.enabled ? "checked" : ""} style="width:auto;min-height:auto"> Enabled (gate)</label>
          <button class="btn" onclick="saveRule('${id}')">Save</button>
          <span id="rmsg-${id}" class="lbl"></span>
        </div>
      </div>
    </section>`).join("");
}
window.saveRule = async (id) => {
  let collection = {}; try { collection = JSON.parse(document.getElementById(`rc-${id}`).value || "{}"); } catch { document.getElementById(`rmsg-${id}`).textContent = "invalid JSON in collection rules"; return; }
  const body = { collection, prompt: document.getElementById(`rp-${id}`).value, model: document.getElementById(`rm-${id}`).value, enabled: document.getElementById(`re-${id}`).checked };
  const r = await fetch(`/api/wh/rules/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  document.getElementById(`rmsg-${id}`).textContent = r.ok ? "saved ✓" : "error";
  renderRules();
};

// ---- RayDar admin: Integrations (key-based) + Vault + Accounts ---------------
// Real connectable integrations for the Whisperer supply / research / validation
// side (YouTube, Reddit, Perplexity, Tavily, Serper…). Google stays OAuth (soon).
let INTG = null;
async function renderIntegrations() {
  const host = document.getElementById("integrations"); if (!host) return;
  INTG = (await (await fetch("/api/integrations")).json()).integrations || {};
  const byCat = {};
  for (const it of Object.values(INTG)) (byCat[it.category] ||= []).push(it);
  const card = (it) => `
    <div class="pipe" data-intg="${it.id}">
      <div class="pipe-head" onclick="this.parentElement.classList.toggle('open')">
        <b>${it.icon || "🔌"} ${esc(it.label)}</b>
        <span class="chip ${it.hasKey ? "chip--approved" : "chip--draft"}" style="margin-left:auto">${it.auth === "none" ? "public" : it.hasKey ? "key " + esc(it.keyHint) : "no key"}</span>
        <span class="chip ${it.enabled ? "chip--approved" : "chip--draft"}">${it.enabled ? "on" : "off"}</span>
        <span class="caret">⌄</span>
      </div>
      <div class="pipe-body">
        <div class="lbl" style="margin-bottom:6px">${esc(it.hint || "")}</div>
        ${it.auth === "none" ? `<div class="lbl">No key needed.</div>` : `
          <input type="password" id="ik-${it.id}" placeholder="${it.auth === "pair" ? "client_id:client_secret" : "paste API key"} — stored encrypted">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">
            <button class="btn" onclick="saveIntg('${it.id}')">Save key</button>
            <button class="btn btn--ghost" onclick="testIntg('${it.id}')">Test</button>
            <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="ie-${it.id}" ${it.enabled ? "checked" : ""} onchange="toggleIntg('${it.id}')" style="width:auto;min-height:auto"> Enabled</label>
            <span id="it-${it.id}" class="lbl"></span>
          </div>`}
      </div>
    </div>`;
  host.innerHTML = Object.entries(byCat).map(([cat, items]) => `
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 8px">${esc(cat)}</h3>
      ${items.map(card).join("")}
    </div>`).join("") + `
    <div class="band grad-soft"><h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">Google (OAuth) <span class="chip chip--draft">coming soon</span></h3>
      <p class="lbl" style="color:var(--ansr-gray)">Gmail · Calendar · Drive · Sheets · SSO need a Google OAuth client (id/secret + redirect) — different flow from the API-key integrations above. Wire once the OAuth client is set.</p></div>`;
}
window.saveIntg = async (id) => {
  const apiKey = document.getElementById(`ik-${id}`)?.value; if (!apiKey) return;
  await fetch(`/api/integrations/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
  renderIntegrations();
};
window.toggleIntg = async (id) => {
  const enabled = document.getElementById(`ie-${id}`)?.checked;
  await fetch(`/api/integrations/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
};
window.testIntg = async (id) => {
  const el = document.getElementById(`it-${id}`); if (el) el.textContent = "testing…";
  const r = await (await fetch(`/api/integrations/${id}/test`, { method: "POST" })).json();
  if (el) el.innerHTML = r.ok ? `<span style="color:var(--ansr-teal)">✓ ${esc(r.detail)}${r.ms ? " · " + r.ms + "ms" : ""}</span>` : `<span style="color:var(--ansr-orange-deep)">✗ ${esc(r.detail)}</span>`;
};
function renderVault() {
  const host = document.getElementById("vault"); if (!host) return;
  host.innerHTML = `
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">Document Vault <span class="chip chip--draft">coming soon</span></h3>
      <p class="lbl" style="color:var(--ansr-gray)">The hybrid store — originals (T1) · markdown extracts (T2) · facts in Postgres (T3), served via the doc×api switch. Holds account docs, integration exports and encrypted provider/OAuth keys, with provenance back to source.</p>
      <div class="chips" style="margin-top:8px">${["originals", "md extracts", "provider keys (encrypted)", "OAuth tokens", "audit trail"].map((s) => `<span class="chip">${s}</span>`).join("")}</div>
    </div>`;
}
function renderAccounts() {
  const host = document.getElementById("accounts"); if (!host) return;
  host.innerHTML = `
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">Accounts &amp; roles <span class="chip chip--draft">coming soon</span></h3>
      <p class="lbl" style="color:var(--ansr-gray)">Accounts + teams + roles — each account carries its own integration connections, vault and MissQ context. Ports from the TKB-Admin users/RBAC.</p>
    </div>`;
}

// short AI write-up (the full mapping lives in Pipelines by product below)
async function renderAiWriteup() {
  const { pipelines } = await (await fetch("/api/ai/map")).json();
  const n = pipelines.length, llm = pipelines.filter((p) => p.kind !== "deterministic").length;
  $("#aiwrite").innerHTML = `
    <div class="band grad-accent">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 4px">✨ All the AI in Q&amp;ANSR</h3>
      <p class="lbl" style="color:var(--ansr-gray);font-size:13px;margin:0">${n} pipelines (${llm} model-backed, ${n - llm} deterministic). Every model call runs through a registered, gated pipeline — deterministic steps never call a model, and raw user text never reaches a provider outside an enabled <code>llm/hybrid</code> pipeline. Switch provider, model, prompt and skills per pipeline below.</p>
    </div>`;
}

// ---- AI connectors (scrollable chips row) ----
function renderConnectors() {
  $("#connectors").innerHTML = Object.entries(CFG.providers).map(([id, p]) => `
    <div class="conn" onclick="editKey('${id}')">
      <div class="cname">${p.label}</div>
      <div class="cstat lbl"><span class="dot ${p.hasKey ? "ok" : "no"}"></span>${p.hasKey ? "connected" : "no key"}</div>
      <div class="lbl" style="font-size:11px;color:var(--ansr-gray-mid);margin-top:4px">${p.models.length} models</div>
    </div>`).join("");
  $("#keyedit").innerHTML = "";
}

window.editKey = (id) => {
  const p = CFG.providers[id];
  const modelOpts = p.models.map((m) => `<option value="${m}">${m}</option>`).join("");
  $("#keyedit").innerHTML = `
    <div class="band" style="margin:10px 0 0">
      <div style="display:flex;justify-content:space-between;align-items:center"><strong style="color:var(--ansr-navy)">${p.label}</strong>
        <span class="chip ${p.hasKey ? "chip--approved" : "chip--draft"}">${p.hasKey ? "key " + p.keyHint : "no key"}</span></div>
      <input type="password" id="key-${id}" placeholder="paste ${p.label} key — stored encrypted" style="margin-top:8px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="btn" onclick="saveKey('${id}')">Save key</button>
        <button class="btn btn--ghost" onclick="testKey('${id}')">Test connection</button>
        <span id="test-${id}" class="lbl" style="align-self:center"></span>
      </div>
      <div style="border-top:1px solid var(--ansr-border);margin-top:12px;padding-top:10px">
        <label class="lbl">Make default · apply to all journeys</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          <select id="def-${id}" style="flex:1;min-width:140px">${modelOpts}</select>
          <button class="btn" onclick="makeDefault('${id}')">Apply to all</button>
        </div>
        <span id="def-msg-${id}" class="lbl"></span>
      </div>
    </div>`;
};

window.saveKey = async (id) => {
  const apiKey = $(`#key-${id}`).value; if (!apiKey) return;
  await fetch(`/api/providers/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
  CFG = await (await fetch("/api/config")).json(); renderConnectors(); editKey(id);
};

window.testKey = async (id) => {
  const el = $(`#test-${id}`); el.textContent = "testing…";
  const r = await (await fetch(`/api/providers/${id}/test`, { method: "POST" })).json();
  el.innerHTML = r.ok ? `<span style="color:var(--ansr-teal)">✓ ${r.detail}${r.ms ? " · " + r.ms + "ms" : ""}</span>` : `<span style="color:var(--ansr-orange-deep)">✗ ${r.detail}</span>`;
};

window.makeDefault = async (id) => {
  const model = $(`#def-${id}`).value;
  const r = await (await fetch(`/api/pipelines/default`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: id, model }) })).json();
  $(`#def-msg-${id}`).textContent = `applied to ${r.applied} journeys ✓`;
  CFG = await (await fetch("/api/config")).json(); renderProducts();
};

// ---- pipelines grouped by product ----
function renderProducts() {
  const groups = {};
  for (const p of Object.values(CFG.pipelines)) (groups[p.product || "Other"] ||= []).push(p);
  $("#products").innerHTML = Object.entries(groups).map(([prod, pipes]) => `
    <details class="band grad-soft" open style="padding:0">
      <summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:14px 16px;min-height:44px">
        <span class="chip chip--role">${prod}</span>
        <span class="lbl" style="color:var(--ansr-gray)">${pipes.length} pipelines</span>
        <span class="caret" style="margin-left:auto;color:var(--ansr-gray-mid)">⌄</span>
      </summary>
      <div style="padding:0 16px 14px">${pipes.map(pipeHtml).join("")}</div>
    </details>`).join("");
}

function pipeHtml(p) {
  const det = p.kind === "deterministic";
  const provLabel = CFG.providers[p.provider]?.label || "—";
  const provOpts = Object.entries(CFG.providers).map(([id, pr]) => `<option value="${id}" ${p.provider === id ? "selected" : ""}>${pr.label}</option>`).join("");
  const models = (CFG.providers[p.provider]?.models) || [];
  const modelOpts = models.map((m) => `<option value="${m}" ${p.model === m ? "selected" : ""}>${m}</option>`).join("");
  return `
  <section class="pipe" data-id="${p.id}">
    <div class="pipe-head" onclick="this.parentElement.classList.toggle('open')">
      <b>${p.name}</b>
      <span class="chip ${det ? "chip--draft" : "chip--approved"}">${p.kind}</span>
      ${det ? "" : `<span class="chip">${provLabel} · ${p.model || "—"}</span>`}
      <span class="chip ${p.enabled ? "chip--approved" : "chip--draft"}" style="margin-left:auto">${p.enabled ? "gate on" : "off"}</span>
      <span class="caret">⌄</span>
    </div>
    <div class="pipe-body">
      <div class="lbl" style="margin-bottom:6px">${p.description}</div>
      <div class="chips" style="margin-bottom:10px">${(p.skills || []).map((s) => `<span class="chip">${s}</span>`).join("")}</div>
      ${det ? `<div class="lbl">Deterministic — no model call.</div>` : `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:130px"><label class="lbl">Provider</label>
            <select id="prov-${p.id}" onchange="syncModels('${p.id}')">${provOpts}</select></div>
          <div style="flex:1;min-width:130px"><label class="lbl">Model</label>
            <select id="model-${p.id}">${modelOpts}</select></div>
        </div>
        <details class="section" style="margin:10px 0 0"><summary>Edit prompt</summary>
          <div class="body"><textarea id="prompt-${p.id}" rows="4">${(p.prompt || "").replace(/</g, "&lt;")}</textarea></div></details>`}
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" id="en-${p.id}" ${p.enabled ? "checked" : ""} style="width:auto;min-height:auto"> Gate enabled</label>
      <button class="btn" style="margin-top:10px" onclick="savePipeline('${p.id}', ${det})">Save</button>
      <span id="msg-${p.id}" class="lbl" style="margin-left:8px"></span>
    </div>
  </section>`;
}

window.syncModels = (id) => {
  const prov = $(`#prov-${id}`).value;
  $(`#model-${id}`).innerHTML = ((CFG.providers[prov]?.models) || []).map((m) => `<option value="${m}">${m}</option>`).join("");
};

window.savePipeline = async (id, det) => {
  const body = { enabled: $(`#en-${id}`).checked };
  if (!det) { body.provider = $(`#prov-${id}`).value; body.model = $(`#model-${id}`).value; body.prompt = $(`#prompt-${id}`)?.value ?? ""; }
  const r = await fetch(`/api/pipelines/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  $(`#msg-${id}`).textContent = r.ok ? "saved ✓" : "error";
  CFG = await (await fetch("/api/config")).json();
};

function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("active"); tab.setAttribute("aria-selected", "true");
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = true));
    const pane = $(`#pane-${tab.dataset.tab}`); pane.hidden = false;
    // re-fire fade-in for any image revealed in this pane
    pane.querySelectorAll(".fade-in").forEach((el) => { el.classList.remove("fade-in"); void el.offsetWidth; el.classList.add("fade-in"); });
  }));
}

load();
