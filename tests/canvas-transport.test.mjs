import test from "node:test";
import assert from "node:assert/strict";
import { CanvasClient } from "../src/canvas-client.js";
import { createCanvasFetch, fetchCanvasInTab } from "../src/canvas-transport.js";

const BASE = "https://canvas.uva.nl";
const init = { method: "GET", headers: { Authorization: "Bearer fixture-token" } };
const request = (overrides = {}) => ({
  url: BASE + "/api/v1/users/self", authorization: init.headers.Authorization,
  deadline: Date.now() + 1000, maxBytes: 1024, ...overrides
});
async function inTab(fetchImpl, work, origin = BASE) {
  const previous = { fetch: globalThis.fetch, location: globalThis.location };
  globalThis.fetch = fetchImpl;
  globalThis.location = { origin };
  try { return await work(); } finally {
    globalThis.fetch = previous.fetch;
    if (previous.location === undefined) delete globalThis.location;
    else globalThis.location = previous.location;
  }
}
function tabChrome(result = { status: 200, headers: { "content-type": "application/json" },
  bytes: Array.from(new TextEncoder().encode('{"name":"Fixture user"}')) }) {
  const injections = [];
  return {
    injections,
    tabs: { query: async () => [{ id: 7, url: BASE + "/courses", active: true }] },
    scripting: { executeScript: async (injection) => {
      injections.push(injection);
      return [{ frameId: 0, result: { url: injection.args[0].url, ...result } }];
    } }
  };
}

test("worker network failure recovers with the same bearer token in an isolated Canvas tab", async () => {
  let direct = 0;
  const chromeApi = tabChrome();
  const transport = createCanvasFetch({ chromeApi, fetchImpl: async () => { direct++; throw new TypeError("Failed to fetch"); } });
  const client = new CanvasClient({ token: "fixture-token", fetchImpl: transport });
  assert.equal((await client.getCurrentUser()).name, "Fixture user");
  await client.get("/api/v1/courses");
  assert.equal(direct, 1, "later API requests use the working transport");
  assert.equal(transport.transport, "canvas-tab");
  for (const injection of chromeApi.injections) {
    assert.equal(injection.world, "ISOLATED");
    assert.deepEqual(injection.target, { tabId: 7, frameIds: [0] });
    assert.equal(injection.args[0].authorization, "Bearer fixture-token");
    assert.equal(injection.func, fetchCanvasInTab);
  }
});

test("direct HTTP 401 stays an authentication error without querying tabs", async () => {
  const chromeApi = tabChrome();
  chromeApi.tabs.query = () => { throw new Error("Must not query tabs"); };
  const transport = createCanvasFetch({ chromeApi, fetchImpl: async () => new Response("private", { status: 401 }) });
  await assert.rejects(new CanvasClient({ token: "fixture-token", fetchImpl: transport }).getCurrentUser(),
    (error) => error.status === 401 && /rejected the token/.test(error.message));
  assert.equal(chromeApi.injections.length, 0);
});

test("timeouts, application errors and file downloads never trigger the tab transport", async () => {
  for (const [url, error] of [
    [BASE + "/api/v1/users/self", new DOMException("Aborted", "AbortError")],
    [BASE + "/api/v1/users/self", new Error("application failure")],
    [BASE + "/files/1/download", new TypeError("network")],
    ["https://other.example/api/v1/users/self", new TypeError("network")]
  ]) {
    const chromeApi = tabChrome();
    const transport = createCanvasFetch({ chromeApi, fetchImpl: async () => { throw error; } });
    await assert.rejects(transport(url, init), (actual) => actual === error);
    assert.equal(chromeApi.injections.length, 0);
  }
});

