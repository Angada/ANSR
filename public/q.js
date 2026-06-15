// Shared UI: app header (logo home · Admin tab · user + role) + Dubai date util.
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Dubai time, dd-MMM-yyyy (e.g. 14-JUN-2026).
window.fmtDubai = (ts) => {
  const d = ts ? new Date(ts) : new Date();
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric" })
    .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return `${p.day}-${MON[+p.month - 1]}-${p.year}`;
};

// ---- app modals (replace browser alert/confirm/prompt everywhere) ----------
const _esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
function _modal(inner) {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal">${inner}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  return { bg, close };
}
window.appAlert = (title, msg = "") => {
  const { bg, close } = _modal(`<h3>${_esc(title)}</h3>${msg ? `<p>${_esc(msg)}</p>` : ""}<div class="row"><button class="btn" data-ok>OK</button></div>`);
  bg.querySelector("[data-ok]").onclick = close;
};
window.appConfirm = (title, msg, onOk, okLabel = "Confirm", danger = false) => {
  const { bg, close } = _modal(`<h3>${_esc(title)}</h3><p>${_esc(msg)}</p><div class="row"><button class="btn btn--ghost" data-x>Cancel</button><button class="btn" data-ok ${danger ? 'style="background:#b3261e"' : ""}>${_esc(okLabel)}</button></div>`);
  bg.querySelector("[data-x]").onclick = close;
  bg.querySelector("[data-ok]").onclick = () => { close(); onOk && onOk(); };
};
window.appPrompt = (title, label, onSubmit, opts = {}) => {
  const { bg, close } = _modal(`<h3>${_esc(title)}</h3>${label ? `<label class="lbl">${_esc(label)}</label>` : ""}<input id="_pin" placeholder="${_esc(opts.placeholder || "")}" value="${_esc(opts.value || "")}" style="margin:6px 0 14px"><div class="row"><button class="btn btn--ghost" data-x>Cancel</button><button class="btn" data-ok>${_esc(opts.okLabel || "OK")}</button></div>`);
  const inp = bg.querySelector("#_pin"); inp.focus();
  const submit = () => { const v = inp.value.trim(); close(); onSubmit && onSubmit(v); };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  bg.querySelector("[data-x]").onclick = close;
  bg.querySelector("[data-ok]").onclick = submit;
};

// multi-field form modal. fields: [{key,label,type:text|select|textarea,placeholder,options,value}]
window.appForm = (title, fields, onSubmit, okLabel = "Create") => {
  const body = fields.map((f) => {
    if (f.type === "select") return `<label class="lbl">${_esc(f.label)}</label><select data-k="${f.key}" style="margin:4px 0 10px">${(f.options || []).map((o) => `<option value="${_esc(o)}" ${o === f.value ? "selected" : ""}>${_esc(o)}</option>`).join("")}</select>`;
    if (f.type === "textarea") return `<label class="lbl">${_esc(f.label)}</label><textarea data-k="${f.key}" rows="2" placeholder="${_esc(f.placeholder || "")}" style="margin:4px 0 10px">${_esc(f.value || "")}</textarea>`;
    return `<label class="lbl">${_esc(f.label)}</label><input data-k="${f.key}" placeholder="${_esc(f.placeholder || "")}" value="${_esc(f.value || "")}" style="margin:4px 0 10px">`;
  }).join("");
  const { bg, close } = _modal(`<h3>${_esc(title)}</h3>${body}<div class="row"><button class="btn btn--ghost" data-x>Cancel</button><button class="btn" data-ok>${_esc(okLabel)}</button></div>`);
  bg.querySelector("input,select,textarea")?.focus();
  bg.querySelector("[data-x]").onclick = close;
  bg.querySelector("[data-ok]").onclick = () => {
    const out = {}; bg.querySelectorAll("[data-k]").forEach((el) => (out[el.dataset.k] = el.value.trim()));
    close(); onSubmit && onSubmit(out);
  };
};

// Inject the app header into #appbar. activeTab: 'home' | 'admin'.
window.qHeader = async (activeTab = "home") => {
  let me = { user: "—", role: "" };
  try { me = await (await fetch("/api/me")).json(); } catch {}
  const el = document.querySelector("#appbar");
  if (!el) return;
  el.outerHTML = `
  <header class="appbar">
    <a href="/" class="logo" title="Home"><img class="full" src="/brand/assets/logos/QAnsr-logo.png" alt="Q&ANSR"><img class="emblem" src="/favicon.png" alt="Q&ANSR"></a>
    <nav style="margin-left:auto">
      <a href="/" class="navtab ${activeTab === "home" ? "active" : ""}">Q&amp;</a>
      <a href="/mint.html" class="navtab ${activeTab === "mint" ? "active" : ""}">Mint</a>
      <a href="/admin.html" class="navtab ${activeTab === "admin" ? "active" : ""}">Admin</a>
    </nav>
    <div class="user">
      <span class="nm">${me.user || ""}</span>
      ${me.role ? `<span class="chip chip--role">${me.role}</span>` : ""}
      <a href="#" class="navtab" onclick="fetch('/api/logout',{method:'POST'}).then(()=>location.href='/login.html');return false">Sign out</a>
    </div>
  </header>`;
};
