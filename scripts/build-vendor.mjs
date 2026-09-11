import { build } from "esbuild";
import { mkdir, copyFile, writeFile, readFile, readdir } from "node:fs/promises";
await mkdir("src/vendor", { recursive: true });
const packages = new Set(["pdfjs-dist"]);
for (const [name, entry] of [["dom", 'export { DOMParser } from "linkedom";'], ["zip", 'export { unzipSync } from "fflate";']]) {
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd() }, bundle: true, format: "esm", platform: "browser", target: "chrome140", minify: true, metafile: true, outfile: `src/vendor/${name}.js` });
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.replaceAll("\\", "/").match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (match) packages.add(match[1]);
  }
}
for (const file of ["pdf.mjs", "pdf.worker.mjs"]) await copyFile(`node_modules/pdfjs-dist/build/${file}`, `src/vendor/${file}`);
const licenses = [];
for (const pkg of [...packages].sort()) {
  const directory = `node_modules/${pkg}`;
  const name = (await readdir(directory)).find((file) => /^(?:LICENSE|COPYING)(?:\..*)?$/i.test(file));
  if (!name) throw new Error(`Missing license for ${pkg}`);
  const version = JSON.parse(await readFile(`${directory}/package.json`, "utf8")).version;
  licenses.push(`${pkg}@${version}\n${(await readFile(`${directory}/${name}`, "utf8")).replaceAll("\r\n", "\n")}`);
}
await writeFile("src/vendor/LICENSES.txt", licenses.join("\n\n"));
