"use strict";
// Isolated table/card fixture; no database access or changes to the system clipboard.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, name);
  return match[0];
}
assert.match(source, /bindStudentContactCopyActions\(scope\)/);
assert.match(source, /bindStudentContactCopyActions\(\)/);

async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<main></main>');
    await page.addScriptTag({ content: `
      const STUDENT_APPLICATIONS_IMPORT_TABLE_CONFIG_ID = "studentApplicationsImport";
      const records = [
        { id: "one", name: " Иванов Иван ", phone: " +7 900 000-00-01 ", email: "one@example.test", workPlace: "Колледж", position: " Преподаватель ", passport: "NEVER COPY" },
        { id: "unselected", name: "Не выбран", email: "excluded@example.test" },
        { id: 3, name: "Петров Пётр", phone: "", email: "three@example.test", organization: "Университет", position: "" },
        { id: "empty" }
      ];
      const state = { tableOptions: "", selected: { students: ["one", "3", "empty", "stale", "one"] },
        data: { collections: { students: records } },
        studentApplicationsImport: { rows: records.map(row => ({ ...row, organization: row.workPlace || row.organization, workPlace: undefined })), selected: ["one", "3", "empty", "stale"] } };
      const configs = { students: {}, contracts: {}, generalExpenses: {} };
      const getSelected = id => state.selected[id] || [];
      const copied = [], alerts = [];
      const alert = text => alerts.push(text);
      let failCopy = false;
      const copyTextToClipboard = async text => { if (failCopy) throw Error("denied"); copied.push(text); };
      const collectStudentFormDraft = () => records[0];
      const collectContractFormDraft = () => records[2];
      const showMenu = config => {
        state.tableOptions = config;
        document.querySelector('main').innerHTML = renderTableOptions(config);
        bindStudentContactCopyActions();
        bindStudentContactCopyActions(document.querySelector('main'));
      };
    ` + ["formatContactDetailsText", "getSelectedStudentContactRows", "copySelectedStudentContacts",
      "bindStudentContactCopyActions", "copyStudentDetails", "renderTableOptions"].map(extract).join("\n") });
    const first = "Иванов Иван\r\n+7 900 000-00-01\r\none@example.test\r\nКолледж\r\nПреподаватель";
    const third = "Петров Пётр\r\nthree@example.test\r\nУниверситет";
    const expected = first + "\r\n\r\n" + third;
    for (const config of ["students", "studentApplicationsImport"]) {
      await page.evaluate(id => showMenu(id), config);
      const button = page.locator('[data-action="copy-selected-student-contacts"]');
      assert.equal(await button.isEnabled(), true);
      await button.click();
      assert.equal(await page.evaluate(() => copied.at(-1)), expected);
      assert.equal(await button.textContent(), "Скопировано контактов: 2");
    }
    assert.equal(await page.evaluate(() => copied.length), 2, "Two bind passes must not copy twice");
    await page.evaluate(async () => {
      document.querySelector('main').innerHTML = '<form id="recordForm" data-config="students"></form><button id="copy"></button>';
      await copyStudentDetails({ currentTarget: document.querySelector('#copy') });
    });
    assert.equal(await page.evaluate(() => copied.at(-1)), first, "Card and bulk copy use exactly the same formatting");
    await page.evaluate(async () => {
      document.querySelector('#recordForm').dataset.config = "contracts";
      await copyStudentDetails({ currentTarget: document.querySelector('#copy') });
    });
    assert.equal(await page.evaluate(() => copied.at(-1)), third, "Employee card remains compatible with organization fallback");
    await page.evaluate(() => { state.selected.students = []; showMenu("students"); });
    assert.equal(await page.locator('[data-action="copy-selected-student-contacts"]').isDisabled(), true);
    await page.evaluate(() => { state.studentApplicationsImport.selected = []; showMenu("studentApplicationsImport"); });
    assert.equal(await page.locator('[data-action="copy-selected-student-contacts"]').isDisabled(), true);
    await page.evaluate(() => { state.selected.students = ["empty", "stale"]; showMenu("students"); });
    await page.locator('[data-action="copy-selected-student-contacts"]').click();
    assert.equal(await page.evaluate(() => copied.length), 4, "Empty/deleted records must not overwrite the clipboard");
    await page.evaluate(() => { state.selected.students = ["one"]; failCopy = true; showMenu("students"); });
    await page.locator('[data-action="copy-selected-student-contacts"]').click();
    assert.match(await page.evaluate(() => alerts.at(-1)), /Не удалось/);
    assert.equal(await page.locator('[data-action="copy-selected-student-contacts"]').isEnabled(), true);
    for (const config of ["contracts", "generalExpenses"]) {
      await page.evaluate(id => showMenu(id), config);
      assert.equal(await page.locator('[data-action="copy-selected-student-contacts"]').count(), 0);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  console.log("Student contact bulk copy: OK (both menus, cross-page selection, card parity, blanks, stale IDs, isolated selections, one listener, clipboard failure).");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
