"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../.htaccess"), "utf8");
const rules = [...source.matchAll(/^\s*RewriteRule (\S+) (\S+) \[([^\]]+)\]/gm)];
function permitted(url) {
  for (const [, pattern, target, flags] of rules) {
    if (new RegExp(pattern).test(url)) return target === "-" && !flags.includes("404");
  }
  return false;
}
const hash = "a".repeat(64);
for (const url of ["updates/windows/latest.json", `updates/windows/${hash}.msi`]) {
  assert.equal(permitted(url), true, url);
}
for (const url of ["updates/windows/", "updates/windows/file.msi", "updates/windows/latest.json.bak",
  `updates/windows/${hash}.msi.bak`, `updates/windows/${hash.toUpperCase()}.msi`,
  "updates/windows/service-config.json", "updates/windows/../storage/settings.json",
  "scripts/ais-msi-update.cs", "storage/settings.json", ".runtime/tunnel-secret.txt"]) {
  assert.equal(permitted(url), false, url);
}
console.log("PASS: signed Windows update endpoints only; private files and other paths remain denied");
