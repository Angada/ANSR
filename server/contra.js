// Contra — contract review app. Phase 1: the Archetype Maker.
// Upload a sample → Munshi/OCR extract → contra-archetype proposes the review
// SECTIONS → reviewer confirms/amends + tags Required → save as an archetype.
// Everything persists (draft rows) so you can leave and come back.
import { readFileSync, rmSync } from "node:fs";
import { q } from "./db/client.js";
import { extractFile } from "./extract.js";
import { runPipeline } from "./ai.js";

const slugify = (s) => String(s || "archetype").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", "·").replace(/:/g, "");

// pull the first JSON object out of an LLM reply (tolerates prose / code fences)
function jparse(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// A sane starter outline when there's no LLM key (or a parse miss) — so the
// Archetype Maker is never a dead end; the reviewer edits from here.
const GENERIC_OUTLINE = [
  { key: "particulars", label: "Particulars", what_to_check: "Effective date, term dates, contract value, key identifiers.", required: true },
  { key: "parties", label: "Parties", what_to_check: "Legal names, roles, signatories, authority to sign.", required: true },
  { key: "commercial_terms", label: "Commercial terms", what_to_check: "Fees, rate card, rebates, escalators, caps.", required: true },
  { key: "payment_terms", label: "Payment terms", what_to_check: "Currency, due days, invoicing, late-payment terms.", required: true },
  { key: "liability", label: "Liability", what_to_check: "Liability cap and any carve-outs that undercut it.", required: true },
  { key: "indemnity", label: "Indemnity", what_to_check: "Who indemnifies whom; carve-outs; sub-caps.", required: true },
  { key: "term_termination", label: "Term & termination", what_to_check: "Duration, renewal, termination rights and notice.", required: true },
  { key: "governing_law", label: "Governing law", what_to_check: "Governing law and dispute-resolution forum.", required: true },
];

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// normalise a plain-English review-rule list [{id,text,created_at}]
function normRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .filter((r) => r && String(r.text || "").trim())
    .map((r) => ({ id: r.id || rid(), text: String(r.text).slice(0, 300), created_at: r.created_at || new Date().toISOString() }));
}

// normalise proposed sections → the review_outline shape (rules preserved)
function toOutline(sections) {
  return (Array.isArray(sections) ? sections : []).map((s, i) => ({
    key: slugify(s.key || s.label || `section_${i + 1}`).replace(/-/g, "_"),
    label: String(s.label || s.key || `Section ${i + 1}`).slice(0, 80),
    what_to_check: String(s.what_to_check || "").slice(0, 400),
    required: s.required !== false,
    order: i,
    rules: normRules(s.rules),
  }));
}

