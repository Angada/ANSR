// ============================================================================
// SUPER FILTER (colf*) — one column-header sort+filter for every table.
// Ported from the GoSavvy OS enquiry table. Vanilla DOM, zero dependencies,
// self-injecting CSS — drop the <script> in and feed it rows + a COLS spec.
//
// NOTE ON PORTING: class names are namespaced `colf*` on purpose. The reference
// implementation used .fchip/.fbar, which collide with Q-Legal's existing
// saved-question gem strip — an app you port into may already own those names.
//
// THE UX: every column header IS the control. Click it and you get sort
// (asc/desc, column-specific labels) plus a searchable multi-select of that
// column's values, each with a LIVE count that respects the other active
// filters — so counts never go stale. Type to narrow, ↑/↓ to move, Enter ticks
// AND clears the box so you can tick several in a row, Esc closes. Active
// filters render as removable chips above the table. No filter row, no clutter.
//
// THE SPEC (the only thing you write per table):
//   { key, label, get(row)->value|values[], opts?, cmp?, sortLabels?, num?,
//     noFilter?, noSort?, fmt?, hint?, onSel? }
//   Omit `opts` to derive the options from the data, with counts.
//
// THE RECIPE (~15 lines):
//   const st = colfState();
//   const draw = () => {
//     const rows = colfSort(COLS, st, colfRows(COLS, st, ALL), fallbackCmp);
//     host.innerHTML = colfChips(COLS, st, ALL)
//       + `<table>${colfHead(COLS, st)}<tbody>${rows.map(rowHTML).join("")}</tbody></table>`;
//     colfWire(COLS, st, ALL, draw);   // re-call after EVERY render
//   };
//   draw();
// ============================================================================
(function () {
  if (window.colfState) return;                    // idempotent
  const esc = (s) => String(s ?? "").replace(/[&<>"'`]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[m]));

  const CSS = `
.colf{background:none;border:none;font:inherit;color:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:0;text-align:left;white-space:nowrap}
.colf:hover{color:var(--org,#CE4502)}
.colf-b{color:var(--org,#CE4502)}
.colf-n{font-size:10px;font-weight:700;background:var(--org,#CE4502);color:#fff;border-radius:999px;padding:1px 6px;line-height:1.5}
.car{font-size:9px;opacity:.7}
.cfp{position:absolute;z-index:80;background:#fff;border:1px solid var(--line2,#D9D3C8);border-radius:12px;
  box-shadow:0 20px 50px -20px rgba(0,36,46,.45);padding:9px;min-width:248px;max-width:330px;font-family:var(--sans,system-ui)}
.cfp .srt{display:block;width:100%;text-align:left;background:none;border:none;font:inherit;font-size:12.5px;color:var(--txt,#141414);
  padding:7px 9px;border-radius:8px;cursor:pointer}
.cfp .srt:hover{background:var(--bg2,#F9FAFB)}
.cfp .srt.on{color:var(--org,#CE4502);font-weight:600;background:var(--tint,#FFF1E9)}
.cfp .sep{height:1px;background:var(--line,#E7E3DC);margin:7px 0}
.cfp input.cfq{width:100%;font:inherit;font-size:13px;border:1px solid var(--line2,#D9D3C8);border-radius:8px;padding:7px 9px;margin-bottom:7px}
.cfp input.cfq:focus{outline:none;border-color:var(--org,#CE4502)}
.cfl{max-height:236px;overflow-y:auto}
.cfo{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--txt,#141414)}
.cfo:hover,.cfo.hi{background:var(--bg2,#F9FAFB)}
.cfo.off{opacity:.45}
.cfo .bx{width:15px;height:15px;border-radius:4px;border:1.5px solid var(--line2,#D9D3C8);flex:0 0 auto;display:grid;place-items:center;font-size:11px;color:#fff}
.cfo.on .bx{background:var(--org,#CE4502);border-color:var(--org,#CE4502)}
.cfo .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cfo .n{font-size:11.5px;color:var(--dim,#3D3934);font-variant-numeric:tabular-nums}
.cfp .acts{display:flex;gap:8px;margin-top:8px;border-top:1px solid var(--line,#E7E3DC);padding-top:8px}
.cfp .acts button{flex:1;font:inherit;font-size:12.5px;background:none;border:1px solid var(--line2,#D9D3C8);border-radius:8px;padding:6px;cursor:pointer;color:var(--txt,#141414)}
.cfp .acts button:hover{border-color:var(--org,#CE4502);color:var(--org,#CE4502)}
.colfbar{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:0 0 12px}
.colfchip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;background:var(--tint,#FFF1E9);color:var(--org,#CE4502);
  border:1px solid #F3D6C2;border-radius:999px;padding:4px 11px}
.colfchip .x{cursor:pointer;font-weight:700;opacity:.75}
.colfchip .x:hover{opacity:1}
.colfclear{font-size:12.5px;background:none;border:none;color:var(--dim,#3D3934);cursor:pointer;text-decoration:underline}
.colfclear:hover{color:var(--org,#CE4502)}`;

  function css() {
    if (document.getElementById("colf-css")) return;
    const s = document.createElement("style"); s.id = "colf-css"; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---- value extraction: get() may return a single value or an array --------
  const ids = (col, row) => {
    const v = col.get ? col.get(row) : row[col.key];
    return (Array.isArray(v) ? v : [v]).map((x) => (x === null || x === undefined || x === "" ? "—" : String(x)));
  };
  const label = (col, id) => (col.fmt ? col.fmt(id) : id);

  // Options, with counts. Counts are computed over rows filtered by every OTHER
  // column (skip this one) so they answer "if I tick this, what will I get?".
  function opts(col, st, all) {
    const base = colfRows(window.__colfCols || [], st, all, col.key);
    const n = new Map();
    for (const r of base) for (const id of ids(col, r)) n.set(id, (n.get(id) || 0) + 1);
    let list;
    if (typeof col.opts === "function") list = col.opts(all);
    else if (Array.isArray(col.opts)) list = col.opts.slice();
    else {
      list = [...new Set(all.flatMap((r) => ids(col, r)))].sort((a, b) =>
        col.num ? (+a || 0) - (+b || 0) : String(a).localeCompare(String(b), undefined, { numeric: true }));
      list = list.map((id) => ({ id, label: label(col, id) }));
    }
    return list.map((o) => ({ ...o, n: n.get(String(o.id)) || 0 }));
  }

  // ---- public primitives ----------------------------------------------------
  window.colfState = (init = {}) => ({ sel: {}, sortKey: init.sortKey || null, sortDir: init.sortDir || "asc" });

  window.colfRows = (cols, st, rows, skip) => rows.filter((r) =>
    cols.every((c) => {
      if (c.key === skip) return true;
      const s = st.sel[c.key];
      if (!s || !s.size) return true;
      return ids(c, r).some((id) => s.has(id));
    }));

  window.colfSort = (cols, st, rows, fallback) => {
    const out = rows.slice();
    const col = cols.find((c) => c.key === st.sortKey);
    if (!col) return fallback ? out.sort(fallback) : out;
    const dir = st.sortDir === "desc" ? -1 : 1;
    return out.sort((a, b) => {
      if (col.cmp) return col.cmp(a, b) * dir;
      const x = ids(col, a)[0], y = ids(col, b)[0];
      if (col.num) return ((+x || 0) - (+y || 0)) * dir;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
    });
  };

  window.colfHead = (cols, st, lead = "", tail = "") => {
    css();
    const th = cols.map((c) => {
      const s = st.sel[c.key];
      const on = s && s.size;
      const arrow = st.sortKey === c.key ? `<span class="car">${st.sortDir === "asc" ? "▲" : "▼"}</span>` : "";
      const inner = (c.noFilter && c.noSort)
        ? esc(c.label)
        : `<button class="colf ${on ? "colf-b" : ""}" data-colf="${esc(c.key)}"${c.hint ? ` title="${esc(c.hint)}"` : ""}>
             ${esc(c.label)}${on ? `<span class="colf-n">${s.size}</span>` : ""}${arrow}<span class="car">⌄</span></button>`;
      return `<th${c.num ? ' style="text-align:right"' : ""}>${inner}</th>`;
    }).join("");
    return `<thead><tr>${lead}${th}${tail}</tr></thead>`;
  };

  window.colfChips = (cols, st, all) => {
    const chips = [];
    for (const c of cols) {
      const s = st.sel[c.key];
      if (!s || !s.size) continue;
      for (const id of s) chips.push(
        `<span class="colfchip">${esc(c.label)}: ${esc(label(c, id))}<span class="x" data-colfx="${esc(c.key)}" data-id="${esc(id)}">✕</span></span>`);
    }
    if (!chips.length) return "";
    return `<div class="colfbar">${chips.join("")}<button class="colfclear" data-colfclear>Clear all</button></div>`;
  };

  // Wire header buttons + chip ✕. Call after EVERY render (innerHTML wipes handlers).
  window.colfWire = (cols, st, all, onChange) => {
    css();
    window.__colfCols = cols;                       // opts() needs the spec for cross-column counts
    document.querySelectorAll("[data-colfx]").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const k = el.dataset.colfx, s = st.sel[k];
        if (s) { s.delete(el.dataset.id); if (!s.size) delete st.sel[k]; }
        cols.find((c) => c.key === k)?.onSel?.(st.sel[k] || new Set());
        onChange();
      };
    });
    document.querySelector("[data-colfclear]") && (document.querySelector("[data-colfclear]").onclick = () => {
      for (const k of Object.keys(st.sel)) { delete st.sel[k]; cols.find((c) => c.key === k)?.onSel?.(new Set()); }
      onChange();
    });
    document.querySelectorAll("[data-colf]").forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); panel(btn, cols.find((c) => c.key === btn.dataset.colf), st, all, onChange); };
    });
  };

  // ---- the panel -----------------------------------------------------------
  function closePanel() { document.querySelector(".cfp")?.remove(); }
  document.addEventListener("click", (e) => { if (!e.target.closest(".cfp")) closePanel(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

  function panel(btn, col, st, all, onChange) {
    const open = document.querySelector(".cfp");
    if (open && open.dataset.k === col.key) return closePanel();
    closePanel();
    const p = document.createElement("div");
    p.className = "cfp"; p.dataset.k = col.key;
    const sel = st.sel[col.key] || new Set();
    const list = col.noFilter ? [] : opts(col, st, all);
    const [asc, desc] = col.sortLabels || (col.num ? ["Lowest first", "Highest first"] : ["A → Z", "Z → A"]);
    p.innerHTML =
      (col.noSort ? "" : `
        <button class="srt ${st.sortKey === col.key && st.sortDir === "asc" ? "on" : ""}" data-s="asc">↑ ${esc(asc)}</button>
        <button class="srt ${st.sortKey === col.key && st.sortDir === "desc" ? "on" : ""}" data-s="desc">↓ ${esc(desc)}</button>`)
      + (col.noSort || col.noFilter ? "" : `<div class="sep"></div>`)
      + (col.noFilter ? "" : `
        <input class="cfq" placeholder="Search ${esc(col.label).toLowerCase()}…">
        <div class="cfl">${list.map((o) => optRow(o, sel)).join("") || '<div class="cfo off"><span class="tx">nothing to filter</span></div>'}</div>
        <div class="acts"><button data-all>Select all</button><button data-none>Clear</button></div>`);
    document.body.appendChild(p);
    // position under the header, kept inside the viewport
    const r = btn.getBoundingClientRect();
    p.style.top = `${window.scrollY + r.bottom + 6}px`;
    p.style.left = `${Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - p.offsetWidth - 12)}px`;

    p.querySelectorAll(".srt").forEach((b) => b.onclick = () => {
      st.sortKey = col.key; st.sortDir = b.dataset.s; closePanel(); onChange();
    });
    const apply = (next) => {
      if (next.size) st.sel[col.key] = next; else delete st.sel[col.key];
      col.onSel?.(next);
      onChange();
    };
    const q = p.querySelector(".cfq");
    const relist = () => {
      const term = (q?.value || "").toLowerCase().trim();
      const cur = st.sel[col.key] || new Set();
      p.querySelector(".cfl").innerHTML = list
        .filter((o) => !term || String(o.label).toLowerCase().includes(term))
        .map((o) => optRow(o, cur)).join("") || '<div class="cfo off"><span class="tx">no match</span></div>';
      wireOpts();
    };
    const wireOpts = () => p.querySelectorAll("[data-oid]").forEach((el) => el.onclick = () => {
      const next = new Set(st.sel[col.key] || []);
      const id = el.dataset.oid;
      next.has(id) ? next.delete(id) : next.add(id);
      apply(next);
      // the table re-renders under us; keep the panel open for multi-tick
      setTimeout(() => panel(document.querySelector(`[data-colf="${col.key}"]`) || btn, col, st, all, onChange), 0);
    });
    wireOpts();
    if (q) {
      q.focus();
      q.oninput = relist;
      q.onkeydown = (e) => {
        const rows = [...p.querySelectorAll("[data-oid]")];
        let i = rows.findIndex((x) => x.classList.contains("hi"));
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          rows[i]?.classList.remove("hi");
          i = e.key === "ArrowDown" ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0);
          rows[i]?.classList.add("hi"); rows[i]?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter") {
          e.preventDefault();
          (rows[i < 0 ? 0 : i])?.click();       // tick…
          q.value = ""; relist();               // …and clear, so you can tick several
        }
      };
    }
    p.querySelector("[data-all]") && (p.querySelector("[data-all]").onclick = () => apply(new Set(list.map((o) => String(o.id)))));
    p.querySelector("[data-none]") && (p.querySelector("[data-none]").onclick = () => apply(new Set()));
  }

  const optRow = (o, sel) => `<div class="cfo ${sel.has(String(o.id)) ? "on" : ""} ${o.n ? "" : "off"}" data-oid="${esc(o.id)}">
      <span class="bx">${sel.has(String(o.id)) ? "✓" : ""}</span>
      <span class="tx" title="${esc(o.label)}">${esc(o.label)}</span><span class="n">${o.n}</span></div>`;
})();
