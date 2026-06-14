// Clause store — the contract MD chunked by clause (stable § refs) + the
// interpretation memory. Until a real SOW is uploaded these are stubbed; the
// chunkMd() function is what real ingestion will use.
import { q } from "./db/client.js";

// stub Kenvue clauses (replace with chunkMd(real SOW))
export function stubClauses(client = "ANSR-KENVUE") {
  return [
    { ref: "§1", title: "Parties & engagement", body: "ANSR provides GCC build-and-operate services to Kenvue Inc." },
    { ref: "§2.4", title: "Total Annual CTC", body: "Total Annual CTC = fixed salary + target annual cash bonus. Excludes long-term incentives, stock rewards, joining bonus and retention bonus." },
    { ref: "§3.1", title: "TA fee rate", body: "The TA (talent acquisition) fee is a percentage of Total Annual CTC, varying by active GCC headcount band, candidate level (non-leadership / manager / director / VP-site-leader) and referral vs non-referral. Referral hires attract a lower rate." },
    { ref: "§3.3", title: "TA milestone split", body: "The TA fee is billed in three milestones: sourcing commencement (Col C), offer acceptance (Col D) and the remaining balance one month after onboarding (Col E)." },
    { ref: "§4.2", title: "OSS fee", body: "A monthly Operations Support (OSS) fee applies based on active GCC headcount per the OSS slab table; measured at month-end with no pro-rata, using employee joining and exit dates." },
    { ref: "§5", title: "Payment terms", body: "Invoiced monthly in USD, net 30 days." },
  ];
}

// which clauses ground each analysis box (for context assembly)
export const CLAUSE_FOR_BOX = {
  company: ["§1"], legal: ["§5"], payment_terms: ["§5"],
  commercial_terms: ["§3.1", "§3.3", "§4.2"],
  billing_rules: ["§2.4", "§3.1", "§3.3", "§4.2"],
  caveats: ["§3.1", "§4.2"], flags: ["§3.1"],
};

// real chunker (heading/§-aware) — used when a true SOW MD lands.
export function chunkMd(md) {
  const lines = String(md || "").split("\n");
  const out = []; let cur = null; let ord = 0;
  const head = /^#{1,4}\s+(.*)$|^\s*(§?\d+(?:\.\d+)*)[.)]?\s+(.*)$/;
  for (const ln of lines) {
    const m = ln.match(head);
    if (m) {
      if (cur) out.push(cur);
      const ref = (m[2] || `§${++ord}`).replace(/^§?/, "§");
      cur = { ref, title: (m[3] || m[1] || "").trim(), body: "", ord: out.length + 1 };
    } else if (cur) cur.body += ln + "\n";
  }
  if (cur) out.push(cur);
  return out;
}

export async function getInterpretations(customerCode) {
  try {
    const r = await q(
      `select clause_ref, reading, compiles_to, confidence, status from interpretation
       where customer_id=(select id from customer where code=$1)`, [customerCode]);
    return r.rows || [];
  } catch { return []; }
}

export async function upsertInterpretation(customerCode, { clause_ref, reading, compiles_to, source = "user", by = "vik" }) {
  try {
    await q(
      `insert into interpretation(customer_id, clause_ref, reading, compiles_to, confidence, status, source, created_by)
       values((select id from customer where code=$1), $2, $3, $4::jsonb, 0.95, 'confirmed', $5, $6)
       on conflict (customer_id, clause_ref) do update set
         reading=excluded.reading, compiles_to=excluded.compiles_to, status='confirmed',
         source=excluded.source, updated_at=now()`,
      [customerCode, clause_ref, reading, JSON.stringify(compiles_to || null), source, by]);
    await q(`insert into audit_log(actor, action, object_type, object_id, detail)
             values($1,'interpret',$2,$3,$4::jsonb)`,
      [by, "clause", clause_ref, JSON.stringify({ reading })]).catch(() => {});
    return true;
  } catch { return false; }
}