// full-app AI log: every gated pipeline call is recorded (best-effort).
async function logRun(out, { ref_type, ref_id, rules_applied, input, output } = {}) {
  try {
    await q(
      `insert into contra_log(pipeline,provider,model,ref_type,ref_id,rules_applied,input_summary,output_summary,status)
       values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [out.pipeline || null, out.provider || null, out.model || null, ref_type || null, ref_id || null,
       JSON.stringify(rules_applied || []), String(input || "").slice(0, 300), String(output || "").slice(0, 500), out.mode || null]
    );
  } catch { /* logging is best-effort — never blocks the review */ }
}

export function mountContra(app, upload) {
  // Upload a sample contract → propose the review sections → persist a draft.
  app.post("/api/contra/archetype/propose", upload.single("file"), async (req, res) => {
    const f = req.file;
    if (!f) return res.status(400).json({ error: "no file" });
    try {
      const extract = await extractFile(f.path, f.originalname);       // Munshi + OCR path
      const text = String(extract.text || "").slice(0, 60000);
      if (!text.trim()) return res.status(422).json({ error: "could not read any text from that file" });

      // STEP · propose the review sections (gated pipeline)
      const out = await runPipeline("contra-archetype", { user: text, maxTokens: 2000 });
      await logRun(out, { ref_type: "archetype", input: f.originalname, output: "propose sections" });
      const parsed = jparse(out.text) || {};
      let outline = toOutline(parsed.sections);
      if (!outline.length) outline = toOutline(GENERIC_OUTLINE);   // no key / parse miss → starter
      const name = (parsed.name || req.body.name || f.originalname.replace(/\.[^.]+$/, "")).slice(0, 80);

      // STEP · suggest rules + required flags from the sample's actual terms (gated)
      try {
        const rout = await runPipeline("contra-rules", {
          user: `Contract:\n${text.slice(0, 40000)}\n\nProposed sections: ${JSON.stringify(outline.map((s) => ({ key: s.key, label: s.label })))}`,
          maxTokens: 1500,
        });
        await logRun(rout, { ref_type: "archetype", input: `${outline.length} sections`, output: "suggest rules" });
        const rparsed = jparse(rout.text);
        if (rparsed?.sections?.length) {
          const bykey = Object.fromEntries(rparsed.sections.map((s) => [s.key, s]));
          outline = outline.map((s) => {
            const r = bykey[s.key];
            if (!r) return s;
            return {
              ...s,
              required: r.required !== undefined ? r.required !== false : s.required,
              rules: normRules((r.rules || []).map((t) => ({ text: t }))),
            };
          });
        }
      } catch { /* rules are best-effort — the outline still saves */ }

      const { rows } = await q(
        `insert into contra_archetype(name, status, review_outline, source_doc)
         values($1,'draft',$2::jsonb,$3) returning id, name, status, review_outline, created_at`,
        [name, JSON.stringify(outline), f.originalname]
      );
      const row = rows[0];
      res.json({ id: row.id, name: row.name, status: row.status, sections: row.review_outline, ocr: !!extract.ocr, mode: out.mode });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e).slice(0, 200) });
    } finally {
      try { rmSync(f.path); } catch { /* ignore */ }
    }
  });

  // List archetypes (saved first, then drafts) — for the library + detect.
  app.get("/api/contra/archetypes", async (_req, res) => {
    const { rows } = await q(
      `select id, name, slug, status, jsonb_array_length(review_outline) as sections,
              source_doc, created_at, updated_at
         from contra_archetype order by (status='saved') desc, updated_at desc`
    );
    res.json({ archetypes: rows });
  });

  app.get("/api/contra/archetype/:id", async (req, res) => {
    const { rows } = await q(`select * from contra_archetype where id=$1`, [Number(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ archetype: rows[0] });
  });

  // Save/confirm an archetype: persist the edited outline + Required flags, name
  // it, and (on save) stamp the slug with a timestamp suffix + build the signature.
  app.post("/api/contra/archetype/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { name, review_outline, global_rules, save } = req.body || {};
    const outline = review_outline ? toOutline(review_outline) : null;
    const gRules = global_rules ? normRules(global_rules) : null;
    const signature = outline
      ? { keys: outline.filter((s) => s.required).map((s) => s.key), labels: outline.map((s) => s.label) }
      : null;
    // status only advances on explicit save; autosaves keep the current status
    // (so editing a saved archetype's rules doesn't downgrade it to draft).
    const status = save ? "saved" : null;
    const slug = save && name ? `${slugify(name)}-${stamp()}` : null;

    const { rows } = await q(
      `update contra_archetype set
         name = coalesce($2, name),
         review_outline = coalesce($3::jsonb, review_outline),
         global_rules = coalesce($4::jsonb, global_rules),
         detect_signature = coalesce($5::jsonb, detect_signature),
         status = coalesce($6, status),
         slug = coalesce(slug, $7),
         updated_at = now()
       where id=$1
       returning id, name, slug, status, review_outline, global_rules, updated_at`,
      [id, name || null, outline ? JSON.stringify(outline) : null, gRules ? JSON.stringify(gRules) : null,
       signature ? JSON.stringify(signature) : null, status, slug]
    );
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ archetype: rows[0] });
  });

  app.delete("/api/contra/archetype/:id", async (req, res) => {
    await q(`delete from contra_archetype where id=$1`, [Number(req.params.id)]);
    res.json({ ok: true });
  });
}
