import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
for (const file of ["src", "options", "popup", "scripts", "tests"].flatMap(walk).filter((name) => /\.(?:m?js)$/.test(name))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status) { console.error(result.stderr); process.exit(1); }
}
console.log("All JavaScript syntax checks passed.");
