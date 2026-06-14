// Admin — AI Skills & Pipelines.
// Connectors row (all providers) → pipelines grouped by product → each AI gate
// with provider/model dropdowns + enable + editable prompt.
const $ = (s, r = document) => r.querySelector(s);
let CFG = null;

async function load() {
  CFG = await (await fetch("/api/config")).json();
  renderConnectors(); renderProducts(); wireTabs();
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
  $("#keyedit").innerHTML = `
    <div class="band" style="margin:10px 0 0">
      <div style="display:flex;justify-content:space-between"><strong style="color:var(--ansr-navy)">${p.label}</strong>
        <span class="chip ${p.hasKey ? "chip--approved" : "chip--draft"}">${p.hasKey ? "key " + p.keyHint : "no key"}</span></div>
      <div class="lbl" style="margin:8px 0 4px">models: ${p.models.join(", ")}</div>
      <input type="password" id="key-${id}" placeholder="paste ${p.label} key — stored encrypted">
      <button class="btn" style="margin-top:8px" onclick="saveKey('${id}')">Save key</button>
    </div>`;
};

window.saveKey = async (id) => {
  const apiKey = $(`#key-${id}`).value; if (!apiKey) return;
  await fetch(`/api/providers/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
  CFG = await (await fetch("/api/config")).json(); renderConnectors();
};

// ---- pipelines grouped by product ----
function renderProducts() {
  const groups = {};
  for (const p of Object.values(CFG.pipelines)) (groups[p.product || "Other"] ||= []).push(p);
  $("#products").innerHTML = Object.entries(groups).map(([prod, pipes]) => `
    <div class="band grad-soft">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="chip chip--role">${prod}</span>
        <span class="lbl" style="color:var(--ansr-gray)">${pipes.length} pipelines</span>
      </div>
      ${pipes.map(pipeHtml).join("")}
    </div>`).join("");
}

function pipeHtml(p) {
  const det = p.kind === "deterministic";
  const provOpts = Object.entries(CFG.providers).map(([id, pr]) => `<option value="${id}" ${p.provider === id ? "selected" : ""}>${pr.label}</option>`).join("");
  const models = (CFG.providers[p.provider]?.models) || [];
  const modelOpts = models.map((m) => `<option value="${m}" ${p.model === m ? "selected" : ""}>${m}</option>`).join("");
  return `
  <section class="section" data-id="${p.id}" style="margin:8px 0">
    <summary>
      <span>${p.name}
        <span class="chip ${det ? "chip--draft" : "chip--approved"}">${p.kind}</span></span>
      <span class="chip ${p.enabled ? "chip--approved" : "chip--draft"}">${p.enabled ? "gate on" : "gate off"}</span>
    </summary>
    <div class="body">
      <div class="lbl" style="margin-bottom:6px">${p.description}</div>
      <div class="chips" style="margin-bottom:10px">${(p.skills || []).map((s) => `<span class="chip">${s}</span>`).join("")}</div>
      ${det ? `<div class="lbl">Deterministic — no model call.</div>` : `
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:140px"><label class="lbl">Provider</label>
            <select id="prov-${p.id}" onchange="syncModels('${p.id}')">${provOpts}</select></div>
          <div style="flex:1;min-width:140px"><label class="lbl">Model</label>
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
    $(`#pane-${tab.dataset.tab}`).hidden = false;
  }));
}

load();
