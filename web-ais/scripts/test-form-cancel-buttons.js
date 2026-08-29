"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function getButtonBlocks(source) {
  return source.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) || [];
}

function getCancelIconBlocks(source) {
  return getButtonBlocks(source).filter((button) => /\bform-cancel-button\b/u.test(button));
}

function assertCancelIcon(button, expectedLabel = "Отмена") {
  const body = /^<button\b[^>]*>([\s\S]*?)<\/button>$/u.exec(button)?.[1]?.trim();
  const title = /\btitle="([^"]+)"/u.exec(button)?.[1] || "";
  const ariaLabel = /\baria-label="([^"]+)"/u.exec(button)?.[1] || "";
  assert.equal(body, "×", "Кнопка отмены должна содержать только крестик");
  assert.match(button, /\bclass="[^"]*\bicon-button\b[^"]*\bform-cancel-button\b[^"]*"/u);
  assert.match(button, /\btype="button"/u);
  assert.equal(title, expectedLabel);
  assert.equal(ariaLabel, title, "title и aria-label кнопки отмены должны совпадать");
}

function assertLastButtonInRow(source, button) {
  const lines = source.split(/\r?\n/u);
  const lineIndex = lines.findIndex((line) => line.includes(button));
  assert.notEqual(lineIndex, -1, `Не найдена строка кнопки: ${button}`);
  const indent = lines[lineIndex].search(/\S/u);
  let boundaryFound = false;
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const nextIndent = line.search(/\S/u);
    if (nextIndent < indent) {
      boundaryFound = true;
      break;
    }
    assert.doesNotMatch(
      line,
      /<button\b/u,
      `После крестика не должно быть другой кнопки в том же ряду: ${button}`
    );
  }
  assert.equal(boundaryFound, true, `Не найдена граница ряда для кнопки: ${button}`);
}

const visibleCancelButtons = [...getButtonBlocks(appSource), ...getButtonBlocks(authSource)]
  .filter((button) => /(^|[>\s])Отмена([<\s]|$)/u.test(button));
assert.deepEqual(visibleCancelButtons, [], "В формах не должно оставаться текстовых кнопок «Отмена»");

const expectedActions = [
  "close-document-template-link-dialog",
  "close-document-template-settings",
  ...Array(5).fill("close-modal"),
  "close-employee-expense-editor",
  "close-event-editor",
  "close-student-event-insert",
  "close-discount-picker",
  "close-student-expense-editor",
  "close-custom-record-email",
  "close-contract-student-picker",
  "close-payment-constant-dialog",
  "close-student-photo-editor",
  "close-person-photo-device-fallback",
  "close-student-mailbox",
  "close-student-photo-cropper",
  "cancel-student-document-recognition-selection",
  "close-student-bulk-operations",
  "close-document-email-template-value",
  "close-communication-template-field-dialog",
  "cancel-sync-conflicts",
  "cancel-generated-document-editor-or-preview",
  "cancel-generated-document-email-preview",
  "close-student-document-choice"
].sort();

const appCancelIcons = getCancelIconBlocks(appSource);
assert.equal(appCancelIcons.length, 27, "В app.js должны быть преобразованы все 27 кнопок «Отмена»");
assert.deepEqual(
  appCancelIcons.map((button) => /\bdata-action="([^"]+)"/u.exec(button)?.[1] || "").sort(),
  expectedActions,
  "У преобразованных кнопок должны сохраниться исходные data-action"
);

for (const button of appCancelIcons) {
  const action = /\bdata-action="([^"]+)"/u.exec(button)?.[1] || "";
  const label = action === "cancel-sync-conflicts"
    ? "Отменить синхронизацию"
    : action === "cancel-generated-document-editor-or-preview"
      ? "Отменить формирование документа"
      : "Отмена";
  assertCancelIcon(button, label);
  assertLastButtonInRow(appSource, button);
}

const authCancelIcons = getCancelIconBlocks(authSource);
assert.equal(authCancelIcons.length, 1, "В форме регистрации должна быть преобразована кнопка «Отмена»");
assert.match(authCancelIcons[0], /\bdata-auth-return-login\b/u);
assertCancelIcon(authCancelIcons[0]);
assertLastButtonInRow(authSource, authCancelIcons[0]);

const previewMode = appSource.slice(
  appSource.indexOf("const setPreviewMode ="),
  appSource.indexOf("const setEditorMode =")
);
const editorMode = appSource.slice(
  appSource.indexOf("const setEditorMode ="),
  appSource.indexOf("const handleEditorMessage =")
);
assert.match(previewMode, /cancelButton\.textContent = "×"/u);
assert.match(previewMode, /cancelButton\.classList\.add\("icon-button", "form-cancel-button"\)/u);
assert.match(previewMode, /cancelButton\.setAttribute\("aria-label", "Отменить формирование документа"\)/u);
assert.match(editorMode, /cancelButton\.textContent = "Отменить изменения"/u);
assert.match(editorMode, /cancelButton\.classList\.remove\("icon-button", "form-cancel-button"\)/u);
assert.match(editorMode, /cancelButton\.setAttribute\("aria-label", "Отменить изменения и вернуться к предварительному просмотру"\)/u);

assert.match(stylesSource, /button\.icon-button\.form-cancel-button\s*\{[^}]*flex:\s*0 0 32px;[^}]*width:\s*32px;[^}]*min-width:\s*32px;[^}]*justify-self:\s*end;/su);
assert.match(stylesSource, /\.generated-document-email-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) repeat\(3, auto\);/su);
assert.match(stylesSource, /\.generated-document-email-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/su);
assert.match(stylesSource, /\.partner-registration-actions\s*\{[^}]*flex-direction:\s*column;/su);

const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authSource)?.[1] || "";
const indexBuild = /const build = "([^"]+)"/u.exec(indexSource)?.[1] || "";
const cssBuild = /styles\.css\?v=([^"]+)/u.exec(indexSource)?.[1] || "";
assert.ok(authBuild, "Не найден идентификатор клиентской сборки");
assert.equal(indexBuild, authBuild);
assert.equal(cssBuild, authBuild);

console.log("Form cancel button checks passed.");
