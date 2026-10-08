import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";

const original = "@Canvas fetch what I am gonna study today";
const context = '{"records":[{"total":2,"title":"Today reading"}]}';
const modes = [
  "send", "hint-send", "rapid-send", "duplicate-script", "rollback-retry", "send-rollback", "edited-attached", "new-invocation", "delayed-state", "early-keydown", "early-pointerdown", "early-click",
  "form-submit", "paste-only", "rollback", "reject-rich", "no-send", "failure",
  "changed", "missing-runtime", "invalid-runtime", "invalidated", "disconnected"
];
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of modes) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const rich = ["paste-only", "reject-rich"].includes(mode);
    await page.setContent(
      '<form id="chat">' +
      (rich ? '<div id="prompt-textarea" contenteditable="true" style="min-height:40px"></div>' : '<textarea id="prompt-textarea"></textarea>') +
      '<button data-testid="send-button" type="' + (mode === "form-submit" ? "submit" : "button") + '">Send</button></form>' +
      '<form id="other"><button data-testid="send-button" type="button">Send elsewhere</button></form>' +
      '<button id="elsewhere">Other action</button>'
    );
    // Set up the page's handlers before the extension to reproduce capture-order bugs.
    await page.evaluate(({ mode, rich, context }) => {
      globalThis.sent = 0; globalThis.calls = 0; globalThis.insertions = 0; globalThis.modelText = "";
      const input = document.querySelector("#prompt-textarea");
      const button = document.querySelector("#chat button");
      const text = () => rich ? input.innerText : input.value;
      const commit = () => {
        if (mode === "send-rollback" && !globalThis.rejectedSend) {
          globalThis.rejectedSend = true;
          setTimeout(() => {
            input.value = globalThis.draftText;
            globalThis.modelText = input.value;
            input.dispatchEvent(new InputEvent("input", { bubbles: true }));
          }, 60);
          return;
        }
        globalThis.sent++;
        globalThis.sentText = globalThis.modelText;
        if (rich) input.replaceChildren(); else input.value = "";
        globalThis.modelText = "";
      };
      input.addEventListener("input", () => {
        const next = text();
        if (!next.includes("<<< CANVAS LIVE DATA")) globalThis.draftText = next;
        if (next.includes("<<< CANVAS LIVE DATA")) globalThis.insertions++;
        if (mode === "delayed-state" && next.includes("<<< CANVAS LIVE DATA")) {
          setTimeout(() => { globalThis.modelText = next; }, 180);
        } else if ((mode === "rollback" || mode === "rollback-retry" && globalThis.insertions === 1) && next.includes("<<< CANVAS LIVE DATA")) {
          const previous = globalThis.modelText;
          setTimeout(() => { input.value = previous; }, 60);
        } else globalThis.modelText = next;
      });
      if (rich) {
        document.execCommand = () => false;
        input.addEventListener("paste", (event) => {
          event.preventDefault();
          if (mode === "reject-rich") return;
          const next = event.clipboardData.getData("text/plain");
          // Simulate a rich editor's own paste transaction and paragraph DOM.
          input.replaceChildren(...next.split("\n").map((line) => {
            const p = document.createElement("p");
            p.textContent = line;
            if (!line) p.append(document.createElement("br"));
            return p;
          }));
          globalThis.modelText = next;
          input.dispatchEvent(new InputEvent("input", { bubbles: true }));
          // Sending reads the editor's state, not the paragraph DOM serialization.
          globalThis.modelText = next;
        });
      }
      if (["no-send", "edited-attached"].includes(mode)) button.disabled = true;
      if (mode === "early-keydown") {
        document.addEventListener("keydown", (event) => {
          if (event.target === input && event.key === "Enter") {
            event.preventDefault(); event.stopImmediatePropagation(); commit();
          }
        }, true);
      }
      if (["early-pointerdown", "early-click"].includes(mode)) {
        document.addEventListener(mode === "early-pointerdown" ? "pointerdown" : "click", (event) => {
          if (event.target === button) {
            event.preventDefault(); event.stopImmediatePropagation(); commit();
          }
        }, true);
      } else if (mode === "form-submit") {
        document.querySelector("#chat").addEventListener("submit", (event) => {
          event.preventDefault(); commit();
        });
      } else button.onclick = commit;
      if (mode === "early-pointerdown") button.onclick = commit;

      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (value) => {
          if (mode === "rollback") throw new Error("Clipboard unavailable");
          globalThis.copiedPrompt = value;
        }
      } });
      globalThis.chrome = { runtime: { id: "fixture-extension", sendMessage: async () => {
        globalThis.calls++;
        if (mode === "rapid-send") await new Promise((resolve) => setTimeout(resolve, 150));
        if (mode === "invalidated") throw new Error("Extension context invalidated.");
        if (mode === "disconnected") throw new Error("Could not establish connection. Receiving end does not exist.");
        if (mode === "changed") {
          await new Promise((resolve) => setTimeout(resolve, 100));
          input.value = "Updated draft @Canvas";
          globalThis.modelText = input.value;
        }
        return mode === "failure" ? { ok: false, error: { message: "Canvas unavailable" } } :
          { ok: true, context, meta: { fetchedAt: "2026-10-06T08:20:15.446Z" } };
      } } };
      if (mode === "missing-runtime") globalThis.chrome = {};
      if (mode === "invalid-runtime") delete globalThis.chrome.runtime.id;
    }, { mode, rich, context });
    await page.addScriptTag({ path: path.resolve("src/chatgpt/composer-adapter.js") });
    await page.addScriptTag({ path: path.resolve("src/content.js") });
    if (mode === "duplicate-script") await page.addScriptTag({ path: path.resolve("src/content.js") });
    const input = page.locator("#prompt-textarea");
    await input.fill(original);
    await page.locator("#elsewhere").press("Enter");
    await page.locator("#other button").click();
    assert.equal(await page.evaluate(() => globalThis.calls), 0, mode + ": ignore other controls");

    if (mode === "hint-send") await page.getByRole("button", { name: "Fetch Canvas once and send" }).click();
    else if (mode === "rapid-send") {
      await input.press("Enter");
      await page.locator("#chat button").click();
      await input.press("Enter");
    }
    else if (["early-pointerdown", "early-click"].includes(mode)) await page.locator("#chat button").click();
    else if (mode === "form-submit") await page.evaluate(() => document.querySelector("#chat").requestSubmit());
    else await input.press("Enter");

    const success = ["send", "hint-send", "rapid-send", "duplicate-script", "new-invocation", "delayed-state", "early-keydown", "early-pointerdown", "early-click", "form-submit", "paste-only"].includes(mode);
    if (success) {
      await page.waitForFunction(() => globalThis.sent === 1);
      const sent = await page.evaluate(() => globalThis.sentText);
      assert.ok(sent.startsWith(original.replace(/@Canvas\s*/, "") + "\n"), mode);
      assert.ok(!sent.includes("@Canvas"), mode + ": invocation tag is consumed");
      assert.ok(sent.includes(context), mode + ": complete context reaches send state");
      assert.ok(sent.includes("<<< END CANVAS LIVE DATA >>>"), mode);
      assert.equal(await page.evaluate(() => globalThis.calls), 1, mode);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => globalThis.sent), 1, mode + ": no duplicate send");
      assert.equal((await input.inputValue().catch(() => input.innerText())).trim(), "", mode + ": sent context leaves no draft");
      if (mode === "new-invocation") {
        await input.fill(original);
        await input.press("Enter");
        await page.waitForFunction(() => globalThis.sent === 2);
        assert.equal(await page.evaluate(() => globalThis.calls), 2, "a new tag/request gets fresh data once");
      }
    } else if (["no-send", "edited-attached"].includes(mode)) {
      await page.waitForFunction(() => document.querySelector(".canvas-live-toast__message")?.textContent.includes("Send button is unavailable"));
      assert.ok((await input.inputValue()).includes(context));
      if (mode === "edited-attached") await input.fill((await input.inputValue()) + "\nPlease summarize. @Canvas inside an attached prompt must not refetch.");
      await page.evaluate(() => document.querySelector("#chat button").disabled = false);
      await page.locator("#chat button").click();
      assert.equal(await page.evaluate(() => globalThis.sent), 1);
      assert.ok((await page.evaluate(() => globalThis.sentText)).includes(context));
      assert.equal(await page.evaluate(() => globalThis.calls), 1);
    } else if (["rollback-retry", "send-rollback"].includes(mode)) {
      await page.waitForFunction(() => document.querySelector(".canvas-live-toast")?.dataset.kind === "error");
      assert.equal(await input.inputValue(), original);
      await input.press("Enter");
      await page.waitForFunction(() => globalThis.sent === 1);
      assert.equal(await page.evaluate(() => globalThis.calls), 1, "an editor retry reuses the fetched response");
      assert.ok((await page.evaluate(() => globalThis.sentText)).includes(context));
    } else {
      await page.waitForFunction(() => document.querySelector(".canvas-live-toast")?.dataset.kind === "error");
      assert.equal(await page.evaluate(() => globalThis.sent), 0, mode + ": unverified prompt must not send");
      const draft = rich ? await input.innerText() : await input.inputValue();
      assert.equal(draft, mode === "changed" ? "Updated draft @Canvas" : original, mode);
      if (["missing-runtime", "invalid-runtime", "invalidated"].includes(mode)) {
        assert.match(await page.locator(".canvas-live-toast__message").innerText(), /Refresh this ChatGPT tab/);
        assert.equal(await page.evaluate(() => globalThis.calls), mode === "invalidated" ? 1 : 0);
      }
      if (mode === "disconnected") assert.match(await page.locator(".canvas-live-toast__message").innerText(), /Reload it in chrome:\/\/extensions/);
      if (["rollback", "reject-rich", "changed"].includes(mode)) {
        await page.locator(".canvas-live-toast__copy").click();
        if (mode === "rollback") {
          const fallback = page.locator(".canvas-live-toast__draft");
          assert.ok((await fallback.inputValue()).includes(context));
          assert.equal(await page.evaluate(() => CanvasComposer.findComposer().id), "prompt-textarea");
          await fallback.press("Enter");
          assert.equal(await page.evaluate(() => globalThis.calls), 1, "copy fallback is not a composer");
        } else {
          const copied = await page.evaluate(() => globalThis.copiedPrompt);
          assert.ok(copied.includes(context));
          if (mode === "reject-rich") {
            await input.fill(copied);
            await page.locator("#chat button").click();
            assert.equal(await page.evaluate(() => globalThis.sent), 1);
            assert.ok((await page.evaluate(() => globalThis.sentText)).includes(context));
            assert.equal(await page.evaluate(() => globalThis.calls), 1, "copied verified prompt does not refetch");
          }
        }
      }
    }
    assert.deepEqual(errors, [], mode);
    await page.close();
  }
  console.log("Composer integration passed: one fetch/send per tag, consumed tag and empty sent draft, rapid input and duplicate installation, cached insertion retry, edited attached data without refetch, new invocation refresh, delayed editor state, pointer/click/form, rich paste, rejection/copy recovery and stale runtime.");
} finally { await browser.close(); }
