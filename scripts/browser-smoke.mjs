import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
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
    assert.equal(await composer.evaluate(() => {
      const el = CanvasComposer.findComposer();
      CanvasComposer.setComposerText(el, "Original draft\nCanvas context");
      return CanvasComposer.getComposerText(el);
    }), "Original draft\nCanvas context");
    await composer.close();
  }

  console.log("Browser smoke passed: MV3 worker, Canvas/Groq connection UI, safe redirects, settings save/remove, popup, PDF/DOCX/PPTX, composer adapters.");
} finally {
  await context.close();
}
