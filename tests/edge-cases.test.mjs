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
  assert.equal(planning.meta.planner, "local");
  assert.ok(result.context.includes("personal reflection"));
  assert.ok(result.context.includes('"total":2'));
});

test("Canvas aborted request does not retry indefinitely", async () => {
  let calls = 0;
  const client = new CanvasClient({ token: "fake", timeoutMs: 5, fetchImpl: (_, { signal }) => {
    calls++;
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Abort", "AbortError"))));
  } });
  await assert.rejects(client.getCurrentUser(), /timed out/);
  assert.equal(calls, 1);
});

for (const status of [401, 403, 404]) test(`Canvas HTTP ${status} has bounded safe error text`, async () => {
  let calls = 0;
  const client = new CanvasClient({ token: "fake", fetchImpl: async () => {
    calls++;
    return new Response("PRIVATE SERVER MESSAGE", { status });
  } });
  await assert.rejects(client.getCurrentUser(), (error) => error.status === status && !error.message.includes("PRIVATE"));
  assert.equal(calls, 1);
});

test("Canvas follows same-origin API redirects using native follow mode", async () => {
  const seen = [];
  const client = new CanvasClient({ token: "secret", fetchImpl: async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.Authorization, redirect: init.redirect });
    if (new URL(url).pathname === "/api/v1/users/self") {
      return new Response(null, { status: 302, headers: { location: "/api/v1/users/self/" } });
    }
    return new Response(JSON.stringify({ name: "Canvas User" }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const user = await client.getCurrentUser();
  assert.equal(user.name, "Canvas User");
  assert.equal(seen.length, 2);
  assert.ok(seen.every((entry) => entry.auth === "Bearer secret" && entry.redirect === "follow"));
  assert.ok(seen.every((entry) => new URL(entry.url).origin === "https://canvas.uva.nl"));
});

test("Canvas blocks cross-origin redirect fallback before a second authorized request", async () => {
  let calls = 0;
  const client = new CanvasClient({ token: "secret", fetchImpl: async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
  } });
  await assert.rejects(client.getCurrentUser(), /untrusted redirect/i);
  assert.equal(calls, 1);
});

test("Canvas rejects an off-origin final URL returned after native redirect following", async () => {
  const client = new CanvasClient({ token: "secret", fetchImpl: async () => {
    const response = new Response(JSON.stringify({ name: "stolen" }), { status: 200, headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", { value: "https://evil.example/api/v1/users/self" });
    return response;
  } });
  await assert.rejects(client.getCurrentUser(), /untrusted redirect/i);
});

test("pagination cycle is marked partial instead of counted as complete", async () => {
  const client = new CanvasClient({ token: "fake", fetchImpl: async (url) => new Response('[{"id":1}]', { headers: { link: `<${url}>; rel="next"` } }) });
  const list = await client.getActiveCourses();
  assert.equal(list.length, 1);
  assert.equal(list.complete, false);
});

test("numeric deadline windows stay executable and do not become assignment title filters", async () => {
  const query = "@Canvas assignments next 7 days";
  const planning = await planRequest(query, DEFAULT_SETTINGS);
  assert.equal(planning.plan.assignment_filters.time_window, "next 7 days");
  const fixture = canvasFixture();
  const result = await executePlan({ query, plan: planning.plan, client: new CanvasClient({ token: "fake", fetchImpl: fixture.fetchImpl }), settings: DEFAULT_SETTINGS, now: NOW });
  assert.equal(JSON.parse(result.context).records.find((r) => r.kind === "assignment_count").matches, 2);
});
