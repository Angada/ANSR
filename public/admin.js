// Admin — AI Skills & Pipelines.
// Connectors row (all providers) → pipelines grouped by product → each AI gate
// with provider/model dropdowns + enable + editable prompt.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
let CFG = null;

async function load() {
  CFG = await (await fetch("/api/config")).json();
  renderDefaultAll(); renderSkillFilter(); renderProducts();
  renderIntegrations(); renderVault(); renderAccounts(); wireTabs();
}
// default provider·model applied to every skill
function renderDefaultAll() {
  const sel = document.getElementById("defAll"); if (!sel || !CFG) return;
  sel.innerHTML = Object.entries(CFG.providers).flatMap(([id, p]) => (p.models || []).map((m) => `<option value="${id}::${m}">${esc(p.label)} · ${m}</option>`)).join("");
  // which app to re-route — applying to every product at once is rarely what
  // anyone means by "apply to all"
  const host = document.getElementById("defProd");
  if (host) {
    const counts = {};
    Object.values(CFG.pipelines || {}).forEach((p) => { if (p.kind !== "deterministic") counts[p.product || "—"] = (counts[p.product || "—"] || 0) + 1; });
    host.innerHTML = `<option value="">Every product · ${Object.values(counts).reduce((a, b) => a + b, 0)} skills</option>`
      + Object.entries(counts).sort().map(([prod, n]) => `<option value="${esc(prod)}">${esc(prod)} · ${n} skills</option>`).join("");
  }
}
window.applyAllDefault = async () => {
  const [provider, model] = (document.getElementById("defAll").value || "").split("::");
  const product = (document.getElementById("defProd") || {}).value || "";
  const r = await (await fetch("/api/pipelines/default", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model, product }) })).json();
  const skipped = (r.skipped || []).length;
  document.getElementById("defMsg").textContent =
    `applied to ${r.applied ?? 0} skill${r.applied === 1 ? "" : "s"} in ${r.product} ✓`
    + (skipped ? ` · ${skipped} kept their own model (vision & embeddings cannot run a chat model)` : "");
  CFG = await (await fetch("/api/config")).json(); renderProducts();
};

