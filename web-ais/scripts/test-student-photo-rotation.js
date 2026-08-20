const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function extractFunction(name) {
  const start = appSource.indexOf(`  function ${name}(`);
  assert(start >= 0, `Function ${name} was not found`);
  const bodyStart = appSource.indexOf(") {", start) + 2;
  assert(bodyStart > start, `Function ${name} body was not found`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1);
    }
  }
  throw new Error(`Function ${name} is incomplete`);
}

function closeTo(actual, expected, message = "") {
  assert(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
}

function closeRect(actual, expected, message) {
  ["x", "y", "width", "height"].forEach((key) => closeTo(actual[key], expected[key], `${message}.${key}`));
}

const canvases = [];
class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.calls = [];
    canvases.push(this);
  }

  getContext() {
    return {
      set fillStyle(value) { this._fillStyle = value; },
      fillRect: (...args) => this.calls.push(["fillRect", ...args]),
      drawImage: (...args) => this.calls.push(["drawImage", ...args]),
      translate: (...args) => this.calls.push(["translate", ...args]),
      rotate: (...args) => this.calls.push(["rotate", ...args])
    };
  }
}

const context = {
  clamp: (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum),
  document: { createElement: (tagName) => {
    assert.strictEqual(tagName, "canvas");
    return new FakeCanvas();
  } }
};
vm.runInNewContext(`
  ${extractFunction("normalizeStudentPhotoRotation")}
  ${extractFunction("getStudentPhotoRotatedSize")}
  ${extractFunction("rotateStudentPhotoNormalizedRect")}
  ${extractFunction("getStudentPhotoRotationOffset")}
  ${extractFunction("rotateStudentPhotoCanvas")}
  ${extractFunction("createStudentPhotoCropCanvas")}
  this.api = {
    normalizeStudentPhotoRotation,
    getStudentPhotoRotatedSize,
    rotateStudentPhotoNormalizedRect,
    getStudentPhotoRotationOffset,
    createStudentPhotoCropCanvas
  };
`, context);

const {
  normalizeStudentPhotoRotation: normalizeRotation,
  getStudentPhotoRotatedSize: rotatedSize,
  rotateStudentPhotoNormalizedRect: rotateRect,
  getStudentPhotoRotationOffset: rotationOffset,
  createStudentPhotoCropCanvas: createCropCanvas
} = context.api;

assert.strictEqual(normalizeRotation(-90), 270);
assert.strictEqual(normalizeRotation(450), 90);
assert.strictEqual(normalizeRotation(44), 0);
assert.deepStrictEqual({ ...rotatedSize(1200, 800, 90) }, { width: 800, height: 1200 });
assert.deepStrictEqual({ ...rotatedSize(1200, 800, 180) }, { width: 1200, height: 800 });
assert.deepStrictEqual({ ...rotationOffset(1200, 800, 270) }, { x: 0, y: 1200 });

const sourceRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
closeRect(rotateRect(sourceRect, 90), { x: 0.4, y: 0.1, width: 0.4, height: 0.3 }, "clockwise");
closeRect(rotateRect(sourceRect, 180), { x: 0.6, y: 0.4, width: 0.3, height: 0.4 }, "half-turn");
closeRect(rotateRect(sourceRect, 270), { x: 0.2, y: 0.6, width: 0.4, height: 0.3 }, "counterclockwise");
[0, 90, 180, 270].forEach((angle) => {
  closeRect(rotateRect(rotateRect(sourceRect, angle), -angle), sourceRect, `inverse-${angle}`);
});
let fourTurns = sourceRect;
for (let index = 0; index < 4; index += 1) fourTurns = rotateRect(fourTurns, 90);
closeRect(fourTurns, sourceRect, "four-turns");

