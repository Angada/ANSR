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

// ---- terminal menu bar (super-CPU aesthetic, radar palette) -----------------
// Self-contained: injects its own scoped CSS once, so it restyles the menu on
// every page without touching app.css. Monospace, phosphor-green, dark.
const QTERM_CSS = `
.q-term{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:16px;
  padding:10px 18px;background:linear-gradient(180deg,#070c15,#05080e);
  border-bottom:1px solid rgba(63,240,166,.22);
  font-family:'Space Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  box-shadow:0 10px 30px -22px #000,0 1px 0 rgba(65,224,255,.08)}
.q-term a{text-decoration:none}
.q-term__brand{display:flex;align-items:center;gap:9px;color:#e7f0fa}
.q-term__led{width:9px;height:9px;border-radius:50%;background:#3ff0a6;box-shadow:0 0 10px #3ff0a6;animation:qled 1.8s ease-in-out infinite;flex:0 0 auto}
@keyframes qled{50%{opacity:.3}}
.q-term__mark{font-weight:700;letter-spacing:.22em;font-size:15px}
.q-term__mark b{color:#3ff0a6}
.q-term__sys{color:#5f7189;font-size:10px;letter-spacing:.2em}
.q-term__nav{display:flex;gap:6px;flex:1;flex-wrap:wrap}
.q-term__tab{color:#8fa3bd;font-size:11px;letter-spacing:.16em;padding:7px 11px;border:1px solid transparent;border-radius:8px;transition:.16s;white-space:nowrap}
.q-term__tab::before{content:"▹ ";color:#41e0ff}
.q-term__tab:hover{color:#e7f0fa;border-color:rgba(122,162,204,.3)}
.q-term__tab.on{color:#04120c;background:#3ff0a6;font-weight:700;box-shadow:0 0 18px -3px rgba(63,240,166,.65)}
.q-term__tab.on::before{content:"▸ ";color:#04120c}
.q-term__user{display:flex;align-items:center;gap:10px;font-size:10px;letter-spacing:.1em;color:#8fa3bd}
.q-term__role{color:#41e0ff;border:1px solid rgba(65,224,255,.4);border-radius:999px;padding:3px 9px}
.q-term__out{color:#8fa3bd}
.q-term__out:hover{color:#ff5a52}
.q-term__hamb{display:none;background:none;border:1px solid rgba(122,162,204,.3);color:#3ff0a6;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer}
@media(max-width:760px){
  .q-term{flex-wrap:wrap}
  .q-term__hamb{display:block;margin-left:auto}
  .q-term__nav,.q-term__user{display:none;width:100%;flex-direction:column;gap:4px}
  .q-term.q-open .q-term__nav,.q-term.q-open .q-term__user{display:flex}
  .q-term__user{flex-direction:row;flex-wrap:wrap;padding-top:8px;border-top:1px solid rgba(122,162,204,.14)}
}`;
// Inject the app menu into #appbar. activeTab: 'home'|'mint'|'raydar'|'admin'.
window.qHeader = async (activeTab = "home") => {
  let me = { user: "—", role: "" };
  try { me = await (await fetch("/api/me")).json(); } catch {}
  const el = document.querySelector("#appbar");
  if (!el) return;
  if (!document.getElementById("qterm-css")) {
    const st = document.createElement("style"); st.id = "qterm-css"; st.textContent = QTERM_CSS;
    document.head.appendChild(st);
  }
  const tabs = [["home", "Q&", "/"], ["mint", "MINT", "/mint.html"], ["raydar", "RAYDAR", "/whisperer.html"], ["admin", "ADMIN", "/admin.html"]];
  el.outerHTML = `
  <header class="q-term" id="appbar">
    <a href="/" class="q-term__brand" title="Home"><span class="q-term__led"></span><span class="q-term__mark">Q&amp;<b>ANSR</b></span><span class="q-term__sys">// CORE</span></a>
    <button class="q-term__hamb" aria-label="Menu" onclick="this.closest('.q-term').classList.toggle('q-open')">▚</button>
    <nav class="q-term__nav">
      ${tabs.map(([k, l, h]) => `<a href="${h}" class="q-term__tab ${activeTab === k ? "on" : ""}">${l}</a>`).join("")}
    </nav>
    <div class="q-term__user">
      <span>USR:${_esc(me.user || "—")}</span>
      ${me.role ? `<span class="q-term__role">${_esc(me.role)}</span>` : ""}
      <a href="#" class="q-term__out" onclick="fetch('/api/logout',{method:'POST'}).then(()=>location.href='/login.html');return false">⏻ SIGN OUT</a>
    </div>
  </header>`;
};

// ---- global "AI working" spinner — the rotating Q emblem ---------------------
// Shows whenever an AI-backed request is in flight, on any page. Counter-based so
// concurrent calls don't flicker it off early.
let _aiN = 0;
window.aiSpin = (on, label) => {
  _aiN = Math.max(0, _aiN + (on ? 1 : -1));
  let el = document.getElementById("aispin");
  if (_aiN > 0) {
    if (!el) {
      el = document.createElement("div"); el.id = "aispin"; el.className = "aispin";
      el.innerHTML = `<img src="/brand/assets/logos/q-emblem.png" alt="" class="qspin"><span class="aispin-l">AI working…</span>`;
      document.body.appendChild(el);
    }
    if (label) el.querySelector(".aispin-l").textContent = label;
  } else if (el) { el.remove(); }
};

// Auto-show the spinner for AI-backed endpoints — covers every page, no per-call
// wiring needed. Deterministic endpoints (compute, runs, config) are excluded.
const _AI_RE = /\/api\/(box\/[^/]+\/chat|mint\/(clarify|roster\/map|run)\b|ai\/)/;
const _origFetch = window.fetch.bind(window);
window.fetch = (...args) => {
  const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
  const isAI = _AI_RE.test(url);
  if (isAI) window.aiSpin(true);
  const p = _origFetch(...args);
  if (isAI) p.finally(() => window.aiSpin(false));
  return p;
};
