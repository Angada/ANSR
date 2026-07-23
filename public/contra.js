// Contra — contract review. Phase 1: Archetype Maker.
// Upload a sample → contra-archetype proposes review sections → tag Required →
// Save. Drafts autosave (server-persisted) so you can leave and come back.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

let VIEW = "maker";       // maker | review
let ARCH = null;          // { id, name, sections:[{key,label,what_to_check,required,order}] }
let ARCHES = [];          // saved + draft library

function renderSubnav() {
  const saved = ARCHES.filter((a) => a.status === "saved").length;
  $("#subnav").innerHTML = [["maker", "Archetype Maker", ARCHES.length], ["review", "Contract Review", saved]]
    .map(([k, l, n]) => `<button class="${VIEW === k ? "on" : ""}" onclick="setView('${k}')">${l}${n ? `<span class="count">${n}</span>` : ""}</button>`).join("");
}
window.setView = (v) => { VIEW = v; renderSubnav(); $("#view-maker").hidden = v !== "maker"; $("#view-review").hidden = v !== "review"; if (v === "maker") renderMaker(); else renderReview(); };

async function init() {
  await loadArches();
  renderSubnav();
  renderMaker();
}

async function loadArches() {
  try { ARCHES = (await (await fetch("/api/contra/archetypes")).json()).archetypes || []; } catch { ARCHES = []; }
}

// ---- Archetype Maker -------------------------------------------------------
function renderMaker() {
  const host = $("#view-maker");
  const drop = `<div class="drop" id="drop" onclick="document.getElementById('file').click()"
        ondragover="dzOver(event)" ondragenter="dzOver(event)" ondragleave="dzLeave(event)" ondrop="dzDrop(event)">
      <span class="ic">⤒</span>
      <div><div class="t">Drop a sample contract to learn its type</div>
        <div class="s">PDF or DOCX · read by Munshi (atomize → clause-chips) · OCR fallback for scans → Contra proposes the sections to review</div></div>
      <input type="file" id="file" accept=".pdf,.docx,.doc,.txt,.md" onchange="uploadSample(this.files[0])">
    </div>`;

  let builder = "";
  if (ARCH) {
    const secs = ARCH.sections.map((s, i) => sectionCard(s, i)).join("");
    const req = ARCH.sections.filter((s) => s.required).length;
    builder = `
      <div class="sec-head">
        <h3>Review outline</h3>
        <span class="chip">${ARCH.sections.length} sections · <b style="color:var(--org)">${req} required</b></span>
        <button class="btn small" onclick="addSection()" style="margin-left:auto">+ Add section</button>
      </div>
      <p class="intro">Tag the sections that <b>matter for this contract type</b> as <b style="color:var(--org)">Required</b> — those become the review boxes. Amend a label or what-to-check, or drop the ones that don't apply.</p>
      <div class="grid">${secs}</div>
      <div class="savebar">
        <span style="font-weight:600">Save archetype</span>
        <input id="archname" value="${esc(ARCH.name)}" placeholder="e.g. MSA — India GCC" oninput="onName(this.value)">
        <span class="stampnote">timestamp auto-suffixed on save</span>
        <button class="btn btn--primary" style="margin-left:auto" onclick="saveArchetype()">Save archetype ▸</button>
        <button class="btn" onclick="discardDraft()">Discard</button>
      </div>`;
  }

  host.innerHTML = `<p class="intro"><b>ARCHETYPE MAKER</b> — teach Contra a contract <b>type</b> once: upload a sample, confirm the sections a reviewer must check, tag what's required, and save it. Contract Review then detects and reviews new contracts against it.</p>`
    + drop + `<div id="proc"></div>` + builder + archLibrary();
}

function sectionCard(s, i) {
  return `<div class="sec ${s.required ? "req" : ""}">
    <div class="sec-top"><span class="ord">${String(i + 1).padStart(2, "0")}</span><span class="lbl">${esc(s.label)}</span></div>
    <p class="chk">${esc(s.what_to_check || "—")}</p>
    <div class="sec-acts">
      <span class="reqtag ${s.required ? "on" : "off"}" onclick="toggleReq(${i})">${s.required ? "★ REQUIRED" : "optional"}</span>
      <button class="lnk" onclick="amendSection(${i})">Amend</button>
      <button class="lnk del" onclick="delSection(${i})">Remove</button>
    </div>
  </div>`;
}