[
  { angle: 0, expected: [200, 100], canvasCount: 1, translate: null },
  { angle: 90, expected: [100, 200], canvasCount: 2, translate: [100, 0] },
  { angle: 180, expected: [200, 100], canvasCount: 2, translate: [200, 100] },
  { angle: 270, expected: [100, 200], canvasCount: 2, translate: [0, 200] }
].forEach(({ angle, expected, canvasCount, translate }) => {
  canvases.length = 0;
  const cropped = createCropCanvas({ naturalWidth: 400, naturalHeight: 200 }, {
    x: 0.25,
    y: 0.25,
    width: 0.5,
    height: 0.5
  }, angle, 1000);
  assert.strictEqual(canvases.length, canvasCount, `canvas count at ${angle}°`);
  assert.deepStrictEqual([cropped.width, cropped.height], expected, `canvas dimensions at ${angle}°`);
  if (translate) {
    assert.deepStrictEqual(cropped.calls.find((call) => call[0] === "translate"), ["translate", ...translate]);
    closeTo(cropped.calls.find((call) => call[0] === "rotate")[1], angle * Math.PI / 180, `canvas rotation ${angle}°`);
  }
});

const photoEditorSource = extractFunction("openStudentPhotoCropEditor");
assert.match(photoEditorSource, /data-photo-crop-rotate-left/u);
assert.match(photoEditorSource, /data-photo-crop-rotate-right/u);
assert.match(photoEditorSource, /data-photo-crop-rotation aria-live="polite">0°/u);
assert.match(photoEditorSource, /rotateStudentPhotoNormalizedRect\(\{[\s\S]*?\}, -previousRotation\)/u);
assert.match(photoEditorSource, /rotateStudentPhotoNormalizedRect\(\{[\s\S]*?\}, -rotation\)/u);
assert.match(photoEditorSource, /backdrop\.querySelector\("\[data-photo-crop-rotate-left\]"\)\?\.addEventListener\("click", \(\) => rotatePhoto\(-90\)\)/u);
assert.match(photoEditorSource, /backdrop\.querySelector\("\[data-photo-crop-rotate-right\]"\)\?\.addEventListener\("click", \(\) => rotatePhoto\(90\)\)/u);
assert.match(photoEditorSource, /rotateStudentPhotoNormalizedRect\(sourceSelection, rotation\)/u);
assert.match(photoEditorSource, /createStudentPhotoCropCanvas\(image, normalizedSourceSelection, rotation, 1600\)/u);
assert.match(photoEditorSource, /исходный файл не изменяется/u);

const ocrCropperSource = extractFunction("openStudentDocumentPhotoCropper");
assert.match(ocrCropperSource, /data-ocr-crop-rotate-left/u);
assert.match(ocrCropperSource, /data-ocr-crop-rotate-right/u);
assert.match(ocrCropperSource, /data-ocr-crop-rotation aria-live="polite">0°/u);
assert.match(ocrCropperSource, /const rotations = new Map\(\)/u);
assert.match(ocrCropperSource, /rotations\.get\(currentPageKey\(\)\)/u);
assert.match(ocrCropperSource, /rotations\.set\(key, rotation\)/u);
assert.match(ocrCropperSource, /rotateStudentPhotoNormalizedRect\(selections\.get\(key\), -rotation\)/u);
assert.match(ocrCropperSource, /selections\.set\(key, rotateStudentPhotoNormalizedRect\(sourceSelection, rotation\)\)/u);
assert.match(ocrCropperSource, /const normalizedSourceSelection = rotateStudentPhotoNormalizedRect\(selection, -rotation\)/u);
assert.match(ocrCropperSource, /rotateLeftButton\.addEventListener\("click", \(\) => rotateDocumentPage\(-90\)\)/u);
assert.match(ocrCropperSource, /rotateRightButton\.addEventListener\("click", \(\) => rotateDocumentPage\(90\)\)/u);
assert.match(ocrCropperSource, /selection: \{ \.\.\.normalizedSourceSelection \}/u);
assert.match(ocrCropperSource, /createStudentPhotoCropCanvas\([\s\S]*?normalizedSourceSelection,[\s\S]*?rotation,/u);
assert.match(ocrCropperSource, /image\.style\.transform = `translate/u);

assert.match(stylesSource, /\.student-document-photo-cropper-stage img\s*\{[^}]*position:\s*absolute;[^}]*max-height:\s*none;/u);
assert.match(stylesSource, /\.student-document-photo-cropper-rotation\s*\{/u);

console.log("student photo rotation tests: OK");
