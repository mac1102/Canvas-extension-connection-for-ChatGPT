import test from "node:test";
import assert from "node:assert/strict";
import { CanvasClient } from "../src/canvas-client.js";
import { deterministicPlan } from "../src/planner/deterministic-planner.js";
import { executePlan } from "../src/retrieval/resource-executor.js";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/settings.js";
import { canvasFixture } from "./fixtures/canvas.mjs";

const QUERY = "@Canvas fetch what I'm gonna study today";
const NOW = new Date("2026-10-06T08:20:00Z");
test("AI empty title filters stay empty and keep 37 assignments from the reported query", async () => {
  const fixture = canvasFixture();
  const calls = [];
  const client = new CanvasClient({ token: "fixture-token", fetchImpl: async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/v1/courses/1/assignments") {
      return json(Array.from({ length: 37 }, (_, i) => ({ id: i + 1, name: "Weekly Goal " + i, due_at: null })));
    }
    if (url.pathname === "/api/v1/calendar_events") {
      return json([
        { id: 100, title: "Ethnography seminar", context_code: "course_1",
          start_at: "2026-10-06T09:00:00Z", end_at: "2026-10-06T11:00:00Z",
          location_name: "Room A", description: "<p>Read the observation notes.</p>" },
        { id: 200, title: "Other course", context_code: "course_999" },
        { id: 300, title: "Hidden", context_code: "course_1", hidden: true }
      ]);
    }
    return fixture.fetchImpl(input, init);
  } });
  const plan = deterministicPlan("@Canvas assignments").plan;
  plan.operations.push({ type: "get_calendar_events", query: "today", resource_ids: [], required: false });
  plan.assignment_filters.search_terms = [];
  plan.assignment_filters.time_window = null;
  const result = await executePlan({ query: QUERY, plan, client, settings: DEFAULT_SETTINGS,
    now: NOW, planner: "Groq / openai/gpt-oss-20b" });
  const records = JSON.parse(result.context).records;
  const count = records.find((record) => record.kind === "assignment_count");
  assert.equal(count.total, 37);
  assert.equal(count.matches, 37);
  assert.deepEqual(count.filters.search_terms, []);
  assert.equal(records.find((record) => record.kind === "routing").planner, "Groq / openai/gpt-oss-20b");
  const events = records.filter((record) => record.kind === "calendar_event");
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Ethnography seminar");
  assert.equal(events[0].location, "Room A");
  const calendar = calls.find((url) => url.pathname === "/api/v1/calendar_events");
  assert.deepEqual(calendar.searchParams.getAll("context_codes[]"), ["course_1"]);
  assert.equal(calendar.searchParams.get("type"), "event");
  assert.match(calendar.searchParams.get("start_date"), /^2026-10-06T/);
});
test("AI named-title restrictions are respected instead of being expanded from conversational text", async () => {
  const fixture = canvasFixture();
  const plan = deterministicPlan("@Canvas assignments").plan;
  plan.assignment_filters.search_terms = ["Weekly Goal"];
  const result = await executePlan({ query: QUERY, plan,
    client: new CanvasClient({ token: "fixture-token", fetchImpl: fixture.fetchImpl }),
    settings: DEFAULT_SETTINGS, now: NOW, planner: "Groq / openai/gpt-oss-20b" });
  const assignments = JSON.parse(result.context).records.filter((record) => record.kind === "assignment");
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].name, "Weekly Goal");
});
test("calendar requests batch course contexts in groups of ten and remain GET-only", async () => {
  const calls = [];
  const client = new CanvasClient({ token: "fixture-token", fetchImpl: async (input, init) => {
    calls.push({ url: new URL(input), init });
    return new Response("[]", { headers: { "content-type": "application/json" } });
  } });
  const events = await client.getCalendarEvents(Array.from({ length: 12 }, (_, i) => i + 1), {
    startDate: NOW, endDate: NOW
  });
  assert.equal(events.complete, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.url.searchParams.getAll("context_codes[]").length), [10, 2]);
  assert.ok(calls.every((call) => call.init.method === "GET"));
});
test("calendar failures are marked unavailable without deleting useful assignment evidence", async () => {
  const fixture = canvasFixture();
  const plan = deterministicPlan("@Canvas assignments").plan;
  plan.operations.push({ type: "get_calendar_events", query: "today", resource_ids: [], required: false });
  const result = await executePlan({ query: QUERY, plan, client: new CanvasClient({ token: "fixture-token",
    fetchImpl: async (input, init) => new URL(input).pathname === "/api/v1/calendar_events" ?
      new Response("private error", { status: 403 }) : fixture.fetchImpl(input, init) }),
    settings: DEFAULT_SETTINGS, now: NOW, planner: "Groq / openai/gpt-oss-20b" });
  const records = JSON.parse(result.context).records;
  assert.equal(records.find((record) => record.kind === "calendar_summary").available, false);
  assert.equal(records.find((record) => record.kind === "calendar_summary").complete, false);
  assert.equal(records.find((record) => record.kind === "assignment_count").matches, 2);
  assert.ok(records.some((record) => record.kind === "warning" && /Calendar events: HTTP 403/.test(record.message)));
  assert.ok(!result.context.includes("private error"));
});
test("legacy AI-preferred settings migrate to the AI-first mode", () => {
  assert.equal(sanitizeSettings({ plannerMode: "preferred" }).plannerMode, "hybrid");
  assert.equal(sanitizeSettings({ plannerMode: "local" }).plannerMode, "local");
});
