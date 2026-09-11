import test from "node:test";
import assert from "node:assert/strict";
import { individualEvidence, executePlan } from "../src/retrieval/resource-executor.js";
import { CanvasClient } from "../src/canvas-client.js";
import { planRequest } from "../src/planner/planner-router.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { QUERY, NOW, canvasFixture } from "./fixtures/canvas.mjs";
test("individual classification uses evidence and does not equate missing group data with individual work", () => {
  assert.equal(individualEvidence({ name: "Essay", description: "Submit individually and cite sources" }), "assignment description");
  assert.equal(individualEvidence({ name: "Essay", description: "Not an individual assignment" }), null);
  assert.equal(individualEvidence({ name: "Essay", group_category_id: null }), null);
  assert.equal(individualEvidence({ name: "Essay", group_category_id: 1, description: "Submit individually" }), null);
});
test("E: failed Groq still executes useful deterministic retrieval", async () => {
  const planning = await planRequest(QUERY, { ...DEFAULT_SETTINGS, groqEnabled: true }, { apiKey: "fake-key" }, { fetchImpl: async () => new Response("", { status: 500 }) });
  const fixture = canvasFixture();
  const result = await executePlan({ query: QUERY, plan: planning.plan, client: new CanvasClient({ token: "fake", fetchImpl: fixture.fetchImpl }),
    settings: DEFAULT_SETTINGS, now: NOW, parseDocument: async () => ({ type: "pdf", text: "Individual grading evidence", metadata: {} }) });
  assert.equal(planning.meta.planner, "local"); assert.ok(result.context.includes("personal reflection")); assert.ok(result.context.includes('"total":2'));
});
test("Canvas aborted request does not retry indefinitely", async () => {
  let calls = 0;
  const client = new CanvasClient({ token: "fake", timeoutMs: 5, fetchImpl: (_, { signal }) => {
    calls++; return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Abort", "AbortError"))));
  } });
  await assert.rejects(client.getCurrentUser(), /timed out/); assert.equal(calls, 1);
});
for (const status of [401, 403, 404]) test(`Canvas HTTP ${status} has bounded safe error text`, async () => {
  let calls = 0; const client = new CanvasClient({ token: "fake", fetchImpl: async () => { calls++; return new Response("PRIVATE SERVER MESSAGE", { status }); } });
  await assert.rejects(client.getCurrentUser(), (error) => error.status === status && !error.message.includes("PRIVATE")); assert.equal(calls, 1);
});
test("pagination cycle is marked partial instead of counted as complete", async () => {
  const client = new CanvasClient({ token: "fake", fetchImpl: async (url) => new Response('[{"id":1}]', { headers: { link: `<${url}>; rel="next"` } }) });
  const list = await client.getActiveCourses(); assert.equal(list.length, 1); assert.equal(list.complete, false);
});

test("numeric deadline windows stay executable and do not become assignment title filters", async () => {
  const query = "@Canvas assignments next 7 days";
  const planning = await planRequest(query, DEFAULT_SETTINGS);
  assert.equal(planning.plan.assignment_filters.time_window, "next 7 days");
  const fixture = canvasFixture();
  const result = await executePlan({ query, plan: planning.plan, client: new CanvasClient({ token: "fake", fetchImpl: fixture.fetchImpl }), settings: DEFAULT_SETTINGS, now: NOW });
  assert.equal(JSON.parse(result.context).records.find((r) => r.kind === "assignment_count").matches, 2);
});