// ---- Business rules have MOVED into each app (RayDar → its Business rules tab;
// Q-Legal → Governance → Business rules). Admin keeps Vault/pipelines/keys only.
let RULES = null, RULE_APP = "All";
async function renderRules() {
  const host = document.getElementById("rules"); if (!host) return;
  if (!RULES) RULES = (await (await fetch("/api/wh/rules")).json()).rules || {};
  const cfg = CFG || (CFG = await (await fetch("/api/config")).json());
  const apps = ["All", ...new Set(Object.values(RULES).map((r) => r.app || "Other"))];
  const modelOpts = `<option value="">Default (pipeline model)</option>` + Object.entries(cfg.providers).flatMap(([id, p]) => (p.models || []).map((m) => `<option value="${id}::${m}">${p.label} · ${m}</option>`)).join("");
  const shown = Object.entries(RULES).filter(([, r]) => RULE_APP === "All" || (r.app || "Other") === RULE_APP);
  const CAT_LABEL = { guardrails: "Guardrails — audience · language · region (prepended to every idea)", journey: "Journey steps — the Hunger routes", integration: "Integrations — external APIs (query + prompt + gate)", scoring: "Scoring — composite rank weights + gap map" };
  const CAT_ORDER = ["guardrails", "journey", "integration", "scoring"];
  const byCat = {}; for (const e of shown) (byCat[e[1].category || "other"] ||= []).push(e);
  const ruleCard = ([id, r]) => `
    <section class="pipe" data-rule="${id}">
      <div class="pipe-head" onclick="this.parentElement.classList.toggle('open')">
        <b>${id}</b>
        <span class="chip chip--role">${esc(r.app || "Other")}</span>
        <span class="chip">${esc(r.pipeline || "")}</span>
        <span class="chip ${r.model ? "chip--approved" : "chip--draft"}">${r.model ? esc(r.model.split("::")[1] || r.model) : "default model"}</span>
        <span class="chip ${r.enabled ? "chip--approved" : "chip--draft"}" style="margin-left:auto">${r.enabled ? "on" : "off"}</span>
        <span class="caret">⌄</span>
      </div>
      <div class="pipe-body">
        <label class="lbl">${r.category === "scoring" ? "Weights + gap map (JSON — drives the rank)" : "Query / collection rules (how we call it)"}</label>
        <textarea id="rc-${id}" rows="${r.category === "scoring" ? 9 : 4}" style="font-family:ui-monospace,monospace;font-size:12px">${esc(JSON.stringify(r.collection || {}, null, 2))}</textarea>
        <label class="lbl" style="margin-top:8px">Processing prompt${r.category === "integration" ? " (classify — every call to this API runs through it)" : ""}</label>
        <textarea id="rp-${id}" rows="3">${esc(r.prompt || "")}</textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">
          <div style="flex:1;min-width:200px"><label class="lbl">Model</label><select id="rm-${id}">${modelOpts.replace(`value="${r.model || ""}"`, `value="${r.model || ""}" selected`)}</select></div>
          <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="re-${id}" ${r.enabled ? "checked" : ""} style="width:auto;min-height:auto"> Enabled (gate)</label>
          <button class="btn" onclick="saveRule('${id}')">Save</button>
          <span id="rmsg-${id}" class="lbl"></span>
        </div>
      </div>
    </section>`;
  host.innerHTML = `<p class="lbl" style="color:var(--ansr-gray)">Every journey step, external API and the scoring model — its query params, the AI prompt each call runs through, its model and gate. All config, no deploy. All RayDar calls are channelled through these.</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 12px">
      <label class="lbl">App</label>
      <select id="ruleApp" onchange="setRuleApp(this.value)" style="max-width:200px">${apps.map((a) => `<option ${a === RULE_APP ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
      <span class="lbl">${shown.length} rule${shown.length === 1 ? "" : "s"}</span>
    </div>` +
    CAT_ORDER.filter((c) => byCat[c]).map((c) =>
      `<div class="grp" style="color:var(--ansr-navy);font-weight:600;margin:18px 0 8px">${esc(CAT_LABEL[c] || c)} <span class="lbl" style="font-weight:400">· ${byCat[c].length}</span></div>` +
      byCat[c].map(ruleCard).join("")).join("");
}
window.setRuleApp = (a) => { RULE_APP = a; renderRules(); };
window.saveRule = async (id) => {
  let collection = {}; try { collection = JSON.parse(document.getElementById(`rc-${id}`).value || "{}"); } catch { document.getElementById(`rmsg-${id}`).textContent = "invalid JSON in collection rules"; return; }
  const body = { collection, prompt: document.getElementById(`rp-${id}`).value, model: document.getElementById(`rm-${id}`).value, enabled: document.getElementById(`re-${id}`).checked };
  const r = await fetch(`/api/wh/rules/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  document.getElementById(`rmsg-${id}`).textContent = r.ok ? "saved ✓" : "error";
  RULES = null; renderRules();
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
        <b>${ic(it.id)} ${esc(it.label)}</b>
        ${(it.apps || []).map((a) => `<span class="chip chip--role">${esc(a)}</span>`).join("")}
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
  host.innerHTML = `<p class="lbl" style="color:var(--ansr-gray)">Every external integration lives here — YouTube, Reddit, research &amp; validation APIs. Each carries an <b>app tag</b> (which app needs it, e.g. <span class="chip chip--role">RayDar</span>). Keys are stored AES-encrypted; how each is queried is set per app in <b>Business Rules</b>.</p>` +
    Object.entries(byCat).map(([cat, items]) => `
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
  if (el) el.innerHTML = r.ok ? `<span style="color:var(--ansr-teal)">${ic("check")} ${esc(r.detail)}${r.ms ? " · " + r.ms + "ms" : ""}</span>` : `<span style="color:var(--ansr-orange-deep)">${ic("x")} ${esc(r.detail)}</span>`;
};
// Vault — BYOK AI provider keys (AES-256-GCM encrypted, never displayed).
function renderVault() {
  const host = document.getElementById("vault"); if (!host || !CFG) return;
  const rows = Object.entries(CFG.providers || {}).map(([id, p]) => `
    <div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--ansr-border);flex-wrap:wrap">
      <div style="flex:1;min-width:150px"><b style="color:var(--ansr-navy)">${esc(p.label || id)}</b>
        ${p.hasKey ? `<span class="chip chip--approved">connected ${esc(p.keyHint || "")}</span>` : `<span class="chip chip--draft">not set</span>`}
        <span class="lbl" style="display:block;font-size:11px;color:var(--ansr-gray-mid)">${(p.models || []).length} models</span></div>
      <input type="password" id="vk-${id}" placeholder="paste API key" style="max-width:260px">
      <button class="btn btn--ghost" onclick="vaultSave('${id}')">Save</button>
      <button class="btn btn--ghost" onclick="vaultTest('${id}')">Test</button>
      <span id="vt-${id}" class="lbl"></span>
    </div>`).join("");
  host.innerHTML = `
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 4px">Vault · BYOK AI keys</h3>
      <p class="lbl" style="color:var(--ansr-gray);margin:0 0 8px">AES-256-GCM encrypted at rest — only a ····last-4 hint is ever shown; the key never leaves the server.</p>
      ${rows}
      <p class="lbl" style="color:var(--ansr-gray);margin-top:10px">⊟ Keys route every AI skill (see <b>AI Skills</b>). Integration keys (YouTube/Reddit/Tavily…) live in <b>Integrations</b>.</p>
    </div>
    <div class="band grad-soft">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 4px">Document Vault <span class="chip chip--draft">hybrid store</span></h3>
      <p class="lbl" style="color:var(--ansr-gray)">Originals (T1) · markdown extracts (T2) · facts in Postgres (T3), served via the doc×api switch — every number traces back to source.</p>
      <div class="chips" style="margin-top:8px">${["originals", "md extracts", "facts (Postgres)", "encrypted keys", "audit trail"].map((s) => `<span class="chip">${s}</span>`).join("")}</div>
    </div>`;
}
window.vaultSave = async (id) => { const apiKey = document.getElementById(`vk-${id}`)?.value; if (!apiKey) return; await fetch(`/api/providers/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) }); CFG = await (await fetch("/api/config")).json(); renderVault(); renderProducts(); };
window.vaultTest = async (id) => { const el = document.getElementById(`vt-${id}`); if (el) el.textContent = "…"; const r = await (await fetch(`/api/providers/${id}/test`, { method: "POST" })).json(); if (el) el.innerHTML = r.ok ? `<span style="color:var(--ansr-teal)">${ic("check")} ${esc(r.detail || "")}</span>` : `<span style="color:var(--ansr-orange-deep)">${ic("x")} ${esc(r.detail || "")}</span>`; };
function renderAccounts() {
  const host = document.getElementById("accounts"); if (!host) return;
  host.innerHTML = `
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">Accounts &amp; roles <span class="chip chip--draft">coming soon</span></h3>
      <p class="lbl" style="color:var(--ansr-gray)">Accounts + teams + roles — each account carries its own integration connections, vault and AI context. Ports from the TKB-Admin users/RBAC.</p>
    </div>`;
}

