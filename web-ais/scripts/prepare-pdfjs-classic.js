"use strict";
// Browser-only adaptation of the vendored Mozilla bundles. Their own global
// exports are retained; legacy installed update engines parse classic JS only.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
for (const file of ["pdfjs-core.js", "pdfjs-worker.js"]) {
  const target = path.join(__dirname, "..", file);
  let source = fs.readFileSync(target, "utf8");
  source = source.replace(/export\{[^}]+\};?\s*$/, "").replaceAll("import.meta.url", "globalThis.location.href");
  new vm.Script(source, {filename: file});
  fs.writeFileSync(target, source);
}
