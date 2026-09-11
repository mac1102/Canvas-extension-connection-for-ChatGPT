import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parseDocument, detectDocumentType } from "../src/parsers/index.js";
for (const [filename, text, expected] of [["note.txt", "Plain note", "Plain note"], ["note.md", "# Heading", "Heading"], ["table.csv", "a,b\n1,2", "1,2"], ["data.json", '{"a":1}', '"a": 1'], ["page.html", '<script>BAD</script><p>Hello &amp; safe</p>', 'Hello & safe'], ["data.xml", '<root><item>Value</item></root>', "Value"]]) {
  test(`local parser: ${filename}`, async () => { const result = await parseDocument({ filename, bytes: strToU8(text) }); assert.ok(result.text.includes(expected)); assert.ok(!result.text.includes("BAD")); });
}
for (const [filename, entry, xml] of [["a.docx", "word/document.xml", '<w:document xmlns:w="w"><w:p><w:r><w:t>Individual requirements</w:t></w:r></w:p></w:document>'], ["a.pptx", "ppt/slides/slide1.xml", '<p:sld xmlns:p="p" xmlns:a="a"><a:t>Grading evidence</a:t></p:sld>']]) {
  test(`local ZIP/XML parser: ${filename}`, async () => { const r = await parseDocument({ filename, bytes: zipSync({ [entry]: strToU8(xml) }) }); assert.ok(r.text.length > 10); assert.ok(!r.metadata.error); });
}
test("PDF magic and Office MIME detection", () => {
  assert.equal(detectDocumentType("unknown", "", strToU8("%PDF-1.4")), "pdf");
  assert.equal(detectDocumentType("unknown", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
  assert.equal(detectDocumentType("unknown", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), "pptx");
});
test("unsupported, too large, malformed JSON and parser failures are isolated", async () => {
  for (const args of [{ filename: "a.exe" }, { filename: "a.txt", maxBytes: 1 }, { filename: "a.json" }, { filename: "a.pdf", pdfParser: async () => { throw new Error("private parser details"); } }]) {
    const result = await parseDocument({ bytes: strToU8("invalid bytes"), ...args }); assert.ok(result.metadata.error); assert.equal(result.text, ""); assert.ok(!JSON.stringify(result).includes("private parser details"));
  }
});
test("ZIP expansion and XML entity attack are rejected", async () => {
  const oversized = zipSync({ "word/document.xml": strToU8("x".repeat(9 * 1024 * 1024)) });
  assert.match((await parseDocument({ filename: "a.docx", bytes: oversized })).metadata.error, /limit/);
  assert.match((await parseDocument({ filename: "a.xml", bytes: strToU8('<!DOCTYPE x [<!ENTITY x SYSTEM "https://evil.test">]><x>&x;</x>') })).metadata.error, /entities/);
});