test("no open Canvas tab produces an actionable safe error", async () => {
  const chromeApi = tabChrome();
  chromeApi.tabs.query = async () => [];
  const transport = createCanvasFetch({ chromeApi, fetchImpl: async () => { throw new TypeError("PRIVATE"); } });
  await assert.rejects(transport(BASE + "/api/v1/users/self", init),
    (error) => /Open https:\/\/canvas.uva.nl/.test(error.message) && !error.message.includes("PRIVATE"));
});

test("aborting while finding a Canvas tab prevents script execution", async () => {
  const controller = new AbortController();
  const chromeApi = tabChrome();
  chromeApi.tabs.query = async () => {
    controller.abort();
    return [{ id: 7, url: BASE + "/" }];
  };
  const transport = createCanvasFetch({ chromeApi, fetchImpl: async () => { throw new TypeError("network"); } });
  await assert.rejects(transport(BASE + "/api/v1/users/self", { ...init, signal: controller.signal }),
    (error) => error.name === "AbortError");
  assert.equal(chromeApi.injections.length, 0);
});

test("injected fetch sends only bearer authentication and returns bounded bytes and pagination", async () => {
  await inTab(async (url, options) => {
    assert.equal(url, BASE + "/api/v1/users/self");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer fixture-token");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    return new Response('{"name":"Fixture"}', { headers: {
      "content-type": "application/json", link: "</api/v1/users/self?page=2>; rel=next"
    } });
  }, async () => {
    // Chrome serializes this function; it must also work without module closures.
    const serialized = new Function("return (" + fetchCanvasInTab.toString() + ")")();
    const result = await serialized(request());
    assert.equal(result.status, 200);
    assert.equal(new TextDecoder().decode(new Uint8Array(result.bytes)), '{"name":"Fixture"}');
    assert.match(result.headers.link, /page=2/);
  });
});

test("injected fetch refuses changed origins, arbitrary paths and credential URLs before sending", async () => {
  const forbidden = async () => { throw new Error("Must not fetch"); };
  for (const overrides of [
    { url: "https://other.example/api/v1/users/self" },
    { url: BASE + "/login" },
    { url: "https://user:pass@canvas.uva.nl/api/v1/users/self" },
    { maxBytes: 8 * 1024 * 1024 },
    { authorization: "invalid" }
  ]) {
    await inTab(forbidden, async () => assert.equal((await fetchCanvasInTab(request(overrides))).error, "destination"));
  }
  await inTab(forbidden, async () => assert.equal((await fetchCanvasInTab(request())).error, "destination"),
    "https://other.example");
});

test("injected fetch refuses opaque redirects and never follows them", async () => {
  let canceled = false;
  await inTab(async () => ({
    type: "opaqueredirect", status: 0, body: { cancel: async () => { canceled = true; } }
  }), async () => assert.equal((await fetchCanvasInTab(request())).error, "redirect"));
  assert.equal(canceled, true);
});

test("injected fetch never returns private HTTP error bodies", async () => {
  await inTab(async () => new Response("PRIVATE SERVER MESSAGE", { status: 403 }),
    async () => {
      const result = await fetchCanvasInTab(request());
      assert.equal(result.status, 403);
      assert.deepEqual(result.bytes, []);
    });
});

test("injected fetch enforces limits with and without Content-Length", async () => {
  for (const headers of [{}, { "content-length": "1000" }]) {
    await inTab(async () => new Response("oversized", { headers }),
      async () => assert.equal((await fetchCanvasInTab(request({ maxBytes: 3 }))).error, "size"));
  }
});

test("tab transport maps redirects, navigation, limits and timeouts to safe errors", async () => {
  for (const [kind, pattern] of [["redirect", /Replace your Canvas access token/],
    ["destination", /untrusted destination/], ["size", /byte limit/], ["timeout", /Aborted/]]) {
    const chromeApi = tabChrome({ error: kind });
    const transport = createCanvasFetch({ chromeApi, fetchImpl: async () => { throw new TypeError("network"); } });
    await assert.rejects(transport(BASE + "/api/v1/users/self", init), pattern);
  }
});
