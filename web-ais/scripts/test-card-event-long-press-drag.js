const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.resolve(__dirname, "..", "styles.css"), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Не найден блок: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Не найден конец блока: ${endMarker}`);
  return source.slice(start, end);
}

const eventRowBlock = sourceBlock(
  appSource,
  "function renderStudentEventRow(",
  "function getOrderedStudentEvents("
);
assert.match(eventRowBlock, /data-orderable-event/u);
assert.match(eventRowBlock, /draggable="false"/u);
assert.match(eventRowBlock, /aria-grabbed="false"/u);

const longPressBlock = sourceBlock(
  appSource,
  "function getLongPressDragContext(",
  "function applyCardWindowPosition("
);
assert.match(longPressBlock, /\[data-orderable-event\]/u);
assert.match(longPressBlock, /type: "events"/u);
assert.match(longPressBlock, /getEventDragAfterElement\(container, clientY\)/u);
assert.match(longPressBlock, /syncStudentEventOrder\(\)/u);
assert.match(longPressBlock, /syncCardEventDraftFromDom\(\)/u);
assert.match(longPressBlock, /window\.setTimeout\(markReady, LONG_PRESS_DRAG_DELAY_MS\)/u);
assert.match(longPressBlock, /event-reorder-dragging/u);

assert.match(appSource, /const LONG_PRESS_DRAG_DELAY_MS = 1000;/u);
assert.doesNotMatch(appSource, /function bindStudentEventReorderKeys\(/u);
assert.match(stylesSource, /\[data-orderable-event\]\.is-long-press-pending/u);
assert.match(stylesSource, /\[data-orderable-event\]\.is-long-press-ready/u);
assert.match(stylesSource, /body\.event-reorder-dragging \.student-event-row\.is-dragging/u);

console.log("Student and employee event long-press drag checks: OK");
