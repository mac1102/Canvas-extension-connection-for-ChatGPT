import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
import { prosemirrorFixture } from "./prosemirror-fixture.mjs";
import { pdfBytes } from "../tests/fixtures/canvas.mjs";
import { zipSync, strToU8 } from "fflate";

const extension = process.cwd();
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/options/options.html`);
  await page.locator("#canvasStatus").filter({ hasText: "Settings loaded" }).waitFor();

  await page.locator("#groqKey").fill("fixture-key");
  await page.locator("#token").fill("fixture-canvas-token");
  await page.locator("#groqEnabled").check();
  await page.locator("#save").click();
  await page.locator("#canvasStatus").filter({ hasText: "Settings saved" }).waitFor();
  assert.equal(await page.locator("#groqKey").inputValue(), "");
  const stored = await worker.evaluate(() => chrome.storage.local.get(["canvasToken", "groqKey", "settings"]));
  assert.equal(stored.groqKey, "fixture-key");
  assert.equal(stored.settings.plannerMode, "hybrid");

  const validPlan = {
    version: 1,
    course_scope: { mode: "current", queries: [] },
    operations: [{ type: "list_assignments", query: null, resource_ids: [], required: true }],
    assignment_filters: { search_terms: [], time_window: null, submission_state: null, individual: false },
    resource_queries: [],
    follow_links: false,
    max_depth: 2,
    max_resources: 30,
    needs_count: false
  };

  await worker.evaluate((validPlan) => {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      const json = (value, init = {}) => new Response(JSON.stringify(value), { status: init.status || 200, headers: { "content-type": "application/json", ...(init.headers || {}) } });
      if (url.hostname === "api.groq.com") {
        return json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validPlan) } }] });
      }
      if (url.pathname === "/api/v1/users/self") {
        return new Response(null, { status: 302, headers: { location: "/api/v1/users/self/" } });
      }
      if (url.pathname === "/api/v1/users/self/") return json({ name: "Fixture Canvas User" });
      return json([]);
    };
  }, validPlan);

  await page.locator("#test").click();
  await page.locator("#canvasStatus").filter({ hasText: "Canvas connected as Fixture Canvas User" }).waitFor();
  await page.locator("#testGroq").click();
  await page.locator("#groqStatus").filter({ hasText: "Groq connected: openai/gpt-oss-20b" }).waitFor();

  await worker.evaluate(() => {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.hostname === "api.groq.com") return new Response("", { status: 401 });
      return new Response(JSON.stringify({ name: "Fixture Canvas User" }), { status: 200, headers: { "content-type": "application/json" } });
    };
  });
  await page.locator("#testGroq").click();
  await page.locator("#groqStatus").filter({ hasText: "Groq rejected the API key (HTTP 401)" }).waitFor();

  // Reproduce a worker-only network failure, then exercise real isolated-world
  // same-origin fetch in a Canvas tab. The page's fetch must never see the token.
  const tabRequests = [];
  await context.addCookies([{ name: "fixture_session", value: "must-not-be-used",
    domain: "canvas.uva.nl", path: "/", secure: true }]);
  await context.route("https://canvas.uva.nl/**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname.startsWith("/api/v1/")) {
      tabRequests.push(request.headers());
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ name: "Isolated Canvas User" }) });
    } else {
      await route.fulfill({ status: 200, contentType: "text/html",
        body: "<!doctype html><title>Canvas fixture</title><p>Canvas</p>" });
    }
  });
  const canvasTab = await context.newPage();
  await canvasTab.goto("https://canvas.uva.nl/");
  await canvasTab.evaluate(() => {
    window.pageFetchCalls = 0;
    window.fetch = () => { window.pageFetchCalls++; throw new Error("Page-world fetch must not receive credentials"); };
  });
  await worker.evaluate(() => {
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  });
  await page.locator("#test").click();
  await page.locator("#canvasStatus").filter({ hasText: "Canvas connected as Isolated Canvas User using the Canvas tab" }).waitFor();
  assert.equal(tabRequests.length, 1);
  assert.equal(tabRequests[0].authorization, "Bearer fixture-canvas-token");
  assert.equal(tabRequests[0].cookie, undefined);
  assert.equal(await canvasTab.evaluate(() => window.pageFetchCalls), 0);
  const connection = await worker.evaluate(() => chrome.storage.local.get("lastConnection"));
  assert.equal(connection.lastConnection.transport, "canvas-tab");
  await canvasTab.close();
  await context.unroute("https://canvas.uva.nl/**");
  await page.locator("#test").click();
  await page.locator("#canvasStatus").filter({ hasText: "Direct Canvas HTTPS access failed. Open https://canvas.uva.nl" }).waitFor();

  for (const [filename, bytes, expected] of [
    ["Manual.pdf", pdfBytes(), "40 percent"],
    ["Requirements.docx", zipSync({ "word/document.xml": strToU8('<w:document xmlns:w="w"><w:t>Individual evidence</w:t></w:document>') }), "Individual evidence"],
    ["Slides.pptx", zipSync({ "ppt/slides/slide1.xml": strToU8('<p:sld xmlns:p="p" xmlns:a="a"><a:t>Grading criteria</a:t></p:sld>') }), "Grading criteria"]
  ]) {
    await worker.evaluate(({ filename, bytes }) => {
      globalThis.fetch = async (input) => {
        const url = new URL(input);
        const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
        if (url.hostname === "api.groq.com") return new Response("", { status: 500 });
        if (url.pathname === "/api/v1/courses") return json([{ id: 1, name: "CONNECTIONS" }]);
        if (url.pathname === "/api/v1/courses/1/files") return json([{ id: 20, filename, display_name: "Course Manual" }]);
        if (url.pathname === "/api/v1/courses/1/files/20") return json({ id: 20, filename, display_name: "Course Manual", url: "https://canvas.uva.nl/files/20/download" });
        if (url.pathname === "/files/20/download") return new Response(new Uint8Array(bytes));
        if (url.pathname === "/api/v1/courses/1") return json({});
        return json([]);
      };
    }, { filename, bytes: [...bytes] });
    const parsed = await page.evaluate(() => chrome.runtime.sendMessage({ type: "FETCH_CANVAS_CONTEXT", query: "@Canvas course manual CONNECTIONS grading" }));
    assert.ok(parsed?.context?.includes(expected), `${filename}: ${JSON.stringify(parsed)}`);
  }

  // Exercise the real manifest content script -> worker -> GPT-OSS plan -> Canvas
  // path for the user's prompt, rather than mocking runtime.sendMessage in the page.
  await worker.evaluate(() => {
    globalThis.studyPlannerCalls = 0;
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
      if (url.hostname === "api.groq.com") {
        globalThis.studyPlannerCalls++;
        const plan = {
          version: 1, course_scope: { mode: "current", queries: [] },
          operations: [
            { type: "list_assignments", query: null, resource_ids: [], required: true },
            { type: "get_calendar_events", query: "today", resource_ids: [], required: false },
            ...["list_modules", "list_files", "get_page", "get_file"].map((type) => ({ type, query: null, resource_ids: [], required: false }))
          ],
          assignment_filters: { search_terms: [], time_window: null, submission_state: null, individual: false },
          resource_queries: [], follow_links: true, max_depth: 2, max_resources: 30, needs_count: false
        };
        return json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(plan) } }] });
      }
      if (url.pathname === "/api/v1/courses") return json([{ id: 1, name: "CONNECTIONS" }]);
      if (url.pathname === "/api/v1/courses/1/assignments") return json(
        Array.from({ length: 37 }, (_, i) => ({ id: i + 1, name: "Weekly Goal " + i, due_at: null })));
      if (url.pathname === "/api/v1/calendar_events") return json([]);
      if (url.pathname === "/api/v1/courses/1/pages") return new Response("", { status: 404 });
      if (url.pathname === "/api/v1/courses/1/files") return new Response("", { status: 403 });
      if (url.pathname === "/api/v1/courses/1/modules") {
        const start = new Date(), end = new Date();
        start.setDate(start.getDate() - (start.getDay() || 7) + 1);
        end.setTime(start.getTime()); end.setDate(end.getDate() + 6);
        const month = (d) => d.toLocaleDateString("en-US", { month: "long" });
        return json([{ id: 60, name: `Week: ${month(start)} ${start.getDate()} - ${month(end)} ${end.getDate()}`, items_count: 4, items: [
          { id: 61, position: 1, title: new Date().toLocaleDateString("en-US", { weekday: "long" }), type: "SubHeader" },
          { id: 62, position: 2, title: "Data acquisition seminar", type: "Page", page_url: "today-topic" },
          { id: 63, position: 3, title: "Deadlines", type: "SubHeader" },
          { id: 64, position: 4, title: "Unrelated deadline", type: "Assignment", content_id: 100 }
        ] }]);
      }
      if (url.pathname === "/api/v1/courses/1/pages/today-topic") return json({
        title: "Data acquisition seminar", body: '<p>Study source provenance.</p><a href="/courses/1/files/300">Today reading</a>'
      });
      if (url.pathname === "/api/v1/courses/1/files/300") return new Response("", { status: 403 });
      if (url.pathname === "/api/v1/files/300") return json({ id: 300, filename: "reading.txt", "content-type": "text/plain", size: 100,
        url: "https://canvas.uva.nl/files/300/download" });
      if (url.pathname === "/files/300/download") return new Response("Today reading: validate data provenance and recording consent.");
      return json([]);
    };
  });
  const editorHtml = await prosemirrorFixture();
  await context.route("https://chatgpt.com/**", (route) => route.fulfill({
    status: 200, contentType: "text/html", body: editorHtml
  }));
  const chatgpt = await context.newPage();
  chatgpt.on("pageerror", (error) => errors.push(error.message));
  await chatgpt.goto("https://chatgpt.com/");
  await chatgpt.locator("#prompt-textarea").fill("@Canvas fetch what I'm gonna study today");
  await chatgpt.locator(".canvas-live-hint").waitFor();
  await chatgpt.locator("#prompt-textarea").press("Enter");
  await chatgpt.waitForFunction(() => window.sent === 1);
  const enrichedStudy = await chatgpt.evaluate(() => window.sentText);
  assert.ok(enrichedStudy.includes('"planner":"Groq / openai/gpt-oss-20b"'));
  assert.ok(enrichedStudy.includes('"matches":37'));
  assert.ok(enrichedStudy.includes('"search_terms":[]'));
  assert.ok(enrichedStudy.includes("Data acquisition seminar"));
  assert.ok(enrichedStudy.includes('"kind":"module_schedule"'));
  assert.ok(enrichedStudy.includes("Today reading: validate data provenance"));
  assert.ok(!enrichedStudy.includes("Unrelated deadline"));
  assert.ok(enrichedStudy.includes("<<< END CANVAS LIVE DATA >>>"));
  assert.equal(await chatgpt.evaluate(() => window.sent), 1);
  assert.equal(await worker.evaluate(() => globalThis.studyPlannerCalls), 1);
  // The visible Fetch Canvas action attaches verified evidence for review, without sending.
  await chatgpt.locator("#prompt-textarea").fill("@Canvas fetch what I'm gonna learn todaay");
  await chatgpt.getByRole("button", { name: "Fetch Canvas and attach context without sending" }).click();
  await chatgpt.locator(".canvas-live-toast__message").filter({ hasText: "Review your draft" }).waitFor();
  assert.equal(await chatgpt.evaluate(() => window.sent), 1);
  assert.ok((await chatgpt.locator("#prompt-textarea").innerText()).includes("Today reading: validate data provenance"));
  await chatgpt.locator('[data-testid="send-button"]').click();
  await chatgpt.waitForFunction(() => window.sent === 2);
  assert.equal(await worker.evaluate(() => globalThis.studyPlannerCalls), 2);
  assert.ok((await chatgpt.evaluate(() => window.sentText)).includes("<<< END CANVAS LIVE DATA >>>"));
  await chatgpt.close();
  await context.unroute("https://chatgpt.com/**");

  await page.locator("#clearGroq").click();
  await page.locator("#groqStatus").filter({ hasText: "Groq key removed" }).waitFor();
  assert.equal((await worker.evaluate(() => chrome.storage.local.get("groqKey"))).groqKey, undefined);

  await page.goto(`chrome-extension://${id}/popup/popup.html`);
  await page.locator("#state").filter({ hasText: "Ready" }).waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));

  for (const markup of [
    '<form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>',
    '<form><div id="prompt-textarea" contenteditable="true"></div><button aria-label="Send message">Send</button></form>'
  ]) {
    const composer = await context.newPage();
    await composer.setContent(markup);
    await composer.addScriptTag({ path: path.join(extension, "src/chatgpt/composer-adapter.js") });
    assert.equal(await composer.evaluate(async () => {
      const el = CanvasComposer.findComposer();
      await CanvasComposer.setComposerText(el, "Original draft\nCanvas context");
      return CanvasComposer.getComposerText(el);
    }), "Original draft\nCanvas context");
    await composer.close();
  }

  console.log("Browser smoke passed: MV3 worker, Canvas/Groq connection UI, actual MV3-to-GPT-OSS module/day retrieval with genuine ProseMirror and review/send, isolated Canvas-tab HTTPS fallback, safe redirects, settings save/remove, popup, PDF/DOCX/PPTX, composer adapters.");
} finally {
  await context.close();
}
