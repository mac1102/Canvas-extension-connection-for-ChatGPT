import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as router from "../src/router.js";

test("background router imports exist as router exports", () => {
  const source = fs.readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const match = source.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/router\.js["'];/);
  assert.ok(match, "background.js must import router helpers from ./router.js");

  const importedNames = match[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  for (const name of importedNames) {
    assert.equal(
      typeof router[name],
      "function",
      `background.js imports ${name}, but router.js does not export it as a function`
    );
  }
});
