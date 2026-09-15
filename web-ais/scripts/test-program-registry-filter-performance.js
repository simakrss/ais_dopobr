"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

assert.match(source, /MAIN_REGISTRY_SEARCH_DEBOUNCE_MS = 180/u);
assert.match(source, /function applyMainRegistrySearchInput\(input\)[\s\S]{0,1400}view !== "programs"[\s\S]{0,500}window\.setTimeout/u);
assert.match(source, /getElementById\("searchInput"\)\?\.addEventListener\("input",[\s\S]{0,180}applyMainRegistrySearchInput/u);
assert.match(source, /function getRegistryRowSearchText\(row\)[\s\S]{0,700}registryRowSearchTextCache\.set/u);
assert.match(source, /state\.view === "programs" && state\.programRegistryTypeFilter\.length/u);
assert.match(source, /const matchProgramType = !selectedProgramTypes\.length \|\| selectedProgramTypes\.includes\([\s\S]{0,180}findProgramByName/u);
assert.match(source, /function getProgramRegistryTypeFilterOptions\(\) \{\s+const programs = getProgramRows\(\)/u);
assert.match(source, /programTrainingPlanHoursSummaryCache\.values\.get\(programRecord\)/u);

console.log("program registry filter performance checks: OK");
