import { pdfBytes } from "./canvas.mjs";

// Reproduce the shape of the reported live fetch without account data/tokens.
export function linkedStudyFixture({ deniedFile = null } = {}) {
  const calls = [];
  const encode = (text) => new TextEncoder().encode(text);
  const notebook = (title) => encode(JSON.stringify({ nbformat: 4, cells: [
    { cell_type: "markdown", source: [`# ${title}\n`, "Collect structured data and explain your method."] },
    { cell_type: "code", source: "from selenium import webdriver", outputs: [{ data: { "text/plain": "OUTPUT_NOT_SOURCE" } }] }
  ] }));
  const documents = new Map([
    [101, ["realistic_requests_selenium.pdf", pdfBytes("Slides: compare browser automation with HTTP requests.")]],
    [303, ["sem3_topic1_scraping_formative2.ipynb", notebook("Formative Selenium instructions")]],
    [304, ["css_formatives_env.yaml", encode("name: css_formatives\ndependencies:\n  - selenium\n  - beautifulsoup4")]],
    [305, ["sem3_topic1_scraping_summative.ipynb", notebook("Summative scraping instructions")]],
    ...[306, 307, 308].map((id) => [id, [`Example_${id}.html`, encode(`<p>Example ${id}: explain collection limitations.</p>`)]])
  ]);
  const signed = (id) => `https://instructure-uploads.s3.eu-central-1.amazonaws.com/attachments/${id}/${documents.get(id)[0]}?X-Amz-Signature=SIGNED_VALUE`;
  const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const links = (ids) => ids.map((id) => `<a href="/courses/1/files/${id}?verifier=PRIVATE_VERIFIER">${documents.get(id)[0]}</a>`).join("\n");
  const metadata = (id) => ({ id, filename: documents.get(id)[0], display_name: documents.get(id)[0], size: documents.get(id)[1].length,
    url: id === 305 ? signed(id) : `https://canvas.uva.nl/files/${id}/download` });
  const fetchImpl = async (input, init) => {
    const url = new URL(input); calls.push({ url, init });
    if (url.origin !== "https://canvas.uva.nl") {
      const id = Number(url.pathname.match(/attachments\/(\d+)/)?.[1]);
      return new Response(documents.get(id)[1]);
    }
    if (url.pathname === "/api/v1/courses") return json([{ id: 1, name: "CONNECTIONS", start_at: "2026-09-01", end_at: "2027-01-31" }]);
    if (url.pathname === "/api/v1/calendar_events") return json([]);
    if (url.pathname === "/api/v1/courses/1/modules") return json([
      ...Array.from({ length: 200 }, (_, index) => ({ id: 1000 + index, name: "Old week: September 7-11", items_count: 50 })),
      { id: 60, name: "Week 6: October 5-9", items_count: 4, items: [
        { id: 61, position: 1, title: "Thursday", type: "SubHeader" },
        ...["ethics", "practical", "stakeholders"].map((name, index) => ({ id: 62 + index, position: 2 + index, title: name, type: "Page", page_url: name }))
      ] }
    ]);
    if (url.pathname.endsWith("/pages/ethics")) return json({ title: "Digital trace ethics", body: '<p>Privacy and sensitive data.</p><a href="https://example.org/ethics">Ethics reference</a>' });
    if (url.pathname.endsWith("/pages/practical")) return json({ title: "Scraping with Selenium", body: `<p>Two practical mini projects using Selenium and BeautifulSoup.</p>${links([101])}
      <a href="/courses/1/assignments/201">Formative Selenium</a><a href="/courses/1/assignments/202">Summative scraping</a>` });
    if (url.pathname.endsWith("/pages/stakeholders")) return json({ title: "Relevant social groups", body: "Zoom In/Out and feedback loops." });
    const assignment = url.pathname.match(/assignments\/(201|202)$/);
    if (assignment) {
      const id = Number(assignment[1]);
      return json({ id, name: id === 201 ? "Formative Selenium" : "Summative scraping", due_at: "2026-12-11T16:00:00Z",
        description: `<p>${id === 201 ? "Practice Selenium with the formative notebook." : "Use examples to gauge the expected level."}</p>${links(id === 201 ? [303, 304] : [305, 306, 307, 308])}`,
        submission: { workflow_state: "unsubmitted" } });
    }
    const file = url.pathname.match(/files\/(\d+)(\/public_url|\/download)?$/);
    if (file) {
      const id = Number(file[1]), operation = file[2];
      if (id === deniedFile) return new Response("PRIVATE_SERVER_BODY", { status: 403 });
      if (operation === "/public_url") return json({ public_url: signed(id) });
      if (operation === "/download") {
        if (id === 303) throw new TypeError("Worker download network failure");
        const response = new Response(documents.get(id)[1]);
        if (id === 101) Object.defineProperty(response, "url", { value: signed(id) });
        return response;
      }
      if (url.pathname.startsWith("/api/v1/courses/") || id === 304) return new Response("", { status: 403 });
      return json(metadata(id));
    }
    return new Response("", { status: 404 });
  };
  return { fetchImpl, calls, documents };
}
