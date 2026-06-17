// Atlas wiki — classify/route a client + browse the archetype library.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));

async function init() {
  const { clients } = await (await fetch("/api/clients")).json();
  $("#client").innerHTML = clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  $("#classify").addEventListener("click", () => act("classify"));
  $("#route").addEventListener("click", () => act("route"));
  renderArchetypes();
}

async function act(kind) {
  const client = $("#client").value;
  $("#result").innerHTML = `<p class="lbl" style="margin-top:10px">Fingerprinting…</p>`;
  const r = await (await fetch(`/api/atlas/${kind}/${client}`, { method: "POST" })).json();
  const fp = r.fingerprint || {};
  const decColor = r.decision === "matched" ? "chip--approved" : r.decision === "partial" ? "chip--flag" : "chip--draft";
  const cands = (r.candidates || []).map((c) => `<tr><td>${esc(c.slug)}</td><td class="r">${Math.round(c.sim * 100)}%</td></tr>`).join("");
  $("#result").innerHTML = `
    <div class="band" style="margin-top:12px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <span class="chip ${decColor}">${esc(r.decision)}</span>
        ${r.archetype ? `<span class="chip chip--role">${esc(r.archetype.slug)} v${r.archetype.version}</span>` : ""}
        ${r.similarity != null ? `<span class="lbl">${Math.round(r.similarity * 100)}% match</span>` : ""}
      </div>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500">Fingerprint</div>
      <div class="chips" style="margin:4px 0 8px">
        ${(fp.heads || []).map((h) => `<span class="chip">${esc(h)}</span>`).join("")}
        ${(fp.dims || []).map((d) => `<span class="chip chip--draft">${esc(d)}</span>`).join("")}
        <span class="chip chip--draft">${esc(fp.currency || "")}</span>
      </div>
      ${cands ? `<div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:6px">Candidates</div><div class="scroll-x"><table class="grid"><thead><tr><th>Archetype</th><th class="r">Similarity</th></tr></thead><tbody>${cands}</tbody></table></div>` : ""}
      ${kind === "route" ? `<p class="lbl" style="margin-top:8px;color:var(--ansr-teal)">✓ Routed — ${r.decision === "novel" ? "seeded a new archetype" : "matched + pre-loaded its template"}.</p>` : ""}
    </div>`;
  if (kind === "route") renderArchetypes();
}

async function renderArchetypes() {
  const { archetypes } = await (await fetch("/api/atlas/archetypes")).json();
  $("#acount").textContent = `${archetypes.length}`;
  $("#archetypes").innerHTML = archetypes.map((a) => `
    <a class="agent" href="#" onclick="showArch('${esc(a.slug)}');return false">
      <div class="badge">${esc((a.name || "?")[0])}</div>
      <div style="flex:1">
        <div class="nm"><b>${esc(a.name)}</b><span class="role">${esc(a.slug)}</span><span class="chip" style="margin-left:auto">${a.members} contracts</span></div>
        <p class="blurb">Heads: ${(a.heads || []).join(", ") || "—"} · ${a.inputs} inputs · dims: ${(a.dims || []).join(", ") || "—"}</p>
      </div></a>`).join("") || `<p class="lbl">No archetypes yet — Route a client to seed the first.</p>`;
}

window.showArch = async (slug) => {
  const a = await (await fetch(`/api/atlas/archetype/${slug}`)).json();
  const members = (a.members || []).map((m) => `<tr><td>${esc(m.name || m.code)}</td><td>${Math.round((m.similarity || 0) * 100)}%</td><td>${esc(m.decision || "")}</td></tr>`).join("");
  $("#detail").innerHTML = `
    <div class="band" style="margin-top:14px">
      <div style="display:flex;align-items:center;gap:8px"><b style="color:var(--ansr-navy)">${esc(a.name)}</b><span class="chip chip--role">${esc(a.slug)} v${a.version}</span></div>
      <pre style="white-space:pre-wrap;font:inherit;font-size:13px;color:var(--ansr-text);margin:10px 0">${esc(a.playbook_md || "")}</pre>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500">Member contracts</div>
      <div class="scroll-x"><table class="grid"><thead><tr><th>Contract</th><th>Similarity</th><th>Routed</th></tr></thead><tbody>${members || "<tr><td colspan=3 class=lbl>none</td></tr>"}</tbody></table></div>
    </div>`;
  $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
};

init();
