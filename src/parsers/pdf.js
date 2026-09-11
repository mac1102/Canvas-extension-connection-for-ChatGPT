
import { getDocument, GlobalWorkerOptions } from "../vendor/pdf.mjs";
GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.mjs", import.meta.url).href;
export async function parsePdf(bytes, maxText = 200000) {
  const task = getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
    useWorkerFetch: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, verbosity: 0 });
  let text = "", truncated = false; const sections = [];
  try {
    const pdf = await task.promise;
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 150); pageNumber++) {
      const page = await pdf.getPage(pageNumber), content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("");
      sections.push({ title: `Page ${pageNumber}`, offset: text.length });
      const remaining = maxText - text.length;
      text += pageText.slice(0, remaining) + "\n"; page.cleanup();
      if (pageText.length >= remaining) { truncated = true; break; }
    }
    return { text, sections, truncated: truncated || pdf.numPages > 150, metadata: { pages: pdf.numPages } };
  } finally { await task.destroy(); }
}
