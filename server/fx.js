// FX rates — cache in fx_rate, fetch a free no-key API on miss, allow manual pin.
import { q } from "./db/client.js";

const mem = new Map(); // process cache: `${from}:${to}:${date}` → rate

export async function getRate(from, to, date) {
  from = (from || "").toUpperCase(); to = (to || "").toUpperCase();
  if (!from || !to || from === to) return { rate: 1, source: "same" };
  const day = (date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const key = `${from}:${to}:${day}`;
  if (mem.has(key)) return mem.get(key);

  // 1) cache / manual override in fx_rate (effective on/before the day, newest first)
  try {
    const r = await q(
      `select rate, source from fx_rate where from_ccy=$1 and to_ccy=$2 and effective_from<=$3
       order by (source='manual') desc, effective_from desc limit 1`, [from, to, day]);
    if (r.rows?.[0]) { const v = { rate: Number(r.rows[0].rate), source: r.rows[0].source }; mem.set(key, v); return v; }
  } catch { /* ignore */ }

  // 2) live fetch (frankfurter.app — free, no key, historical supported)
  try {
    const res = await fetch(`https://api.frankfurter.app/${day}?from=${from}&to=${to}`);
    const j = await res.json();
    const rate = j?.rates?.[to];
    if (rate) {
      const v = { rate: Number(rate), source: "api" };
      mem.set(key, v);
      q(`insert into fx_rate(from_ccy,to_ccy,rate,effective_from,source) values($1,$2,$3,$4,'api')
         on conflict do nothing`, [from, to, rate, day]).catch(() => {});
      return v;
    }
  } catch { /* offline / api down */ }

  return { rate: null, source: "unavailable" }; // caller raises a clarification/exception
}

// pin a manual / contract-fixed rate
export async function setManualRate(from, to, rate, effective_from) {
  from = from.toUpperCase(); to = to.toUpperCase();
  mem.clear();
  await q(`insert into fx_rate(from_ccy,to_ccy,rate,effective_from,source) values($1,$2,$3,$4,'manual')
           on conflict (from_ccy,to_ccy,effective_from,source) do update set rate=excluded.rate`,
    [from, to, rate, (effective_from || new Date().toISOString().slice(0, 10))]);
  return { ok: true };
}
