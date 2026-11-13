"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert.match(appSource, /data-message-part="text"/u);
assert.match(appSource, /data-message-part="attachment"/u);
assert.match(appSource, /data-attachment-index=/u);
assert.match(appSource, /const selections = Array\.from\(list\.querySelectorAll\("\[data-student-mailbox-message\]"\)\)/u);
assert.match(appSource, /body: JSON\.stringify\(\{[\s\S]*?uids,[\s\S]*?selections,[\s\S]*?folder,/u);
assert.match(appSource, /Писем: \$\{selectedMessages\} · вложений: \$\{selectedAttachments\} · текстов: \$\{selectedTexts\}/u);
assert.match(serverSource, /function parseStudentMailboxImportSelections\(body = \{\}\)/u);
assert.match(serverSource, /selection\.attachmentIndexes === null[\s\S]*?message\.attachments\.map/u);
assert.match(serverSource, /if \(selection\.includeText\)/u);
assert.match(stylesSource, /\.student-mailbox-import-item:has\(input:checked\)/u);

console.log("Student mailbox item selection: OK");
