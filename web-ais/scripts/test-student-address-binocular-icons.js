"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.resolve(__dirname, "..", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

const addressRendererStart = appSource.indexOf("  function renderStudentAddressField");
const addressRendererEnd = appSource.indexOf("  function renderStudentProgramLine", addressRendererStart);
assert.ok(addressRendererStart >= 0 && addressRendererEnd > addressRendererStart, "Не найден рендер адресных полей");

const addressRenderer = appSource.slice(addressRendererStart, addressRendererEnd);
assert.match(addressRenderer, /data-action="check-post-index"[\s\S]*renderBinocularsIcon\(\)/u);
assert.doesNotMatch(addressRenderer, /renderGlobeGridIcon\(\)/u);

const iconRendererStart = appSource.indexOf("  function renderBinocularsIcon");
const iconRendererEnd = appSource.indexOf("  function renderStudentEnglishNameField", iconRendererStart);
assert.ok(iconRendererStart >= 0 && iconRendererEnd > iconRendererStart, "Не найден значок бинокля");

const iconRenderer = appSource.slice(iconRendererStart, iconRendererEnd);
assert.match(iconRenderer, /<svg viewBox="0 0 24 24"/u);
assert.match(iconRenderer, /M10 10h4/u);
assert.doesNotMatch(appSource, /function renderGlobeGridIcon/u);

console.log("Student address binocular icon tests passed.");
