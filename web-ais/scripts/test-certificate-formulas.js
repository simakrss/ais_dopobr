const assert = require('node:assert/strict');
const fs = require('node:fs');
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

const certificateTemplate = fs.readFileSync(path.resolve(
  __dirname,
  '..',
  'storage',
  'document-templates',
  'Сертификат ПРО.docx'
));
const linkedCertificate = server.fillDocxMarkers(
  certificateTemplate,
  { 'QRкод': '' },
  { 'QRкод': qrImage }
);
const linkedCertificateEntries = server.readDocxZipEntries(linkedCertificate);
const linkedCertificateXml = linkedCertificateEntries
  .find((entry) => entry.name === 'word/document.xml')
  ?.content.toString('utf8') || '';
const linkedCertificateRelationships = linkedCertificateEntries
  .find((entry) => entry.name === 'word/_rels/document.xml.rels')
  ?.content.toString('utf8') || '';
const generatedImageRelationship = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bType="[^"]*\/image"[^>]*\bTarget="media\/ais-photo-[^"]+"[^>]*\/>/
  .exec(linkedCertificateRelationships)?.[1] || '';
assert.ok(generatedImageRelationship, 'QR image relationship must be created');
const generatedImageDrawing = new RegExp(
  `<w:drawing>[\\s\\S]*?r:embed="${generatedImageRelationship}"[\\s\\S]*?<\\/w:drawing>`
).exec(linkedCertificateXml)?.[0] || '';
assert.match(generatedImageDrawing, /<a:hlinkClick\b[^>]*\br:id="rId8"/);
const generatedImageOccurrences = [...linkedCertificateXml.matchAll(
  new RegExp(`r:embed="${generatedImageRelationship}"`, 'g')
)].length;
const generatedHyperlinkWrappers = [...linkedCertificateXml.matchAll(
  /<w:hyperlink\b[^>]*\br:id="rId8"[^>]*>/g
)].length;
assert.ok(generatedImageOccurrences >= 2, 'QR image must be inserted in every certificate language page');
assert.equal(generatedHyperlinkWrappers, generatedImageOccurrences);
assert.match(
  linkedCertificateRelationships,
  /<Relationship\b[^>]*\bId="rId8"[^>]*\bType="[^"]*\/hyperlink"[^>]*\bTarget="https:\/\/edu-plus\.ru"[^>]*\/>/
);

console.log('Certificate formula and QR tests passed.');
