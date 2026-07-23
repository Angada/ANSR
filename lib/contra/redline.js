/* Contra — inject tracked-change redlines into an ORIGINAL .docx, preserving
   its exact formatting (edits word/document.xml; wraps changed text in
   <w:del>/<w:ins> so Word shows accept/reject). Portable — only needs jszip.
   Redlines whose text spans runs or isn't found verbatim are skipped + reported. */
import JSZip from "jszip";

const xmlesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function markOne(xml, find, replace, meta) {
  const ef = xmlesc(find);
  const pos = xml.indexOf(ef);
  if (pos < 0) return { xml, done: false };
  const tm = [...xml.slice(0, pos).matchAll(/<w:t(?:\s[^>]*)?>/g)];
  if (!tm.length) return { xml, done: false };
  const tOpen = tm[tm.length - 1];
  const tOpenStart = tOpen.index, tOpenEnd = tOpen.index + tOpen[0].length;
  const tClose = xml.indexOf("</w:t>", pos);
  if (tClose < 0) return { xml, done: false };
  const tText = xml.slice(tOpenEnd, tClose);
  const rel = tText.indexOf(ef);
  if (rel < 0) return { xml, done: false };
  const before = tText.slice(0, rel), after = tText.slice(rel + ef.length);
  const rm = [...xml.slice(0, tOpenStart).matchAll(/<w:r(?:\s[^>]*)?>/g)];
  if (!rm.length) return { xml, done: false };
  const rS = rm[rm.length - 1].index;
  const rClose = xml.indexOf("</w:r>", tClose) + 6;
  if (rClose < 6) return { xml, done: false };
  const rpr = (xml.slice(rS, rClose).match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0];
  const run = (t) => (t ? `<w:r>${rpr}<w:t xml:space="preserve">${t}</w:t></w:r>` : "");
  const del = `<w:del w:id="${meta.id++}" w:author="${meta.author}" w:date="${meta.date}"><w:r>${rpr}<w:delText xml:space="preserve">${ef}</w:delText></w:r></w:del>`;
  const er = xmlesc(replace || "");
  const ins = er ? `<w:ins w:id="${meta.id++}" w:author="${meta.author}" w:date="${meta.date}"><w:r>${rpr}<w:t xml:space="preserve">${er}</w:t></w:r></w:ins>` : "";
  return { xml: xml.slice(0, rS) + run(before) + del + ins + run(after) + xml.slice(rClose), done: true };
}

// markupDocx(originalDocxBuffer, [{find, replace}], {author}) → { buffer, applied, skipped }
export async function markupDocx(origBuf, redlines, { author = "Contra" } = {}) {
  const zip = await JSZip.loadAsync(origBuf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("not a valid .docx (no word/document.xml)");
  let xml = await docFile.async("string");
  const meta = { author, date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), id: 1000 };
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
