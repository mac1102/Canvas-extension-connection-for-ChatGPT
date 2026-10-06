import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ["send", "no-send", "failure", "changed", "missing-runtime", "invalid-runtime", "invalidated", "disconnected"]) {
    const page = await browser.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<form><textarea id="prompt-textarea"></textarea><button data-testid="send-button" type="button">Send</button></form><button id="elsewhere">Other action</button>');
    await page.evaluate((mode) => {
      globalThis.sent = 0; globalThis.calls = 0;
      const input = document.querySelector("textarea"), button = document.querySelector('[data-testid="send-button"]');
      if (mode === "no-send") button.disabled = true;
      button.onclick = () => { globalThis.sent++; globalThis.sentText = input.value; input.value = ""; };
      globalThis.chrome = { runtime: { id: "fixture-extension", sendMessage: async () => {
        globalThis.calls++;
        if (mode === "invalidated") throw new Error("Extension context invalidated.");
        if (mode === "disconnected") throw new Error("Could not establish connection. Receiving end does not exist.");
        if (mode === "changed") { await new Promise((r) => setTimeout(r, 100)); input.value = "Updated draft @Canvas"; }
        return mode === "failure" ? { ok: false, error: { message: "Canvas unavailable" } } : { ok: true, context: '{"records":[{"total":2}]}', meta: {} };
      } } };
      if (mode === "missing-runtime") globalThis.chrome = {};
      if (mode === "invalid-runtime") delete globalThis.chrome.runtime.id;
    }, mode);
    await page.addScriptTag({ path: path.resolve("src/chatgpt/composer-adapter.js") });
    await page.addScriptTag({ path: path.resolve("src/content.js") });
    await page.locator("textarea").fill("@Canvas fetch what I am gonna study today");
    await page.locator("#elsewhere").press("Enter"); assert.equal(await page.evaluate(() => globalThis.calls), 0);
    await page.locator("textarea").press("Enter");
    if (mode === "send") {
      await page.waitForFunction(() => globalThis.sent === 1); assert.ok((await page.evaluate(() => globalThis.sentText)).startsWith("@Canvas fetch what I am gonna study today\n"));
      assert.equal(await page.evaluate(() => globalThis.calls), 1);
    } else if (mode === "no-send") {
      await page.waitForFunction(() => document.querySelector(".canvas-live-toast__message")?.textContent.includes("Press Send"));
      assert.ok((await page.locator("textarea").inputValue()).includes('"total":2'));
      await page.evaluate(() => document.querySelector('[data-testid="send-button"]').disabled = false);
      await page.locator('[data-testid="send-button"]').click(); assert.equal(await page.evaluate(() => globalThis.calls), 1);
    } else {
      await page.waitForFunction(() => document.querySelector(".canvas-live-toast")?.dataset.kind === "error");
      assert.equal(await page.locator("textarea").inputValue(), mode === "changed" ? "Updated draft @Canvas" : "@Canvas fetch what I am gonna study today");
      if (["missing-runtime", "invalid-runtime", "invalidated"].includes(mode)) {
        assert.match(await page.locator(".canvas-live-toast__message").innerText(), /Refresh this ChatGPT tab/);
        assert.equal(await page.evaluate(() => globalThis.sent), 0);
        assert.equal(await page.evaluate(() => globalThis.calls), mode === "invalidated" ? 1 : 0);
      }
      if (mode === "disconnected") {
        assert.match(await page.locator(".canvas-live-toast__message").innerText(), /Reload it in chrome:\/\/extensions/);
        assert.equal(await page.evaluate(() => globalThis.sent), 0);
      }
    }
    assert.deepEqual(errors, []); await page.close();
  }
  console.log("Composer integration passed: one fetch/send, manual send fallback, error preservation, edited-draft preservation, focus isolation, missing/invalidated runtime and disconnected worker recovery.");
} finally { await browser.close(); }
