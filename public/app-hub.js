// Ops hub — the 20-card landing.
fetch("/api/ops").then((r) => r.json()).then(({ ops }) => {
  document.querySelector("#ops").innerHTML = ops.map((o) => {
    const live = o.status === "live";
    const card = `
      <div class="section" style="margin:0">
        <div class="body">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
            <strong style="color:var(--ansr-navy)">${o.title}</strong>
            <span class="chip ${live ? "chip--approved" : "chip--draft"}">${live ? "live" : "soon"}</span>
          </div>
          <div class="lbl" style="color:var(--ansr-gray);margin-top:6px">${o.sub}</div>
        </div>
      </div>`;
    return live ? `<a href="${o.href}" style="text-decoration:none">${card}</a>` : `<div style="opacity:.6">${card}</div>`;
  }).join("");
});