// short AI write-up (the full mapping lives in Pipelines by product below)
async function renderAiWriteup() {
  const { pipelines } = await (await fetch("/api/ai/map")).json();
  const n = pipelines.length, llm = pipelines.filter((p) => p.kind !== "deterministic").length;
  $("#aiwrite").innerHTML = `
    <div class="band grad-accent">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 4px">All the AI in Q&amp;ANSR</h3>
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
  el.innerHTML = r.ok ? `<span style="color:var(--ansr-teal)">${ic("check")} ${r.detail}${r.ms ? " · " + r.ms + "ms" : ""}</span>` : `<span style="color:var(--ansr-orange-deep)">${ic("x")} ${r.detail}</span>`;
};

window.makeDefault = async (id) => {
  const model = $(`#def-${id}`).value;
  const r = await (await fetch(`/api/pipelines/default`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: id, model }) })).json();
  $(`#def-msg-${id}`).textContent = `applied to ${r.applied} journeys ✓`;
  CFG = await (await fetch("/api/config")).json(); renderProducts();
};

// ---- pipelines grouped by product ----
// AI Skills — grouped by product; each skill a card with capability · routing ·
// prompt · gate (TKB "AI Skills" design). Every pipeline behind the app appears.
const LOCKED_PIPELINES = new Set(["qlegal-embed", "atlas-embed"]);
const CAP_COLOR = { deterministic: "#8a8a8a", llm: "#c0392b", hybrid: "#0a7d78" };
let SKILL_FILTER = "All";
const PROD_ORDER = ["RayDar", "Mint", "Atlas"];
function pipeGroups() {
  const raw = {};
  for (const p of Object.values(CFG.pipelines)) (raw[p.product || "Other"] ||= []).push(p);
  const ordered = {};
  for (const k of PROD_ORDER) if (raw[k]) ordered[k] = raw[k];
  for (const k of Object.keys(raw)) if (!ordered[k]) ordered[k] = raw[k];
  return ordered;
}
// Agent filter boxes — one per product; click to show only that agent's skills.
function renderSkillFilter() {
  const host = document.getElementById("skillFilter"); if (!host) return;
  const groups = pipeGroups();
  const total = Object.values(CFG.pipelines).length;
  const boxes = [["All", total], ...Object.entries(groups).map(([p, arr]) => [p, arr.length])];
  host.innerHTML = boxes.map(([name, n]) =>
    `<button class="agentbox ${SKILL_FILTER === name ? "on" : ""}" onclick="setSkillFilter('${esc(name).replace(/'/g, "\\'")}')">
       <span class="ab-name">${esc(name)}</span><span class="ab-n">${n} skills</span>
     </button>`).join("");
}
window.setSkillFilter = (name) => { SKILL_FILTER = name; renderSkillFilter(); renderProducts(); };
function renderProducts() {
  const groups = pipeGroups();
  const shown = Object.entries(groups).filter(([prod]) => SKILL_FILTER === "All" || prod === SKILL_FILTER);
  $("#products").innerHTML = shown.map(([prod, pipes]) =>
    `<div class="grp" style="color:var(--ansr-navy);font-weight:600;margin:18px 0 6px">${esc(prod)} <span class="lbl" style="font-weight:400">· ${pipes.length} skills</span></div>` +
    pipes.map(skillCard).join("")).join("");
}
function skillCard(p) {
  const det = p.kind === "deterministic";
  const prov = CFG.providers[p.provider] || {};
  const cap = CAP_COLOR[p.kind] || "#888";
  // The embedding step is not routable: see the server's EMBED_LOCK. Offering a
  // dropdown the server will refuse is worse than showing the lock.
  const locked = LOCKED_PIPELINES.has(p.id);
  const provOpts = Object.entries(CFG.providers).map(([id, pr]) => `<option value="${id}" ${p.provider === id ? "selected" : ""}>${esc(pr.label)}${pr.hasKey ? "" : " · no key"}</option>`).join("");
  const modelOpts = (prov.models || []).map((m) => `<option ${p.model === m ? "selected" : ""}>${m}</option>`).join("");
  const resolved = det ? "deterministic — no model call"
    : (prov.hasKey ? `now → <b>${esc(prov.label)} · ${esc(p.model || "—")}</b>` : `<span style="color:var(--ansr-orange-deep)">no key for ${esc(prov.label || "provider")} — add it in Vault</span>`);
  return `<div class="band" data-skl="${p.id}" style="margin-bottom:8px;padding:14px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px">
        <b style="color:var(--ansr-navy)">${esc(p.name)}</b>
        <span class="chip" title="capability" style="background:${cap}1a;color:${cap}">${esc(p.kind)}</span>
        <span class="chip ${p.enabled ? "chip--approved" : "chip--draft"}">${p.enabled ? "gate on" : "off"}</span>
        <div class="lbl" style="margin-top:2px">${esc(p.description || "")}</div>
        <div class="lbl" style="margin-top:2px">${resolved}</div>
      </div>
      ${det ? "" : locked ? `
        <span class="chip" title="Every stored vector lives in this model's space. Swapping the model does not re-embed anything — it leaves the estate answering with meaningless similarity. Changing it safely means a deliberate re-embed of the whole corpus."
          style="background:#EEF1F4;color:#44505C;font-weight:600">🔒 locked · ${esc(p.provider)} · ${esc(p.model)}</span>` : `
        <select class="sk-prov" style="max-width:160px" onchange="skSync('${p.id}')">${provOpts}</select>
        <select class="sk-model" style="max-width:180px">${modelOpts}</select>
        <a class="lbl sk-pe" style="cursor:pointer;font-weight:600;color:var(--ansr-orange)" onclick="skPrompt('${p.id}')">prompt ▾</a>`}
    </div>
    <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center">${(p.skills || []).map((s, i) => `${i ? '<span style="color:var(--ansr-gray-mid)">→</span>' : ""}<span class="chip" style="font-size:11px">${esc(s)}</span>`).join("")}</div>
    ${det ? "" : `<div class="sk-pwrap" id="pw-${p.id}" style="display:none;margin-top:8px"><textarea id="prompt-${p.id}" rows="3" placeholder="System prompt (blank = built-in default)">${(p.prompt || "").replace(/</g, "&lt;")}</textarea></div>`}
    <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
      <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="en-${p.id}" ${p.enabled ? "checked" : ""} style="width:auto;min-height:auto"> Gate enabled</label>
      <button class="btn" style="margin-left:auto" onclick="savePipeline('${p.id}', ${det})">Save</button>
      <span id="msg-${p.id}" class="lbl"></span>
    </div>
  </div>`;
}
window.skSync = (id) => { const card = document.querySelector(`[data-skl="${id}"]`); const prov = card.querySelector(".sk-prov").value; card.querySelector(".sk-model").innerHTML = ((CFG.providers[prov]?.models) || []).map((m) => `<option>${m}</option>`).join(""); };
window.skPrompt = (id) => { const w = document.getElementById(`pw-${id}`); w.style.display = w.style.display === "none" ? "block" : "none"; };

