// Shared UI: app header (logo home · Admin tab · user + role) + the platform date
// standard: INDIA format, IST always — readable "29 Jun, 2026" · compact "29-09-2026".
// ---- ONE PLACE THAT NOTICES A DEAD SESSION --------------------------------
// Every loader in every app is written `try { X = (await (await fetch(u)).json()).rows }
// catch { X = [] }`. A 401 returns perfectly valid JSON — {"error":"auth required"} —
// so .json() SUCCEEDS, the catch never fires, and `|| []` swallows it. Q-Legal then
// rendered as a healthy but EMPTY repository: "the repository is empty", 0 contracts,
// 0 standing questions, no obligations, and no sign-in prompt anywhere on the page.
// A seven-day cookie expiring mid-session, or a server restart, looked exactly like a
// customer who had not uploaded anything yet.
//
// Rather than fix a hundred call sites, notice it once, here.
(() => {
  const _fetch = window.fetch;
  let bounced = false;
  window.fetch = async (input, init) => {
    const r = await _fetch(input, init);
    try {
      const url = String(typeof input === "string" ? input : (input && input.url) || "");
      const api = url.startsWith("/api/") || url.includes(`${location.origin}/api/`);
      // /api/login answers 401 for a wrong password — that is the login form's own
      // business, not an expired session.
      if (r.status === 401 && api && !url.includes("/api/login") && !bounced) {
        bounced = true;
        location.href = `/login.html?next=${encodeURIComponent(location.pathname)}`;
      }
    } catch { /* an interceptor must never break a real response */ }
    return r;
  };
})();

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const _istParts = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" })
  .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
