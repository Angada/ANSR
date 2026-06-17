// FX rates (DB-injected): cache in fx_rate, fetch a free no-key API on miss,
// manual pin. createFx(q) where q(text, params) → { rows }.
export function createFx(q) {
  const mem = new Map();
  async function getRate(from, to, date) {
    from = (from || "").toUpperCase(); to = (to || "").toUpperCase();
    if (!from || !to || from === to) return { rate: 1, source: "same" };
    const day = (date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const key = `${from}:${to}:${day}`;
    if (mem.has(key)) return mem.get(key);
    try {
      const r = await q(`select rate, source from fx_rate where from_ccy=$1 and to_ccy=$2 and effective_from<=$3
        order by (source='manual') desc, effective_from desc limit 1`, [from, to, day]);
      if (r.rows?.[0]) { const v = { rate: Number(r.rows[0].rate), source: r.rows[0].source }; mem.set(key, v); return v; }
    } catch { /* */ }
    try {
      const j = await (await fetch(`https://api.frankfurter.app/${day}?from=${from}&to=${to}`)).json();
      const rate = j?.rates?.[to];
      if (rate) {
        const v = { rate: Number(rate), source: "api" }; mem.set(key, v);
        q(`insert into fx_rate(from_ccy,to_ccy,rate,effective_from,source) values($1,$2,$3,$4,'api') on conflict do nothing`, [from, to, rate, day]).catch(() => {});
        return v;
      }
    } catch { /* */ }
    return { rate: null, source: "unavailable" };
  }
  async function setManualRate(from, to, rate, effective_from) {
    mem.clear();
    await q(`insert into fx_rate(from_ccy,to_ccy,rate,effective_from,source) values($1,$2,$3,$4,'manual')
      on conflict (from_ccy,to_ccy,effective_from,source) do update set rate=excluded.rate`,
      [from.toUpperCase(), to.toUpperCase(), rate, effective_from || new Date().toISOString().slice(0, 10)]);
    return { ok: true };
  }
  return { getRate, setManualRate };
}
