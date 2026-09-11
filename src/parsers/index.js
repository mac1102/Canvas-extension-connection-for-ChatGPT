import { unzipSync } from "../vendor/zip.js";
import { DOMParser } from "../vendor/dom.js";
import { readableText } from "../retrieval/html.js";
export function detectDocumentType(filename = "", contentType = "", bytes = new Uint8Array()) {
  const ext = filename.toLowerCase().split(".").pop(), mime = contentType.toLowerCase().split(";")[0];
  if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-" || ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "docx" || mime.includes("wordprocessingml")) return "docx";
  if (ext === "pptx" || mime.includes("presentationml")) return "pptx";
  if (["txt", "md", "markdown", "html", "htm", "csv", "json", "xml"].includes(ext)) return ext === "htm" ? "html" : ext;
  return ({ "text/plain": "txt", "text/markdown": "md", "text/html": "html", "text/csv": "csv", "application/json": "json", "application/xml": "xml", "text/xml": "xml" })[mime] || "unsupported";
}
export async function parseDocument({ filename = "", contentType = "", bytes, maxBytes = 8 * 1024 * 1024, maxText = 200000, pdfParser } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const type = detectDocumentType(filename, contentType, data);
  const result = { type, title: filename, text: "", sections: [], metadata: {}, truncated: false };
  try {
    if (data.length > maxBytes) throw new Error("Document too large");
    if (type === "unsupported") throw new Error("Unsupported document type");
    if (type === "pdf") {
      const parse = pdfParser || (await import("./pdf.js")).parsePdf;
      Object.assign(result, await parse(data, maxText));
    } else if (type === "docx" || type === "pptx") {
      let expanded = 0, entries = 0;
      const zip = unzipSync(data, { filter(entry) {
        if (++entries > 2000) throw new Error("ZIP entry limit");
        const selected = type === "docx" ? /^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(entry.name) : /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(entry.name);
        if (!selected) return false;
        expanded += entry.originalSize;
        if (expanded > 24 * 1024 * 1024 || entry.originalSize > 8 * 1024 * 1024) throw new Error("ZIP expansion limit");
        return true;
      } });
      for (const name of Object.keys(zip).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
        const xml = new TextDecoder().decode(zip[name]);
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML entities are unsupported");
        const doc = new DOMParser().parseFromString(xml, "text/xml");
        const text = [...doc.querySelectorAll("*")].filter((node) => /(?:^|:)t$/.test(node.tagName)).map((node) => node.textContent).join(" ");
        const remaining = maxText - result.text.length;
        result.sections.push({ title: name, offset: result.text.length });
        result.text += text.slice(0, remaining) + "\n";
        if (text.length >= remaining) { result.truncated = true; break; }
      }
      if (!Object.keys(zip).length) throw new Error("Invalid Office document");
    } else {
      let text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      if (type === "html") text = readableText(text);
      if (type === "json") text = JSON.stringify(JSON.parse(text), null, 2);
      if (type === "xml") {
        if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("XML entities are unsupported");
        const doc = new DOMParser().parseFromString(text, "text/xml"); text = doc.documentElement?.textContent || "";
      }
      result.text = text;
    }
    result.truncated ||= result.text.length > maxText; result.text = result.text.slice(0, maxText);
    if (!result.text.trim()) result.metadata.warning = "No extractable text (scans may require OCR).";
  } catch (error) {
    result.text = ""; result.sections = []; result.metadata.error = /too large|Unsupported|limit|entities/.test(error.message) ? error.message : "Document parsing failed";
  }
  return result;
}
