import test from "node:test";
import assert from "node:assert/strict";
import { CanvasClient, fileDestination } from "../src/canvas-client.js";
import { executePlan } from "../src/retrieval/resource-executor.js";
import { deterministicPlan } from "../src/planner/deterministic-planner.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { parseDocument } from "../src/parsers/index.js";
import { linkedStudyFixture } from "./fixtures/linked-study.mjs";
import { ResourceGraph } from "../src/retrieval/resource-graph.js";
import { discoverLinks } from "../src/retrieval/html.js";

const query = "@Canvas fetch hôm nay tôi học cái gì";
async function retrieve(options = {}, settings = {}) {
  const fixture = linkedStudyFixture(options);
  const plan = deterministicPlan(query).plan;
  const result = await executePlan({ query, plan, now: new Date(2026, 9, 8, 12),
    client: new CanvasClient({ token: "fixture-token", fetchImpl: fixture.fetchImpl, maxRequests: 40 }),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    // PDF.js needs browser DOM APIs; its real parsing is covered by MV3 smoke.
    parseDocument: (options) => parseDocument({ ...options, pdfParser: async () => ({ text: "Slides: compare browser automation with HTTP requests." }) }) });
  return { ...fixture, ...result, records: JSON.parse(result.context).records };
}

test("three daily pages include descriptions, assignment links and all seven document contents within request budget", async () => {
  const result = await retrieve();
  assert.equal(result.stats.documentsParsed, 7);
  assert.deepEqual(result.records.find((r) => r.kind === "file_summary"), {
    kind: "file_summary", total: 7, read: 7, failed: 0, not_read: 0, complete: true,
    scope: "Discovered linked files within selected resources and relationship limits; text excerpts may be truncated or omitted by the context budget."
  });
  for (const text of ["Two practical mini projects", "Formative Selenium instructions", "Summative scraping instructions",
    "css_formatives", "Example 306", "Example 307", "Example 308", "compare browser automation"]) assert.ok(result.context.includes(text), text);
  assert.equal(result.records.filter((r) => r.kind === "assignment_detail").length, 2);
  const page = result.records.find((r) => r.resource === "Scraping with Selenium" && r.kind === "resource_excerpt");
  assert.ok(page.links.some((link) => link.url.endsWith("/assignments/201")));
  assert.equal(page.linked_resources.length, 3);
  assert.ok(result.records.some((r) => r.links?.some((link) => link.url === "https://example.org/ethics")));
  assert.ok(!result.calls.some((call) => /modules\/\d+\/items$/.test(call.url.pathname)), "old module item lists are never fetched");
  assert.ok(!result.calls.some((call) => /courses\/1\/(files|pages)$/.test(call.url.pathname)));
  assert.ok(result.calls.length < 40);
  assert.ok(!result.context.includes("SIGNED_VALUE") && !result.context.includes("PRIVATE_VERIFIER") && !result.context.includes("OUTPUT_NOT_SOURCE"));
  assert.ok(result.context.length <= DEFAULT_SETTINGS.maxContextChars);
  for (const { url, init } of result.calls) {
    assert.equal(init.method, "GET"); assert.equal(init.credentials, "omit");
    assert.equal(init.headers.Authorization, url.origin === "https://canvas.uva.nl" ? "Bearer fixture-token" : undefined);
    if (url.origin !== "https://canvas.uva.nl") assert.equal(init.redirect, "error");
  }
});

test("denied file retains filename, source link and failure stage without claiming complete contents", async () => {
  const result = await retrieve({ deniedFile: 304 });
  const file = result.records.find((r) => r.kind === "file_detail" && r.id === 304);
  assert.equal(file.resource, "css_formatives_env.yaml");
  assert.equal(file.status, "failed"); assert.equal(file.stage, "metadata"); assert.equal(file.http_status, 403);
  assert.ok(file.url.endsWith("/files/304"));
  assert.equal(result.records.find((r) => r.kind === "file_summary").complete, false);
  assert.ok(!result.context.includes("PRIVATE_SERVER_BODY"));
});

test("budget exhaustion explicitly marks discovered files unread", async () => {
  const result = await retrieve({}, { maxResources: 3 });
  assert.ok(result.records.some((r) => r.kind === "file_detail" && r.status === "not_read"));
  assert.equal(result.records.find((r) => r.kind === "file_summary").complete, false);
});

test("signed storage validation rejects non-storage hosts, unsigned S3 and credential URLs", () => {
  for (const url of ["http://uploads.s3.amazonaws.com/x?X-Amz-Signature=test", "https://uploads.s3.amazonaws.com/x",
    "https://evil.example/x?X-Amz-Signature=test", "https://s3.amazonaws.com.evil.example/x?X-Amz-Signature=test",
    "https://user:password@uploads.s3.amazonaws.com/x?X-Amz-Signature=test", "https://ec2.amazonaws.com/x?X-Amz-Signature=test"])
    assert.throws(() => fileDestination(url));
  assert.equal(fileDestination("https://uploads.s3.eu-central-1.amazonaws.com/x?X-Amz-Signature=test").protocol, "https:");
});

test("a locked file is not retried through the signed URL endpoint", async () => {
  let calls = 0;
  const client = new CanvasClient({ token: "fixture-token", fetchImpl: async () => { calls++; return new Response("locked"); } });
  await assert.rejects(client.downloadFile({ id: 304, url: "https://canvas.uva.nl/files/304/download", locked_for_user: true }), /locked/);
  assert.equal(calls, 0);
});

test("Canvas link verifiers stay internal and preserve access to files available by link", async () => {
  const graph = new ResourceGraph();
  const source = graph.add("Page", 1, "practical");
  const [file] = discoverLinks('<a href="/courses/1/files/304?verifier=private_link">Environment file</a>', source, graph,
    "https://canvas.uva.nl", new Set(["1"]));
  assert.equal(file.verifier, "private_link");
  const requests = [];
  const client = new CanvasClient({ token: "fixture-token", fetchImpl: async (input) => {
    const url = new URL(input); requests.push(url);
    if (!url.pathname.endsWith("/public_url")) return new Response("", { status: 403 });
    assert.equal(url.searchParams.get("verifier"), "private_link");
    return new Response(JSON.stringify({ public_url: "https://uploads.s3.amazonaws.com/env.yaml?X-Amz-Signature=fixture" }));
  } });
  const metadata = await client.getFile(1, 304, file);
  assert.equal(metadata.filename, "env.yaml");
  assert.ok(requests.slice(0, 2).every((url) => url.searchParams.get("use_verifiers") === "true"));
  assert.ok(requests.every((url) => url.searchParams.get("verifier") === "private_link"));
});
