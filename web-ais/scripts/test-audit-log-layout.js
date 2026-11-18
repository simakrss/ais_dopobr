"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesPath = path.resolve(__dirname, "..", "styles.css");
const styles = fs.readFileSync(stylesPath, "utf8");

assert.doesNotMatch(styles, /\.admin-audit-change-list\s*\{[^}]*min-width:\s*360px/isu);
assert.doesNotMatch(styles, /\.admin-audit-(?:change-item|single-change)[^{]*\{[^}]*minmax\((?:90|100)px/isu);
assert.match(styles, /\.admin-audit-change-list\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%/isu);
assert.match(styles, /\.admin-audit-change-item,\s*\.admin-audit-single-change\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+12px\s+minmax\(0,\s*1fr\)/isu);
assert.match(styles, /\.admin-audit-change-item\s*>\s*strong,\s*\.admin-audit-single-change\s*>\s*strong\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/isu);
assert.match(styles, /\.admin-audit-details\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/isu);

console.log("Audit log layout checks passed.");
