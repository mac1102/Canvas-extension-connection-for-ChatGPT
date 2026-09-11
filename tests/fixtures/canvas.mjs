export const QUERY = "@Canvas check xem tôi có bao nhiêu assignment, cái nào là individual và yêu cầu những gì?";
export const NOW = new Date("2026-09-11T12:00:00Z");
export const courses = [
  { id: 1, name: "CONNECTIONS: Linking data", course_code: "CON26", start_at: "2026-09-01", end_at: "2027-01-31" },
  { id: 2, name: "HISTORY", course_code: "HIST23", start_at: "2023-09-01", end_at: "2024-01-31" }
];
export const assignments = [
  { id: 10, name: "Weekly Goal", due_at: "2026-09-12T12:00:00Z", points_possible: 10, submission: { workflow_state: "unsubmitted" } },
  { id: 11, name: "Individual Contribution IV", due_at: "2026-09-14T12:00:00Z", description: '<p>Write a personal reflection.</p><a href="/courses/1/pages/requirements">Assessment Requirements</a>',
    rubric: [{ description: "Evidence", points: 10, ratings: [{ description: "Strong evidence", points: 10 }] }] }
];
export function pdfBytes(text = "Grading: individual reflection is worth 40 percent. Include sources and evidence.") {
  const stream = `BT /F1 12 Tf 50 700 Td (${text.replace(/[()\\]/g, " ")}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n", offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
export function canvasFixture({ fileCount = 200, brokenPage = false } = {}) {
  const calls = [], file = { id: 20, filename: "Course Manual.pdf", display_name: "Course Manual.pdf", "content-type": "application/pdf", size: 1000, url: "https://canvas.uva.nl/files/20/download?verifier=PRIVATE_SIGNED_VALUE" };
  const files = [file, ...Array.from({ length: fileCount - 1 }, (_, i) => ({ id: 100 + i, filename: `Random lecture ${i}.txt`, display_name: `Random lecture ${i}.txt` }))];
  const fetchImpl = async (input, init) => {
    const url = new URL(input); calls.push({ path: url.pathname, method: init.method });
    const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    switch (url.pathname) {
      case "/api/v1/courses": return json(courses);
      case "/api/v1/courses/1/assignments": return json(assignments);
      case "/api/v1/courses/2/assignments": return json([{ id: 99, name: "Ancient essay" }]);
      case "/api/v1/courses/1/assignments/10": return json(assignments[0]);
      case "/api/v1/courses/1/assignments/11": return json(assignments[1]);
      case "/api/v1/courses/1/pages": return json([{ url: "requirements", title: "Assessment Requirements" }]);
      case "/api/v1/courses/1/pages/requirements": return brokenPage ? new Response("", { status: 403 }) : json({ title: "Assessment Requirements", body: '<p>Explain your individual contribution.</p><a href="/courses/1/files/20">Course Manual.pdf</a><a href="/courses/1/assignments/11">Back</a>' });
      case "/api/v1/courses/1/files": return json(files);
      case "/api/v1/courses/1/files/20": return json(file);
      case "/files/20/download": return new Response(pdfBytes());
      case "/api/v1/courses/1": return json({ syllabus_body: "Grading is defined in the course manual." });
      case "/api/v1/courses/1/modules": return json([{ id: 30, name: "Assessment", items_count: 2, items: [{ id: 31, title: "Individual Contribution IV", type: "Assignment", content_id: 11 }, { id: 32, title: "Assessment Requirements", type: "Page", page_url: "requirements" }] }]);
      case "/api/v1/users/self/enrollments": return json([{ course_id: 1, grades: { current_score: 90 } }, { course_id: 2, grades: { current_score: 99 } }]);
      case "/api/v1/announcements": return json([{ title: "Welcome", context_code: "course_1", message: "Read the syllabus" }]);
      case "/api/v1/users/self/todo": return json([{ assignment: { ...assignments[0], course_id: 1 } }]);
      default: return new Response("", { status: 404 });
    }
  };
  return { fetchImpl, calls };
}