window.savePipeline = async (id, det) => {
  const card = document.querySelector(`[data-skl="${id}"]`);
  const body = { enabled: document.getElementById(`en-${id}`).checked };
  // A locked step (embeddings) renders no selectors — read them and this throws,
  // and sending its provider/model would be refused anyway. Only the gate saves.
  if (!det && !LOCKED_PIPELINES.has(id)) {
    body.provider = card.querySelector(".sk-prov").value;
    body.model = card.querySelector(".sk-model").value;
    body.prompt = document.getElementById(`prompt-${id}`)?.value ?? "";
  }
  const r = await fetch(`/api/pipelines/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  document.getElementById(`msg-${id}`).textContent = r.ok ? "saved ✓" : (j.error || "error");
  CFG = await (await fetch("/api/config")).json(); renderProducts();
};

function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("active"); tab.setAttribute("aria-selected", "true");
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = true));
    const pane = $(`#pane-${tab.dataset.tab}`); pane.hidden = false;
    if (tab.dataset.tab === "audit") loadAudit();
    // re-fire fade-in for any image revealed in this pane
    pane.querySelectorAll(".fade-in").forEach((el) => { el.classList.remove("fade-in"); void el.offsetWidth; el.classList.add("fade-in"); });
  }));
}

load();

// ==========================================================================
// AUDIT — every state-changing action across every app: who, what, when,
// from where, how long it took, and what came back. Written automatically by
// the server for EVERY api write plus every Ask/search query, so coverage does
// not depend on anyone remembering to log. Append-only; nothing here is
// editable from the UI by design.
// ==========================================================================

