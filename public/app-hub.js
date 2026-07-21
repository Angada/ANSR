// Agent launcher — renders each agent as a super-CPU "module bay" + boot HUD.
const _e = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));

fetch("/api/ops").then((r) => r.json()).then(({ ops }) => {
  const live = ops.filter((a) => a.status === "live").length;

  // ---- boot HUD readouts ----
  const boot = Date.now();
  const hud = document.getElementById("hud");
  const paint = () => {
    const up = Math.floor((Date.now() - boot) / 1000);
    const hh = String(Math.floor(up / 3600)).padStart(2, "0");
    const mm = String(Math.floor((up % 3600) / 60)).padStart(2, "0");
    const ss = String(up % 60).padStart(2, "0");
    if (hud) hud.innerHTML =
      `<span class="stat ok"><span class="dot"></span><span class="k">STATUS</span> <span class="v">ONLINE</span></span>` +
      `<span class="stat"><span class="k">AGENTS</span> <span class="v">${ops.length}</span></span>` +
      `<span class="stat ok"><span class="k">LIVE</span> <span class="v">${live}</span></span>` +
      `<span class="stat"><span class="k">NODES</span> <span class="v">04</span></span>` +
      `<span class="stat"><span class="k">SESSION</span> <span class="v">${hh}:${mm}:${ss}</span></span>`;
  };
  paint(); setInterval(paint, 1000);

  // ---- module bays ----
  document.querySelector("#agents").innerHTML = ops.map((a, i) => {
    const on = a.status === "live";
    const id = "MOD-" + String(i + 1).padStart(2, "0");
    const inner = `
      <div class="bay__top">
        <span class="bay__id">${id}</span>
        <span class="bay__led ${on ? "" : "standby"}"><span class="l"></span>${on ? "ONLINE" : "STANDBY"}</span>
      </div>
      <div class="bay__name">${_e(a.name).toUpperCase()}</div>
      <div class="bay__role">${_e(a.role)}</div>
      <p class="bay__blurb">${_e(a.blurb)}</p>
      <div class="bay__go ${on ? "" : "off"}">${on ? "ENGAGE ▸" : "OFFLINE · SOON"}</div>`;
    return on
      ? `<a class="bay live" href="${_e(a.href)}">${inner}</a>`
      : `<div class="bay soon">${inner}</div>`;
  }).join("");
});
