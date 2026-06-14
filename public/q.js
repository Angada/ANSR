// Shared UI: app header (logo home · Admin tab · user + role) + Dubai date util.
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Dubai time, dd-MMM-yyyy (e.g. 14-JUN-2026).
window.fmtDubai = (ts) => {
  const d = ts ? new Date(ts) : new Date();
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric" })
    .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return `${p.day}-${MON[+p.month - 1]}-${p.year}`;
};

// Inject the app header into #appbar. activeTab: 'home' | 'admin'.
window.qHeader = async (activeTab = "home") => {
  let me = { user: "—", role: "" };
  try { me = await (await fetch("/api/me")).json(); } catch {}
  const el = document.querySelector("#appbar");
  if (!el) return;
  el.outerHTML = `
  <header class="appbar">
    <a href="/" class="logo" title="Home"><img src="/brand/assets/logos/QAnsr-logo.png" alt="Q&ANSR"></a>
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
