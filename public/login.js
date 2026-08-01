// Soft login.
async function signIn() {
  const user = document.querySelector("#user").value.trim();
  const pw = document.querySelector("#pw").value;
  const err = document.querySelector("#err");
  const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, pw }) });
  // land where this account actually works: a single-app user goes straight in
  if (r.ok) { const j = await r.json().catch(() => ({})); location.href = j.home || "/"; return; }
  const j = await r.json().catch(() => ({}));
  err.textContent = j.error || "sign in failed";
  err.style.display = "block";
}
window.signIn = signIn;
