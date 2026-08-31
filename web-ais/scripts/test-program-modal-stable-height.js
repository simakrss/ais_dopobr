const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Не найдено начало блока: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `Не найден конец блока после: ${startMarker}`);
  return source.slice(start, end);
}

const programModalCss = sourceBlock(stylesSource, ".program-modal {", "\n}");
assert.match(
  programModalCss,
  /height:\s*min\(820px,\s*calc\(100vh\s*-\s*48px\)\);/u,
  "У формы программы должна быть фиксированная высота с fallback на обычный viewport."
);
assert.match(
  programModalCss,
  /height:\s*min\(820px,\s*calc\(100dvh\s*-\s*48px\)\);/u,
  "У формы программы должна быть фиксированная высота с учётом динамического viewport."
);
assert.match(
  programModalCss,
  /max-height:\s*min\(820px,\s*calc\(100dvh\s*-\s*48px\)\);/u,
  "Высота формы программы должна оставаться в пределах экрана."
);

const baseModalCss = sourceBlock(stylesSource, ".modal {", "\n}");
assert.match(
  baseModalCss,
  /overflow:\s*auto;/u,
  "Длинное содержимое формы должно оставаться доступным через прокрутку."
);

const renderProgramModalSource = sourceBlock(
  appSource,
  "function renderProgramModal",
  "function getProgramFieldsByTab"
);
assert.equal(
  [...renderProgramModalSource.matchAll(/data-program-tab-panel=/gu)].length,
  6,
  "Все шесть вкладок программы должны оставаться внутри одного модального окна."
);

const switchProgramTabSource = sourceBlock(
  appSource,
  "function switchProgramTab",
  "function switchContractTab"
);
assert.match(switchProgramTabSource, /panel\.hidden\s*=\s*!isActive/u);
assert.doesNotMatch(
  switchProgramTabSource,
  /render\s*\(/u,
  "Переключение вкладок не должно пересоздавать форму программы."
);

console.log("Program modal stable height tests passed.");
