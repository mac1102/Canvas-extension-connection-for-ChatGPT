import { DOMParser } from "../vendor/dom.js";
export function parseHtml(html) {
  const doc = new DOMParser().parseFromString(`<html><body>${String(html || "")}</body></html>`, "text/html");
  for (const el of doc.querySelectorAll("script,style,iframe,object,embed,svg,form")) el.remove();
  return doc;
}
export function readableText(html) {
  const doc = parseHtml(html);
  for (const el of doc.querySelectorAll("p,div,br,li,tr,h1,h2,h3,h4")) el.appendChild(doc.createTextNode("\n"));
  return doc.body.textContent.replace(/[\t ]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}
export function discoverLinks(html, source, graph, baseUrl, allowedCourses) {
  const output = [];
  for (const anchor of parseHtml(html).querySelectorAll("a[href]")) {
    try {
      const url = new URL(anchor.getAttribute("href"), `${baseUrl}/courses/${source.courseId}/`);
      if (url.origin !== baseUrl || url.username || url.password) continue;
      const match = url.pathname.match(/^\/(?:api\/v1\/)?courses\/(\d+)\/(files|pages|assignments)\/([^/]+)(?:\/(?:download|preview))?\/?$/);
      const globalFile = url.pathname.match(/^\/(?:api\/v1\/)?files\/(\d+)(?:\/(?:download|preview))?\/?$/);
      const courseId = match ? Number(match[1]) : source.courseId;
      if (!allowedCourses.has(String(courseId))) continue;
      const type = match ? { files: "File", pages: "Page", assignments: "Assignment" }[match[2]] : globalFile ? "File" : null;
      if (!type) continue;
      const node = graph.add(type, courseId, decodeURIComponent(match ? match[3] : globalFile[1]), { title: anchor.textContent.trim() });
      graph.edge(source, node); if (node) output.push(node);
    } catch { /* Malformed or non-Canvas links are not executable. */ }
  }
  return output;
}
