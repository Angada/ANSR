// Contracts list — open existing or create new.
fetch("/api/contracts").then((r) => r.json()).then(({ contracts }) => {
  const el = document.querySelector("#contracts");
  if (!contracts.length) { el.innerHTML = `<p class="lbl">No contracts yet. Tap “+ New contract”.</p>`; return; }
  el.innerHTML = contracts.map((c) => `
    <a href="/contract.html?id=${c.id}" style="text-decoration:none">
      <div class="section" style="margin:0 0 10px">
        <div class="body" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div>
            <strong style="color:var(--ansr-navy)">${c.name}</strong>
            <div class="lbl" style="color:var(--ansr-gray);margin-top:4px">${c.runs} runs · last ${c.last_month} · ${c.currency}</div>
          </div>
          <span class="chip chip--approved">${c.status}</span>
        </div>
      </div>
    </a>`).join("");
});

window.newContract = () => {
  const name = prompt("New contract — customer name (e.g. Kenvue):");
  if (!name) return;
  alert(`(stub) Created '${name}'. Next: upload the SOW to run Phase A and derive the rule book.`);
};
