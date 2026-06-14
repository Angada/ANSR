// Agent launcher.
fetch("/api/ops").then((r) => r.json()).then(({ ops }) => {
  document.querySelector("#agents").innerHTML = ops.map((a) => {
    const live = a.status === "live";
    const inner = `
      <div class="badge">${a.name[0]}</div>
      <div style="flex:1">
        <div class="nm"><b>${a.name}</b><span class="role">${a.role}</span>
          <span class="chip ${live ? "chip--approved" : "chip--draft"}" style="margin-left:auto">${live ? "live" : "soon"}</span></div>
        <p class="blurb">${a.blurb}</p>
      </div>
      ${live ? `<span class="go">→</span>` : ""}`;
    return live
      ? `<a class="agent" href="${a.href}">${inner}</a>`
      : `<div class="agent coming">${inner}</div>`;
  }).join("");
});
