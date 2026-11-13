const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const templateRoot = path.join(root, "storage", "document-templates");
const server = require(path.join(root, "app-server.js"));

const requiredTemplates = [
  "Диплом о переподготовке_v1.docx",
  "Удостоверение о повышении квалификации_v1.docx",
  "Сертификат ДОП.docx",
  "Сертификат ПРО.docx"
];

const syntheticFieldValues = {
  "Дата выдачи": "01.02.2026",
  "Дата начала": "01.01.2026",
  "Дата окончания": "31.01.2026",
  "Номер бланка": "0000000001",
  "Прогр обуч факт": "Контрольная программа",
  "РегНомер": "TEST-001",
  "ФИО": "Тестов Тест Тестович",
  "Фото": "",
  "QRкод": ""
};

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function getMediaEntries(docxBytes) {
  return server.readDocxZipEntries(docxBytes)
    .filter((entry) => entry.name.startsWith("word/media/"));
}

function getMediaByName(docxBytes) {
  const entries = getMediaEntries(docxBytes);
  const byName = new Map(entries.map((entry) => [entry.name, entry.content]));
  assert.equal(byName.size, entries.length, "DOCX must not contain duplicate media entry names");
  return byName;
}

assert.ok(fs.existsSync(templateRoot), "Document template directory must exist");
requiredTemplates.forEach((fileName) => {
  assert.ok(
    fs.existsSync(path.join(templateRoot, fileName)),
    `Required quality-control template is missing: ${fileName}`
  );
});

const templateNames = fs.readdirSync(templateRoot)
  .filter((fileName) => fileName.toLowerCase().endsWith(".docx"))
  .sort((left, right) => left.localeCompare(right, "ru"));
assert.ok(templateNames.length >= requiredTemplates.length, "No DOCX templates found for media checks");

const syntheticImage = server.createDocumentQrCodeImage(
  "Контроль сохранности media без рабочих данных"
);
const syntheticImageValues = {
  "Фото": syntheticImage,
  "QRкод": syntheticImage
};

let checkedMediaCount = 0;
let insertedImageCount = 0;
const checkedExtensions = new Set();
const syntheticImageHash = sha256(syntheticImage.bytes);

templateNames.forEach((fileName) => {
  const templatePath = path.join(templateRoot, fileName);
  const sourceBytes = fs.readFileSync(templatePath);
  const sourceMedia = getMediaByName(sourceBytes);
  const generatedBytes = server.fillDocxMarkers(
    sourceBytes,
    syntheticFieldValues,
    syntheticImageValues
  );
  const generatedMedia = getMediaByName(generatedBytes);

  sourceMedia.forEach((sourceContent, mediaName) => {
    const generatedContent = generatedMedia.get(mediaName);
    assert.ok(generatedContent, `${fileName}: source media disappeared: ${mediaName}`);
    assert.equal(
      generatedContent.length,
      sourceContent.length,
      `${fileName}: source media size changed: ${mediaName}`
    );
    assert.equal(
      sha256(generatedContent),
      sha256(sourceContent),
      `${fileName}: source media bytes changed: ${mediaName}`
    );
    checkedMediaCount += 1;
    checkedExtensions.add(path.extname(mediaName).toLowerCase());
  });

  assert.ok(
    generatedMedia.size >= sourceMedia.size,
    `${fileName}: generated DOCX must retain every source media entry`
  );
  generatedMedia.forEach((content) => {
    if (sha256(content) === syntheticImageHash) insertedImageCount += 1;
  });
});

assert.ok(checkedMediaCount > 0, "The media preservation check must inspect at least one source asset");
assert.ok(checkedExtensions.has(".emf"), "The media preservation check must cover vector EMF artwork");
assert.ok(checkedExtensions.has(".png"), "The media preservation check must cover PNG artwork");
assert.ok(
  insertedImageCount > 0,
  "At least one synthetic Photo/QR image must be inserted byte-for-byte without recompression"
);

console.log(
  `Document source media preservation checks passed: ${templateNames.length} templates, `
    + `${checkedMediaCount} source assets, ${insertedImageCount} lossless inserted images.`
);
