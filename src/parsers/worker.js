import { parseDocument } from "./index.js";
self.onmessage = async (event) => {
  try { self.postMessage({ kind: "parsed-document", result: await parseDocument(event.data) }); }
  catch { self.postMessage({ kind: "parsed-document", result: { type: "unknown", text: "", sections: [], metadata: { error: "Document parsing failed" }, truncated: false } }); }
};
