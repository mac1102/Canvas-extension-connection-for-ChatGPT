import test from "node:test";
import assert from "node:assert/strict";
import { CanvasClient, parseNextLink } from "../src/canvas-client.js";
import { deterministicPlan } from "../src/planner/deterministic-planner.js";
import { executePlan } from "../src/retrieval/resource-executor.js";
import { selectCourses } from "../src/retrieval/course-scope.js";
import { ResourceGraph } from "../src/retrieval/resource-graph.js";
import { discoverLinks } from "../src/retrieval/html.js";
import { resourceScore } from "../src/retrieval/resource-ranker.js";
import { budgetContext } from "../src/context/budget.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { parseDocument } from "../src/parsers/index.js";
import { QUERY, NOW, courses, canvasFixture } from "./fixtures/canvas.mjs";
async function run(query, fixtureOptions = {}, settings = {}) {
  const fixture = canvasFixture(fixtureOptions), client = new CanvasClient({ token: "fake-canvas-token", fetchImpl: fixture.fetchImpl });
  const result = await executePlan({ query, plan: deterministicPlan(query).plan, client, settings: { ...DEFAULT_SETTINGS, ...settings }, now: NOW,
    parseDocument: (options) => parseDocument({ ...options, pdfParser: async () => ({ text: "Grading: individual reflection is worth 40 percent. Include sources and evidence." }) }), secrets: ["fake-canvas-token"] });
  return { ...result, records: JSON.parse(result.context).records, calls: fixture.calls };
}
test("A: CONNECTIONS list excludes historical courses and descriptions", async () => {
  const r = await run("@Canvas CONNECTIONS có những assignment gì?");
  assert.equal(r.records.filter((x) => x.kind === "assignment").length, 2);
  assert.equal(r.calls.length, 2); assert.ok(!r.context.includes("Ancient essay"));
});
test("B: individual filter scans inventory without returning weekly goals", async () => {
  const r = await run("@Canvas check xem assignment nào là individual");
  assert.equal(r.records.find((x) => x.kind === "assignment_count").total, 2);
  assert.deepEqual(r.records.filter((x) => x.kind === "assignment").map((a) => a.name), ["Individual Contribution IV"]);
});
test("C: count plus details, rubric and assignment → page → PDF, deduped", async () => {
  const r = await run(QUERY);
  assert.equal(r.records.find((x) => x.kind === "assignment_count").total, 2);
  for (const text of ["Individual Contribution", "personal reflection", "Evidence", "individual contribution", "40 percent"]) assert.ok(r.context.includes(text), text);
  assert.equal(r.calls.filter((x) => x.path === "/api/v1/courses/1/assignments/11").length, 1);
  assert.equal(r.stats.documentsParsed, 1); assert.ok(!r.context.includes("PRIVATE_SIGNED_VALUE"));
});
test("D and F: 200-file metadata discovery downloads only ranked manual", async () => {
  const r = await run("@Canvas course manual CONNECTIONS nói gì về grading?", { fileCount: 200 });
  assert.ok(r.context.includes("40 percent")); assert.equal(r.calls.filter((x) => x.path.startsWith("/files/")).length, 1);
  assert.ok(r.calls.findIndex((x) => x.path.endsWith("/files")) < r.calls.findIndex((x) => x.path.startsWith("/files/")));
});
test("optional page failure preserves assignment and count", async () => {
  const r = await run(QUERY, { brokenPage: true });
  assert.ok(r.context.includes("personal reflection")); assert.ok(r.records.some((x) => x.kind === "warning"));
});
test("depth zero never retrieves linked page", async () => {
  const r = await run(QUERY, {}, { maxDepth: 0 }); assert.ok(!r.calls.some((x) => x.path.includes("/pages/")));
});
test("course selection keeps explicit historical course searchable", () => {
  const plan = deterministicPlan("assignments").plan;
  assert.deepEqual(selectCourses("assignments", courses, plan, DEFAULT_SETTINGS, NOW).courses.map((c) => c.id), [1]);
  assert.deepEqual(selectCourses("HISTORY assignments", courses, plan, DEFAULT_SETTINGS, NOW).courses.map((c) => c.id), [2]);
  assert.equal(selectCourses("connection assignments", courses, plan, DEFAULT_SETTINGS, NOW).courses[0].id, 1);
});
test("resource graph recognizes safe links, dedupes and bounds cyclic traversal", () => {
  const graph = new ResourceGraph(), a = graph.add("Assignment", 1, 1);
  const [page] = discoverLinks('<a href="/courses/1/pages/requirements">Instructions</a><a href="https://evil.test/courses/1/files/1">bad</a>', a, graph, "https://canvas.uva.nl", new Set(["1"]));
  assert.equal(page.type, "Page"); graph.edge(page, a); graph.edge(a, page);
  assert.equal(graph.distances([a], 0).size, 1); assert.equal(graph.distances([a], 3).size, 2);
  assert.equal(graph.add("Page", 1, "requirements"), page); assert.equal(graph.edges.length, 2);
  assert.ok(resourceScore("course manual", { title: "Instructions", type: "File" }, { distance: 1 }) > resourceScore("course manual", { title: "Course Manual", type: "File" }));
});
test("context remains valid at every budget, prioritizing count", () => {
  const records = [{ kind: "count", priority: 100, total: 50 }, { kind: "metadata", priority: 1, text: "x".repeat(1000) }];
  for (let budget = 2; budget < 1500; budget++) { const text = budgetContext(records, budget); assert.ok(text.length <= budget); assert.doesNotThrow(() => JSON.parse(text)); }
  assert.equal(JSON.parse(budgetContext(records, 100)).records[0].kind, "count");
});
test("pagination handles extra link parameters and caches requests", async () => {
  let calls = 0;
  const client = new CanvasClient({ token: "fake", fetchImpl: async (url) => {
    calls++; return new Response(JSON.stringify([{ id: calls }]), { headers: calls === 1 ? { link: '<https://canvas.uva.nl/api/v1/courses?page=2>; title="next"; rel="next"' } : {} });
  } });
  const all = await client.getActiveCourses(); assert.equal(all.length, 2); assert.equal(all.complete, true);
  await client.getActiveCourses(); assert.equal(calls, 2);
  assert.equal(parseNextLink('<https://canvas.uva.nl/api/v1/courses?page=2>; rel="next"').search, "?page=2");
});
test("cross-origin pagination never sends token and reports partial inventory", async () => {
  let calls = 0;
  const client = new CanvasClient({ token: "fake", fetchImpl: async () => { calls++; return new Response('[{"id":1}]', { headers: { link: '<https://evil.test/api/v1/courses>; rel="next"' } }); } });
  const all = await client.getActiveCourses(); assert.equal(calls, 1); assert.equal(all.complete, false);
});
test("Canvas retry is bounded; 429 blocks subsequent calls", async () => {
  let calls = 0;
  const client = new CanvasClient({ token: "fake", fetchImpl: async () => { calls++; return new Response("", { status: 500 }); } });
  await assert.rejects(client.getCurrentUser()); assert.equal(calls, 2);
  const rate = new CanvasClient({ token: "fake", fetchImpl: async () => new Response("", { status: 429 }) });
  await assert.rejects(rate.getCurrentUser()); await assert.rejects(rate.getTodo()); assert.equal(rate.requestCount, 1);
});
test("download enforces size, destination and redirect policy", async () => {
  let calls = 0;
  const client = new CanvasClient({ token: "fake", fetchImpl: async (_, init) => { calls++; assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); return new Response("too big"); } });
  await assert.rejects(client.downloadFile({ url: "https://evil.test/files/1" }));
  await assert.rejects(client.downloadFile({ url: "https://canvas.uva.nl/files/1", size: 100 }, 10));
  assert.equal(calls, 0);
  await assert.rejects(client.downloadFile({ url: "https://canvas.uva.nl/files/1" }, 2));
});
