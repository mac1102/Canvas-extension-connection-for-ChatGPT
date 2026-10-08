// Synthetic reproduction: many weeks, no calendar, inaccessible Files/Pages
// listings, and readable resources referenced directly by the current module.
export function studyFixture({ partial = false, oldWeeks = 15 } = {}) {
  const calls = [];
  const items = [
    { id: 1, position: 1, type: "SubHeader", title: "Tuesday" },
    { id: 2, position: 2, type: "ExternalTool", title: "Check-in" },
    { id: 3, position: 3, type: "Page", title: "Calculus lecture", page_url: "tuesday" },
    { id: 4, position: 4, type: "File", title: "Calculus exercise", content_id: 301 },
    { id: 5, position: 5, type: "SubHeader", title: "Thursday" },
    { id: 6, position: 6, type: "Page", title: "Thursday-only ethics", page_url: "thursday" },
    { id: 7, position: 7, type: "SubHeader", title: "Deadlines" },
    { id: 8, position: 8, type: "Assignment", title: "Friday deadline", content_id: 99 }
  ];
  const modules = [
    ...Array.from({ length: oldWeeks }, (_, index) => ({ id: 10 + index, name: `Old week ${index}: September 7-11`, items_count: 1,
      items: [{ id: 100 + index, position: 1, type: "Page", title: "Old unrelated workshop", page_url: `old-${index}` }] })),
    { id: 60, name: "Week 6: October 5-9", items_count: items.length, items: partial ? items.slice(0, 4) : items }
  ];
  const fetchImpl = async (input, init) => {
    const url = new URL(input); calls.push(url);
    if (init.method !== "GET") throw new Error("Expected read-only request");
    const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    const file = (id) => ({ id, filename: `reading-${id}.txt`, "content-type": "text/plain", url: `https://canvas.uva.nl/files/${id}/download`, size: 100 });
    switch (url.pathname) {
      case "/api/v1/courses": return json([{ id: 1, name: "Current course", start_at: "2026-09-01", end_at: "2027-01-31" }]);
      case "/api/v1/calendar_events": return json([]);
      case "/api/v1/courses/1/modules": return json(modules);
      case "/api/v1/courses/1/modules/60/items": return new Response("", { status: 403 });
      case "/api/v1/courses/1/pages": return new Response("", { status: 404 });
      case "/api/v1/courses/1/files": return new Response("", { status: 403 });
      case "/api/v1/courses/1/pages/tuesday": return json({ title: "Calculus lecture", body: '<p>Prepare derivatives and gradients.</p><a href="/courses/1/files/300">Chain rule reading</a>' });
      case "/api/v1/courses/1/pages/thursday": return json({ title: "Thursday-only ethics", body: "Consent and anonymisation" });
      case "/api/v1/courses/1/files/300": return json(file(300));
      case "/api/v1/courses/1/files/301": return new Response("", { status: 403 });
      case "/api/v1/files/301": return json(file(301));
      case "/files/300/download": return new Response("Reading: chain rule worked examples");
      case "/files/301/download": return new Response("Exercises: differentiate composite functions");
      case "/api/v1/courses/1": return json({ syllabus_body: "" });
      case "/api/v1/announcements": return json([]);
      default: return new Response("", { status: 404 });
    }
  };
  return { fetchImpl, calls, modules, items };
}
