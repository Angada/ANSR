// Contra — branded Word (.docx) export of a contract review. Q&ANSR emblem in
// the header, a filename/id/date ref line, and a footer on every page.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Header, Footer, PageNumber, ImageRun, BorderStyle } from "docx";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ORG = "CE4502", INK = "141414", DIM = "54504A", MUTE = "9A938A";
const V_COLOR = { present: "2E7D4F", non_standard: "8A6D1F", risky: "C77B2B", missing: "C0392B" };
const R_COLOR = { pass: "2E7D4F", check: "8A6D1F", breach: "C0392B" };

function emblemBuf() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    return readFileSync(join(root, "brand", "assets", "logos", "q-emblem.png"));
  } catch { return null; }
}

const label = (t) => new Paragraph({ spacing: { before: 220, after: 80 }, children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 16, color: MUTE, characterSpacing: 20 })] });
const line = (runs, opts = {}) => new Paragraph({ spacing: { after: 90 }, ...opts, children: runs });

export async function buildReviewDocx(review) {
  const rep = review.report || {};
  const emblem = emblemBuf();
  const date = new Date(rep.generated_at || Date.now()).toLocaleDateString();
  const ref = `Ref: ${review.contract_name || "contract"} · Review #${review.id} · ${(rep.archetypes || []).join(" + ") || "—"} · ${date}`;

  const header = new Header({
    children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "E7E3DC" } },
      spacing: { after: 60 },
      children: [
        ...(emblem ? [new ImageRun({ type: "png", data: emblem, transformation: { width: 18, height: 18 } }), new TextRun({ text: "  " })] : []),
        new TextRun({ text: "Q&ANSR", bold: true, size: 18, color: ORG }),
        new TextRun({ text: "  ·  Contract Review", size: 18, color: DIM }),
      ],
    })],
  });
  const footer = new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: "E7E3DC" } },
      spacing: { before: 60 },
      children: [
        new TextRun({ text: `${review.contract_name || "contract"} · Review #${review.id} · Generated ${date} · an AI product by The Kettle Black · Page `, size: 14, color: MUTE }),
        new TextRun({ children: [PageNumber.CURRENT], size: 14, color: MUTE }),
      ],
    })],
  });

  const body = [];
  body.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "Contract Review", bold: true, size: 40, color: INK })] }));
  body.push(line([new TextRun({ text: ref, size: 16, color: MUTE })]));
  body.push(line([new TextRun({ text: `${review.issue_count || 0} issue${review.issue_count === 1 ? "" : "s"} flagged`, bold: true, size: 18, color: review.issue_count ? R_COLOR.breach : V_COLOR.present })]));

  if (rep.summary) { body.push(label("Summary")); body.push(line([new TextRun({ text: rep.summary, size: 20, color: DIM })])); }

  if ((rep.rule_checks || []).length) {
    body.push(label("Your rule checks"));
    for (const c of rep.rule_checks) {
      body.push(line([
        new TextRun({ text: `${String(c.result || "check").toUpperCase()}  `, bold: true, size: 18, color: R_COLOR[c.result] || R_COLOR.check }),
        new TextRun({ text: `${c.rule || c.section_key || ""} — ${c.note || c.found || ""} `, size: 18, color: INK }),
        new TextRun({ text: (c.refs || []).join(" "), size: 16, color: "005465" }),
      ]));
    }
  }
  if ((rep.findings || []).length) {
    body.push(label("Whole-contract findings"));
    for (const f of rep.findings) {
      body.push(line([
        new TextRun({ text: `${String(f.kind || "finding").replace(/_/g, " ")} — `, bold: true, size: 18, color: "8A5410" }),
        new TextRun({ text: `${f.note || ""} `, size: 18, color: INK }),
        new TextRun({ text: (f.refs || []).join(" "), size: 16, color: "005465" }),
      ]));
    }
  }
  if ((rep.verdicts || []).length) {
    body.push(label("Section review"));
    for (const v of rep.verdicts) {
      body.push(line([
        new TextRun({ text: `${String(v.key || "").replace(/_/g, " ")}: `, bold: true, size: 18, color: INK }),
        new TextRun({ text: `${String(v.verdict || "").replace(/_/g, " ").toUpperCase()} `, bold: true, size: 16, color: V_COLOR[v.verdict] || DIM }),
        new TextRun({ text: `— ${v.note || ""} `, size: 18, color: DIM }),
        new TextRun({ text: (v.evidence_refs || []).join(" "), size: 16, color: "005465" }),
      ]));
    }
  }

  const doc = new Document({ sections: [{ properties: {}, headers: { default: header }, footers: { default: footer }, children: body }] });
  return Packer.toBuffer(doc);
}
