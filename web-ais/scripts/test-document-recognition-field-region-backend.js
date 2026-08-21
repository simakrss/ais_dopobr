const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const server = require("../app-server");

function runPythonUnitChecks(pythonBinary, pythonSource) {
  if (!pythonBinary) return false;
  const script = String.raw`
import importlib.util
import pathlib
import base64

path = pathlib.Path(r"${pythonSource.replace(/\\/g, "\\\\")}")
spec = importlib.util.spec_from_file_location("ais_ocr_field_test", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

samples = {
    "name": "Иванов Иван Иванович",
    "birthDate": "05.03.2016",
    "gender": "женский",
    "citizenship": "Российская Федерация",
    "passportType": "паспорт",
    "passportNumber": "12 34 567890",
    "passportDate": "05.03.2016",
    "passportCode": "123-456",
    "passportIssuer": "ГУ МВД России",
    "registrationAddress": "г. Москва, ул. Мира, д. 1",
    "snils": "112-233-445 95",
    "inn": "7707083893",
    "educationLevel": "высшее образование",
    "educationDocument": "Диплом о высшем образовании",
    "educationDocumentSeries": "АБ 12",
    "educationDocumentNumber": "123456",
    "educationDocumentDate": "05.03.2016",
    "educationDocumentIssuer": "МГУ",
    "educationSpecialty": "Информатика",
    "educationQualification": "Бакалавр",
    "educationDocumentSurname": "Иванов",
    "mailingAddress": "г. Москва, ул. Мира, д. 1",
    "phone": "+7 999 123-45-67",
    "email": "test@example.ru",
    "workPlace": "ООО Ромашка",
    "position": "Инженер",
    "program": "Охрана труда",
    "studyForm": "заочная",
    "hours": "256 часов",
    "applicationDate": "05.03.2016",
    "startDate": "05.03.2016",
    "endDate": "06.03.2016",
    "contractNo": "Договор № 12-А",
    "contractDate": "05.03.2016",
}
assert set(samples) == set(module.FIELD_LABELS)
assert set(module.FIELD_LABEL_ALIASES) == set(module.FIELD_LABELS)
for key, source in samples.items():
    value, confidence = module.normalize_recognized_field_value(key, source)
    assert value, (key, source)
    assert 0 < confidence <= 1, (key, confidence)
assert module.normalize_recognized_field_value("hours", "256 часов")[0] == "256"
assert module.normalize_recognized_field_value("passportNumber", "Паспорт 12 34 567890")[0] == "12 34 567890"
assert module.normalize_recognized_field_value("passportCode", "Код подразделения 123-456")[0] == "123-456"
assert module.normalize_recognized_field_value("snils", "СНИЛС 112-233-445 95")[0] == "112-233-445 95"
assert module.normalize_recognized_field_value("inn", "ИНН 7707083893")[0] == "7707083893"
assert module.normalize_recognized_field_value("phone", "Телефон +7 999 123-45-67")[0] == "+79991234567"
assert module.normalize_recognized_field_value("passportNumber", "not a passport")[0] == ""
assert module.normalize_recognized_field_value("birthDate", "31.02.2020")[0] == ""
key, content = module.decode_field_region_payload({
    "key": "inn",
    "mimeType": "image/jpeg",
    "base64": base64.b64encode(b"\xff\xd8\xff\xd9").decode("ascii"),
})
assert key == "inn" and content == b"\xff\xd8\xff\xd9"
try:
    module.decode_field_region_payload({
        "key": "inn",
        "mimeType": "image/png",
        "base64": base64.b64encode(b"not jpeg").decode("ascii"),
    })
except ValueError:
    pass
else:
    raise AssertionError("non-JPEG field region was accepted")
print("python field normalizers: OK")
`;
  const result = spawnSync(pythonBinary, ["-c", script], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error?.code === "ENOENT") return false;
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /python field normalizers: OK/u);
  return true;
}

function main() {
  const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
  const request = server.normalizeOcrFieldRegionRequest({
    key: "passportNumber",
    mimeType: "image/jpeg",
    base64: jpegBytes.toString("base64")
  });
  assert.deepStrictEqual(request, {
    key: "passportNumber",
    mimeType: "image/jpeg",
    base64: jpegBytes.toString("base64")
  });
  assert.throws(
    () => server.normalizeOcrFieldRegionRequest({ ...request, key: "unknown" }),
    /Неизвестное поле/u
  );
  assert.throws(
    () => server.normalizeOcrFieldRegionRequest({ ...request, mimeType: "image/png" }),
    /формате JPG/u
  );
  assert.throws(
    () => server.normalizeOcrFieldRegionRequest({ ...request, base64: Buffer.from("not jpeg").toString("base64") }),
    /не является корректным JPG/u
  );

  const response = server.normalizeOcrFieldRegionResponse({
    ok: true,
    key: "passportNumber",
    label: "untrusted",
    value: " 12  34  567890 ",
    confidence: 5,
    evidence: " OCR   evidence ",
    rawText: "12 34 567890"
  }, "passportNumber");
  assert.strictEqual(response.label, "Серия и номер паспорта");
  assert.strictEqual(response.value, "12 34 567890");
  assert.strictEqual(response.confidence, 1);
  assert.throws(
    () => server.normalizeOcrFieldRegionResponse({ ...response, key: "inn" }, "passportNumber"),
    /для другого поля/u
  );
  assert.throws(
    () => server.normalizeOcrFieldRegionResponse({ ...response, value: "" }, "passportNumber"),
    /Не удалось распознать поле/u
  );

  assert.strictEqual(server.isVisualOcrDocument({ contentType: "image/jpeg" }), true);
  assert.strictEqual(server.isVisualOcrDocument({ contentType: "application/pdf" }), true);
  assert.strictEqual(server.isVisualOcrDocument({
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }), true);
  assert.strictEqual(server.isVisualOcrDocument({ contentType: "text/plain" }), false);

  const serverSource = fs.readFileSync(path.join(__dirname, "..", "app-server.js"), "utf8");
  const pythonSource = path.join(__dirname, "..", "services", "ocr", "server.py");
  const ocrSource = fs.readFileSync(pythonSource, "utf8");
  assert.match(serverSource, /\/api\/students\/recognize-documents\/field-region/u);
  assert.match(serverSource, /\["--recognize-field-stdin"\]/u);
  assert.match(serverSource, /\/v1\/recognize-field/u);
  assert.match(ocrSource, /def recognize_field\(/u);
  assert.match(ocrSource, /def normalize_recognized_field_value\(/u);
  assert.match(ocrSource, /"\/v1\/recognize-field"/u);
  assert.match(ocrSource, /arguments == \["--recognize-field-stdin"\]/u);
  assert.match(ocrSource, /extract_docx_embedded_images\(file_bytes, workdir\)/u);

  const pythonChecked = runPythonUnitChecks(process.env.OCR_PYTHON_BINARY || "", pythonSource);
  console.log(`document recognition field-region backend tests: OK${pythonChecked ? " (Python checked)" : ""}`);
}

main();
