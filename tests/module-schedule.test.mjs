import test from "node:test";
import assert from "node:assert/strict";
import { moduleDateRange, selectModuleSchedule, studyWindow, dateKey } from "../src/retrieval/module-schedule.js";
import { CanvasClient } from "../src/canvas-client.js";
import { executePlan } from "../src/retrieval/resource-executor.js";
import { deterministicPlan } from "../src/planner/deterministic-planner.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { parseDocument } from "../src/parsers/index.js";
import { studyFixture } from "./fixtures/study.mjs";

const now = new Date(2026, 9, 6, 10, 20);
const query = "@Canvas fetch what I'm gonna learn todaay";
test("empty calendar and inaccessible global listings still yield the correct module day and linked reading", async () => {
  const fixture = studyFixture();
  const result = await executePlan({ query, plan: deterministicPlan(query).plan, now,
    planner: "Groq / openai/gpt-oss-20b", settings: DEFAULT_SETTINGS,
    client: new CanvasClient({ token: "fixture-token", fetchImpl: fixture.fetchImpl }), parseDocument });
  const records = JSON.parse(result.context).records;
  const schedule = records.find((r) => r.kind === "module_schedule");
  assert.equal(schedule.module, "Week 6: October 5-9");
  assert.equal(schedule.complete, true);
  assert.deepEqual(schedule.days.map((day) => day.date), ["2026-10-06"]);
  assert.deepEqual(schedule.days[0].items.map((item) => item.title), ["Check-in", "Calculus lecture", "Calculus exercise"]);
  assert.equal(records.find((r) => r.kind === "calendar_summary").count, 0);
  assert.equal(records.find((r) => r.kind === "study_summary").learning_items, 3);
  assert.ok(result.context.includes("Prepare derivatives and gradients"));
  assert.ok(result.context.includes("Reading: chain rule worked examples"));
  assert.ok(!result.context.includes("Thursday-only ethics"));
  assert.ok(!result.context.includes("Old unrelated workshop"));
  assert.equal(records.filter((r) => r.kind === "module").length, 0);
  assert.equal(fixture.calls.filter((url) => url.pathname === "/api/v1/courses/1/pages/tuesday").length, 1);
  assert.equal(fixture.calls.filter((url) => url.pathname === "/files/301/download").length, 1);
  assert.ok(!fixture.calls.some((url) => url.pathname.endsWith("/undefined")));
  assert.equal(result.stats.documentsParsed, 2);
  assert.ok(!fixture.calls.some((url) => ["/api/v1/courses/1/files", "/api/v1/courses/1/pages"].includes(url.pathname)), "daily fetch skips broad catalogs");
  assert.ok(result.context.length < DEFAULT_SETTINGS.maxContextChars);
});
test("changing the requested day selects Thursday, without Tuesday resources or Friday deadlines", async () => {
  const fixture = studyFixture();
  const result = await executePlan({ query: "@Canvas what will I learn on 2026-10-08", plan: deterministicPlan("@Canvas what will I learn on 2026-10-08").plan,
    now, settings: DEFAULT_SETTINGS, client: new CanvasClient({ token: "fixture-token", fetchImpl: fixture.fetchImpl }), parseDocument });
  const schedule = JSON.parse(result.context).records.find((r) => r.kind === "module_schedule");
  assert.deepEqual(schedule.days.map((day) => day.date), ["2026-10-08"]);
  assert.equal(schedule.days[0].items[0].title, "Thursday-only ethics");
  assert.ok(!fixture.calls.some((url) => url.pathname.endsWith("/pages/tuesday")));
  assert.ok(!result.context.includes("Friday deadline"));
});
test("date ranges cover cross-month and cross-year weeks, but never infer a date from a week number", () => {
  const window = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 1, 23, 59) };
  const range = moduleDateRange("Week 5: September 28 - October 2", window);
  assert.equal(dateKey(range.start), "2026-09-28");
  assert.equal(dateKey(range.end), "2026-10-02");
  assert.equal(moduleDateRange("Week 6", window), null);
  assert.equal(moduleDateRange("February 30-31", window), null);
  const year = moduleDateRange("December 28 - January 1", { start: new Date(2027, 0, 1), end: new Date(2027, 0, 1) });
  assert.equal(dateKey(year.start), "2026-12-28");
  assert.equal(dateKey(year.end), "2027-01-01");
});
test("ambiguous multi-week headings and missing module dates cannot claim daily sessions", () => {
  const window = { start: new Date(2026, 9, 6), end: new Date(2026, 9, 6, 23, 59) };
  for (const name of ["October 5-16", "Week 6"]) {
    const selected = selectModuleSchedule([{ module: { id: 1, name }, course: { id: 1 }, complete: true,
      items: [{ type: "SubHeader", title: "Tuesday" }, { type: "Page", title: "Lecture", page_url: "lesson" }] }], window);
    assert.equal(selected.schedules.reduce((n, s) => n + s.days.length, 0), 0);
  }
});
test("the typo from the supplied prompt stays a daily study request, with no assignment deadline/title filter", () => {
  const { plan } = deterministicPlan(query);
  assert.equal(studyWindow(query, plan, now).label, "today");
  assert.ok(plan.follow_links);
  assert.ok(plan.operations.some((op) => op.type === "get_file"));
  assert.ok(!plan.operations.some((op) => op.type === "list_assignments"));
  assert.deepEqual(plan.assignment_filters.search_terms, []);
  assert.equal(plan.assignment_filters.time_window, null);
});
test("a partial module-item list is retained as partial learning evidence", async () => {
  const fixture = studyFixture({ partial: true });
  const result = await executePlan({ query, plan: deterministicPlan(query).plan, now,
    settings: DEFAULT_SETTINGS, client: new CanvasClient({ token: "fixture-token", fetchImpl: fixture.fetchImpl }), parseDocument });
  const records = JSON.parse(result.context).records;
  assert.equal(records.find((r) => r.kind === "module_schedule").complete, false);
  assert.equal(records.find((r) => r.kind === "study_summary").complete, false);
});
test("canonical file metadata fallback stays bearer-authenticated and never retries 401", async () => {
  const calls = [];
  const client = new CanvasClient({ token: "fixture-token", fetchImpl: async (input, init) => {
    calls.push({ path: new URL(input).pathname, init });
    return new URL(input).pathname.startsWith("/api/v1/courses/") ? new Response("", { status: 403 }) :
      new Response('{"id":301,"filename":"worksheet.txt"}');
  } });
  assert.equal((await client.getFile(1, 301)).id, 301);
  assert.deepEqual(calls.map((c) => c.path), ["/api/v1/courses/1/files/301", "/api/v1/files/301"]);
  assert.ok(calls.every((c) => c.init.method === "GET" && c.init.credentials === "omit" && c.init.headers.Authorization === "Bearer fixture-token"));
  let denied = 0;
  await assert.rejects(new CanvasClient({ token: "fixture-token", fetchImpl: async () => { denied++; return new Response("", { status: 401 }); } }).getFile(1, 301));
  assert.equal(denied, 1);
});
test("a relevant week after the metadata cap is selected ahead of old modules", async () => {
  const fixture = studyFixture({ oldWeeks: 45 });
  const result = await executePlan({ query, plan: deterministicPlan(query).plan, now,
    settings: DEFAULT_SETTINGS, client: new CanvasClient({ token: "fixture-token", fetchImpl: fixture.fetchImpl }), parseDocument });
  const records = JSON.parse(result.context).records;
  assert.equal(records.find((r) => r.kind === "module_schedule").module_id, 60);
  assert.ok(result.context.includes("Reading: chain rule worked examples"));
  assert.ok(!records.some((r) => r.kind === "warning" && /metadata cap/.test(r.message)), "old weeks do not consume the current-day cap");
});
