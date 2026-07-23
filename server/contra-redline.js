// Contra — inject tracked-change redlines into an ORIGINAL .docx, preserving
// its exact formatting. A .docx is a zip of XML; we edit word/document.xml,
// wrapping the changed text in <w:del>/<w:ins> so Word shows accept/reject
// redlines. Handles the common case where the target text sits in one run;
// redlines whose text spans runs (or isn't found verbatim) are skipped and
// reported. No new format is generated — it's the client's own file + edits.
import JSZip from "jszip";

const xmlesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Apply one redline (find → replace) to the document xml. Returns { xml, done }.
function markOne(xml, find, replace, meta) {
  const ef = xmlesc(find);
  const pos = xml.indexOf(ef);
  if (pos < 0) return { xml, done: false };

  // the <w:t ...> that encloses the match (must be w:t, not w:tbl/w:tc/w:tr)
  const preT = xml.slice(0, pos);
  const tm = [...preT.matchAll(/<w:t(?:\s[^>]*)?>/g)];
  if (!tm.length) return { xml, done: false };
  const tOpen = tm[tm.length - 1];
  const tOpenStart = tOpen.index, tOpenEnd = tOpen.index + tOpen[0].length; // char after '>'
  const tClose = xml.indexOf("</w:t>", pos);
  if (tClose < 0) return { xml, done: false };
  const tText = xml.slice(tOpenEnd, tClose);
  const rel = tText.indexOf(ef);
  if (rel < 0) return { xml, done: false }; // spans runs / not this node
  const before = tText.slice(0, rel), after = tText.slice(rel + ef.length);

  // the enclosing <w:r ...> + its rPr (formatting to clone onto the new runs)
  const preR = xml.slice(0, tOpenStart);
  const rm = [...preR.matchAll(/<w:r(?:\s[^>]*)?>/g)];
  if (!rm.length) return { xml, done: false };
  const rS = rm[rm.length - 1].index;
  const rClose = xml.indexOf("</w:r>", tClose) + 6;
  if (rClose < 6) return { xml, done: false };
  const runXml = xml.slice(rS, rClose);
  const rprMatch = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rpr = rprMatch ? rprMatch[0] : "";

  const run = (t) => (t ? `<w:r>${rpr}<w:t xml:space="preserve">${t}</w:t></w:r>` : "");
  const id1 = meta.id++, id2 = meta.id++;
  const del = `<w:del w:id="${id1}" w:author="${meta.author}" w:date="${meta.date}"><w:r>${rpr}<w:delText xml:space="preserve">${ef}</w:delText></w:r></w:del>`;
  const er = xmlesc(replace || "");
  const ins = er ? `<w:ins w:id="${id2}" w:author="${meta.author}" w:date="${meta.date}"><w:r>${rpr}<w:t xml:space="preserve">${er}</w:t></w:r></w:ins>` : "";
  const repl = run(before) + del + ins + run(after);
  return { xml: xml.slice(0, rS) + repl + xml.slice(rClose), done: true };
}

// Mark up an original .docx with tracked-change redlines. Returns
// { buffer, applied, skipped[] }.
export async function markupDocx(origBuf, redlines) {
  const zip = await JSZip.loadAsync(origBuf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("not a valid .docx (no word/document.xml)");
  let xml = await docFile.async("string");
  const meta = { author: "Contra", date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), id: 1000 };
  let applied = 0; const skipped = [];
  for (const rl of (redlines || [])) {
    if (!rl || !rl.find) continue;
    const res = markOne(xml, rl.find, rl.replace, meta);
    if (res.done) { xml = res.xml; applied++; } else skipped.push(rl.find);
  }
  zip.file("word/document.xml", xml);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, applied, skipped };
}
