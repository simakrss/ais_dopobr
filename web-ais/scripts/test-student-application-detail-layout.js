const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/gu, "\n");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

const renderStart = appSource.indexOf("  function renderStudentApplicationDetail");
const renderEnd = appSource.indexOf("\n\n  function getStudentApplicationsImportPagination", renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, "application detail renderer must exist");
const renderSource = appSource.slice(renderStart, renderEnd);
const compactTopRow = [
  '["Дата", row.date]',
  '["ФИО", row.name]',
  '["Телефон", row.phone]',
  '["Email", row.email]',
  '["Город", row.city]'
];
compactTopRow.forEach((expected) => {
  assert.ok(renderSource.includes(expected), `${expected} must exist`);
});
compactTopRow.slice(1).forEach((expected, index) => {
  assert.ok(
    renderSource.indexOf(compactTopRow[index]) < renderSource.indexOf(expected),
    `${expected} must follow ${compactTopRow[index]}`
  );
});
assert.doesNotMatch(renderSource, /\["(?:Телефон|Email|Город)",[^\]]*,\s*true\]/u);
const orderLineFields = [
  '["Заказ", row.order]',
  '["Программа", row.program]',
  '["Категория", inferredProgramType || "—"]'
];
orderLineFields.forEach((field) => {
  assert.equal(
    renderSource.split(field).length - 1,
    1,
    field + " must occur exactly once"
  );
});
assert.ok(renderSource.indexOf(orderLineFields[0]) < renderSource.indexOf(orderLineFields[1]));
assert.ok(renderSource.indexOf(orderLineFields[1]) < renderSource.indexOf(orderLineFields[2]));
assert.ok(renderSource.indexOf(orderLineFields[2]) < renderSource.indexOf('["Оплата",'));
assert.match(
  renderSource,
  /<div class="student-application-detail-order-line">[\s\S]*?renderDetailItems\(orderLineDetails\)/u
);
assert.doesNotMatch(
  renderSource,
  /\["(?:Заказ|Программа|Категория)",[^\]]*,\s*true\]/u
);
[
  '["Организация", row.organization, true]',
  '["Примечание", row.note, true]'
].forEach((expected) => assert.ok(renderSource.includes(expected), `${expected} must use the full-width layout`));
assert.match(renderSource, /const renderDetailItems = \(items\) => items\.map\(\(\[label, value, wide\]\)/u);
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
const orderLineRule = stylesSource.match(
  /\.student-application-detail-grid\s*>\s*\.student-application-detail-order-line\s*\{([^}]*)\}/u
)?.[1] || "";
assert.match(orderLineRule, /grid-column:\s*1\s*\/\s*-1/u);
assert.match(orderLineRule, /display:\s*grid/u);
const orderLineTracks = orderLineRule.match(/grid-template-columns:\s*([^;]+);/u)?.[1] || "";
assert.equal((orderLineTracks.match(/minmax\(/gu) || []).length, 3);

const detailPanelRule = stylesSource.match(/\.student-applications-import-detail\s*\{([\s\S]*?)\n\}/u)?.[1] || "";
assert.match(detailPanelRule, /max-height:\s*min\(300px,\s*28vh\)/u);
assert.match(detailPanelRule, /overflow-y:\s*auto/u);
assert.match(detailPanelRule, /overscroll-behavior:\s*contain/u);
assert.match(detailPanelRule, /scrollbar-gutter:\s*stable/u);
const detailHeadingRule = stylesSource.match(/\.student-applications-import-detail h3\s*\{([\s\S]*?)\n\}/u)?.[1] || "";
assert.match(detailHeadingRule, /position:\s*sticky/u);
assert.match(detailHeadingRule, /top:\s*0/u);
assert.match(detailHeadingRule, /z-index:\s*[1-9]\d*/u);
assert.match(detailHeadingRule, /background:\s*#fbfcfa/u);
const mobileImportMarker = stylesSource.indexOf(
  "\n  .student-applications-import-backdrop {",
  stylesSource.indexOf(".student-applications-import-detail")
);
assert.ok(mobileImportMarker >= 0, "mobile application import layout must exist");
const responsiveStart = stylesSource.lastIndexOf("@media (max-width: 720px)", mobileImportMarker);
const responsiveEnd = stylesSource.indexOf("\n@media ", mobileImportMarker);
assert.ok(responsiveStart >= 0, "responsive application layout must exist");
const responsiveStyles = stylesSource.slice(responsiveStart, responsiveEnd < 0 ? undefined : responsiveEnd);
const responsiveDetailRule = responsiveStyles.match(/\.student-applications-import-detail\s*\{([^}]*)\}/u)?.[1] || "";
assert.match(responsiveDetailRule, /max-height:\s*none/u);
assert.match(responsiveDetailRule, /overflow:\s*visible/u);
const responsiveHeadingRule = responsiveStyles.match(/\.student-applications-import-detail h3\s*\{([^}]*)\}/u)?.[1] || "";
assert.match(responsiveHeadingRule, /position:\s*static/u);
const responsiveOrderLineRule = responsiveStyles.match(
  /\.student-application-detail-grid\s*>\s*\.student-application-detail-order-line\s*\{([^}]*)\}/u
)?.[1] || "";
const responsiveOrderLineTracks = responsiveOrderLineRule
  .match(/grid-template-columns:\s*([^;]+);/u)?.[1] || "";
assert.equal((responsiveOrderLineTracks.match(/minmax\(/gu) || []).length, 3);
assert.doesNotMatch(responsiveOrderLineTracks, /^\s*1fr\s*$/u);
assert.match(appSource, /data-student-applications-detail role="region" tabindex="0" aria-labelledby="student-applications-detail-title"/u);
assert.equal((appSource.match(/id="student-applications-detail-title"/gu) || []).length, 2);
assert.match(appSource, /detail\.innerHTML\s*=\s*`[\s\S]*?detail\.scrollTop\s*=\s*0;/u);
assert.match(stylesSource, /\.student-applications-import-detail:focus-visible\s*\{[\s\S]*?outline:/u);

console.log("student application detail layout tests: OK");
