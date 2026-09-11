import test from "node:test";
import assert from "node:assert/strict";
import { deterministicPlan } from "../src/planner/deterministic-planner.js";
import { validatePlan } from "../src/planner/plan-validator.js";
import { planRequest } from "../src/planner/planner-router.js";
import { groqPlan } from "../src/planner/groq-planner.js";
import { plannerPayload } from "../src/privacy/privacy-guard.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { QUERY } from "./fixtures/canvas.mjs";
const good = () => deterministicPlan(QUERY).plan;
const response = (plan) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(plan) } }] }));
for (const query of ["@Canvas deadline tuần này", "@Canvas CONNECTIONS assignments", "@Canvas điểm hiện tại", "@Canvas announcements", "@Canvas CONNECTIONS assigments"]) {
  test(`simple query stays local: ${query}`, async () => {
    let calls = 0;
    const result = await planRequest(query, { ...DEFAULT_SETTINGS, groqEnabled: true }, { apiKey: "fake" }, { fetchImpl: () => { calls++; } });
    assert.equal(calls, 0); assert.equal(result.meta.planner, "local"); validatePlan(result.plan);
  });
}
test("mixed language preserves count, inventory, requirements and individual", () => {
  const { plan, complexity } = deterministicPlan(QUERY);
  assert.ok(complexity >= 0.4); assert.ok(plan.needs_count && plan.follow_links && plan.assignment_filters.individual);
  for (const op of ["list_assignments", "get_assignment", "get_rubric"]) assert.ok(plan.operations.some((o) => o.type === op));
});
test("ambiguous and relationship requests consider AI", () => {
  for (const q of ["@Canvas help me prepare", "@Canvas xem tôi cần đọc gì để làm bài tuần sau"]) assert.ok(deterministicPlan(q).complexity >= 0.4);
});
test("validator rejects unknown fields, unsafe operations, IDs, values and limits", () => {
  for (const mutate of [(p) => p.extra = 1, (p) => p.operations[0].type = "delete", (p) => p.max_depth = 4,
    (p) => p.max_resources = 1000, (p) => p.max_resources = 2.5, (p) => p.needs_count = "true", (p) => p.operations[0].resource_ids = ["r12"], (p) => p.course_scope = {}]) {
    const p = good(); mutate(p); assert.throws(() => validatePlan(p));
  }
});
test("Groq strict schema payload contains query and operations, no private Canvas object", async () => {
  let request;
  await groqPlan({ query: QUERY, apiKey: "fake-groq-key", secrets: ["fake-canvas-token"], fetchImpl: async (_, init) => { request = init; return response(good()); } });
  const body = JSON.parse(request.body); assert.equal(body.model, "openai/gpt-oss-20b"); assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.reasoning_effort, "low"); assert.equal(body.temperature, 0); assert.equal(body.stream, false); assert.ok(body.max_completion_tokens < 1024);
  for (const secret of ["fake-canvas-token", "fake-groq-key", "PRIVATE_DESCRIPTION", "PRIVATE_GRADE", "PRIVATE_FILE", "PRIVATE_SUBMISSION"]) assert.ok(!request.body.includes(secret));
  const privateObject = { query: QUERY, grades: "PRIVATE_GRADE", description: "PRIVATE_DESCRIPTION", file: "PRIVATE_FILE", submission: "PRIVATE_SUBMISSION" };
  assert.throws(() => plannerPayload(privateObject));
});
for (const query of ["@Canvas token fake-canvas-token", "@Canvas grade: 95", "@Canvas email: user@example.com", "@Canvas <p>private content</p>", "@Canvas https://canvas.uva.nl/files/1?verifier=secret", "@Canvas notes\nPRIVATE FILE TEXT"]) test(`privacy rejects sensitive query: ${query}`, () => {
  assert.throws(() => plannerPayload({ query }, ["fake-canvas-token"]));
});
for (const invalid of ["not json", JSON.stringify({ version: 8 })]) test("invalid output retries once at medium reasoning", async () => {
  const attempts = [];
  const p = await groqPlan({ query: QUERY, apiKey: "fake", fetchImpl: async (_, init) => {
    attempts.push(JSON.parse(init.body).reasoning_effort);
    return attempts.length === 1 ? new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: invalid } }] })) : response(good());
  } });
  assert.deepEqual(attempts, ["low", "medium"]); assert.equal(p.version, 1);
});
for (const status of [401, 429, 500]) test(`HTTP ${status} falls back without blind retry`, async () => {
  let calls = 0;
  const result = await planRequest(QUERY, { ...DEFAULT_SETTINGS, groqEnabled: true }, { apiKey: "fake" }, { fetchImpl: async () => { calls++; return new Response("private error", { status }); } });
  assert.equal(calls, 1); assert.equal(result.meta.planner, "local"); assert.ok(result.meta.fallback); assert.ok(result.plan.needs_count);
});
test("timeout and persistent invalid JSON fall back", async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => new Response("not json")]) {
    const r = await planRequest(QUERY, { ...DEFAULT_SETTINGS, groqEnabled: true }, { apiKey: "fake" }, { fetchImpl, timeoutMs: 10 });
    assert.equal(r.meta.planner, "local"); assert.ok(r.meta.fallback);
  }
});
test("privacy rejection falls back with zero HTTP calls", async () => {
  const r = await planRequest(QUERY + " description: PRIVATE", { ...DEFAULT_SETTINGS, groqEnabled: true }, { apiKey: "fake" }, { fetchImpl: () => assert.fail("privacy leak") });
  assert.equal(r.meta.fallback, "privacy firewall");
});
