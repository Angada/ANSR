// Admin — AI Skills & Pipelines. Documents + controls every AI pipeline:
// provider/model switching, enable gate, per-provider API keys. Backed by
// /api/config, /api/pipelines/:id, /api/providers/:provider.
const $ = (s, r = document) => r.querySelector(s);
let CFG = null;

async function load() {
  CFG = await (await fetch("/api/config")).json();
  renderProviders(); renderPipelines(); wireTabs();
}

function renderProviders() {
  $("#providers").innerHTML = Object.entries(CFG.providers).map(([id, p]) => `
    <section class="section">
      <summary>${p.label} ${p.hasKey ? `<span class="chip chip--approved">key ${p.keyHint}</span>` : `<span class="chip chip--flag">no key</span>`}</summary>
      <div class="body">
        <div class="lbl" style="margin-bottom:6px">Models: ${p.models.join(", ") || "—"}</div>
        <label class="lbl">API key</label>
        <input type="password" id="key-${id}" placeholder="paste key — stored encrypted">
        <button class="btn" style="margin-top:8px" onclick="saveKey('${id}')">Save key</button>
      </div>
    </section>`).join("");
}

function renderPipelines() {
  $("#pipelines").innerHTML = Object.values(CFG.pipelines).map((p) => {
    const det = p.kind === "deterministic";
    const provOpts = Object.entries(CFG.providers).map(([id, pr]) => `<option value="${id}" ${p.provider === id ? "selected" : ""}>${pr.label}</option>`).join("");
    const models = (CFG.providers[p.provider]?.models) || [];
    const modelOpts = models.map((m) => `<option value="${m}" ${p.model === m ? "selected" : ""}>${m}</option>`).join("");
    return `
    <section class="section" data-id="${p.id}">
      <summary><span>${p.name} <span class="chip ${det ? "chip--draft" : "chip--approved"}">${p.kind}</span></span>
        <span class="chip ${p.enabled ? "chip--approved" : "chip--draft"}">${p.enabled ? "on" : "off"}</span></summary>
      <div class="body">
        <div class="lbl" style="margin-bottom:8px">${p.description}</div>
        <div class="lbl" style="margin-bottom:8px">skills: ${(p.skills || []).join(", ") || "—"}</div>
        ${det ? `<div class="lbl">Deterministic — no model call.</div>` : `
          <label class="lbl">Provider</label>
          <select id="prov-${p.id}" onchange="syncModels('${p.id}')">${provOpts}</select>
          <label class="lbl" style="margin-top:8px;display:block">Model</label>
          <select id="model-${p.id}">${modelOpts}</select>`}
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" id="en-${p.id}" ${p.enabled ? "checked" : ""} style="width:auto;min-height:auto"> Enabled</label>
        <button class="btn" style="margin-top:10px" onclick="savePipeline('${p.id}', ${det})">Save</button>
        <span id="msg-${p.id}" class="lbl" style="margin-left:8px"></span>
      </div>
    </section>`;
  }).join("");
}

// when provider changes, repopulate its model list
window.syncModels = (id) => {
  const prov = $(`#prov-${id}`).value;
  const models = (CFG.providers[prov]?.models) || [];
  $(`#model-${id}`).innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join("");
};

window.savePipeline = async (id, det) => {
  const body = { enabled: $(`#en-${id}`).checked };
  if (!det) { body.provider = $(`#prov-${id}`).value; body.model = $(`#model-${id}`).value; }
  const r = await fetch(`/api/pipelines/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  $(`#msg-${id}`).textContent = r.ok ? "saved ✓" : "error";
  CFG = await (await fetch("/api/config")).json();
};

window.saveKey = async (id) => {
  const apiKey = $(`#key-${id}`).value;
  if (!apiKey) return;
  await fetch(`/api/providers/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
  CFG = await (await fetch("/api/config")).json(); renderProviders();
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
