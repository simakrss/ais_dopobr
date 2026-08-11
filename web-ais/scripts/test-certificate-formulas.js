const assert = require('node:assert/strict');
const path = require('node:path');

const server = require(path.resolve(__dirname, '..', 'app-server.js'));

const context = {
  fieldValues: {
    'Дата выдачи': '2026-06-23',
    'РегНомер': '12/34-ПРО',
    'ФИО': 'Иванов Иван Иванович',
    'ФИО_eng': '',
    'Прогр обуч факт': 'Тестовая программа'
  },
  sourceValues: {}
};

assert.equal(
  server.evaluateDocumentFormula('=ТЕКСТ([Дата выдачи];"ДД.ММ.ГГГГ")', context),
  '23.06.2026'
);
assert.equal(
  server.evaluateDocumentFormula('=ТРАНСЛИТЕРАЦИЯ([РегНомер])', context),
  '12/34-PRO'
);
assert.equal(
  server.evaluateDocumentFormula('=ЕСЛИ([ФИО_eng]="";ТРАНСЛИТЕРАЦИЯ([ФИО]);[ФИО_eng])', context),
  'Ivanov Ivan Ivanovich'
);

const qrValue = server.evaluateDocumentFormula(
  '=QRкод([Прогр обуч факт] & " " & [ФИО] & "https://edu-plus.ru";;1,5)',
  context
);
assert.equal(qrValue, 'Тестовая программа Иванов Иван Ивановичhttps://edu-plus.ru');

const qrImage = server.createDocumentQrCodeImage(qrValue);
assert.equal(qrImage.ext, 'png');
assert.equal(qrImage.mime, 'image/png');
assert.ok(qrImage.width >= 300 && qrImage.width === qrImage.height);
assert.deepEqual(
  [...qrImage.bytes.subarray(0, 8)],
  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
);

console.log('Certificate formula and QR tests passed.');