function archLibrary() {
  const rows = ARCHES.map((a) => `<div class="arch-row">
      <span class="an">${esc(a.name)}</span>
      <span class="chip ${a.status}">${a.status}</span>
      <span class="am">${a.sections} sections</span>
      <span class="am">${a.source_doc ? esc(a.source_doc) : ""}</span>
      <button class="btn small" onclick="openArch(${a.id})">Open</button>
      <button class="btn small" onclick="delArch(${a.id},'${esc(a.name).replace(/'/g, "\\'")}')">✕</button>
    </div>`).join("");
  return `<div class="sec-head" style="margin-top:34px"><h3>Saved archetypes</h3></div>`
    + (ARCHES.length ? rows : `<div class="empty">// no archetypes yet — upload a sample above //</div>`);
}

// drag & drop onto the box
window.dzOver = (e) => { e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = "copy"); e.currentTarget.classList.add("over"); };
window.dzLeave = (e) => { e.currentTarget.classList.remove("over"); };
window.dzDrop = (e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); const f = e.dataTransfer?.files?.[0]; if (f) uploadSample(f); };

window.uploadSample = async (file) => {
  if (!file) return;
  const proc = $("#proc");
  const fill = () => { proc.innerHTML = `<div class="meter"><div class="now"><img class="potspin" src="/brand/assets/logos/pot.png" alt="">Reading the contract & proposing sections — this can take up to a minute…</div><div class="track"><div class="fill indet"></div></div></div>`; };
  fill();
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await fetch("/api/contra/archetype/propose", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) { proc.innerHTML = ""; return rdAlert("Couldn't read that", j.error || "Try a different file."); }
    ARCH = { id: j.id, name: j.name, sections: j.sections || [] };
    await loadArches();
    renderSubnav();
    renderMaker();
    if (j.mode !== "ai") rdAlert("Draft outline (no LLM key)", "Contra returned a starter outline. Add a Claude/Gemini key in AI Skills & Pipelines for a full read.");
  } catch (e) { proc.innerHTML = ""; rdAlert("Upload failed", String(e.message || e)); }
};

// mutations autosave the draft (server-persisted → leave & come back works)
async function saveDraft() {
  if (!ARCH?.id) return;
  ARCH.sections.forEach((s, i) => (s.order = i));
  try { await fetch(`/api/contra/archetype/${ARCH.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: ARCH.name, review_outline: ARCH.sections, save: false }) }); } catch { /* keep local */ }
}
window.toggleReq = (i) => { ARCH.sections[i].required = !ARCH.sections[i].required; renderMaker(); saveDraft(); };
window.delSection = (i) => { ARCH.sections.splice(i, 1); renderMaker(); saveDraft(); };
window.onName = (v) => { ARCH.name = v; };
window.addSection = () => rdForm("Add a section", [{ k: "label", label: "Section label", ph: "e.g. Data protection" }, { k: "chk", label: "What to check", ph: "what a reviewer verifies here" }], (o) => {
  if (!o.label) return;
  ARCH.sections.push({ key: o.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: o.label, what_to_check: o.chk || "", required: true, order: ARCH.sections.length });
  renderMaker(); saveDraft();
});
window.amendSection = (i) => { const s = ARCH.sections[i]; rdForm("Amend section", [{ k: "label", label: "Section label", v: s.label }, { k: "chk", label: "What to check", v: s.what_to_check }], (o) => { s.label = o.label || s.label; s.what_to_check = o.chk; renderMaker(); saveDraft(); }); };

window.saveArchetype = async () => {
  if (!ARCH?.id) return;
  if (!ARCH.name?.trim()) return rdAlert("Name it first", "Give the archetype a name so Review can detect against it.");
  if (!ARCH.sections.some((s) => s.required)) return rdAlert("Mark at least one required", "Tag the sections that matter as Required — they become the review boxes.");
  ARCH.sections.forEach((s, i) => (s.order = i));
  const r = await fetch(`/api/contra/archetype/${ARCH.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: ARCH.name, review_outline: ARCH.sections, save: true }) });
  const j = await r.json();
  if (!r.ok) return rdAlert("Save failed", j.error || "");
  ARCH = null; await loadArches(); renderSubnav(); renderMaker();
  rdAlert("Archetype saved", `Saved as “${esc(j.archetype.slug || j.archetype.name)}”. It's now available in Contract Review.`);
};
window.discardDraft = () => rdConfirm("Discard this draft?", "The proposed outline will be deleted.", async () => { if (ARCH?.id) await fetch(`/api/contra/archetype/${ARCH.id}`, { method: "DELETE" }); ARCH = null; await loadArches(); renderSubnav(); renderMaker(); });
window.openArch = async (id) => { const j = await (await fetch(`/api/contra/archetype/${id}`)).json(); const a = j.archetype; ARCH = { id: a.id, name: a.name, sections: a.review_outline || [] }; renderMaker(); window.scrollTo({ top: 0, behavior: "smooth" }); };
window.delArch = (id, name) => rdConfirm("Delete archetype?", `“${name}” will be removed.`, async () => { await fetch(`/api/contra/archetype/${id}`, { method: "DELETE" }); if (ARCH?.id === id) ARCH = null; await loadArches(); renderSubnav(); renderMaker(); });

