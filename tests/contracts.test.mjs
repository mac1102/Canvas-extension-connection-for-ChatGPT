import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
const root = new URL("../", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", root)));
test("manifest paths and permissions", () => {
  assert.equal(manifest.manifest_version, 3); assert.equal(manifest.background.type, "module");
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((c) => [...c.js, ...c.css])]) assert.ok(fs.existsSync(new URL(file, root)), file);
  assert.deepEqual(manifest.host_permissions, ["https://canvas.uva.nl/*", "https://api.groq.com/*"]);
});
test("worker, parser and UI module graphs resolve including named exports", async () => {
  for (const file of ["src/background.js", "src/parsers/worker.js", "src/parsers/offscreen.js", "options/options.js", "popup/popup.js"]) {
    const result = await build({ entryPoints: [file], bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent", metafile: true });
    assert.ok(Object.keys(result.metafile.inputs).length > 0);
  }
});
test("content context has no privileged storage, network, or options calls", () => {
  for (const file of manifest.content_scripts[0].js) {
    const source = fs.readFileSync(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /chrome\.(?:storage|offscreen)|chrome\.runtime\.openOptionsPage|\bfetch\s*\(/);
  }
});
test("HTML local scripts and styles exist, no remote scripts", () => {
  for (const file of ["options/options.html", "popup/popup.html", "src/parsers/offscreen.html"]) {
    const html = fs.readFileSync(new URL(file, root), "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
      assert.ok(!match[1].startsWith("http")); assert.ok(fs.existsSync(new URL(path.posix.join(path.posix.dirname(file), match[1]), root)));
    }
  }
});
test("background imports and registers with a minimal Chrome runtime", async () => {
  let registered = false;
  globalThis.chrome = { runtime: { id: "test", getURL: (p) => `chrome-extension://test/${p}`, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() { registered = true; } } },
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({}) } } };
  const worker = await import("../src/background.js"); assert.equal(registered, true);
  assert.throws(() => worker.validateSender("SAVE_SETTINGS", { id: "test", url: "https://chatgpt.com/", frameId: 0 }));
  assert.throws(() => worker.validateSender("GET_STATUS", { id: "other", url: "https://chatgpt.com/", frameId: 0 }));
  assert.equal(worker.validateSender("OPEN_OPTIONS", { id: "test", url: "https://chatgpt.com/", frameId: 0 }), false);
});

test("worker URL references and dynamic parser modules exist", () => {
  for (const file of ["src/parsers/pdf.js", "src/parsers/bridge.js", "src/parsers/offscreen.js", "src/parsers/index.js"]) {
    const source = fs.readFileSync(new URL(file, root), "utf8");
    for (const match of source.matchAll(/(?:new URL\(|import\()"([^\"]+)"/g)) assert.ok(fs.existsSync(new URL(match[1], new URL(file, root))), match[1]);
  }
});