// Plain English — an endpoint like "POST /api/wh/journey/12/promote" tells an
// engineer everything and a reader nothing. This turns each row into a sentence
// a non-technical person can audit without asking what it means.
const AU_SAY = [
  [/\/api\/login/i,                 (r) => `Signed in`],
  [/\/api\/logout/i,                () => `Signed out`],
  [/\/api\/wh\/batch\b/i,           () => `Started a new sweep (a fresh batch of content ideas)`],
  [/\/api\/wh\/feedstories/i,       () => `Generated content ideas for a sweep`],
  [/\/api\/wh\/feedstory\/\d+\/action/i, (r) => { const a=(r.detail||{}).action; return a==='used'?`Marked an idea as USED`:a==='saved'?`Saved an idea for later`:a==='rejected'?`Rejected an idea${(r.detail||{}).reason?` — "${(r.detail).reason}"`:''}`:a==='edit'?`Edited an idea's heading`:a==='delete'?`Deleted an idea`:`Updated an idea (${a||'action'})`; }],
  [/\/api\/wh\/seo\/upload/i,      () => `Uploaded SEO research (Excel/CSV)`],
  [/\/api\/wh\/seo\b/i,            (r) => r.method==='POST'?`Pasted SEO research into the sweep`:`Removed an SEO research input`],
  [/\/api\/wh\/theme\/compile/i,   () => `Asked RayDar to work out the search logic for a theme`],
  [/\/api\/wh\/theme\/save/i,      (r) => `Saved a content theme${(r.detail||{}).name?` — "${(r.detail).name}"`:''}`],
  [/\/api\/wh\/topic\b/i,          () => `Edited a demand concept`],
  [/\/api\/wh\/rules\//i,          (r) => `Changed a business rule (${(r.path||'').split('/').pop()})`],
  [/\/api\/wh\/journey/i,           () => `Moved a topic through the journey`],
  [/\/api\/integrations\/[^/]+\/test/i, () => `Tested an integration key`],
  [/\/api\/integrations/i,           (r) => `Updated an integration${(r.path||'').split('/').pop()?` — ${(r.path).split('/').pop()}`:''}`],
  [/\/api\/pipelines\/default/i,    () => `Applied one AI model across every pipeline`],
  [/\/api\/pipelines/i,              () => `Changed an AI pipeline (model, prompt or gate)`],
  [/\/api\/config/i,                 () => `Changed platform configuration`],
  [/\/api\/qlegal\/ask/i,           (r) => `Asked the legal repository a question${(r.detail||{}).question?`: "${(r.detail).question}"`:''}`],
  [/\/api\/qlegal\/sync/i,          () => `Ran a SharePoint sync`],
  [/\/api\/qlegal/i,                 () => `Worked in the legal repository`],
  [/\/api\/contra/i,                 () => `Worked in contract review`],
  [/\/api\/mint|\/api\/roster|\/api\/runs/i, () => `Worked in Mint (AR reconciliation)`],
  [/\/api\/upload/i,                 () => `Uploaded a document`],
];
function auSay(r) {
  if (r.action === 'query') return `Searched / asked a question`;
  for (const [re, fn] of AU_SAY) if (re.test(r.path || '')) { try { return fn(r); } catch { /* fall through */ } }
  const verb = r.method === 'DELETE' ? 'Deleted' : r.method === 'PUT' || r.method === 'PATCH' ? 'Updated' : 'Changed';
  return `${verb} ${(r.path || '').replace('/api/', '').replace(/\//g, ' › ')}`;
}

let AU = { app: "all", actor: "all", q: "", limit: 200 };
const auEsc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const auDT = (ts) => { if (!ts) return ""; const p = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(ts)).reduce((a, x) => ((a[x.type] = x.value), a), {}); return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`; };

async function loadAudit() {
  const host = document.getElementById("audit"); if (!host) return;
  host.innerHTML = `<p class="muted">Loading the activity record…</p>`;
  const qs = new URLSearchParams();
  if (AU.app !== "all") qs.set("app", AU.app);
  if (AU.actor !== "all") qs.set("actor", AU.actor);
  if (AU.q) qs.set("q", AU.q);
  qs.set("limit", AU.limit);
  let d; try { d = await (await fetch(`/api/audit?${qs}`)).json(); } catch { d = null; }
  if (!d || d.error) { host.innerHTML = `<p class="muted">Could not load the audit trail${d?.error ? ` — ${auEsc(d.error)}` : ""}.</p>`; return; }
  const apps = ["all", ...(d.facets?.apps || [])], actors = ["all", ...(d.facets?.actors || [])];
  const sel = (label, cur, opts, fn) => `<label class="au-f"><span>${label}</span>
    <select onchange="${fn}(this.value)">${opts.map((o) => `<option ${cur === o ? "selected" : ""}>${auEsc(o)}</option>`).join("")}</select></label>`;
  host.innerHTML = `
    <p class="muted">Every state-changing action across every app — who did it, when, from where, and what came back. Written automatically by the server; append-only and not editable here. Times are IST.</p>
    <div class="au-bar">
      ${sel("App", AU.app, apps, "auSetApp")}
      ${sel("User", AU.actor, actors, "auSetActor")}
      <label class="au-f"><span>Search</span><input value="${auEsc(AU.q)}" placeholder="path or detail…" onchange="auSetQ(this.value)"></label>
      ${sel("Rows", String(AU.limit), ["100", "200", "500", "1000"], "auSetLimit")}
      <span class="au-n">${(d.rows || []).length} shown${d.facets?.total ? ` of ${d.facets.total} recorded` : ""}</span>
      <button class="btn btn--ghost" onclick="loadAudit()">Refresh</button>
    </div>
    <div class="au-wrap"><table class="au">
      <thead><tr><th>When (IST)</th><th>Who</th><th>App</th><th>Action</th><th>What happened</th><th>Endpoint</th><th>Result</th></tr></thead>
      <tbody>${(d.rows || []).map((r) => `<tr class="${r.status >= 400 ? "au-bad" : ""}">
        <td class="au-t">${auDT(r.at)}</td>
        <td><b>${auEsc(r.actor)}</b>${r.role ? `<span class="au-r">${auEsc(r.role)}</span>` : ""}</td>
        <td><span class="au-app">${auEsc(r.app || "—")}</span></td>
        <td>${auEsc(r.action || "")}</td>
        <td class="au-say">${auEsc(auSay(r))}${r.detail && Object.keys(r.detail).length ? `<span class="au-d">${auEsc(JSON.stringify(r.detail)).slice(0, 160)}</span>` : ""}</td>
        <td class="au-p"><span class="au-m">${auEsc(r.method)}</span> ${auEsc(r.path)}</td>
        <td>${r.status}${r.ms != null ? ` <span class="au-ms">${r.ms}ms</span>` : ""}</td>
      </tr>`).join("") || `<tr><td colspan="7" class="muted">No activity matches these filters.</td></tr>`}</tbody>
    </table></div>`;
}
window.auSetApp = (v) => { AU.app = v; loadAudit(); };
window.auSetActor = (v) => { AU.actor = v; loadAudit(); };
window.auSetQ = (v) => { AU.q = v.trim(); loadAudit(); };
window.auSetLimit = (v) => { AU.limit = Number(v) || 200; loadAudit(); };
