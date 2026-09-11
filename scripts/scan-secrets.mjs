import { execFileSync } from "node:child_process";
import fs from "node:fs";
// Scan the entire tracked working tree plus new source files, printing only filenames.
const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const rules = [/\bgsk_[A-Za-z0-9]{30,}\b/, /\bsk-[A-Za-z0-9_-]{30,}\b/, /\b\d{3,}~[A-Za-z0-9_-]{40,}\b/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:canvasToken|groqKey)\s*[:=]\s*["'][A-Za-z0-9_~-]{30,}["']/];
const failures = paths.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile() && rules.some((rule) => rule.test(fs.readFileSync(p, "utf8"))));
if (failures.length) { console.error("Potential secrets in:", failures.join(", ")); process.exit(1); }
console.log(`Secret sanity scan passed (${paths.length} files; heuristic, not a credential audit guarantee).`);
