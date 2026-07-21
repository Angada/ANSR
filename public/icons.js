// Shared inline-SVG icon set — replaces all emoji. Monochrome, currentColor,
// CSP-safe (no external assets). Usage: ic("target") or ic("target", 18).
(function () {
  const P = {
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>',
    pin: '<path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z"/><circle cx="12" cy="11" r="2.2"/>',
    monitor: '<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16.5V20"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5 16 12l-6 3.5Z" fill="currentColor" stroke="none"/>',
    bank: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M12 3 20 8H4l8-5Z"/><path d="M8 12v5M12 12v5M16 12v5"/>',
    spark: '<path d="M11 2.5c.5 4.4 1.9 5.8 6.3 6.3-4.4.5-5.8 1.9-6.3 6.3-.5-4.4-1.9-5.8-6.3-6.3 4.4-.5 5.8-1.9 6.3-6.3Z" fill="currentColor" stroke="none"/><path d="M18.5 14c.2 1.7.8 2.3 2.5 2.5-1.7.2-2.3.8-2.5 2.5-.2-1.7-.8-2.3-2.5-2.5 1.7-.2 2.3-.8 2.5-2.5Z" fill="currentColor" stroke="none"/>',
    exa: '<path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18" stroke-width="1.3"/>',
    doc: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="1.5"/><path d="M4 9h16M8 3v4M16 3v4"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    ruler: '<path d="M3 15 15 3l6 6L9 21Z"/><path d="M8 8l2 2M11 5l2 2M5 11l2 2"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" fill="currentColor" stroke="none"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    book: '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2Z"/><path d="M18 20a2 2 0 0 0-2-2H5"/>',
    plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0Z"/><path d="M12 16v5"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6Z"/><path d="m9 12 2 2 4-4"/>',
    newspaper: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M7 9h6M7 12h6M7 15h4M16 9h2v6h-2Z"/>',
    message: '<path d="M4 5h16v11H9l-4 3v-3H4Z"/><path d="M8 10h8M8 13h5"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
    box: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 10h16M10 4v16"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6"/>',
    edit: '<path d="M14 4 20 10 9 21H3v-6Z"/><path d="M13.5 4.5 19.5 10.5"/>',
    x: '<path d="M6 6 18 18M18 6 6 18"/>',
    save: '<path d="M5 3h11l3 3v15H5Z"/><path d="M8 3v6h7V3M8 21v-6h8v6"/>',
    refresh: '<path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 21V9M7 13l5-5 5 5M5 3h14"/>',
    robot: '<rect x="5" y="8" width="14" height="10" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01M8 18v2M16 18v2"/>',
    users: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3.2 3.2 0 0 1 0 5.6M17 20a5.5 5.5 0 0 0-2.2-4.4"/>',
    key: '<circle cx="8" cy="14" r="3.5"/><path d="m10.5 11.5 8-8M16 6l2 2M14 8l2 2"/>',
  };
  const ALIAS = { youtube: "play", reddit: "message", newsapi: "newspaper", serpapi: "chart", perplexity: "search", tavily: "compass", serper: "search", exa: "spark", brave: "shield", factcheck: "checkCircle", wikidata: "book", integration: "plug" };
  window.ic = function (name, size = 16) {
    const key = P[name] ? name : (ALIAS[name] || "plug");
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.18em;flex:0 0 auto">${P[key] || P.plug}</svg>`;
  };
  // hydrate any static <span data-ic="name"> in page HTML
  const hydrate = () => document.querySelectorAll("[data-ic]").forEach((el) => { el.innerHTML = window.ic(el.getAttribute("data-ic"), Number(el.getAttribute("data-ic-size")) || 16); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hydrate); else hydrate();
})();
