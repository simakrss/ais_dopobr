const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

const renderStart = appSource.indexOf("  function renderStudentApplicationDetail");
const renderEnd = appSource.indexOf("\n\n  function getStudentApplicationsImportPagination", renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, "application detail renderer must exist");
const renderSource = appSource.slice(renderStart, renderEnd);
[
  '["Заказ", row.order, true]',
  '["Программа", row.program, true]',
  '["Организация", row.organization, true]',
  '["Примечание", row.note, true]'
].forEach((expected) => assert.ok(renderSource.includes(expected), `${expected} must use the full-width layout`));
assert.match(renderSource, /details\.map\(\(\[label, value, wide\]\)/u);
assert.match(renderSource, /class="\$\{wide \? "is-wide" : ""\}"/u);

const detailValueRule = stylesSource.match(/\.student-application-detail-grid dd\s*\{([\s\S]*?)\n\}/u)?.[1] || "";
assert.match(detailValueRule, /white-space:\s*normal/u);
assert.match(detailValueRule, /overflow-wrap:\s*anywhere/u);
assert.match(detailValueRule, /text-overflow:\s*clip/u);
assert.doesNotMatch(detailValueRule, /text-overflow:\s*ellipsis/u);
assert.doesNotMatch(detailValueRule, /white-space:\s*nowrap/u);
assert.match(detailValueRule, /font-size:\s*13\.5px/u);

const detailLabelRule = stylesSource.match(/\.student-application-detail-grid dt\s*\{([\s\S]*?)\n\}/u)?.[1] || "";
assert.match(detailLabelRule, /font-size:\s*11\.5px/u);
assert.match(stylesSource, /\.student-applications-import-detail h3\s*\{[\s\S]*?font-size:\s*15px/u);

console.log("student application detail layout tests: OK");