// readable: "29 Jun, 2026"
window.fmtIndia = (ts) => { const p = _istParts(ts ? new Date(ts) : new Date()); return `${+p.day} ${MON[+p.month - 1]}, ${p.year}`; };
// compact: "29-09-2026"
window.fmtIndiaShort = (ts) => { const p = _istParts(ts ? new Date(ts) : new Date()); return `${p.day}-${p.month}-${p.year}`; };
window.fmtDubai = window.fmtIndia;   // legacy name — now the India format

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
  min-height:62px;box-sizing:border-box;
  padding:9px 18px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);
  border-bottom:1px solid #E7E3DC;
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  box-shadow:0 8px 24px -20px rgba(0,36,46,.4)}
.q-term a{text-decoration:none}
.q-term__brand{display:flex;align-items:center;gap:10px;color:#1E1E1E}
.q-term__logo{height:44px;width:auto;display:block}
.q-term__led{width:8px;height:8px;border-radius:50%;background:#CE4502;box-shadow:0 0 0 3px rgba(206,69,2,.14);animation:qled 1.8s ease-in-out infinite;flex:0 0 auto}
@keyframes qled{50%{opacity:.3}}
.q-term__sys{color:#A79F93;font-size:13px;letter-spacing:.14em}
.q-term__nav{display:flex;gap:4px;flex:1;flex-wrap:wrap}
.q-term__tab{color:#54504A;font-size:15px;font-weight:500;letter-spacing:.01em;padding:7px 13px;border:1px solid transparent;border-radius:8px;transition:.16s;white-space:nowrap}
.q-term__tab:hover{color:#141414;border-color:#E7E3DC}
.q-term__tab.on{color:#CE4502;background:#FFF1E9;font-weight:600;border-color:#F3D6C2}
.q-term__user{display:flex;align-items:center;gap:10px;font-size:14px;color:#54504A}
.q-term__role{color:#CE4502;border:1px solid #F3D6C2;background:#FFF1E9;border-radius:999px;padding:3px 10px;font-size:13px}
.q-term__out{color:#54504A}
.q-term__out:hover{color:#CE4502}
.q-term__hamb{display:none;background:none;border:1px solid #D9D3C8;color:#CE4502;border-radius:8px;padding:6px 10px;font-size:16px;cursor:pointer}
@media(max-width:760px){
  .q-term{flex-wrap:wrap}
  .q-term__hamb{display:block;margin-left:auto}
  .q-term__nav,.q-term__user{display:none;width:100%;flex-direction:column;gap:4px}
  .q-term.q-open .q-term__nav,.q-term.q-open .q-term__user{display:flex}
  .q-term__user{flex-direction:row;flex-wrap:wrap;padding-top:8px;border-top:1px solid #E7E3DC}
}`;
// Inject the app menu into #appbar. activeTab: 'home'|'mint'|'raydar'|'admin'.
window.qHeader = (activeTab = "home") => {
  const el = document.querySelector("#appbar");
  if (!el) return;
  if (!document.getElementById("qterm-css")) {
    const st = document.createElement("style"); st.id = "qterm-css"; st.textContent = QTERM_CSS;
    document.head.appendChild(st);
  }
  // Tabs are filtered to the signed-in account's apps once /api/me resolves.
  // (The server enforces access too — this only keeps the bar honest.)
  const ALL_TABS = [["raydar", "RayDar", "/whisperer.html"], ["contra", "Contra", "/contra.html"], ["qlegal", "Q-Legal", "/qlegal.html"], ["mint", "Mint", "/mint.html"], ["admin", "Admin", "/admin.html"]];
  // What each app is, in one sentence — shown when someone can see an app but
  // can't open it, so a lock explains itself instead of just refusing.
  window.Q_APP_ABOUT = {
    raydar: { name: "RayDar", what: "Talent trend radar. Reads what your audience is actually watching, asking and complaining about across YouTube and Reddit, and turns it into ranked, justified content ideas — never finished copy.", who: "the Content team" },
    contra: { name: "Contra", what: "Contract review. You teach it a contract TYPE once — the sections a reviewer must check and the house rules in plain English — and it then reviews whole contracts against that standard: a verdict per section with the § evidence, your rules marked pass or breach, contradictions flagged, and tracked-change redlines you can open in Word.", who: "the Legal review team" },
    qlegal: { name: "Q-Legal", what: "Legal repository intelligence. Reads every contract once, then answers questions across the whole estate with a citation for every claim.", who: "the Legal team" },
    mint: { name: "Mint", what: "Contract-aware billing. Turns a signed SOW plus a monthly worksheet into a computed, explainable invoice where every number traces back to its clause.", who: "the Finance team" },
    admin: { name: "Admin", what: "The Vault, the AI-pipeline registry, integrations and accounts — the platform's shared controls.", who: "platform administrators" },
  };
  const tabs = ALL_TABS;
  // Render the bar synchronously (no await) so it never pops in late / shifts
  // the page. The username + role fill in after /api/me resolves, without moving
  // anything (their spans already occupy the row).
  el.outerHTML = `
  <header class="q-term" id="appbar">
    <a href="/" class="q-term__brand" title="Home"><span class="q-term__led"></span><img class="q-term__logo" src="/brand/assets/logos/QAnsr-logo.png" alt="Q&ANSR"><span class="q-term__sys">// CORE</span></a>
    <button class="q-term__hamb" aria-label="Menu" onclick="this.closest('.q-term').classList.toggle('q-open')">▚</button>
    <nav class="q-term__nav">
      ${tabs.map(([k, l, h]) => `<a href="${h}" class="q-term__tab ${activeTab === k ? "on" : ""}">${l}</a>`).join("")}
    </nav>
    <div class="q-term__user">
      <span id="q-usr">USR:—</span>
      <span class="q-term__role" id="q-role" style="display:none"></span>
      <a href="#" class="q-term__out" onclick="fetch('/api/logout',{method:'POST'}).then(()=>location.href='/login.html');return false">⏻ SIGN OUT</a>
    </div>
  </header>`;
  fetch("/api/me").then((r) => r.json()).then((me) => {
    const u = document.getElementById("q-usr"); if (u) u.textContent = "USR:" + (me.user || "—");
    const rl = document.getElementById("q-role"); if (rl && me.role) { rl.textContent = me.role; rl.style.display = ""; }
    if (Array.isArray(me.apps)) {
      const locked = me.locked || [];
      const mine = ALL_TABS.filter(([k]) => (k === "admin" ? me.admin : me.apps.includes(k) || locked.includes(k)));
      const nav = document.querySelector(".q-term__nav");
      if (nav) nav.innerHTML = mine.map(([k, l, h]) => locked.includes(k)
        ? `<a href="#" class="q-term__tab" style="opacity:.55" title="You don't have access yet" onclick="qLocked('${k}');return false">🔒 ${l}</a>`
        : `<a href="${h}" class="q-term__tab ${activeTab === k ? "on" : ""}">${l}</a>`).join("");
      // a single-app account has nothing to go "home" to — point the logo at its app
      if (!me.admin && me.apps.length === 1) {
        const brand = document.querySelector(".q-term__brand");
        const only = ALL_TABS.find(([k]) => k === me.apps[0]);
        if (brand && only) brand.setAttribute("href", only[2]);
      }
    }
  }).catch(() => {});
};

// ---- global "AI working" spinner — the rotating Q emblem ---------------------
// Shows whenever an AI-backed request is in flight, on any page. Counter-based so
// concurrent calls don't flicker it off early.
let _aiN = 0;
window.aiSpin = (on, label) => {
  _aiN = Math.max(0, _aiN + (on ? 1 : -1));
  let el = document.getElementById("aispin");
  if (_aiN > 0) {
    if (!document.getElementById("aispin-css")) {
      // self-contained: the app pages are standalone and don't load console.css,
      // so without this the spinner renders as a full-size raw image
      const st = document.createElement("style"); st.id = "aispin-css";
      st.textContent = `.aispin{position:fixed;right:18px;bottom:18px;z-index:120;display:flex;align-items:center;gap:9px;
        background:rgba(255,255,255,.96);border:1px solid #E7E3DC;border-radius:999px;padding:8px 15px 8px 11px;
        box-shadow:0 12px 30px -14px rgba(0,36,46,.45);font:600 13px 'Inter',system-ui,sans-serif;color:#3D3934}
        .aispin img{width:20px;height:20px;animation:aispin-r 1s linear infinite}
        @keyframes aispin-r{to{transform:rotate(360deg)}}`;
      document.head.appendChild(st);
    }
    if (!el) {
      el = document.createElement("div"); el.id = "aispin"; el.className = "aispin";
      el.innerHTML = `<img src="/brand/assets/logos/pot.png" alt="" class="qspin"><span class="aispin-l">AI working…</span>`;
      document.body.appendChild(el);
    }
    if (label) el.querySelector(".aispin-l").textContent = label;
  } else if (el) { el.remove(); }
};

// Auto-show the spinner for AI-backed endpoints — covers every page, no per-call
// wiring needed. Deterministic endpoints (compute, runs, config) are excluded.
// Every AI-backed endpoint, not a hand-picked few. Listing them one by one meant
// each new action shipped without a spinner and looked like a dead button; the
// rule is now "anything that thinks, shows it", with the deterministic reads
// (registry, config, log, status polls) explicitly excluded below.
const _AI_RE = /\/api\/(box\/[^/]+\/chat|mint\/(clarify|roster\/map|run)\b|ai\/|qlegal\/(upload|ask|reindex|registers?\/|register\/[^/]+\/(hits|run)|sweep\/(refresh|families|registers)|document\/[^/]+\/(ask|reindex|category)|draft\/|sharepoint\/(scan|ingest)|embed))/;
// deterministic — never raise the "AI working" badge for a plain read
const _AI_SKIP = /\/api\/qlegal\/(registry|registers$|batch|batches|log|sweep\/status|confirms|categories|tags|concepts|rules|obligations|document\/[0-9]+$|search\?)/;
// what the badge says, so "AI working" names the actual job
function _aiLabel(u) {
  if (/upload/.test(u)) return "Reading the document — transcript, key, clauses…";
  if (/reindex/.test(u)) return "Re-indexing — re-reading the original, rebuilding the key…";
  if (/sweep\/refresh/.test(u)) return "Re-deriving keys across the estate…";
  if (/sweep\/families/.test(u)) return "Proposing families & dependencies…";
  if (/registers?\/run|register\/[^/]+\/run/.test(u)) return "Answering standing questions across the estate…";
  if (/document\/[^/]+\/ask/.test(u)) return "Reading this contract…";
  if (/qlegal\/ask/.test(u)) return "Reading the estate — registers, wikis, transcripts…";
  if (/draft\/suggest/.test(u)) return "Finding the best contracts to model on…";
  if (/draft\/run/.test(u)) return "Drafting from your model contracts…";
  if (/sharepoint\/scan/.test(u)) return "Scanning the SharePoint library…";
  if (/sharepoint\/ingest/.test(u)) return "Pulling the file in and reading it…";
  if (/embed/.test(u)) return "Building the semantic index…";
  return "AI working…";
}
const _origFetch = window.fetch.bind(window);
window.fetch = (...args) => {
  const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
  const isAI = _AI_RE.test(url) && !_AI_SKIP.test(url);
  if (isAI) window.aiSpin(true, _aiLabel(url));
  const p = _origFetch(...args);
  if (isAI) p.finally(() => window.aiSpin(false));
  return p;
};


// ---- a locked app explains itself, and lets you ask for it -------------------
// Seeing an app you can't open is only useful if it tells you what it is and gives
// you a way in. A bare "access denied" teaches nothing and leaves no trail.
window.qLocked = (key) => {
  const a = (window.Q_APP_ABOUT || {})[key] || { name: key, what: "", who: "its team" };
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" style="max-width:520px">
    <h3 style="margin:0 0 4px">🔒 ${_esc(a.name)}</h3>
    <div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5C564D;margin-bottom:12px">You don't have access to this app</div>
    <p style="line-height:1.6;margin:0 0 12px">${_esc(a.what)}</p>
    <p style="line-height:1.6;margin:0 0 16px;color:#3D3934">It's normally used by <b>${_esc(a.who)}</b>. If you need it, ask and an administrator will be notified — nothing is granted automatically.</p>
    <textarea id="qlock-note" rows="2" placeholder="Optional: why do you need it?" style="width:100%;padding:9px 11px;border:1px solid #D9D3C8;border-radius:9px;font:inherit;font-size:13px"></textarea>
    <div id="qlock-msg" style="font-size:13px;margin-top:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn" id="qlock-x">Close</button>
      <button class="btn btn--primary" id="qlock-go">Request access</button>
    </div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.onclick = (e) => { if (e.target === bg) close(); };
  bg.querySelector("#qlock-x").onclick = close;
  bg.querySelector("#qlock-go").onclick = async () => {
    const note = bg.querySelector("#qlock-note").value.trim();
    const msg = bg.querySelector("#qlock-msg");
    try {
      const r = await fetch("/api/access-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: key, note }) });
      msg.innerHTML = r.ok
        ? '<span style="color:#2E7D4F">Requested — an administrator has been notified. You\'ll keep working as normal until they grant it.</span>'
        : '<span style="color:#C0392B">Could not send that. Try again shortly.</span>';
      if (r.ok) bg.querySelector("#qlock-go").disabled = true;
    } catch { msg.innerHTML = '<span style="color:#C0392B">Could not send that. Try again shortly.</span>'; }
  };
};
