import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const options = fs.readFileSync(new URL("../options/options.js", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../src/background.js", import.meta.url), "utf8");

test("Canvas test button requests withheld host access from the user gesture", () => {
  assert.match(options, /\$\("test"\)\.onclick[\s\S]*chrome\.permissions\.request\(\{ origins: \[CANVAS_ORIGIN\] \}\)/);
  assert.match(options, /Chrome is blocking Canvas site access/);
});

test("service worker checks Canvas host access before connection or retrieval", () => {
  assert.match(background, /chrome\.permissions\.contains\(\{ origins: \[CANVAS_ORIGIN\] \}\)/);
  assert.match(background, /\["TEST_CONNECTION", "FETCH_CANVAS_CONTEXT"\][\s\S]*hasCanvasHostAccess/);
  assert.match(background, /canvasHostAccess: await hasCanvasHostAccess\(\)/);
});
