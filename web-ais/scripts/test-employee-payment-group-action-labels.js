"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");

assert.match(
  source,
  /data-action="delete-selected-employee-payments"[^>]*title="Удалить выбранные выплаты"[^>]*>Удалить<\/button>/u,
  "Кнопка удаления выплат должна иметь компактную подпись «Удалить»."
);
assert.match(
  source,
  /data-action="clear-employee-payment-selection"[^>]*title="Снять выбор со всех выплат"[^>]*>Снять<\/button>/u,
  "Кнопка снятия выбора должна иметь компактную подпись «Снять»."
);

console.log("Employee payment compact group action labels tests passed.");
