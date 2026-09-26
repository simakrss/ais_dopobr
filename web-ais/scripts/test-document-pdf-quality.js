const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const {
  buildLibreOfficePdfConversionFilter,
  resolveLibreOfficeBinary,
  convertDocxBytesToPdf,
  createDocumentQrCodeImage,
  fillDocxMarkers,
  readDocxZipEntries
} = require(path.join(root, "app-server.js"));
const {
  PDFDocument,
  PDFName,
  PDFRawStream
} = require(path.join(root, "vendor", "pdf-lib.min.js"));

function readPdfNumber(dictionary, name) {
  const value = dictionary.get(PDFName.of(name));
  return typeof value?.asNumber === "function" ? value.asNumber() : 0;
}

function getPdfImageObjects(pdfDocument) {
  const imageObjects = [];
  for (const [, object] of pdfDocument.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (String(object.dict.get(PDFName.of("Subtype"))) !== "/Image") continue;
    imageObjects.push({
      width: readPdfNumber(object.dict, "Width"),
      height: readPdfNumber(object.dict, "Height"),
      filter: String(object.dict.get(PDFName.of("Filter")) || "")
    });
  }
  return imageObjects;
}

async function main() {
  const filterPrefix = "pdf:writer_pdf_Export:";
  const filter = buildLibreOfficePdfConversionFilter();
  assert.ok(filter.startsWith(filterPrefix), "Должен использоваться PDF-фильтр Writer");
  const filterOptions = JSON.parse(filter.slice(filterPrefix.length));
  assert.deepEqual(filterOptions.UseLosslessCompression, { type: "boolean", value: "true" });
  assert.deepEqual(filterOptions.Quality, { type: "long", value: "100" });
  assert.deepEqual(filterOptions.ReduceImageResolution, { type: "boolean", value: "false" });
  assert.deepEqual(filterOptions.EmbedStandardFonts, { type: "boolean", value: "true" });

  await assert.rejects(
    convertDocxBytesToPdf(Buffer.from("test"), {
      libreOfficeConverter: async () => {
        throw new Error("test high-quality converter failure");
      }
    }),
    /Генерация через ONLYOFFICE не выполнена/u
  );

  const binaryPath = await resolveLibreOfficeBinary();
  assert.ok(binaryPath, "Для высококачественной генерации должен быть установлен LibreOffice");
  if (process.platform === "win32") {
    const preferredConsoleBinary = path.join(path.dirname(binaryPath), "soffice.com");
    if (fs.existsSync(preferredConsoleBinary)) {
      assert.equal(
        path.resolve(binaryPath).toLowerCase(),
        path.resolve(preferredConsoleBinary).toLowerCase(),
        "На Windows должен выбираться soffice.com, корректно возвращающий код завершения"
      );
    }
  }

  const templatePath = path.join(
    root,
    "storage",
    "document-templates",
    "Удостоверение о повышении квалификации_v1.docx"
  );
  const syntheticFieldValues = {
    "Дата выдачи": "01.02.2026",
    "Дата начала": "01.01.2026",
    "Дата окончания": "31.01.2026",
    "Номер бланка": "0000000001",
    "Прогр обуч факт": "Контрольная программа",
    "РегНомер": "TEST-001",
    "ФИО": "Тестов Тест Тестович"
  };
  const testImage = createDocumentQrCodeImage("Контроль качества PDF без рабочих данных");
  const syntheticImageValues = { "Фото": testImage, "QRкод": testImage };
  const generatedDocxBytes = fillDocxMarkers(
    fs.readFileSync(templatePath),
    syntheticFieldValues,
    syntheticImageValues
  );
  const pdfBytes = await convertDocxBytesToPdf(generatedDocxBytes);
  assert.equal(pdfBytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdfBytes.length > 500 * 1024, "Фон удостоверения не должен исчезнуть из PDF");
  const qualityOutputPath = String(process.env.AIS_PDF_QUALITY_OUTPUT || "").trim();
  if (qualityOutputPath) {
    fs.mkdirSync(path.dirname(path.resolve(qualityOutputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(qualityOutputPath), pdfBytes);
  }

  const pdfDocument = await PDFDocument.load(pdfBytes);
  assert.equal(pdfDocument.getPageCount(), 3, "Конвертация не должна менять число страниц удостоверения");
  const imageObjects = getPdfImageObjects(pdfDocument);
  assert.deepEqual(
    imageObjects,
    [],
    "EMF-фон удостоверения должен оставаться векторным и не должен разбиваться на растровые тайлы"
  );

  const convertedTemplates = [{
    fileName: path.basename(templatePath),
    pageCount: pdfDocument.getPageCount(),
    byteLength: pdfBytes.length
  }];
  if (process.env.AIS_TEST_ALL_DOCUMENT_TEMPLATES === "1") {
    const templateDirectory = path.dirname(templatePath);
    const otherTemplateNames = fs.readdirSync(templateDirectory)
      .filter((fileName) => fileName.toLowerCase().endsWith(".docx"))
      .filter((fileName) => fileName !== path.basename(templatePath))
      .sort((left, right) => left.localeCompare(right, "ru"));
    for (const fileName of otherTemplateNames) {
      const templateBytes = fs.readFileSync(path.join(templateDirectory, fileName));
      const filledTemplateBytes = fillDocxMarkers(
        templateBytes,
        syntheticFieldValues,
        syntheticImageValues
      );
      const convertedBytes = await convertDocxBytesToPdf(filledTemplateBytes);
      assert.equal(
        convertedBytes.subarray(0, 5).toString("ascii"),
        "%PDF-",
        `${fileName}: конвертер должен вернуть PDF`
      );
      const convertedDocument = await PDFDocument.load(convertedBytes);
      assert.ok(convertedDocument.getPageCount() > 0, `${fileName}: PDF не должен быть пустым`);
      const sourceMediaExtensions = new Set(
        readDocxZipEntries(templateBytes)
          .filter((entry) => entry.name.startsWith("word/media/"))
          .map((entry) => path.extname(entry.name).toLowerCase())
      );
      const hasVectorMedia = [".emf", ".wmf", ".svg"]
        .some((extension) => sourceMediaExtensions.has(extension));
      const hasRasterMedia = [".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".wdp", ".webp"]
        .some((extension) => sourceMediaExtensions.has(extension));
      if (hasVectorMedia && !hasRasterMedia) {
        assert.deepEqual(
          getPdfImageObjects(convertedDocument),
          [],
          `${fileName}: чисто векторный шаблон не должен растрироваться`
        );
      }
      convertedTemplates.push({
        fileName,
        pageCount: convertedDocument.getPageCount(),
        byteLength: convertedBytes.length
      });
    }
  }

  process.stdout.write(
    `PDF quality test passed: ${pdfDocument.getPageCount()} pages, ${pdfBytes.length} bytes, `
      + `${imageObjects.length} image XObjects, converter ${binaryPath}, `
      + `${convertedTemplates.length} template(s) converted\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