// ---- Contract Review (Phase 2 placeholder) ---------------------------------
function renderReview() {
  const saved = ARCHES.filter((a) => a.status === "saved");
  $("#view-review").innerHTML = `<p class="intro"><b>CONTRACT REVIEW</b> — drop one or many contracts; each auto-detects its archetype, then Contra runs a <b>holistic</b> review (section boxes + whole-contract findings) you can Accept or chat, and exports comments into the Word doc.</p>`
    + (saved.length
      ? `<div class="drop" style="cursor:default"><span class="ic">⇊</span><div><div class="t">Coming next — Phase 2</div><div class="s">${saved.length} archetype${saved.length === 1 ? "" : "s"} ready to detect against: ${saved.map((a) => esc(a.name)).join(" · ")}</div></div></div>`
      : `<div class="empty">// save an archetype in the Archetype Maker first — Review detects against it //</div>`);
}

// ---- modals ----------------------------------------------------------------
function _ov(inner) { const ov = document.createElement("div"); ov.className = "ov"; ov.innerHTML = `<div class="box">${inner}</div>`; document.body.appendChild(ov); const close = () => ov.remove(); ov.onclick = (e) => { if (e.target === ov) close(); }; return { ov, close }; }
function rdAlert(title, msg) { const { ov, close } = _ov(`<h3>${esc(title)}</h3>${msg ? `<p>${esc(msg)}</p>` : ""}<div class="row"><button class="btn btn--primary" data-ok>OK</button></div>`); ov.querySelector("[data-ok]").onclick = close; }
function rdConfirm(title, msg, onOk) { const { ov, close } = _ov(`<h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="row"><button class="btn" data-x>Cancel</button><button class="btn btn--org" data-ok>Confirm</button></div>`); ov.querySelector("[data-x]").onclick = close; ov.querySelector("[data-ok]").onclick = () => { close(); onOk && onOk(); }; }
function rdForm(title, fields, onOk) {
  const body = fields.map((f) => `<label style="font-size:12.5px;color:var(--dim)">${esc(f.label)}</label><input data-k="${f.k}" placeholder="${esc(f.ph || "")}" value="${esc(f.v || "")}">`).join("");
  const { ov, close } = _ov(`<h3>${esc(title)}</h3>${body}<div class="row"><button class="btn" data-x>Cancel</button><button class="btn btn--primary" data-ok>Save</button></div>`);
  ov.querySelector("input")?.focus();
  ov.querySelector("[data-x]").onclick = close;
  ov.querySelector("[data-ok]").onclick = () => { const o = {}; ov.querySelectorAll("[data-k]").forEach((el) => (o[el.dataset.k] = el.value.trim())); close(); onOk(o); };
}

init();
