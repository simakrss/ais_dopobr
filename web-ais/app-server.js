const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { Worker, isMainThread } = require("node:worker_threads");
const { TextDecoder } = require("node:util");
const XLSX = require("./vendor/sheetjs/xlsx.full.min.js");

const ROOT = __dirname;
const STORAGE_ROOT = path.join(ROOT, "storage");
const PHOTO_ROOT = path.join(STORAGE_ROOT, "photos");
const SERVER_SETTINGS_PATH = path.join(STORAGE_ROOT, "server-settings.json");
const STUDENT_DATABASE_SYNC_SCRIPT = path.join(ROOT, "scripts", "sync-student-database.ps1");
const STUDENT_APPLICATIONS_QUERY_SCRIPT = path.join(ROOT, "scripts", "query-student-applications.ps1");
const DEFAULT_STUDENT_DATABASE_WEBDAV_PATH = "ООО Цифровизация Плюс/АИС Допобразование/АИС Допобразование.xlsb";
const DEFAULT_YANDEX_DISK_BASE_PATH = "ООО Цифровизация Плюс/АИС Допобразование";
const DEFAULT_LOCAL_DOCUMENTS_ROOT = "Y:\\";
let serverSettings = {};
const DOCUMENT_TEMPLATE_ROOT = path.join(STORAGE_ROOT, "document-templates");
const PORT = Number(process.env.PORT || 8080);
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const MAX_DOCX_BYTES = 24 * 1024 * 1024;
const MAX_STUDENT_DATABASE_BYTES = 24 * 1024 * 1024;
const MAX_STUDENT_PHOTO_BYTES = 16 * 1024 * 1024;
const MAX_STUDENT_DATABASE_EXPORT_STUDENTS = 20000;
const MAX_STUDENT_DATABASE_EXPORT_EXPENSES = 100000;
const STUDENT_IMPORT_JOB_TTL_MS = 15 * 60 * 1000;
const studentImportJobs = new Map();
const studentExportJobs = new Map();
const WORD_TEMPLATE_EXTENSIONS = new Set(["doc", "docx", "docm", "dot", "dotx", "dotm", "rtf"]);
const OPENXML_WORD_EXTENSIONS = new Set(["docx", "docm", "dotx", "dotm"]);
const STUDENT_DATABASE_COLUMN_MAP = Object.freeze({
  "uid": "uid",
  "ФИО": "name",
  "Дата подачи заявки": "applicationDate",
  "Статус": "status",
  "Источник": "source",
  "Теги": "tags",
  "Агент": "agent",
  "Скидка": "discount",
  "Вид программы ДПО": "educationType",
  "Вид  программы ДПО": "educationType",
  "Прогр обуч факт": "program",
  "Количество часов": "hours",
  "Форма обучения": "studyForm",
  "Стажировка": "internship",
  "Обуч тел.": "phone",
  "Email": "email",
  "АккаунтTelegram": "telegram",
  "Пол": "gender",
  "Осн. скидки": "discountDescription",
  "Фото": "photoPath",
  "ФИО_eng": "nameEnglish",
  "ОбрПоИмени": "addressByFirstName",
  "СНИЛС": "snils",
  "СНИЛС_зак": "customerSnils",
  "ИНН": "inn",
  "ИНН_зак": "customerInn",
  "ФИО_несклон": "noDeclension",
  "Адрес места жительства": "mailingAddress",
  "Адрес места регистрации": "registrationAddress",
  "МестоРаботы": "workPlace",
  "Должность": "position",
  "Категория занятости": "employmentCategory",
  "Статус ОВЗ": "ovzStatus",
  "Гражданство": "citizenship",
  "Пасп_Обуч_Вид документа": "passportType",
  "ДР обуч": "birthDate",
  "Пасп_Обуч_Серия_Номер": "passportNumber",
  "КодПодрОбуч": "passportCode",
  "Пасп_Обуч_Дата": "passportDate",
  "Пасп_Обуч_Кем": "passportIssuer",
  "Обр_Вид образования": "educationDocument",
  "Обр_Уровень": "educationLevel",
  "Обр_Серия": "educationDocumentSeries",
  "Обр_Номер": "educationDocumentNumber",
  "Обр_Дата выдачи": "educationDocumentDate",
  "Обр_Кем выдан": "educationDocumentIssuer",
  "Обр_Специальность": "educationSpecialty",
  "Обр_Квалификация": "educationQualification",
  "Фамилия в документе": "educationDocumentSurname",
  "Заказчик": "customer",
  "Зак тел.": "customerPhone",
  "WhatsApp": "whatsapp",
  "Пасп_Зак_Вид документа": "customerPassportType",
  "ДР зак": "customerBirthDate",
  "Пасп_Зак_Серия_Номер": "customerPassportNumber",
  "КодПодрЗак": "customerPassportCode",
  "Пасп_Зак_Дата": "customerPassportDate",
  "Пасп_Зак_Кем": "customerPassportIssuer",
  "Логин": "login",
  "Пароль": "password",
  "СообщЛогин": "portalAccessMessage",
  "Диплом": "diplomaStatus",
  "Заявл.": "applicationDocumentStatus",
  "Анкета": "questionnaireStatus",
  "Договор": "contractNo",
  "Дата договора": "contractDate",
  "Согласие на обр. ПнД": "consentPersonalData",
  "Источник финансирования": "fundingSource",
  "Сумма по договору (руб)": "contractAmount",
  "Сумма  по договору (руб)": "contractAmount",
  "Сумма в месяц (руб)": "monthlyAmount",
  "Остаток по договору (руб)": "balance",
  "Остаток  по договору (руб)": "balance",
  "Внесено (руб)": "paidAmount",
  "Заказ": "orderNo",
  "Дата1": "payment1Date",
  "Оплата1": "payment1Amount",
  "Дата2": "payment2Date",
  "Оплата2": "payment2Amount",
  "Дата3": "payment3Date",
  "Оплата3": "payment3Amount",
  "Дата4": "payment4Date",
  "Оплата4": "payment4Amount",
  "Дата5": "payment5Date",
  "Оплата5": "payment5Amount",
  "Дата6": "payment6Date",
  "Оплата6": "payment6Amount",
  "Дата7": "payment7Date",
  "Оплата7": "payment7Amount",
  "Дата8": "payment8Date",
  "Оплата8": "payment8Amount",
  "Номер приказа зачисления": "enrollmentOrderNo",
  "Дата приказа зачисления": "enrollmentDate",
  "Номер группы": "group",
  "Дата начала обучения": "startDate",
  "Тема ВАР": "finalWorkTopic",
  "Замечания ВАР": "finalWorkNotes",
  "Оценка ИА": "finalGrade",
  "Дата окончания обучения": "endDate",
  "Продленная дата окончания обучения": "extendedEndDate",
  "Признак оформления": "documentsStatus",
  "Номер приказа отчисления": "expulsionOrderNo",
  "Дата приказа Отчисл Док Обр": "expulsionDate",
  "Номер протокола": "protocolNo",
  "Примечание5": "note",
  "Отзыв": "review",
  "ОтзывРазмещен": "reviewPublished",
  "Почта": "postalTrack",
  "Номер бланка": "diplomaBlankNo",
  "РегНомер": "registrationNo",
  "Дата выдачи": "diplomaIssueDate",
  "Квалификация": "qualification",
  "Председатель": "chairman",
  "Руководитель орг": "commissionMember1",
  "Секретарь": "secretary",
  "ФРДО": "frdoStatus",
  "Дата доставки": "deliveryDate"
});
const STUDENT_DATABASE_DATE_FIELDS = new Set([
  "applicationDate",
  "birthDate",
  "passportDate",
  "educationDocumentDate",
  "customerBirthDate",
  "customerPassportDate",
  "contractDate",
  "payment1Date",
  "payment2Date",
  "payment3Date",
  "payment4Date",
  "payment5Date",
  "payment6Date",
  "payment7Date",
  "payment8Date",
  "enrollmentDate",
  "startDate",
  "endDate",
  "extendedEndDate",
  "expulsionDate",
  "diplomaIssueDate",
  "deliveryDate"
]);
const STUDENT_DATABASE_NUMBER_FIELDS = new Set([
  "discount",
  "hours",
  "contractAmount",
  "monthlyAmount",
  "balance",
  "paidAmount",
  "payment1Amount",
  "payment2Amount",
  "payment3Amount",
  "payment4Amount",
  "payment5Amount",
  "payment6Amount",
  "payment7Amount",
  "payment8Amount"
]);
const DIRECT_EXPENSE_DATABASE_COLUMN_MAP = Object.freeze({
  "uid": "uid",
  "Дата": "date",
  "Вид затрат": "type",
  "Сумма": "amount",
  "Примечание": "note",
  "Связь с запасами": "inventoryLink",
  "Акт": "act",
  "Статус акта": "actStatus",
  "Рекомендация оплаты": "recommendation",
  "Дополнительная информация": "additionalInfo"
});
const STUDENT_EVENT_IMPORT_TEMPLATES = Object.freeze([
  { key: "docsListNotice", label: "Уведомление с перечнем документов" },
  { key: "sourceDocsReceived", label: "Получен пакет исходных документов" },
  { key: "contractDocsSent", label: "Отправлен пакет готовых документов для подписи" },
  { key: "portalAccountCreated", label: "Создана/обновлена учетная запись на портале" },
  { key: "enrollmentOrderPrepared", label: "Сформирован приказ на зачисление" },
  { key: "signedDocsReceived", label: "Получен подписанный пакет документов" },
  { key: "portalCredentialsSent", label: "Отправлены данные для доступа к порталу" },
  { key: "expulsionOrderPrepared", label: "Сформирован приказ об отчислении" },
  { key: "educationDocMaketSent", label: "Отправлен макет документа об образовании на согласование" },
  { key: "educationDocMaketApproved", label: "Макет документа об образовании согласован" },
  { key: "educationDocOriginalSent", label: "Отправлен оригинал документа об образовании" },
  { key: "reviewRequested", label: "Запрошен отзыв о прохождении обучения" },
  { key: "reviewReceived", label: "Получен отзыв о прохождении обучения" },
  { key: "recommendationRequested", label: "Запрошена рекомендация учебного центра" },
  { key: "partnerInviteSent", label: "Отправлено приглашение в партнерскую программу" },
  { key: "examSheetPrepared", label: "Сформирована зачетно-экзаменационная ведомость" },
  { key: "personalCasePrinted", label: "Распечатано личное дело" },
  { key: "extensionDocsSent", label: "Отправлен комплект документов для продления обучения" },
  { key: "extensionDocsReceived", label: "Получен комплект документов для продления обучения" },
  { key: "reductionDocsSent", label: "Отправлен комплект документов для сокращения обучения" },
  { key: "reductionDocsReceived", label: "Получен комплект документов для сокращения обучения" },
  { key: "certificateSent", label: "Отправлена справка об обучении" }
]);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Content-Disposition, X-Yandex-Disk-Saved, X-Yandex-Disk-Path, X-Yandex-Disk-Error"
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".docm": "application/vnd.ms-word.document.macroEnabled.12",
  ".dot": "application/msword",
  ".dotx": "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  ".dotm": "application/vnd.ms-word.template.macroEnabled.12",
  ".rtf": "application/rtf"
};

async function ensureStorage() {
  await fs.mkdir(PHOTO_ROOT, { recursive: true });
  await fs.mkdir(DOCUMENT_TEMPLATE_ROOT, { recursive: true });
  try {
    serverSettings = JSON.parse(await fs.readFile(SERVER_SETTINGS_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Не удалось прочитать настройки сервера: ${error.message}`);
    serverSettings = {};
  }
  serverSettings = {
    studentDatabaseWebDavPath: DEFAULT_STUDENT_DATABASE_WEBDAV_PATH,
    yandexDiskBasePath: DEFAULT_YANDEX_DISK_BASE_PATH,
    localDocumentsRoot: DEFAULT_LOCAL_DOCUMENTS_ROOT,
    localDocumentsRootIsSystemParent: false,
    studentApplicationsMySqlConnectionString: "",
    studentApplicationsEmailHost: "",
    studentApplicationsEmailPort: 993,
    studentApplicationsEmailSecure: true,
    studentApplicationsEmailLogin: "",
    yandexDiskLogin: "",
    yandexDiskAutoSave: false,
    ...serverSettings
  };
  delete serverSettings.systemDocumentsPublicUrl;
  delete serverSettings.systemDocumentsPublicPassword;
  delete serverSettings.studentDatabaseUrl;
  delete serverSettings.studentPhotoBasePath;
}

async function saveServerSettings(patch) {
  serverSettings = {
    ...serverSettings,
    ...patch
  };
  await fs.writeFile(
    SERVER_SETTINGS_PATH,
    `${JSON.stringify(serverSettings, null, 2)}\n`,
    "utf8"
  );
  return serverSettings;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}
function sendFile(res, status, bytes, fileName, contentType, extraHeaders = {}) {
  const encodedName = encodeURIComponent(fileName).replace(/['()]/g, escape);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": contentType,
    "Content-Length": bytes.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(bytes);
}

function escapeXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/\r\n|\r|\n/g, "&#10;");
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value).replace(/'/g, "&apos;");
}

function safeDocumentFileName(value) {
  const base = safeNamePart(String(value || "договор").replace(/\.docx$/i, ""), "договор");
  return `${base}.docx`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function findZipEnd(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054B50) return offset;
  }
  throw new Error("Некорректный DOCX: не найден центральный каталог ZIP");
}

function readDocxZipEntries(buffer) {
  const endOffset = findZipEnd(buffer);
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014B50) throw new Error("Некорректный DOCX: ошибка центрального каталога");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = zlib.inflateRawSync(compressed);
    else throw new Error(`DOCX содержит неподдерживаемый метод сжатия ZIP: ${method}`);
    entries.push({ name, content });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function buildDocxZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    const compressed = zlib.deflateRawSync(content, { level: 6 });
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  });
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

const IMAGE_CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp"
};

function entryByName(entries, name) {
  return entries.find((entry) => entry.name === name);
}

function nextRelationshipId(relsXml) {
  let maxId = 0;
  for (const match of relsXml.matchAll(/\bId="rId(\d+)"/g)) {
    maxId = Math.max(maxId, Number(match[1]) || 0);
  }
  return `rId${maxId + 1}`;
}

function nextDocPrId(documentXml) {
  let maxId = 0;
  for (const match of documentXml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)) {
    maxId = Math.max(maxId, Number(match[1]) || 0);
  }
  return maxId + 1;
}

function ensureContentType(entries, ext, contentType) {
  const entry = entryByName(entries, "[Content_Types].xml");
  if (!entry) return;
  let xml = entry.content.toString("utf8");
  const pattern = new RegExp(`<Default\\b[^>]*\\bExtension="${ext}"`, "i");
  if (pattern.test(xml)) return;
  xml = xml.replace(
    "</Types>",
    `<Default Extension="${escapeXmlAttribute(ext)}" ContentType="${escapeXmlAttribute(contentType)}"/></Types>`
  );
  entry.content = Buffer.from(xml, "utf8");
}

function ensureDocumentRelationshipsEntry(entries) {
  let entry = entryByName(entries, "word/_rels/document.xml.rels");
  if (entry) return entry;
  entry = {
    name: "word/_rels/document.xml.rels",
    content: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
      "utf8"
    )
  };
  entries.push(entry);
  return entry;
}

function addDocumentImageRelationship(entries, target) {
  const relsEntry = ensureDocumentRelationshipsEntry(entries);
  let relsXml = relsEntry.content.toString("utf8");
  const relationshipId = nextRelationshipId(relsXml);
  const relationshipXml = `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeXmlAttribute(target)}"/>`;
  relsXml = relsXml.replace("</Relationships>", `${relationshipXml}</Relationships>`);
  relsEntry.content = Buffer.from(relsXml, "utf8");
  return relationshipId;
}

function uniqueMediaName(entries, ext) {
  let index = 1;
  let name;
  do {
    name = `word/media/ais-photo-${Date.now().toString(36)}-${index}.${ext}`;
    index += 1;
  } while (entryByName(entries, name));
  return name;
}

function imageDimensions(bytes, ext) {
  if (ext === "png" && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if ((ext === "jpg" || ext === "jpeg") && bytes.length > 4) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xFF) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  if (ext === "gif" && bytes.length >= 10 && bytes.subarray(0, 3).toString("ascii") === "GIF") {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (ext === "webp" && bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    const format = bytes.subarray(12, 16).toString("ascii");
    if (format === "VP8X" && bytes.length >= 30) {
      return {
        width: 1 + bytes.readUIntLE(24, 3),
        height: 1 + bytes.readUIntLE(27, 3)
      };
    }
    if (format === "VP8 " && bytes.length >= 30) {
      return { width: bytes.readUInt16LE(26) & 0x3FFF, height: bytes.readUInt16LE(28) & 0x3FFF };
    }
    if (format === "VP8L" && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
    }
  }
  return { width: 300, height: 400 };
}

const EMU_PER_TWIP = 635;
const EMU_PER_POINT = 12700;
const EMU_PER_INCH = 914400;
const EMU_PER_CM = 360000;

function parseXmlTagNumberAttribute(xml, tagName, attrName) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "i");
  const tag = tagPattern.exec(xml || "")?.[0] || "";
  if (!tag) return null;
  const attrPattern = new RegExp(`\\b${attrName}="([^"]+)"`, "i");
  const value = attrPattern.exec(tag)?.[1];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseXmlTagAttribute(xml, tagName, attrName) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "i");
  const tag = tagPattern.exec(xml || "")?.[0] || "";
  if (!tag) return "";
  const attrPattern = new RegExp(`\\b${attrName}="([^"]+)"`, "i");
  return attrPattern.exec(tag)?.[1] || "";
}

function getEnclosingXmlElement(xml, index, tagName) {
  const start = xml.lastIndexOf(`<${tagName}`, index);
  if (start < 0) return null;
  const previousClose = xml.lastIndexOf(`</${tagName}>`, index);
  if (previousClose > start) return null;
  const end = xml.indexOf(`</${tagName}>`, index);
  if (end < 0) return null;
  return {
    start,
    end: end + tagName.length + 3,
    xml: xml.slice(start, end + tagName.length + 3)
  };
}

function parseTwipsToEmu(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * EMU_PER_TWIP) : null;
}

function parseCssLengthToEmu(value) {
  const match = /^(-?\d+(?:\.\d+)?)(pt|in|cm|mm|px)?$/i.exec(String(value || "").trim());
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return null;
  const unit = (match[2] || "pt").toLowerCase();
  if (unit === "pt") return Math.round(number * EMU_PER_POINT);
  if (unit === "in") return Math.round(number * EMU_PER_INCH);
  if (unit === "cm") return Math.round(number * EMU_PER_CM);
  if (unit === "mm") return Math.round(number * EMU_PER_CM / 10);
  if (unit === "px") return Math.round(number * EMU_PER_INCH / 96);
  return null;
}

function parseStyleLengthToEmu(style, property) {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i");
  return parseCssLengthToEmu(pattern.exec(style || "")?.[1]);
}

function getWordFrameImageConstraints(xml, markerIndex) {
  const paragraph = getEnclosingXmlElement(xml, markerIndex, "w:p");
  const framePr = paragraph?.xml.match(/<w:framePr\b[^>]*>/i)?.[0] || "";
  if (!framePr) return null;
  const width = parseTwipsToEmu(/\bw:w="([^"]+)"/i.exec(framePr)?.[1]);
  const height = parseTwipsToEmu(/\bw:h="([^"]+)"/i.exec(framePr)?.[1]);
  if (!width && !height) return null;
  return { width, height, source: "framePr" };
}

function getDrawingFrameImageConstraints(xml, markerIndex) {
  const drawing = getEnclosingXmlElement(xml, markerIndex, "w:drawing");
  if (!drawing) return null;
  const width = parseXmlTagNumberAttribute(drawing.xml, "wp:extent", "cx");
  const height = parseXmlTagNumberAttribute(drawing.xml, "wp:extent", "cy");
  if (!width && !height) return null;
  return { width, height, source: "drawing" };
}

function getVmlFrameImageConstraints(xml, markerIndex) {
  const shapeTags = ["v:shape", "v:rect", "v:roundrect"];
  for (const tagName of shapeTags) {
    const shape = getEnclosingXmlElement(xml, markerIndex, tagName);
    if (!shape) continue;
    const style = parseXmlTagAttribute(shape.xml, tagName, "style");
    const width = parseStyleLengthToEmu(style, "width");
    const height = parseStyleLengthToEmu(style, "height");
    if (width || height) return { width, height, source: "vml" };
  }
  return null;
}

function parseTableCellWidthEmu(cellXml) {
  const tcWTag = cellXml.match(/<w:tcW\b[^>]*>/i)?.[0] || "";
  if (!tcWTag) return null;
  const type = /\bw:type="([^"]+)"/i.exec(tcWTag)?.[1] || "dxa";
  if (type !== "dxa") return null;
  return parseTwipsToEmu(/\bw:w="([^"]+)"/i.exec(tcWTag)?.[1]);
}

function parseTableRowHeightEmu(rowXml) {
  const trHeightTag = rowXml.match(/<w:trHeight\b[^>]*>/i)?.[0] || "";
  if (!trHeightTag) return null;
  return parseTwipsToEmu(/\bw:val="([^"]+)"/i.exec(trHeightTag)?.[1]);
}

function getTableFrameImageConstraints(xml, markerIndex) {
  const cell = getEnclosingXmlElement(xml, markerIndex, "w:tc");
  const row = getEnclosingXmlElement(xml, markerIndex, "w:tr");
  if (!cell && !row) return null;
  const width = cell ? parseTableCellWidthEmu(cell.xml) : null;
  const height = row ? parseTableRowHeightEmu(row.xml) : null;
  const hasVisibleFrame = Boolean(
    /<w:tcBorders\b/i.test(cell?.xml || "")
    || /<w:tblBorders\b/i.test(getEnclosingXmlElement(xml, markerIndex, "w:tbl")?.xml || "")
  );
  if (!width && !height) return null;
  if (!height && !hasVisibleFrame) return null;
  return { width, height, source: "table" };
}

function getImageFrameConstraints(xml, marker) {
  const markerIndex = xml.indexOf(marker);
  if (markerIndex < 0) return null;
  return getDrawingFrameImageConstraints(xml, markerIndex)
    || getVmlFrameImageConstraints(xml, markerIndex)
    || getWordFrameImageConstraints(xml, markerIndex)
    || getTableFrameImageConstraints(xml, markerIndex);
}

function imageExtentEmu(image, frame = null) {
  const maxWidth = 3 * 360000;
  const maxHeight = 4 * 360000;
  const width = Math.max(1, Number(image.width) || 300);
  const height = Math.max(1, Number(image.height) || 400);
  const aspect = width / height;
  const frameWidth = Number(frame?.width) > 0 ? Number(frame.width) : null;
  const frameHeight = Number(frame?.height) > 0 ? Number(frame.height) : null;
  if (frameHeight) {
    const cy = frameHeight;
    let cx = Math.round(cy * aspect);
    if (frameWidth && cx > frameWidth) cx = frameWidth;
    return { cx: Math.max(1, cx), cy: Math.max(1, cy) };
  }
  if (frameWidth) {
    const cx = frameWidth;
    return { cx: Math.max(1, cx), cy: Math.max(1, Math.round(cx / aspect)) };
  }
  let cx = maxWidth;
  let cy = Math.round(cx / aspect);
  if (cy > maxHeight) {
    cy = maxHeight;
    cx = Math.round(cy * aspect);
  }
  return { cx, cy };
}

function buildImageDrawingXml({ relationshipId, cx, cy, docPrId, name }) {
  const safeName = escapeXmlAttribute(name || "Фото слушателя");
  return `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="${safeName}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${safeName}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function replaceTextMarkerWithXml(xml, marker, replacementXml) {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const textNodePattern = new RegExp(`(<w:t\\b[^>]*>)([^<]*)${escapedMarker}([^<]*)(</w:t>)`, "g");
  let replaced = false;
  const result = xml.replace(textNodePattern, (match, openTag, before, after, closeTag) => {
    replaced = true;
    return `${openTag}${before}${closeTag}</w:r><w:r>${replacementXml}</w:r><w:r>${openTag}${after}${closeTag}`;
  });
  if (replaced) return { xml: result, replaced: true };
  if (!xml.includes(marker)) return { xml, replaced: false };
  return { xml: xml.split(marker).join(replacementXml), replaced: true };
}

function insertDocumentImage(entries, fieldName, image) {
  const documentEntry = entryByName(entries, "word/document.xml");
  if (!documentEntry) return false;
  let documentXml = documentEntry.content.toString("utf8");
  const marker = `#${fieldName}#`;
  if (!documentXml.includes(marker)) return false;
  const ext = image.ext === "jpeg" ? "jpg" : image.ext;
  const contentType = IMAGE_CONTENT_TYPES[ext];
  if (!contentType) return false;
  const mediaName = uniqueMediaName(entries, ext);
  const target = mediaName.replace(/^word\//, "");
  const relationshipId = addDocumentImageRelationship(entries, target);
  const frame = getImageFrameConstraints(documentXml, marker);
  const { cx, cy } = imageExtentEmu(image, frame);
  const drawingXml = buildImageDrawingXml({
    relationshipId,
    cx,
    cy,
    docPrId: nextDocPrId(documentXml),
    name: image.name || fieldName
  });
  const replaced = replaceTextMarkerWithXml(documentXml, marker, drawingXml);
  if (!replaced.replaced) return false;
  documentEntry.content = Buffer.from(replaced.xml, "utf8");
  entries.push({ name: mediaName, content: image.bytes });
  ensureContentType(entries, ext, contentType);
  return true;
}

function findAdjacentWordImageRun(paragraphXml, startIndex) {
  const source = String(paragraphXml || "");
  let cursor = Math.max(0, Number(startIndex) || 0);
  for (let index = 0; index < 4; index += 1) {
    const remaining = source.slice(cursor);
    const match = /^\s*(<w:r\b[\s\S]*?<\/w:r>)/.exec(remaining);
    if (!match) break;
    const runXml = match[1];
    const runStart = cursor + match[0].indexOf(runXml);
    const runEnd = runStart + runXml.length;
    if (/<w:(?:drawing|pict)\b/.test(runXml)) {
      return { insertionIndex: startIndex, runStart, runEnd, runXml };
    }
    if (getWordParagraphText(runXml).trim()) break;
    cursor += match[0].length;
  }
  return { insertionIndex: startIndex, runStart: -1, runEnd: -1, runXml: "" };
}

function findIndexedWordFieldImageAnchor(paragraphXml, fieldName, fieldPositionMap) {
  const source = String(paragraphXml || "");
  const targetName = String(fieldName || "").trim();
  if (!targetName || !fieldPositionMap?.size) return null;
  const complexFieldPattern = /<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>/g;
  for (const match of source.matchAll(complexFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(match[0]));
    if (!indexedField || fieldPositionMap.get(String(indexedField.position)) !== targetName) continue;
    let fieldEnd = match.index + match[0].length;
    const closingRun = /^\s*<\/w:r>/.exec(source.slice(fieldEnd));
    if (closingRun) fieldEnd += closingRun[0].length;
    return findAdjacentWordImageRun(source, fieldEnd);
  }
  const simpleFieldPattern = /<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>[\s\S]*?<\/w:fldSimple>/g;
  for (const match of source.matchAll(simpleFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(match[1] || "");
    if (!indexedField || fieldPositionMap.get(String(indexedField.position)) !== targetName) continue;
    return findAdjacentWordImageRun(source, match.index + match[0].length);
  }
  return null;
}

function applyIndexedDocumentImage(entries, fieldName, image, fieldPositionMap) {
  const documentEntry = entryByName(entries, "word/document.xml");
  if (!documentEntry || !fieldPositionMap?.size) return false;
  const documentXml = documentEntry.content.toString("utf8");
  const paragraphs = [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  for (const paragraph of paragraphs) {
    const anchor = findIndexedWordFieldImageAnchor(paragraph[0], fieldName, fieldPositionMap);
    if (!anchor) continue;
    let replacementRun = "";
    if (image?.bytes?.length) {
      const ext = image.ext === "jpeg" ? "jpg" : image.ext;
      const contentType = IMAGE_CONTENT_TYPES[ext];
      if (!contentType) return false;
      const mediaName = uniqueMediaName(entries, ext);
      const target = mediaName.replace(/^word\//, "");
      const relationshipId = addDocumentImageRelationship(entries, target);
      const frame = anchor.runXml ? {
        width: parseXmlTagNumberAttribute(anchor.runXml, "wp:extent", "cx"),
        height: parseXmlTagNumberAttribute(anchor.runXml, "wp:extent", "cy")
      } : null;
      const { cx, cy } = imageExtentEmu(image, frame);
      const drawingXml = buildImageDrawingXml({
        relationshipId,
        cx,
        cy,
        docPrId: nextDocPrId(documentXml),
        name: image.name || fieldName
      });
      const runOpenTag = /^<w:r\b[^>]*>/.exec(anchor.runXml)?.[0] || "<w:r>";
      const runProperties = /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(anchor.runXml)?.[0] || "";
      replacementRun = `${runOpenTag}${runProperties}${drawingXml}</w:r>`;
      entries.push({ name: mediaName, content: image.bytes });
      ensureContentType(entries, ext, contentType);
    }
    const replacementStart = anchor.runStart >= 0 ? anchor.runStart : anchor.insertionIndex;
    const replacementEnd = anchor.runEnd >= 0 ? anchor.runEnd : anchor.insertionIndex;
    const paragraphXml = `${paragraph[0].slice(0, replacementStart)}${replacementRun}${paragraph[0].slice(replacementEnd)}`;
    documentEntry.content = Buffer.from(
      `${documentXml.slice(0, paragraph.index)}${paragraphXml}${documentXml.slice(paragraph.index + paragraph[0].length)}`,
      "utf8"
    );
    return true;
  }
  return false;
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseCustomDocumentProperties(entries) {
  const entry = entryByName(entries, "docProps/custom.xml");
  if (!entry) return [];
  const xml = entry.content.toString("utf8");
  const properties = [];
  const propertyPattern = /<property\b([^>]*)>([\s\S]*?)<\/property>/g;
  for (const match of xml.matchAll(propertyPattern)) {
    const name = /name="([^"]+)"/.exec(match[1])?.[1];
    if (!name) continue;
    const valueMatch = /<vt:[^>]+>([\s\S]*?)<\/vt:[^>]+>/.exec(match[2]);
    if (!valueMatch) continue;
    properties.push({ name: decodeXmlText(name), value: decodeXmlText(valueMatch[1]) });
  }
  return properties;
}

function decodeAssistantOptionText(value) {
  return String(value || "")
    .replace(/_x000d_\r?\n?/gi, "\n")
    .replace(/_x000a_\r?\n?/gi, "\n")
    .replace(/_x000b_/gi, "\u000b")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function parseAssistantOptionBoolean(value) {
  return /^(?:1|да|true|истина)$/i.test(String(value || "").trim());
}

function isAssistantOptionPropertyName(name) {
  const prefix = "Опции";
  const text = String(name || "");
  return text.startsWith(prefix) && /^\d+$/.test(text.slice(prefix.length));
}

function isAssistantReservePropertyName(name) {
  return /^(?:Резерв|ДатаРезерва)\d+$/u.test(String(name || ""));
}

function parseAssistantDocumentFieldProperties(properties) {
  const optionProperties = (Array.isArray(properties) ? properties : [])
    .filter((property) => isAssistantOptionPropertyName(property?.name))
    .sort((a, b) => (
      Number(String(a.name).replace(/^Опции/, "")) - Number(String(b.name).replace(/^Опции/, ""))
    ));
  if (!optionProperties.length) return [];
  const configText = decodeAssistantOptionText(optionProperties.map((property) => property.value || "").join(""));
  const fields = [];
  const seen = new Set();
  const sectionPattern = /^\[Поля\\([^\]]+)\]\s*\n([\s\S]*?)(?=^\[[^\]]+\]\s*$|(?![\s\S]))/gm;
  for (const match of configText.matchAll(sectionPattern)) {
    const values = {};
    let currentKey = "";
    String(match[2] || "").split("\n").forEach((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex > 0) {
        currentKey = line.slice(0, separatorIndex).trim();
        values[currentKey] = line.slice(separatorIndex + 1).replace(/\u000b/g, "\n").trim();
        return;
      }
      if (currentKey && line) values[currentKey] = `${values[currentKey]}\n${line.replace(/\u000b/g, "\n")}`;
    });
    const name = String(values["ИмяПоля"] || "").replace(/^#+|#+$/g, "").trim();
    if (!name || seen.has(name)) continue;
    const formula = String(values["Формула"] || "").trim();
    const fieldNumber = Number.parseInt(String(match[1] || "").trim(), 10);
    const position = Number.parseInt(values["Позиция"], 10);
    fields.push({
      name,
      value: formula,
      fieldNumber: Number.isFinite(fieldNumber) && fieldNumber > 0 ? fieldNumber : undefined,
      position: Number.isFinite(position) && position > 0 ? position : fields.length + 1,
      hideEmpty: parseAssistantOptionBoolean(values["СкрытьПустые"]),
      source: "assistant-options"
    });
    seen.add(name);
  }
  return fields;
}

function getDocumentFormulaPropertiesFromEntries(entries) {
  const properties = parseCustomDocumentProperties(entries);
  return [
    ...properties.filter((property) => (
      !isAssistantOptionPropertyName(property.name)
      && !isAssistantReservePropertyName(property.name)
    )),
    ...parseAssistantDocumentFieldProperties(properties)
  ];
}

function isFormulaLike(value) {
  const text = String(value || "").trim();
  return Boolean(text && (
    /^=/.test(text)
    || /\[[^\]]+\]|#[^#]+#/u.test(text)
    || /[\p{L}_][\p{L}\p{N}_*]*\(/u.test(text)
  ));
}

function getDocumentFormulaFieldReferences(formula) {
  const result = [];
  const seen = new Set();
  for (const match of String(formula || "").matchAll(/#([^#\r\n]+)#/g)) {
    const name = String(match[1] || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function orderDocumentFormulaProperties(properties) {
  const propertiesByName = new Map();
  (Array.isArray(properties) ? properties : []).forEach((property) => {
    const name = String(property?.name || "").trim();
    if (name && isFormulaLike(property?.value)) propertiesByName.set(name, { ...property, name });
  });
  const stateByName = new Map();
  const path = [];
  const ordered = [];
  const visit = (name) => {
    if (stateByName.get(name) === "visiting") {
      const startIndex = path.indexOf(name);
      const cycle = [...path.slice(Math.max(0, startIndex)), name];
      throw new Error(`Обнаружена рекурсия в формулах документа: ${cycle.join(" → ")}.`);
    }
    if (stateByName.get(name) === "visited") return;
    const property = propertiesByName.get(name);
    if (!property) return;
    stateByName.set(name, "visiting");
    path.push(name);
    getDocumentFormulaFieldReferences(property.value)
      .filter((dependency) => propertiesByName.has(dependency))
      .forEach(visit);
    path.pop();
    stateByName.set(name, "visited");
    ordered.push(property);
  };
  for (const name of propertiesByName.keys()) visit(name);
  return ordered;
}

function splitTopLevel(value, delimiter) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let squareDepth = 0;
  let quoted = false;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === delimiter && depth === 0 && squareDepth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function unwrapFormulaParentheses(value) {
  let text = String(value || "").trim();
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    let quoted = false;
    let wraps = true;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') index += 1;
        else quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth === 0 && index < text.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

function findTopLevelComparison(value) {
  const text = String(value || "");
  let depth = 0;
  let squareDepth = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && squareDepth === 0) {
      const twoChars = text.slice(index, index + 2);
      if ([">=", "<=", "<>"].includes(twoChars)) return { index, operator: twoChars };
      if ([">", "<"].includes(char)) return { index, operator: char };
      if (text.slice(index, index + 2) === "<>") return { index, operator: "<>" };
      if (char === "=") return { index, operator: "=" };
    }
  }
  return null;
}

function findTopLevelAdditiveOperator(value) {
  const text = String(value || "");
  let depth = 0;
  let squareDepth = 0;
  let quoted = false;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index - 1] === '"') {
        index -= 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === ")") depth += 1;
    else if (char === "(") depth = Math.max(0, depth - 1);
    else if (char === "]") squareDepth += 1;
    else if (char === "[") squareDepth = Math.max(0, squareDepth - 1);
    else if (depth === 0 && squareDepth === 0 && (char === "+" || char === "-")) {
      const previous = text.slice(0, index).trimEnd().slice(-1);
      if (!previous || /[+\-*/(;,<>=]/.test(previous)) continue;
      return { index, operator: char };
    }
  }
  return null;
}

function formulaValueToString(value) {
  if (value === true) return "ИСТИНА";
  if (value === false) return "ЛОЖЬ";
  if (value === null || value === undefined) return "";
  return String(value);
}

function formulaValueToBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return Boolean(text && text !== "0" && text !== "ложь" && text !== "false");
}

function parseDocumentFormulaDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  const text = String(value ?? "").trim();
  if (!text) return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (ru) return new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1])).getTime();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function compareDocumentFormulaValues(left, right, operator) {
  if (operator === "=" || operator === "<>") {
    const normalizeEquivalentValue = (value) => {
      const text = formulaValueToString(value);
      const normalized = text.trim().toLocaleLowerCase("ru-RU");
      return normalized === "\u0434\u0438\u0441\u0442\u0430\u043d\u0442"
        || normalized === "\u0434\u0438\u0441\u0442\u0430\u043d\u0446\u0438\u043e\u043d\u043d\u0430\u044f"
        ? "\u0434\u0438\u0441\u0442\u0430\u043d\u0446\u0438\u043e\u043d\u043d\u0430\u044f"
        : text;
    };
    const result = normalizeEquivalentValue(left) === normalizeEquivalentValue(right);
    return operator === "<>" ? !result : result;
  }
  const leftNumber = typeof left === "number" ? left : Number(String(left ?? "").replace(",", "."));
  const rightNumber = typeof right === "number" ? right : Number(String(right ?? "").replace(",", "."));
  let comparableLeft = leftNumber;
  let comparableRight = rightNumber;
  if (!Number.isFinite(comparableLeft) || !Number.isFinite(comparableRight)) {
    comparableLeft = parseDocumentFormulaDateValue(left);
    comparableRight = parseDocumentFormulaDateValue(right);
  }
  if (comparableLeft === null || comparableRight === null || !Number.isFinite(comparableLeft) || !Number.isFinite(comparableRight)) {
    comparableLeft = formulaValueToString(left);
    comparableRight = formulaValueToString(right);
  }
  if (operator === ">") return comparableLeft > comparableRight;
  if (operator === "<") return comparableLeft < comparableRight;
  if (operator === ">=") return comparableLeft >= comparableRight;
  if (operator === "<=") return comparableLeft <= comparableRight;
  return false;
}

function getFormulaContextValue(name, context) {
  const key = String(name || "").trim();
  const evaluatingName = String(context?.evaluatingName || "").trim();
  if (key && key === String(context?.evaluatingName || "").trim()
    && Object.prototype.hasOwnProperty.call(context.sourceValues, key)) {
    return context.sourceValues[key];
  }
  if (Object.prototype.hasOwnProperty.call(context.fieldValues, key)) return context.fieldValues[key];
  if (Object.prototype.hasOwnProperty.call(context.sourceValues, key)) return context.sourceValues[key];
  if (key === "Приказ" && /^Номер приказа (?:зачисления|отчисления)$/i.test(evaluatingName)) {
    if (Object.prototype.hasOwnProperty.call(context.fieldValues, evaluatingName)) {
      return context.fieldValues[evaluatingName];
    }
    if (Object.prototype.hasOwnProperty.call(context.sourceValues, evaluatingName)) {
      return context.sourceValues[evaluatingName];
    }
  }
  const baseKey = key.split("|")[0].trim();
  if (baseKey && baseKey !== key) {
    if (baseKey === String(context?.evaluatingName || "").trim()
      && Object.prototype.hasOwnProperty.call(context.sourceValues, baseKey)) {
      return context.sourceValues[baseKey];
    }
    if (Object.prototype.hasOwnProperty.call(context.fieldValues, baseKey)) return context.fieldValues[baseKey];
    if (Object.prototype.hasOwnProperty.call(context.sourceValues, baseKey)) return context.sourceValues[baseKey];
  }
  return "";
}

function replaceDocumentFormulaReferences(text, context) {
  return String(text ?? "")
    .replace(/#([^#]+)#/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)))
    .replace(/\[([^\]]+)\]/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)));
}

function parseDocumentFormulaQuotedLiteral(value) {
  const text = String(value || "");
  if (text.length < 2 || text[0] !== '"') return null;
  let result = "";
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '"') {
      result += char;
      continue;
    }
    if (text[index + 1] === '"') {
      result += '"';
      index += 1;
      continue;
    }
    return index === text.length - 1 ? result : null;
  }
  return null;
}

function evaluateDocumentFormula(formula, context) {
  try {
    return formulaValueToString(evaluateDocumentFormulaExpression(String(formula || "").replace(/^=\s*/, ""), context)).trim();
  } catch {
    return String(formula || "")
      .replace(/^=\s*/, "")
      .replace(/#([^#]+)#/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)))
      .replace(/\[([^\]]+)\]/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)))
      .trim();
  }
}

function isGetSqlQueryFormula(value) {
  return /Получить\s*SQL\s*запрос|ПолучитьSQLзапрос/i.test(String(value || ""));
}

function evaluateDocumentFormulaExpression(expression, context) {
  let text = unwrapFormulaParentheses(String(expression || "").trim());
  if (!text) return "";
  if (/^ИСТИНА$/i.test(text)) return true;
  if (/^ЛОЖЬ$/i.test(text)) return false;
  const quotedLiteral = parseDocumentFormulaQuotedLiteral(text);
  if (quotedLiteral !== null) return replaceDocumentFormulaReferences(quotedLiteral, context);
  if (/^-?\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(",", "."));
  const concatParts = splitTopLevel(text, "&");
  if (concatParts.length > 1) {
    return concatParts.map((part) => formulaValueToString(evaluateDocumentFormulaExpression(part, context))).join("");
  }
  const comparison = findTopLevelComparison(text);
  if (comparison) {
    const left = evaluateDocumentFormulaExpression(text.slice(0, comparison.index), context);
    const right = evaluateDocumentFormulaExpression(text.slice(comparison.index + comparison.operator.length), context);
    return compareDocumentFormulaValues(left, right, comparison.operator);
  }
  const additive = findTopLevelAdditiveOperator(text);
  if (additive) {
    const left = Number(evaluateDocumentFormulaExpression(text.slice(0, additive.index), context));
    const right = Number(evaluateDocumentFormulaExpression(text.slice(additive.index + 1), context));
    if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error("Некорректное арифметическое выражение");
    return additive.operator === "+" ? left + right : left - right;
  }
  const hashRef = /^#([^#]+)#$/.exec(text);
  if (hashRef) return getFormulaContextValue(hashRef[1], context);
  const sourceRef = /^\[([^\]]+)\]$/.exec(text);
  if (sourceRef) return getFormulaContextValue(sourceRef[1], context);
  const functionMatch = /^([\p{L}_][\p{L}\p{N}_*]*)\(([\s\S]*)\)$/u.exec(text);
  if (functionMatch) {
    return evaluateDocumentFormulaFunction(functionMatch[1], splitTopLevel(functionMatch[2], ";"), context);
  }
  return text
    .replace(/#([^#]+)#/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)))
    .replace(/\[([^\]]+)\]/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)));
}

function evaluateDocumentFormulaFunction(name, args, context) {
  const upperName = String(name || "").toUpperCase();
  const compactName = upperName.replace(/[\s_*]+/g, "");
  const value = (index) => evaluateDocumentFormulaExpression(args[index] || "", context);
  const text = (index) => formulaValueToString(value(index));
  if (upperName === "\u0421\u0422\u0420\u041e\u0427\u041d") return text(0).toLocaleLowerCase("ru-RU");
  if (upperName === "\u041f\u0423\u0422\u042c\u0414\u041e\u041a\u0423\u041c\u0415\u041d\u0422\u0410") return "";
  if (upperName === "\u0418\u0417\u041e\u0411\u0420\u0410\u0416\u0415\u041d\u0418\u0415") return text(0);
  if (upperName === "ТДАТА") return new Date();
  if (upperName === "ЕСЛИ") return formulaValueToBoolean(value(0)) ? value(1) : value(2);
  if (upperName === "И") return args.every((arg) => formulaValueToBoolean(evaluateDocumentFormulaExpression(arg, context)));
  if (upperName === "ИЛИ") return args.some((arg) => formulaValueToBoolean(evaluateDocumentFormulaExpression(arg, context)));
  if (upperName === "ЕСЛИОШИБКА") {
    try { return value(0); } catch { return value(1); }
  }
  if (upperName === "ПОИСК") {
    const needle = text(0).toLowerCase();
    const haystack = text(1).toLowerCase();
    const index = haystack.indexOf(needle);
    if (index < 0) throw new Error("ПОИСК: значение не найдено");
    return index + 1;
  }
  if (upperName === "ПОДСТАВИТЬ") return text(0).split(text(1)).join(text(2));
  if (upperName === "СИМВОЛ") return String.fromCharCode(Number(value(0)) || 0);
  if (upperName === "ЛЕВСИМВ") return text(0).slice(0, Number(value(1)) || 0);
  if (upperName === "ДЛСТР") return text(0).length;
  if (upperName === "ПСТР") {
    const start = Math.max(1, Number(value(1)) || 1) - 1;
    const length = Math.max(0, Number(value(2)) || 0);
    return text(0).slice(start, start + length);
  }
  if (upperName === "СЖПРОБЕЛЫ") return text(0).replace(/\s+/g, " ").trim();
  if (upperName === "ТЕКСТ") return formatDocumentFormulaDate(text(0));
  if (upperName === "ПОЛУЧИТЬSQLЗАПРОС" || upperName === "ПОЛУЧИТЬ_SQL_ЗАПРОС") return "";
  if (upperName === "ПОЛУЧИТЬ_ЭЛЕМЕНТ") {
    const delimiter = text(2) || " ";
    const index = Math.max(1, Number(value(1)) || 1) - 1;
    return text(0).split(delimiter).filter(Boolean)[index] || "";
  }
  if (compactName === "\u0427\u0418\u0421\u041b\u041e\u0412\u041f\u0420\u041e\u041f\u0418\u0421\u042c") {
    return numberToRussianWords(Number(String(text(0)).replace(/\s+/g, "").replace(",", ".")) || 0);
  }
  if (upperName === "СКЛОНЕНИЕ_ФИО") {
    const grammaticalCase = text(1).toUpperCase();
    const mode = text(2).toUpperCase();
    if (mode === "ИО") {
      const parts = splitFullName(text(0));
      return [parts.firstName, parts.patronymic].filter(Boolean).join(" ");
    }
    if (grammaticalCase === "И") return text(0);
    if (grammaticalCase === "Д") return inflectFioDative(text(0));
    return inflectFioGenitive(text(0));
  }
  return `${name}(${args.map((arg) => formulaValueToString(evaluateDocumentFormulaExpression(arg, context))).join(";")})`;
}

function formatDocumentFormulaDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (ru) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

function numberToRussianWords(value) {
  const number = Math.abs(Math.trunc(Number(value) || 0));
  if (!number) return "ноль";
  const units = [
    { forms: ["", "", ""], gender: "male" },
    { forms: ["тысяча", "тысячи", "тысяч"], gender: "female" },
    { forms: ["миллион", "миллиона", "миллионов"], gender: "male" },
    { forms: ["миллиард", "миллиарда", "миллиардов"], gender: "male" }
  ];
  const parts = [];
  let rest = number;
  let unitIndex = 0;
  while (rest > 0 && unitIndex < units.length) {
    const chunk = rest % 1000;
    if (chunk) parts.unshift(formatRussianNumberChunk(chunk, units[unitIndex]));
    rest = Math.floor(rest / 1000);
    unitIndex += 1;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function formatRussianNumberChunk(value, unit) {
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const onesMale = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const onesFemale = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const result = [];
  const h = Math.floor(value / 100);
  const t = Math.floor((value % 100) / 10);
  const o = value % 10;
  if (hundreds[h]) result.push(hundreds[h]);
  if (t === 1) result.push(teens[o]);
  else {
    if (tens[t]) result.push(tens[t]);
    const ones = unit.gender === "female" ? onesFemale : onesMale;
    if (ones[o]) result.push(ones[o]);
  }
  if (unit.forms[0]) result.push(unit.forms[getRussianPluralIndex(value)]);
  return result.join(" ");
}

function getRussianPluralIndex(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

function splitFullName(name) {
  const [surname = "", firstName = "", patronymic = ""] = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { surname, firstName, patronymic };
}

function inferGenderFromFio(name) {
  const { patronymic, firstName } = splitFullName(name);
  if (/вна$/i.test(patronymic) || /[ая]$/i.test(firstName)) return "female";
  return "male";
}

function inflectFioGenitive(name) {
  const gender = inferGenderFromFio(name);
  const parts = splitFullName(name);
  return [
    inflectRussianNamePart(parts.surname, gender, "surname"),
    inflectRussianNamePart(parts.firstName, gender, "firstName"),
    inflectRussianNamePart(parts.patronymic, gender, "patronymic")
  ].filter(Boolean).join(" ");
}

function inflectFioDative(name) {
  const gender = inferGenderFromFio(name);
  const parts = splitFullName(name);
  return [
    inflectRussianNamePartDative(parts.surname, gender, "surname"),
    inflectRussianNamePartDative(parts.firstName, gender, "firstName"),
    inflectRussianNamePartDative(parts.patronymic, gender, "patronymic")
  ].filter(Boolean).join(" ");
}

function inflectRussianNamePart(value, gender, role) {
  if (!value) return "";
  return String(value).split("-").map((part) => inflectRussianSimpleNamePart(part, gender, role)).join("-");
}

function inflectRussianNamePartDative(value, gender, role) {
  if (!value) return "";
  return String(value).split("-").map((part) => inflectRussianSimpleNamePartDative(part, gender, role)).join("-");
}

function inflectRussianSimpleNamePart(value, gender, role) {
  const lower = value.toLowerCase();
  const replaceEnding = (pattern, ending) => value.replace(pattern, ending);
  if (gender === "female") {
    if (role === "patronymic" && /(?:вна|ична)$/i.test(value)) return value.replace(/а$/i, "ы");
    if (/(ская|цкая)$/i.test(value)) return replaceEnding(/ая$/i, "ой");
    if (/(ая|яя)$/i.test(value)) return replaceEnding(/[ая]$/i, "ой");
    if (/(ова|ева|ёва|ина)$/i.test(value)) return replaceEnding(/а$/i, "ой");
    if (/ия$/i.test(value)) return replaceEnding(/ия$/i, "ии");
    if (/я$/i.test(value)) return replaceEnding(/я$/i, "и");
    if (/а$/i.test(value)) return replaceEnding(/а$/i, /[гкхжчшщ]а$/i.test(lower) ? "и" : "ы");
    return value;
  }
  if (role === "patronymic" && /ич$/i.test(value)) return `${value}а`;
  if (/(ский|цкий)$/i.test(value)) return value.replace(/ий$/i, "ого");
  if (/(ый|ой)$/i.test(value)) return value.replace(/[ыо]й$/i, "ого");
  if (/ий$/i.test(value)) return value.replace(/ий$/i, "ия");
  if (/[йь]$/i.test(value)) return value.replace(/[йь]$/i, "я");
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(value)) return `${value}а`;
  return value;
}

function inflectRussianSimpleNamePartDative(value, gender, role) {
  if (!value) return "";
  const lower = value.toLowerCase();
  const replaceEnding = (pattern, ending) => value.replace(pattern, ending);
  if (gender === "female") {
    if (role === "patronymic" && /(?:вна|ична)$/i.test(value)) return value.replace(/а$/i, "е");
    if (/(ская|цкая)$/i.test(value)) return replaceEnding(/ая$/i, "ой");
    if (/яя$/i.test(value)) return replaceEnding(/яя$/i, "ей");
    if (/ая$/i.test(value)) return replaceEnding(/ая$/i, "ой");
    if (/(ова|ева|ёва|ина)$/i.test(value)) return replaceEnding(/а$/i, "ой");
    if (/ия$/i.test(value)) return replaceEnding(/ия$/i, "ии");
    if (/[ая]$/i.test(value)) return replaceEnding(/[ая]$/i, "е");
    return value;
  }
  if (role === "patronymic" && /ич$/i.test(value)) return `${value}у`;
  if (/(ский|цкий)$/i.test(value)) return value.replace(/ий$/i, "ому");
  if (/(ый|ой)$/i.test(value)) return value.replace(/[ыо]й$/i, "ому");
  if (/ий$/i.test(value)) return value.replace(/ий$/i, "ию");
  if (/[йь]$/i.test(value)) return value.replace(/[йь]$/i, "ю");
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(lower)) return `${value}у`;
  return value;
}

function applyCustomDocumentPropertyFormulas(templateBytes, fieldValues, sourceValues) {
  const entries = readDocxZipEntries(templateBytes);
  const values = { ...(fieldValues || {}) };
  const context = { fieldValues: values, sourceValues: sourceValues || {} };
  orderDocumentFormulaProperties(getDocumentFormulaPropertiesFromEntries(entries)).forEach((property) => {
    context.evaluatingName = property.name;
    if (isGetSqlQueryFormula(property.value)) {
      const existingValue = getFormulaContextValue(property.name, context) || values[property.name] || "";
      values[property.name] = property.name === "УчебныйПлан"
        ? (getFormulaContextValue("УчебныйПлан", context) || existingValue || "")
        : existingValue;
      context.evaluatingName = "";
      return;
    }
    const evaluatedValue = evaluateDocumentFormula(property.value, context);
    values[property.name] = evaluatedValue;
    context.evaluatingName = "";
  });
  return values;
}

function getIndexedWordFieldPositionMap(entries) {
  const positionMap = new Map();
  getDocumentFormulaPropertiesFromEntries(entries).forEach((property) => {
    const fieldNumber = Number(property.fieldNumber);
    if (Number.isFinite(fieldNumber) && fieldNumber > 0 && property.name) {
      positionMap.set(String(fieldNumber), property.name);
    }
    const position = Number(property.position);
    if (Number.isFinite(position) && position > 0 && property.name && !positionMap.has(String(position))) {
      positionMap.set(String(position), property.name);
    }
  });
  return positionMap;
}

function normalizeExpulsionOrderFieldPositionMap(fieldPositionMap, fieldValues) {
  const values = fieldValues || {};
  const hasExpulsionOrderLists = Object.prototype.hasOwnProperty.call(values, "СписокСвыдачей")
    || Object.prototype.hasOwnProperty.call(values, "СписокБезВыдачи");
  if (!hasExpulsionOrderLists || !fieldPositionMap?.size) return fieldPositionMap;
  const mappedNames = new Set(fieldPositionMap.values());
  if (mappedNames.has("СписокСвыдачей")) return fieldPositionMap;
  const hasKnownAssistantShift = fieldPositionMap.get("6") === "N3"
    && fieldPositionMap.get("7") === "СписокБезВыдачи"
    && fieldPositionMap.get("9") === "N3";
  if (!hasKnownAssistantShift) return fieldPositionMap;
  const normalizedMap = new Map(fieldPositionMap);
  normalizedMap.set("6", "СписокСвыдачей");
  return normalizedMap;
}

function buildWordTextRuns(value) {
  return String(value ?? "").split(/\r\n|\r|\n/).map((line, index) => (
    `${index ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r>`
  )).join("");
}

function replaceWordFieldResultXml(resultXml, value) {
  if (/\r|\n/.test(String(value ?? ""))) return buildWordTextRuns(value);
  const escapedValue = escapeXmlText(value);
  let replaced = false;
  const nextXml = String(resultXml || "").replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
    if (!replaced) {
      replaced = true;
      return `<w:t xml:space="preserve">${escapedValue}</w:t>`;
    }
    return "<w:t></w:t>";
  });
  if (replaced) return nextXml;
  return `<w:r><w:t xml:space="preserve">${escapedValue}</w:t></w:r>`;
}

function parseIndexedWordFieldInstruction(instruction) {
  const text = decodeXmlText(instruction).replace(/\s+/g, " ").trim();
  const match = /\b(SUBJECT|SEQ(?:UENCE)?)\s+"([^"]*)"[\s\S]*?(?:[\\\/]\s*|\\r\s+)(\d+)/i.exec(text);
  if (!match) return null;
  const position = Number(match[3]);
  if (!Number.isFinite(position) || position <= 0) return null;
  return {
    type: /^SUBJECT$/i.test(match[1]) ? "subject" : "sequence",
    value: match[2],
    position
  };
}

function getComplexWordFieldInstruction(fieldStartXml) {
  return [...String(fieldStartXml || "").matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function updateSubjectFieldInstruction(startXml, value) {
  const escapedInstructionValue = escapeXmlText(String(value ?? "").replace(/\r\n|\r|\n/g, " "));
  return String(startXml || "").replace(
    /(SUBJECT\s+)"[^"<]*"([\s\S]*?(?:[\\\/]\s*|\\r\s+)\d+)/i,
    `$1"${escapedInstructionValue}"$2`
  );
}

const ORDER_LIST_DOCUMENT_FIELDS = new Set([
  "\u0421\u043f\u0438\u0441\u043e\u043a",
  "\u0421\u043f\u0438\u0441\u043e\u043a\u0421\u0432\u044b\u0434\u0430\u0447\u0435\u0439",
  "\u0421\u043f\u0438\u0441\u043e\u043a\u0411\u0435\u0437\u0412\u044b\u0434\u0430\u0447\u0438"
]);
const EDUCATION_TRAINING_PLAN_FIELD = "\u0423\u0447\u0435\u0431\u043d\u044b\u0439\u041f\u043b\u0430\u043d";

function shouldRenderDocumentFieldAsParagraphs(fieldName, value) {
  return ORDER_LIST_DOCUMENT_FIELDS.has(String(fieldName || "").trim()) && /\r|\n/.test(String(value ?? ""));
}

function splitDocumentFieldParagraphLines(value) {
  return String(value ?? "").split(/\r\n|\r|\n/);
}

function splitEducationTrainingPlanLines(value) {
  return String(value ?? "").split(/\r\n|\r|\n|\u000b/);
}

function parseEducationTrainingPlanTableRows(value) {
  return splitEducationTrainingPlanLines(value)
    .map((line, index) => {
      const parts = String(line || "").split("\t").map((part) => part.trim());
      if (!parts.some(Boolean)) return null;
      const hasExplicitNumber = parts.length >= 4 && /^\d+[.)]?$/.test(parts[0] || "");
      return {
        number: hasExplicitNumber ? parts[0].replace(/[.)]$/, "") : String(index + 1),
        discipline: hasExplicitNumber ? parts[1] || "" : parts[0] || "",
        hours: hasExplicitNumber ? parts[2] || "" : parts[1] || "",
        grade: hasExplicitNumber ? parts.slice(3).join(" ").trim() : parts.slice(2).join(" ").trim()
      };
    })
    .filter((row) => row && (row.discipline || row.hours || row.grade));
}

function isEmptyDocumentFieldValue(value) {
  return !String(value ?? "").trim();
}

function getWordParagraphText(paragraphXml) {
  return [...String(paragraphXml || "").matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join("");
}

function paragraphHasIndexedDocumentField(paragraphXml, fieldName, fieldPositionMap) {
  if (!fieldPositionMap?.size) return false;
  const targetName = String(fieldName || "").trim();
  if (!targetName) return false;
  const complexFieldPattern = /<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>([\s\S]*?)<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>/g;
  for (const match of String(paragraphXml || "").matchAll(complexFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(match[1] || ""));
    if (indexedField && fieldPositionMap.get(String(indexedField.position)) === targetName) return true;
  }
  const simpleFieldPattern = /<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>/g;
  for (const match of String(paragraphXml || "").matchAll(simpleFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(match[1] || "");
    if (indexedField && fieldPositionMap.get(String(indexedField.position)) === targetName) return true;
  }
  return false;
}

function paragraphHasDocumentField(paragraphXml, fieldName, fieldPositionMap) {
  const targetName = String(fieldName || "").trim();
  if (!targetName) return false;
  return getWordParagraphText(paragraphXml).includes(`#${targetName}#`)
    || paragraphHasIndexedDocumentField(paragraphXml, targetName, fieldPositionMap);
}

function getWordParagraphNormalizedText(paragraphXml) {
  return getWordParagraphText(paragraphXml).replace(/\s+/g, " ").trim().toLowerCase();
}

function findWordParagraphIndex(paragraphs, predicate) {
  return paragraphs.findIndex((match, index) => predicate(match[0], index));
}

function addWordParagraphRangeRemoval(removeIndexes, startIndex, endIndex) {
  const hasStart = Number.isInteger(startIndex) && startIndex >= 0;
  const hasEnd = Number.isInteger(endIndex) && endIndex >= 0;
  if (hasStart && hasEnd && startIndex <= endIndex) {
    for (let index = startIndex; index <= endIndex; index += 1) removeIndexes.add(index);
    return;
  }
  if (hasStart) removeIndexes.add(startIndex);
  if (hasEnd) removeIndexes.add(endIndex);
}

function addWordParagraphRange(set, startIndex, endIndex) {
  const hasStart = Number.isInteger(startIndex) && startIndex >= 0;
  const hasEnd = Number.isInteger(endIndex) && endIndex >= 0;
  if (hasStart && hasEnd && startIndex <= endIndex) {
    for (let index = startIndex; index <= endIndex; index += 1) set.add(index);
    return;
  }
  if (hasStart) set.add(startIndex);
  if (hasEnd) set.add(endIndex);
}

function findWordFieldEndParagraphIndex(paragraphs, startIndex) {
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= paragraphs.length) return -1;
  for (let index = startIndex; index < paragraphs.length; index += 1) {
    if (/<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>/.test(paragraphs[index][0])) return index;
  }
  return startIndex;
}

function setWordHiddenFalse(xml) {
  return String(xml || "")
    .replace(/<w:vanish\b[^>]*\/>/g, '<w:vanish w:val="false"/>')
    .replace(/<w:vanish\b[^>]*>[\s\S]*?<\/w:vanish>/g, '<w:vanish w:val="false"/>');
}

function applyExpulsionOrderConditionalBlocks(xml, fieldValues, fieldPositionMap) {
  const values = fieldValues || {};
  const hasExpulsionOrderFields = Object.prototype.hasOwnProperty.call(values, "СписокСвыдачей")
    || Object.prototype.hasOwnProperty.call(values, "СписокБезВыдачи");
  if (!hasExpulsionOrderFields) return xml;
  const hasIssuedList = !isEmptyDocumentFieldValue(values["СписокСвыдачей"]);
  const hasWithoutIssueList = !isEmptyDocumentFieldValue(values["СписокБезВыдачи"]);
  const paragraphs = [...String(xml || "").matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  if (!paragraphs.length) return xml;
  const removeIndexes = new Set();
  const revealIndexes = new Set();
  const issuedHeaderIndex = findWordParagraphIndex(paragraphs, (paragraphXml) => {
    const text = getWordParagraphNormalizedText(paragraphXml);
    return text.includes("с выдачей") && !text.includes("без выдачи") && text.includes("документа об образовании");
  });
  const issuedListIndex = findWordParagraphIndex(paragraphs, (paragraphXml) => (
    paragraphHasDocumentField(paragraphXml, "СписокСвыдачей", fieldPositionMap)
  ));
  const issuedListEndIndex = findWordFieldEndParagraphIndex(paragraphs, issuedListIndex);
  const withoutIssueHeaderIndex = findWordParagraphIndex(paragraphs, (paragraphXml) => {
    const text = getWordParagraphNormalizedText(paragraphXml);
    return paragraphHasDocumentField(paragraphXml, "N2", fieldPositionMap)
      || (text.includes("без выдачи") && text.includes("документа об образовании"));
  });
  const withoutIssueListIndex = findWordParagraphIndex(paragraphs, (paragraphXml) => (
    paragraphHasDocumentField(paragraphXml, "СписокБезВыдачи", fieldPositionMap)
  ));
  const withoutIssueListEndIndex = findWordFieldEndParagraphIndex(paragraphs, withoutIssueListIndex);
  if (!hasIssuedList) addWordParagraphRangeRemoval(removeIndexes, issuedHeaderIndex, issuedListEndIndex);
  if (!hasWithoutIssueList) addWordParagraphRangeRemoval(removeIndexes, withoutIssueHeaderIndex, withoutIssueListEndIndex);
  if (hasIssuedList) addWordParagraphRange(revealIndexes, issuedHeaderIndex, issuedListEndIndex);
  if (hasWithoutIssueList) addWordParagraphRange(revealIndexes, withoutIssueHeaderIndex, withoutIssueListEndIndex);
  if (!removeIndexes.size && !revealIndexes.size) return xml;
  let cursor = 0;
  let result = "";
  paragraphs.forEach((match, index) => {
    result += String(xml || "").slice(cursor, match.index);
    if (!removeIndexes.has(index)) {
      result += revealIndexes.has(index) ? setWordHiddenFalse(match[0]) : match[0];
    }
    cursor = match.index + match[0].length;
  });
  return result + String(xml || "").slice(cursor);
}

function getWordParagraphPropertiesXml(paragraphXml) {
  return /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(String(paragraphXml || ""))?.[0] || "";
}

function getWordParagraphOpenTag(paragraphXml) {
  return /^<w:p\b[^>]*>/.exec(String(paragraphXml || ""))?.[0] || "<w:p>";
}

function getWordClonedParagraphOpenTag(paragraphXml) {
  return getWordParagraphOpenTag(paragraphXml)
    .replace(/\s+w14:paraId="[^"]*"/g, "")
    .replace(/\s+w14:textId="[^"]*"/g, "");
}

function getWordParagraphInnerXml(paragraphXml) {
  const text = String(paragraphXml || "");
  const openTag = getWordParagraphOpenTag(text);
  return text.endsWith("</w:p>")
    ? text.slice(openTag.length, -"</w:p>".length)
    : text.slice(openTag.length);
}

function getWordMarkerRunPropertiesXml(paragraphXml, marker) {
  const text = String(paragraphXml || "");
  const markerIndex = marker ? text.indexOf(marker) : -1;
  const runStart = markerIndex >= 0 ? text.lastIndexOf("<w:r", markerIndex) : text.indexOf("<w:r");
  const runEnd = runStart >= 0 ? text.indexOf("</w:r>", Math.max(markerIndex, runStart)) : -1;
  const runXml = runStart >= 0 && runEnd >= 0 ? text.slice(runStart, runEnd + "</w:r>".length) : text;
  return /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(runXml)?.[0]
    || /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(text)?.[0]
    || "";
}

function buildWordRunFromLine(sourceParagraphXml, line, marker = "") {
  const runProperties = getWordMarkerRunPropertiesXml(sourceParagraphXml, marker);
  return `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r>`;
}

function buildWordParagraphFromLine(sourceParagraphXml, line, marker = "") {
  const openTag = getWordClonedParagraphOpenTag(sourceParagraphXml);
  const paragraphProperties = getWordParagraphPropertiesXml(sourceParagraphXml);
  return `${openTag}${paragraphProperties}${buildWordRunFromLine(sourceParagraphXml, line, marker)}</w:p>`;
}

function splitWordTableRowCells(rowXml) {
  return [...String(rowXml || "").matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
    .map((match) => ({ xml: match[0], index: match.index }));
}

function getWordTableCellOpenTag(cellXml) {
  return /^<w:tc\b[^>]*>/.exec(String(cellXml || ""))?.[0] || "<w:tc>";
}

function getWordTableCellPropertiesXml(cellXml) {
  return /<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(String(cellXml || ""))?.[0] || "";
}

function getWordTableCellFirstParagraphXml(cellXml) {
  return /<w:p\b[\s\S]*?<\/w:p>/.exec(String(cellXml || ""))?.[0] || "<w:p></w:p>";
}

function buildWordTableCellValueXml(cellXml, value) {
  const openTag = getWordTableCellOpenTag(cellXml);
  const cellProperties = getWordTableCellPropertiesXml(cellXml);
  const sourceParagraphXml = getWordTableCellFirstParagraphXml(cellXml);
  const lines = splitDocumentFieldParagraphLines(value);
  const paragraphsXml = (lines.length ? lines : [""])
    .map((line) => buildWordParagraphFromLine(sourceParagraphXml, line))
    .join("");
  return `${openTag}${cellProperties}${paragraphsXml}</w:tc>`;
}

function replaceWordTableRowCells(rowXml, nextCells) {
  const cells = splitWordTableRowCells(rowXml);
  if (!cells.length) return rowXml;
  let cursor = 0;
  let result = "";
  cells.forEach((cell, index) => {
    result += String(rowXml || "").slice(cursor, cell.index);
    result += nextCells[index] || cell.xml;
    cursor = cell.index + cell.xml.length;
  });
  return result + String(rowXml || "").slice(cursor);
}

function getEducationTrainingPlanFieldCellIndex(cells, fieldPositionMap) {
  return cells.findIndex((cell) => paragraphHasDocumentField(
    cell.xml,
    EDUCATION_TRAINING_PLAN_FIELD,
    fieldPositionMap
  ));
}

function buildEducationTrainingPlanTableRow(rowXml, row, rowIndex, fieldCellIndex) {
  const cells = splitWordTableRowCells(rowXml);
  if (!cells.length) return rowXml;
  const disciplineIndex = fieldCellIndex >= 0 ? fieldCellIndex : (cells.length >= 4 ? 1 : 0);
  const numberIndex = disciplineIndex > 0 ? disciplineIndex - 1 : -1;
  const hoursIndex = disciplineIndex + 1 < cells.length ? disciplineIndex + 1 : -1;
  const gradeIndex = disciplineIndex + 2 < cells.length ? disciplineIndex + 2 : -1;
  const cellValues = new Map();
  if (numberIndex >= 0) {
    cellValues.set(numberIndex, /<w:numPr\b/.test(cells[numberIndex].xml) ? "" : row.number || String(rowIndex + 1));
  }
  cellValues.set(disciplineIndex, row.discipline || "");
  if (hoursIndex >= 0) cellValues.set(hoursIndex, row.hours || "");
  if (gradeIndex >= 0) cellValues.set(gradeIndex, row.grade || "");
  const nextCells = cells.map((cell, index) => (
    cellValues.has(index) ? buildWordTableCellValueXml(cell.xml, cellValues.get(index)) : cell.xml
  ));
  return replaceWordTableRowCells(rowXml, nextCells);
}

function applyEducationTrainingPlanTableRows(xml, fieldValues, fieldPositionMap) {
  const value = fieldValues?.[EDUCATION_TRAINING_PLAN_FIELD];
  const rows = parseEducationTrainingPlanTableRows(value);
  if (!rows.length) return xml;
  const sourceXml = String(xml || "");
  const tableRows = [...sourceXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)];
  if (!tableRows.length) return sourceXml;
  let cursor = 0;
  let result = "";
  let changed = false;
  for (let index = 0; index < tableRows.length; index += 1) {
    const match = tableRows[index];
    const rowXml = match[0];
    const cells = splitWordTableRowCells(rowXml);
    if (cells.length < 2) continue;
    const fieldCellIndex = getEducationTrainingPlanFieldCellIndex(cells, fieldPositionMap);
    if (fieldCellIndex < 0) continue;
    result += sourceXml.slice(cursor, match.index);
    result += rows.map((row, rowIndex) => (
      buildEducationTrainingPlanTableRow(rowXml, row, rowIndex, fieldCellIndex)
    )).join("");
    let lastDataRowIndex = index;
    for (let nextIndex = index + 1; nextIndex < tableRows.length; nextIndex += 1) {
      const previousMatch = tableRows[nextIndex - 1];
      const nextMatch = tableRows[nextIndex];
      const betweenRows = sourceXml.slice(
        previousMatch.index + previousMatch[0].length,
        nextMatch.index
      );
      if (/<\/?w:tbl\b/.test(betweenRows)) break;
      if (splitWordTableRowCells(nextMatch[0]).length !== cells.length) break;
      lastDataRowIndex = nextIndex;
    }
    const lastDataRow = tableRows[lastDataRowIndex];
    cursor = lastDataRow.index + lastDataRow[0].length;
    index = lastDataRowIndex;
    changed = true;
  }
  return changed ? result + sourceXml.slice(cursor) : sourceXml;
}

function trimDanglingWordRunStartXml(xml) {
  const text = String(xml || "");
  const runStarts = [...text.matchAll(/<w:r\b[^>]*>/g)];
  const lastRunStart = runStarts.length ? runStarts[runStarts.length - 1].index : -1;
  const lastRunEnd = text.lastIndexOf("</w:r>");
  if (lastRunStart > lastRunEnd) return text.slice(0, lastRunStart);
  return text;
}

function trimLeadingWordRunCloseXml(xml) {
  return String(xml || "").replace(/^\s*<\/w:r>/, "");
}

function buildComplexFieldParagraphsFromLines({
  sourceParagraphXml,
  beforeInner,
  startXml,
  resultXml,
  endXml,
  afterInner,
  lines,
  marker = "",
  spanFieldAcrossParagraphs = true
}) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const openTag = getWordParagraphOpenTag(sourceParagraphXml);
  const clonedOpenTag = getWordClonedParagraphOpenTag(sourceParagraphXml);
  const paragraphProperties = getWordParagraphPropertiesXml(sourceParagraphXml);
  const instruction = getComplexWordFieldInstruction(startXml);
  const beforeFieldXml = trimDanglingWordRunStartXml(beforeInner);
  const afterFieldXml = trimLeadingWordRunCloseXml(afterInner);
  const fieldEndXml = `<w:r><w:fldChar w:fldCharType="end"/></w:r>${afterFieldXml}`;
  if (lines.length === 1) {
    return `${openTag}${beforeFieldXml}${buildComplexFieldStartXmlFromInstruction(instruction)}${buildWordRunFromLine(sourceParagraphXml, lines[0], marker)}${fieldEndXml}</w:p>`;
  }
  if (!spanFieldAcrossParagraphs) {
    const firstParagraphXml = `${openTag}${beforeFieldXml}${buildComplexFieldStartXmlFromInstruction(instruction)}${buildWordRunFromLine(sourceParagraphXml, lines[0], marker)}${fieldEndXml}</w:p>`;
    const restParagraphsXml = lines
      .slice(1)
      .map((line) => `${clonedOpenTag}${paragraphProperties}${buildWordRunFromLine(sourceParagraphXml, line, marker)}</w:p>`)
      .join("");
    return `${firstParagraphXml}${restParagraphsXml}`;
  }
  const firstParagraphXml = `${openTag}${beforeFieldXml}${buildComplexFieldStartXmlFromInstruction(instruction)}${buildWordRunFromLine(sourceParagraphXml, lines[0], marker)}</w:p>`;
  const restParagraphsXml = lines
    .slice(1)
    .map((line, index, restLines) => {
      const isLastLine = index === restLines.length - 1;
      return `${clonedOpenTag}${paragraphProperties}${buildWordRunFromLine(sourceParagraphXml, line, marker)}${isLastLine ? fieldEndXml : ""}</w:p>`;
    })
    .join("");
  return `${firstParagraphXml}${restParagraphsXml}`;
}

function buildComplexFieldStartXmlFromInstruction(instruction) {
  const instructionText = escapeXmlText(decodeXmlText(instruction).replace(/\r\n|\r|\n/g, " "));
  return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instructionText}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
}

function buildComplexFieldParagraphsFromSimpleField({
  sourceParagraphXml,
  beforeInner,
  encodedInstruction,
  resultXml,
  afterInner,
  lines,
  marker = "",
  spanFieldAcrossParagraphs = true
}) {
  const startXml = buildComplexFieldStartXmlFromInstruction(encodedInstruction);
  const endXml = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  return buildComplexFieldParagraphsFromLines({
    sourceParagraphXml,
    beforeInner,
    startXml,
    resultXml,
    endXml,
    afterInner,
    lines,
    marker,
    spanFieldAcrossParagraphs
  });
}

function replaceTextMarkerInsideWordFieldWithParagraphs(paragraphXml, marker, lines) {
  const innerXml = getWordParagraphInnerXml(paragraphXml);
  const complexFieldPattern = /(<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>)([\s\S]*?)(<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>)/g;
  for (const match of innerXml.matchAll(complexFieldPattern)) {
    if (!String(match[2] || "").includes(marker)) continue;
    return buildComplexFieldParagraphsFromLines({
      sourceParagraphXml: paragraphXml,
      beforeInner: innerXml.slice(0, match.index),
      startXml: match[1],
      resultXml: match[2],
      endXml: match[3],
      afterInner: innerXml.slice(match.index + match[0].length),
      lines,
      marker,
      spanFieldAcrossParagraphs: true
    });
  }
  const simpleFieldPattern = /(<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>)([\s\S]*?)(<\/w:fldSimple>)/g;
  for (const match of innerXml.matchAll(simpleFieldPattern)) {
    if (!String(match[3] || "").includes(marker)) continue;
    return buildComplexFieldParagraphsFromSimpleField({
      sourceParagraphXml: paragraphXml,
      beforeInner: innerXml.slice(0, match.index),
      encodedInstruction: match[2],
      resultXml: match[3],
      afterInner: innerXml.slice(match.index + match[0].length),
      lines,
      marker,
      spanFieldAcrossParagraphs: true
    });
  }
  return null;
}

function replaceTextMarkerWithParagraphs(xml, marker, value) {
  const lines = splitDocumentFieldParagraphLines(value);
  if (lines.length < 2) return String(xml || "").split(marker).join(escapeXmlText(value));
  let replaced = false;
  const nextXml = String(xml || "").replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    if (!paragraphXml.includes(marker)) return paragraphXml;
    replaced = true;
    const fieldParagraphXml = replaceTextMarkerInsideWordFieldWithParagraphs(paragraphXml, marker, lines);
    if (fieldParagraphXml) return fieldParagraphXml;
    const firstParagraphXml = paragraphXml.split(marker).join(escapeXmlText(lines[0]));
    const restParagraphsXml = lines
      .slice(1)
      .map((line) => buildWordParagraphFromLine(paragraphXml, line, marker))
      .join("");
    return `${firstParagraphXml}${restParagraphsXml}`;
  });
  if (replaced) return nextXml;
  return String(xml || "").split(marker).join(lines.map((line) => escapeXmlText(line)).join("&#10;"));
}

function replaceIndexedWordFieldInsideParagraphWithParagraphs(paragraphXml, fieldValues, fieldPositionMap) {
  const innerXml = getWordParagraphInnerXml(paragraphXml);
  const complexFieldPattern = /(<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>)([\s\S]*?)(<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>)/g;
  for (const match of innerXml.matchAll(complexFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(match[1]));
    if (!indexedField) continue;
    const fieldName = fieldPositionMap.get(String(indexedField.position));
    if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) continue;
    const value = fieldValues[fieldName];
    if (!shouldRenderDocumentFieldAsParagraphs(fieldName, value)) continue;
    const lines = splitDocumentFieldParagraphLines(value);
    const isOrderListField = ORDER_LIST_DOCUMENT_FIELDS.has(String(fieldName || "").trim());
    if (isOrderListField && getWordParagraphText(match[2]).trim() === String(lines[0] || "").trim()) continue;
    const startXml = indexedField.type === "subject"
      ? updateSubjectFieldInstruction(match[1], lines[0])
      : match[1];
    return buildComplexFieldParagraphsFromLines({
      sourceParagraphXml: paragraphXml,
      beforeInner: innerXml.slice(0, match.index),
      startXml,
      resultXml: match[2],
      endXml: match[3],
      afterInner: innerXml.slice(match.index + match[0].length),
      lines,
      spanFieldAcrossParagraphs: true
    });
  }
  const simpleFieldPattern = /(<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>)([\s\S]*?)(<\/w:fldSimple>)/g;
  for (const match of innerXml.matchAll(simpleFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(match[2] || "");
    if (!indexedField) continue;
    const fieldName = fieldPositionMap.get(String(indexedField.position));
    if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) continue;
    const value = fieldValues[fieldName];
    if (!shouldRenderDocumentFieldAsParagraphs(fieldName, value)) continue;
    const lines = splitDocumentFieldParagraphLines(value);
    const isOrderListField = ORDER_LIST_DOCUMENT_FIELDS.has(String(fieldName || "").trim());
    if (isOrderListField && getWordParagraphText(match[3]).trim() === String(lines[0] || "").trim()) continue;
    return buildComplexFieldParagraphsFromSimpleField({
      sourceParagraphXml: paragraphXml,
      beforeInner: innerXml.slice(0, match.index),
      encodedInstruction: match[2],
      resultXml: match[3],
      afterInner: innerXml.slice(match.index + match[0].length),
      lines,
      spanFieldAcrossParagraphs: true
    });
  }
  return null;
}

function applyIndexedWordFieldParagraphValues(xml, fieldValues, fieldPositionMap) {
  return String(xml || "").replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    return replaceIndexedWordFieldInsideParagraphWithParagraphs(paragraphXml, fieldValues, fieldPositionMap)
      || paragraphXml;
  });
}

function replaceIndexedComplexFieldAcrossParagraphs(paragraphs, startIndex, fieldValues, fieldPositionMap) {
  const sourceParagraphXml = paragraphs[startIndex]?.[0] || "";
  const innerXml = getWordParagraphInnerXml(sourceParagraphXml);
  const startPattern = /(<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>)/g;
  for (const startMatch of innerXml.matchAll(startPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(startMatch[1]));
    if (!indexedField) continue;
    const fieldName = fieldPositionMap.get(String(indexedField.position));
    if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) continue;
    if (!ORDER_LIST_DOCUMENT_FIELDS.has(String(fieldName || "").trim())) continue;
    const value = fieldValues[fieldName];
    const lines = splitDocumentFieldParagraphLines(value).filter((line) => String(line || "").trim());
    if (!lines.length) continue;
    const sameParagraphEndMatch = /<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>/.exec(innerXml.slice(startMatch.index + startMatch[0].length));
    if (sameParagraphEndMatch) continue;
    for (let endIndex = startIndex + 1; endIndex < paragraphs.length; endIndex += 1) {
      const endInnerXml = getWordParagraphInnerXml(paragraphs[endIndex][0]);
      const endMatch = /<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>/.exec(endInnerXml);
      if (!endMatch) continue;
      return {
        endIndex,
        xml: buildComplexFieldParagraphsFromLines({
          sourceParagraphXml,
          beforeInner: innerXml.slice(0, startMatch.index),
          startXml: indexedField.type === "subject"
            ? updateSubjectFieldInstruction(startMatch[1], lines[0])
            : startMatch[1],
          resultXml: "",
          endXml: endMatch[0],
          afterInner: endInnerXml.slice(endMatch.index + endMatch[0].length),
          lines,
          spanFieldAcrossParagraphs: true
        })
      };
    }
  }
  return null;
}

function applyIndexedComplexFieldParagraphValues(xml, fieldValues, fieldPositionMap) {
  const sourceXml = String(xml || "");
  const paragraphs = [...sourceXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  if (!paragraphs.length) return sourceXml;
  let cursor = 0;
  let result = "";
  for (let index = 0; index < paragraphs.length; index += 1) {
    const match = paragraphs[index];
    result += sourceXml.slice(cursor, match.index);
    const replacement = replaceIndexedComplexFieldAcrossParagraphs(paragraphs, index, fieldValues, fieldPositionMap);
    if (replacement?.xml) {
      result += replacement.xml;
      const endMatch = paragraphs[replacement.endIndex];
      cursor = endMatch.index + endMatch[0].length;
      index = replacement.endIndex;
    } else {
      result += match[0];
      cursor = match.index + match[0].length;
    }
  }
  return result + sourceXml.slice(cursor);
}

function applyIndexedComplexFieldValues(xml, fieldValues, fieldPositionMap) {
  return String(xml || "").replace(
    /(<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>)([\s\S]*?)(<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>)/g,
    (match, startXml, resultXml, endXml) => {
      const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(startXml));
      if (!indexedField) return match;
      const fieldName = fieldPositionMap.get(String(indexedField.position));
      if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) return match;
      const value = fieldValues[fieldName];
      if (shouldRenderDocumentFieldAsParagraphs(fieldName, value)) return match;
      const nextStartXml = indexedField.type === "subject"
        ? updateSubjectFieldInstruction(startXml, value)
        : startXml;
      return `${nextStartXml}${replaceWordFieldResultXml(resultXml, value)}${endXml}`;
    }
  );
}

function applyIndexedSimpleFieldValues(xml, fieldValues, fieldPositionMap) {
  return String(xml || "").replace(
    /(<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>)([\s\S]*?)(<\/w:fldSimple>)/g,
    (match, startXml, encodedInstruction, resultXml, endXml) => {
      const indexedField = parseIndexedWordFieldInstruction(encodedInstruction);
      if (!indexedField) return match;
      const fieldName = fieldPositionMap.get(String(indexedField.position));
      if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) return match;
      if (shouldRenderDocumentFieldAsParagraphs(fieldName, fieldValues[fieldName])) return match;
      return `${startXml}${replaceWordFieldResultXml(resultXml, fieldValues[fieldName])}${endXml}`;
    }
  );
}

function applyIndexedWordFieldValues(xml, fieldValues, fieldPositionMap) {
  if (!fieldPositionMap?.size) return xml;
  const complexParagraphXml = applyIndexedComplexFieldParagraphValues(xml, fieldValues, fieldPositionMap);
  const paragraphXml = applyIndexedWordFieldParagraphValues(complexParagraphXml, fieldValues, fieldPositionMap);
  return applyIndexedSimpleFieldValues(
    applyIndexedComplexFieldValues(paragraphXml, fieldValues, fieldPositionMap),
    fieldValues,
    fieldPositionMap
  );
}

function updateCustomDocumentProperties(entries, fieldValues, allowedNames = null) {
  const entry = entries.find((item) => item.name === "docProps/custom.xml");
  if (!entry) return;
  const values = fieldValues || {};
  let xml = entry.content.toString("utf8");
  xml = xml.replace(
    /(<property\b[^>]*\bname="([^"]+)"[^>]*>)([\s\S]*?)(<\/property>)/g,
    (match, startXml, encodedName, bodyXml, endXml) => {
      const name = decodeXmlText(encodedName);
      if (allowedNames?.size && !allowedNames.has(name)) return match;
      if (!Object.prototype.hasOwnProperty.call(values, name)) return match;
      const value = escapeXmlText(values[name]);
      const nextBody = /<vt:[^>]+>[\s\S]*?<\/vt:[^>]+>/.test(bodyXml)
        ? bodyXml.replace(/(<vt:[^>]+>)[\s\S]*?(<\/vt:[^>]+>)/, `$1${value}$2`)
        : `<vt:lpwstr>${value}</vt:lpwstr>`;
      return `${startXml}${nextBody}${endXml}`;
    }
  );
  entry.content = Buffer.from(xml, "utf8");
}

function fillDocxMarkers(templateBytes, fieldValues, imageValues = {}, propertyUpdateNames = null) {
  const replacements = Object.entries(fieldValues || {})
    .filter(([name]) => String(name || "").trim())
    .map(([name, value]) => {
      const hasImageValue = Object.prototype.hasOwnProperty.call(imageValues, name);
      return {
        marker: `#${name}#`,
        value: hasImageValue ? "" : value,
        renderAsParagraphs: !hasImageValue && shouldRenderDocumentFieldAsParagraphs(name, value)
      };
    });
  const entries = readDocxZipEntries(templateBytes);
  const indexedFieldPositionMap = normalizeExpulsionOrderFieldPositionMap(
    getIndexedWordFieldPositionMap(entries),
    fieldValues
  );
  updateCustomDocumentProperties(entries, fieldValues, propertyUpdateNames);
  Object.entries(imageValues || {}).forEach(([name, image]) => {
    const indexedImageHandled = applyIndexedDocumentImage(entries, name, image, indexedFieldPositionMap);
    if (!indexedImageHandled && image?.bytes?.length) insertDocumentImage(entries, name, image);
  });
  entries.forEach((entry) => {
    if (!/^word\/.+\.xml$/i.test(entry.name)) return;
    let xml = entry.content.toString("utf8");
    xml = applyExpulsionOrderConditionalBlocks(xml, fieldValues, indexedFieldPositionMap);
    xml = applyEducationTrainingPlanTableRows(xml, fieldValues, indexedFieldPositionMap);
    replacements.forEach(({ marker, value, renderAsParagraphs }) => {
      xml = renderAsParagraphs
        ? replaceTextMarkerWithParagraphs(xml, marker, value)
        : xml.split(marker).join(escapeXmlText(value));
    });
    xml = applyIndexedWordFieldValues(xml, fieldValues, indexedFieldPositionMap);
    entry.content = Buffer.from(xml, "utf8");
  });
  return buildDocxZip(entries);
}

function imageExtensionFromPath(value) {
  const ext = path.extname(String(value || "")).replace(/^\./, "").toLowerCase();
  if (ext === "jpeg") return "jpg";
  return IMAGE_CONTENT_TYPES[ext] ? ext : "";
}

function normalizeSystemDocumentsRelativePath(value) {
  let source = String(value || "").trim().replace(/\\/g, "/");
  if (!source || /^data:|^https?:/i.test(source)) return "";
  source = source.replace(/^[a-z]:\/+/i, "");
  source = source.replace(/^\[-1\]\//i, "");
  const rootMarker = "аис допобразование/";
  const rootIndex = source.toLocaleLowerCase("ru-RU").indexOf(rootMarker);
  if (rootIndex >= 0) source = source.slice(rootIndex + rootMarker.length);
  const parts = source
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) return "";
  return parts.join("/");
}

function usesParentSystemDocumentsFolder(value) {
  return /^\s*\[-1\](?:[\\/]+|$)/u.test(String(value || ""));
}

function resolveYandexDiskBasePath(useParentFolder = false) {
  const parts = normalizeWebDavPath(
    serverSettings.yandexDiskBasePath || DEFAULT_YANDEX_DISK_BASE_PATH
  ).split("/").filter(Boolean);
  if (useParentFolder) parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function resolveYandexDiskSourcePath(source) {
  const normalizedPath = normalizeSystemDocumentsRelativePath(source);
  if (!normalizedPath) return "";
  return normalizeWebDavPath(
    `${resolveYandexDiskBasePath(usesParentSystemDocumentsFolder(source))}/${normalizedPath}`
  );
}

function resolveLocalDocumentsFolder(source) {
  const rootSource = String(
    serverSettings.localDocumentsRoot || DEFAULT_LOCAL_DOCUMENTS_ROOT
  ).trim();
  if (!rootSource || !path.isAbsolute(rootSource)) {
    throw new Error("Укажите абсолютный путь к локальной папке документов.");
  }
  const relativePath = normalizeSystemDocumentsRelativePath(source);
  if (!relativePath) throw new Error("Не удалось определить папку документов слушателя.");
  const relativeParts = relativePath.split("/").filter(Boolean);
  if (relativeParts.some((part) => /[<>:"|?*\u0000-\u001f]/u.test(part))) {
    throw new Error("Путь к папке документов содержит недопустимые символы.");
  }
  const baseParts = normalizeWebDavPath(
    serverSettings.yandexDiskBasePath || DEFAULT_YANDEX_DISK_BASE_PATH
  ).split("/").filter(Boolean);
  if (serverSettings.localDocumentsRootIsSystemParent && baseParts.length > 1) {
    baseParts.splice(0, baseParts.length - 1);
  }
  if (usesParentSystemDocumentsFolder(source)) baseParts.pop();
  const rootPath = path.resolve(rootSource);
  const folderPath = path.resolve(rootPath, ...baseParts, ...relativeParts);
  const pathFromRoot = path.relative(rootPath, folderPath);
  if (pathFromRoot.startsWith("..") || path.isAbsolute(pathFromRoot)) {
    throw new Error("Папка документов находится за пределами локального хранилища.");
  }
  return folderPath;
}

function openFolderInExplorer(folderPath) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Открытие папки в Проводнике доступно только в Windows."));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("explorer.exe", [folderPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function handleOpenLocalDocumentsFolder(req, res) {
  try {
    const body = await readJsonBody(req);
    const folderPath = resolveLocalDocumentsFolder(body.folder);
    await fs.mkdir(folderPath, { recursive: true });
    await openFolderInExplorer(folderPath);
    sendJson(res, 200, { ok: true, path: folderPath });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function loadSystemDocumentFromYandexDisk(relativePath) {
  const remotePath = resolveYandexDiskSourcePath(relativePath);
  if (!remotePath) return null;
  const response = await requestYandexWebDav("GET", remotePath, {
    acceptedStatuses: [200],
    maxResponseBytes: MAX_STUDENT_PHOTO_BYTES
  });
  const bytes = response.body;
  if (!bytes.length || bytes.length > MAX_STUDENT_PHOTO_BYTES) return null;
  return bytes;
}

function resolveStoredPhotoPath(value) {
  const source = String(value || "").trim();
  if (!source || /^data:/i.test(source)) return null;
  try {
    const url = new URL(source, `http://localhost:${PORT}`);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const decodedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      if (decodedPath.startsWith("storage/photos/")) {
        const fullPath = path.resolve(ROOT, decodedPath);
        return isInsideRoot(fullPath) ? fullPath : null;
      }
    }
  } catch {
    // Ниже обрабатываются обычные файловые пути.
  }
  const webPath = source.replace(/^\/+/, "");
  if (webPath.startsWith("storage/photos/")) {
    const fullPath = path.resolve(ROOT, webPath);
    return isInsideRoot(fullPath) ? fullPath : null;
  }
  return null;
}

async function loadContractPhoto(fieldValues) {
  const source = fieldValues?.["Фото"] || fieldValues?.photo || fieldValues?.photoPath || "";
  if (!source) return null;
  if (/^data:image\//i.test(source)) {
    const parsed = parseDataUrl(source);
    return {
      ...parsed,
      ...imageDimensions(parsed.bytes, parsed.ext),
      name: "Фото слушателя"
    };
  }
  const fullPath = resolveStoredPhotoPath(source);
  const ext = imageExtensionFromPath(fullPath || source);
  if (!ext) return null;
  try {
    const bytes = fullPath
      ? await fs.readFile(fullPath)
      : await loadSystemDocumentFromYandexDisk(source);
    if (!bytes?.length) return null;
    return {
      bytes,
      ext,
      mime: IMAGE_CONTENT_TYPES[ext],
      ...imageDimensions(bytes, ext),
      name: path.basename(String(fullPath || source).replace(/\\/g, "/"))
    };
  } catch (error) {
    if (!fullPath || error.code === "ENOENT") return null;
    throw error;
  }
}

function requestBuffer(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const req = transport.request(target, {
      method: options.method || "GET",
      headers: {
        "User-Agent": "AIS-Dopobrazovanie-Web/1.0",
        ...(options.headers || {})
      }
    }, (res) => {
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && location) {
        res.resume();
        if (redirectCount >= 5) {
          reject(new Error("Слишком много перенаправлений при загрузке шаблона."));
          return;
        }
        resolve(requestBuffer(new URL(location, target).toString(), options, redirectCount + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => reject(new Error(`Не удалось скачать шаблон: HTTP ${res.statusCode} ${Buffer.concat(chunks).toString("utf8").slice(0, 200)}`)));
        return;
      }
      const chunks = [];
      let size = 0;
      const totalSize = Number(res.headers["content-length"]) || 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        options.onProgress?.({
          receivedBytes: size,
          totalBytes: totalSize
        });
        if (size > MAX_DOCX_BYTES) {
          req.destroy(new Error("Скачанный шаблон договора слишком большой."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Истекло время загрузки шаблона договора.")));
    req.end();
  });
}

function normalizeWebDavPath(value) {
  const parts = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Путь Яндекс-Диска содержит недопустимый сегмент.");
  }
  return parts.length ? `/${parts.join("/")}` : "/";
}

function parseHttpResourceUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(parsed.protocol.toLowerCase()) ? parsed : null;
  } catch {
    return null;
  }
}

function isYandexWebDavHost(host) {
  return String(host || "").toLowerCase() === "webdav.yandex.ru";
}

function extractYandexWebDavPath(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  const parsed = parseHttpResourceUrl(source);
  if (parsed) {
    if (!isYandexWebDavHost(parsed.hostname)) return "";
    try {
      return decodeURIComponent(parsed.pathname);
    } catch {
      return parsed.pathname;
    }
  }
  if (/^webdav:\/\//i.test(source)) {
    const withoutProtocol = source.replace(/^webdav:\/\//i, "");
    const withoutHost = withoutProtocol.replace(/^webdav\.yandex\.ru(?:\/+|$)/i, "");
    try {
      return decodeURIComponent(withoutHost);
    } catch {
      return withoutHost;
    }
  }
  return source;
}

function normalizeYandexDiskResourceSetting(value, fallback = "") {
  const source = String(value || fallback || "").trim();
  if (!source) return "";
  const parsed = parseHttpResourceUrl(source);
  if (parsed && !isYandexWebDavHost(parsed.hostname)) return parsed.href;
  const webDavPath = extractYandexWebDavPath(source);
  return normalizeWebDavPath(webDavPath).replace(/^\/+/, "");
}

function resolveConfiguredYandexWebDavPath(value) {
  const source = String(value || "").trim();
  const extractedPath = extractYandexWebDavPath(source);
  if (!extractedPath) throw new Error("Не указан путь к файлу на Яндекс-Диске.");
  const useParentFolder = /^\s*\[-1\](?:[\\/]+|$)/u.test(extractedPath);
  const sourcePath = normalizeWebDavPath(extractedPath.replace(/^\s*\[-1\](?:[\\/]+|$)/u, ""));
  const basePath = normalizeWebDavPath(
    serverSettings.yandexDiskBasePath || DEFAULT_YANDEX_DISK_BASE_PATH
  );
  const sourceParts = sourcePath.split("/").filter(Boolean);
  const baseParts = basePath.split("/").filter(Boolean);
  const sourceRoot = sourceParts[0]?.toLocaleLowerCase("ru-RU") || "";
  const baseRoot = baseParts[0]?.toLocaleLowerCase("ru-RU") || "";
  if (sourceRoot && sourceRoot === baseRoot) return sourcePath;
  if (useParentFolder) baseParts.pop();
  return normalizeWebDavPath(`/${baseParts.join("/")}/${sourceParts.join("/")}`);
}

async function loadYandexWebDavResourceBytes(source, options = {}) {
  const response = await requestYandexWebDav("GET", resolveConfiguredYandexWebDavPath(source), {
    acceptedStatuses: [200],
    maxResponseBytes: Number(options.maxResponseBytes) || MAX_DOCX_BYTES,
    onProgress: options.onProgress
  });
  return response.body;
}

function getYandexDiskCredentials() {
  const login = String(serverSettings.yandexDiskLogin || process.env.YANDEX_DISK_LOGIN || "").trim();
  const password = String(
    serverSettings.yandexDiskPassword || process.env.YANDEX_DISK_PASSWORD || ""
  );
  if (!login || !password) {
    throw new Error("В админке не настроены логин и пароль приложения Яндекс-Диска.");
  }
  return { login, password };
}

function requestYandexWebDav(method, davPath, options = {}) {
  return new Promise((resolve, reject) => {
    const { login, password } = getYandexDiskCredentials();
    const target = new URL("https://webdav.yandex.ru");
    target.pathname = normalizeWebDavPath(davPath);
    const body = options.body ? Buffer.from(options.body) : null;
    const acceptedStatuses = new Set(options.acceptedStatuses || [200, 201, 204, 207]);
    const request = https.request(target, {
      method,
      headers: {
        "User-Agent": "AIS-Dopobrazovanie-Web/1.0",
        Authorization: `Basic ${Buffer.from(`${login}:${password}`, "utf8").toString("base64")}`,
        ...(body ? {
          "Content-Type": options.contentType || "application/octet-stream",
          "Content-Length": body.length
        } : {}),
        ...(options.headers || {})
      }
    }, (response) => {
      const chunks = [];
      let size = 0;
      let responseTooLarge = false;
      const maxResponseBytes = Number(options.maxResponseBytes) || 1024 * 1024;
      const totalSize = Number(response.headers["content-length"]) || 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        options.onProgress?.({ receivedBytes: size, totalBytes: totalSize });
        if (size > maxResponseBytes) {
          responseTooLarge = true;
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (responseTooLarge) {
          reject(new Error("Файл на Яндекс-Диске превышает допустимый размер."));
          return;
        }
        if (acceptedStatuses.has(response.statusCode)) {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks)
          });
          return;
        }
        if (response.statusCode === 401 || response.statusCode === 403) {
          reject(new Error(
            "Яндекс-Диск отклонил авторизацию. Используйте отдельный пароль приложения для WebDAV."
          ));
          return;
        }
        reject(new Error(
          `Яндекс-Диск вернул HTTP ${response.statusCode}: ${Buffer.concat(chunks).toString("utf8").slice(0, 240)}`
        ));
      });
    });
    request.on("error", reject);
    request.setTimeout(30000, () => request.destroy(new Error("Истекло время ожидания ответа Яндекс-Диска.")));
    if (body) request.write(body);
    request.end();
  });
}

async function testYandexDiskConnection() {
  const basePath = normalizeWebDavPath(
    serverSettings.yandexDiskBasePath || DEFAULT_YANDEX_DISK_BASE_PATH
  );
  await requestYandexWebDav("PROPFIND", "/", {
    acceptedStatuses: [207],
    headers: { Depth: "0" },
    contentType: "application/xml; charset=utf-8",
    body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>'
  });
  await ensureYandexDiskFolder(basePath);
  await requestYandexWebDav("PROPFIND", basePath, {
    acceptedStatuses: [207],
    headers: { Depth: "0" },
    contentType: "application/xml; charset=utf-8",
    body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>'
  });
  return basePath.replace(/^\/+/, "");
}

async function ensureYandexDiskFolder(davPath) {
  const parts = normalizeWebDavPath(davPath).split("/").filter(Boolean);
  let currentPath = "";
  for (const part of parts) {
    currentPath += `/${part}`;
    await requestYandexWebDav("MKCOL", currentPath, {
      acceptedStatuses: [201, 405]
    });
  }
  return currentPath || "/";
}

async function handleEnsureStudentDocumentFolders(req, res) {
  try {
    const body = await readJsonBody(req);
    const students = Array.isArray(body.students) ? body.students : [];
    if (!students.length) throw new Error("Не выбраны слушатели для создания папок.");
    if (students.length > 5000) throw new Error("За один раз можно создать не более 5000 папок слушателей.");

    const folders = students.map((student, index) => {
      const name = String(student?.name || "").trim();
      const compactName = buildStudentCompactName(name);
      if (!compactName) throw new Error(`Не заполнено ФИО слушателя в строке ${index + 1}.`);
      return {
        id: String(student?.id || index),
        compactName,
        relativePath: `Слушатели/${compactName}/Документы`
      };
    });

    const basePath = resolveYandexDiskBasePath(false);
    const studentsRoot = normalizeWebDavPath(`${basePath}/Слушатели`);
    await ensureYandexDiskFolder(studentsRoot);
    const uniqueNames = [...new Set(folders.map((folder) => folder.compactName))];
    for (const compactName of uniqueNames) {
      const studentFolder = normalizeWebDavPath(`${studentsRoot}/${compactName}`);
      await requestYandexWebDav("MKCOL", studentFolder, {
        acceptedStatuses: [201, 405]
      });
      await requestYandexWebDav("MKCOL", `${studentFolder}/Документы`, {
        acceptedStatuses: [201, 405]
      });
    }

    sendJson(res, 200, {
      folders: folders.map(({ id, relativePath }) => ({ id, relativePath }))
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

function resolveStudentDocumentRelativeFolder(body) {
  const sourceValues = body.sourceValues || {};
  const source = body.studentFolder
    || sourceValues["Фото"]
    || sourceValues.photoPath
    || "";
  const useParentFolder = usesParentSystemDocumentsFolder(source);
  let relativePath = normalizeSystemDocumentsRelativePath(source);
  if (relativePath && path.posix.extname(relativePath)) {
    relativePath = path.posix.dirname(relativePath);
  }
  if (relativePath && relativePath !== ".") {
    return { relativeFolder: relativePath, useParentFolder };
  }
  const studentName = buildStudentCompactName(
    sourceValues["ФИО"] || sourceValues["ФИО_обуч"] || body.studentName || "Без ФИО"
  );
  return {
    relativeFolder: `Слушатели/${studentName || "БезФИО"}/Документы`,
    useParentFolder: false
  };
}

async function uploadStudentDocumentToYandexDisk(bytes, fileName, body) {
  const { relativeFolder, useParentFolder } = resolveStudentDocumentRelativeFolder(body);
  const basePath = resolveYandexDiskBasePath(useParentFolder);
  const folderPath = normalizeWebDavPath(`${basePath}/${relativeFolder}`);
  await ensureYandexDiskFolder(folderPath);
  const targetPath = normalizeWebDavPath(`${folderPath}/${safeDocumentFileName(fileName)}`);
  await requestYandexWebDav("PUT", targetPath, {
    acceptedStatuses: [200, 201, 204],
    body: bytes,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  return targetPath;
}

async function downloadYandexDiskPublicFile(publicUrl, options = {}) {
  const apiUrl = new URL("https://cloud-api.yandex.net/v1/disk/public/resources/download");
  apiUrl.searchParams.set("public_key", publicUrl);
  if (options.path) apiUrl.searchParams.set("path", options.path);
  const json = JSON.parse((await requestBuffer(apiUrl, {
    headers: { Accept: "application/json" }
  })).toString("utf8"));
  if (!json.href) throw new Error("Яндекс.Диск не вернул ссылку на скачивание файла.");
  return requestBuffer(json.href, { onProgress: options.onProgress });
}

function extractGoogleDriveFileId(publicUrl) {
  const parsed = new URL(publicUrl);
  const byQuery = parsed.searchParams.get("id");
  if (byQuery) return byQuery;
  const fileMatch = /\/file\/d\/([^/]+)/.exec(parsed.pathname);
  if (fileMatch) return fileMatch[1];
  const docMatch = /\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/.exec(parsed.pathname);
  if (docMatch) return docMatch[1];
  return "";
}

function extractGoogleDriveConfirmDownload(html, baseUrl) {
  const uuid = /name="uuid"\s+value="([^"]+)"/i.exec(html)?.[1];
  const confirm = /name="confirm"\s+value="([^"]+)"/i.exec(html)?.[1]
    || /confirm=([0-9A-Za-z_-]+)/i.exec(html)?.[1];
  const id = /name="id"\s+value="([^"]+)"/i.exec(html)?.[1]
    || /[?&]id=([^&"']+)/i.exec(html)?.[1];
  if (confirm && id) {
    const url = new URL("https://drive.google.com/uc");
    url.searchParams.set("export", "download");
    url.searchParams.set("confirm", decodeURIComponent(confirm));
    url.searchParams.set("id", decodeURIComponent(id));
    if (uuid) url.searchParams.set("uuid", decodeURIComponent(uuid));
    return url.toString();
  }
  const href = /href="([^"]*uc\?export=download[^"]+)"/i.exec(html)?.[1]
    || /href="([^"]*\/download\?[^"]+)"/i.exec(html)?.[1];
  return href ? new URL(href.replace(/&amp;/g, "&"), baseUrl).toString() : "";
}

async function downloadGoogleDrivePublicFile(publicUrl) {
  const fileId = extractGoogleDriveFileId(publicUrl);
  const downloadUrl = fileId
    ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
    : publicUrl;
  const bytes = await requestBuffer(downloadUrl, {
    headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*" }
  });
  const firstBytes = bytes.subarray(0, 256).toString("utf8");
  if (!/^\s*</.test(firstBytes) || !/<html|<!doctype html/i.test(firstBytes)) return bytes;
  const confirmUrl = extractGoogleDriveConfirmDownload(bytes.toString("utf8"), downloadUrl);
  if (!confirmUrl) return bytes;
  return requestBuffer(confirmUrl, {
    headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*" }
  });
}

function oneDriveShareId(publicUrl) {
  return `u!${Buffer.from(publicUrl, "utf8")
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\//g, "_")
    .replace(/\+/g, "-")}`;
}

async function downloadOneDrivePublicFile(publicUrl) {
  const apiUrl = `https://api.onedrive.com/v1.0/shares/${oneDriveShareId(publicUrl)}/root/content`;
  return requestBuffer(apiUrl, {
    headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*" }
  });
}

function isYandexDiskHost(host) {
  return host === "disk.yandex.ru" || host === "yadi.sk";
}

function isGoogleDriveHost(host) {
  return host === "drive.google.com" || host === "docs.google.com";
}

function isOneDriveHost(host) {
  return host === "1drv.ms"
    || host === "onedrive.live.com"
    || host.endsWith(".sharepoint.com")
    || host.endsWith("-my.sharepoint.com");
}

function normalizeStudentDatabaseDate(value) {
  let date = null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    date = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  } else {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(text);
    if (!date && ru) {
      const year = Number(ru[3].length === 2 ? `${Number(ru[3]) >= 70 ? "19" : "20"}${ru[3]}` : ru[3]);
      date = new Date(Date.UTC(year, Number(ru[2]) - 1, Number(ru[1])));
    }
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
    if (!date && slash) {
      const year = Number(slash[3].length === 2 ? `${Number(slash[3]) >= 70 ? "19" : "20"}${slash[3]}` : slash[3]);
      date = new Date(Date.UTC(year, Number(slash[1]) - 1, Number(slash[2])));
    }
  }
  if (!date || Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900) return "";
  return date.toISOString().slice(0, 10);
}

function normalizeStudentDatabaseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  const text = String(value ?? "").replace(/\u00a0/g, "").replace(/\s+/g, "").replace(",", ".").trim();
  if (!text) return "";
  const number = Number(text);
  return Number.isFinite(number) ? number : String(value).trim();
}

function normalizeStudentDatabaseValue(value, fieldName) {
  if (STUDENT_DATABASE_DATE_FIELDS.has(fieldName)) return normalizeStudentDatabaseDate(value);
  if (STUDENT_DATABASE_NUMBER_FIELDS.has(fieldName)) return normalizeStudentDatabaseNumber(value);
  if (fieldName === "uid") return String(value ?? "").trim().replace(/\.0+$/, "");
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return value;
}

function normalizeImportedStudentEventLabel(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

const STUDENT_EVENT_IMPORT_KEY_BY_LABEL = new Map(
  STUDENT_EVENT_IMPORT_TEMPLATES.map((event) => [
    normalizeImportedStudentEventLabel(event.label),
    event.key
  ])
);

[
  ["Уведомление с перечнем документов в мессенжер (whApp, tlg)", "docsListNotice"],
  ["Запрошена рекомендация учебного центра коллегам, знакомым", "recommendationRequested"],
  ["Сформировано личное дело", "personalCasePrinted"]
].forEach(([label, key]) => {
  STUDENT_EVENT_IMPORT_KEY_BY_LABEL.set(normalizeImportedStudentEventLabel(label), key);
});

function decodeStudentEventSettingValue(value) {
  const base64 = String(value || "").replace(/[\s\u000b]+/g, "");
  if (!base64) return "";
  try {
    return new TextDecoder("windows-1251").decode(Buffer.from(base64, "base64")).trim();
  } catch {
    return "";
  }
}

function normalizeImportedStudentEventDate(value) {
  const text = String(value || "").trim().toLocaleLowerCase("ru-RU");
  const standardDate = normalizeStudentDatabaseDate(text);
  if (standardDate) return standardDate;
  const match = /^(\d{1,2})\s+([а-яё]+)\s+(\d{2}|\d{4})$/iu.exec(text);
  if (!match) return "";
  const monthByName = {
    янв: 1,
    фев: 2,
    мар: 3,
    апр: 4,
    май: 5,
    июн: 6,
    июл: 7,
    авг: 8,
    сен: 9,
    сент: 9,
    окт: 10,
    ноя: 11,
    дек: 12
  };
  const monthName = match[2].replace(/ё/g, "е");
  const month = monthByName[monthName] || monthByName[monthName.slice(0, 3)];
  if (!month) return "";
  const day = Number(match[1]);
  const shortYear = Number(match[3]);
  const year = match[3].length === 2
    ? (shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear)
    : shortYear;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return "";
  return date.toISOString().slice(0, 10);
}

function parseStudentEventSettings(value) {
  const lines = String(value || "").replace(/\u000b/g, "").split(/\r?\n/);
  const blocks = [];
  let block = null;
  let currentEvent = null;
  let insideEventSection = false;
  lines.forEach((line) => {
    const section = /^\[КарточкаСлушателя\\События(?:\\(\d+))?\]$/u.exec(line.trim());
    if (section) {
      insideEventSection = true;
      if (!section[1]) {
        block = { selected: [], events: [] };
        blocks.push(block);
        currentEvent = null;
      } else if (block) {
        const index = Number(section[1]);
        currentEvent = { index, date: "", label: "" };
        block.events.push(currentEvent);
      }
      return;
    }
    if (/^\[/.test(line.trim())) {
      currentEvent = null;
      insideEventSection = false;
      return;
    }
    if (!block || !insideEventSection) return;
    const separator = line.indexOf("=");
    if (separator < 0) return;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!currentEvent && key === "Выд") {
      block.selected = rawValue.split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0);
      return;
    }
    if (!currentEvent) return;
    if (key === "0") currentEvent.date = decodeStudentEventSettingValue(rawValue);
    if (key === "1") currentEvent.label = decodeStudentEventSettingValue(rawValue);
  });

  const sourceBlock = [...blocks].reverse().find((item) => item.events.some((event) => event.label));
  if (!sourceBlock) return {};
  const selected = new Set(sourceBlock.selected);
  const usedBaseKeys = new Set();
  const customKeys = [];
  const eventOrder = [];
  const result = {};
  sourceBlock.events
    .filter((event) => event.label)
    .forEach((event) => {
      const normalizedLabel = normalizeImportedStudentEventLabel(event.label);
      let eventKey = STUDENT_EVENT_IMPORT_KEY_BY_LABEL.get(normalizedLabel) || "";
      if (eventKey && usedBaseKeys.has(eventKey)) eventKey = "";
      if (eventKey) {
        usedBaseKeys.add(eventKey);
      } else {
        const hash = crypto.createHash("sha1")
          .update(`${event.index}:${normalizedLabel}`)
          .digest("hex")
          .slice(0, 10);
        eventKey = `imported_${hash}`;
        customKeys.push(eventKey);
      }
      const date = normalizeImportedStudentEventDate(event.date);
      const isSelected = selected.has(event.index);
      eventOrder.push(eventKey);
      result[`event_${eventKey}_label`] = event.label;
      if (date) result[`event_${eventKey}_date`] = date;
      if (isSelected) result[`event_${eventKey}_state`] = date ? "dated" : "checked";
    });
  result.eventOrder = eventOrder.join(",");
  result.eventCustomKeys = customKeys.join(",");
  result.eventDeleted = STUDENT_EVENT_IMPORT_TEMPLATES
    .map((event) => event.key)
    .filter((key) => !usedBaseKeys.has(key))
    .join(",");
  return result;
}

function buildStudentDatabaseRecordId(uid, rowNumber) {
  const normalizedUid = String(uid || "").trim();
  const safeUid = normalizedUid.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  if (safeUid) return `student-db-${safeUid}`;
  const hash = crypto.createHash("sha1").update(`${normalizedUid}:${rowNumber}`).digest("hex").slice(0, 12);
  return `student-db-${hash}`;
}

function normalizeDirectExpenseDatabaseValue(value, fieldName) {
  if (fieldName === "date") return normalizeStudentDatabaseDate(value);
  if (fieldName === "amount") return normalizeStudentDatabaseNumber(value);
  if (fieldName === "uid") return String(value ?? "").trim().replace(/\.0+$/, "");
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return value;
}

function buildDirectExpenseDatabaseRecordId(expense, rowNumber) {
  const fingerprint = [
    expense.uid,
    expense.date,
    expense.type,
    expense.amount,
    expense.note,
    rowNumber
  ].map((value) => String(value ?? "").trim()).join(":");
  const hash = crypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 16);
  return `direct-expense-db-${hash}`;
}

function parseDirectExpenseDatabaseSheet(workbook, onProgress = () => {}) {
  const worksheet = workbook.Sheets["Прямые затраты"];
  if (!worksheet) throw new Error("В файле не найден лист «Прямые затраты».");
  onProgress({ progress: 68, message: "Чтение листа «Прямые затраты»..." });
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true, UTC: true });
  const headerRowIndex = rows.findIndex((row) => (
    row.some((value) => String(value || "").trim() === "Дата")
    && row.some((value) => String(value || "").trim() === "Вид затрат")
    && row.some((value) => String(value || "").trim() === "Сумма")
  ));
  if (headerRowIndex < 0) {
    throw new Error("На листе «Прямые затраты» не найдены колонки Дата, Вид затрат и Сумма.");
  }
  const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
  const mappedColumns = headers
    .map((header, index) => ({ index, fieldName: DIRECT_EXPENSE_DATABASE_COLUMN_MAP[header] || "" }))
    .filter((column) => column.fieldName);
  const dateColumn = headers.indexOf("Дата");
  const typeColumn = headers.indexOf("Вид затрат");
  const amountColumn = headers.indexOf("Сумма");
  const directExpenses = [];
  const sourceRowCount = Math.max(0, rows.length - headerRowIndex - 1);
  const progressStep = Math.max(1, Math.floor(sourceRowCount / 100));
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const processedRows = rowIndex - headerRowIndex;
    if (processedRows === 1 || processedRows % progressStep === 0 || processedRows === sourceRowCount) {
      onProgress({
        progress: 70 + Math.floor((processedRows / Math.max(1, sourceRowCount)) * 25),
        message: `Обработка прямых затрат: ${processedRows} из ${sourceRowCount}`,
        processedRows,
        totalRows: sourceRowCount
      });
    }
    const row = rows[rowIndex] || [];
    const date = normalizeStudentDatabaseDate(row[dateColumn]);
    const type = String(row[typeColumn] ?? "").trim();
    const amount = normalizeStudentDatabaseNumber(row[amountColumn]);
    if (!date || !type || amount === "" || !Number.isFinite(Number(amount))) continue;
    const expense = {};
    mappedColumns.forEach((column) => {
      const value = normalizeDirectExpenseDatabaseValue(row[column.index], column.fieldName);
      if (value === "") return;
      expense[column.fieldName] = value;
    });
    expense.id = buildDirectExpenseDatabaseRecordId(expense, rowIndex + 1);
    expense.date = date;
    expense.type = type;
    expense.amount = Number(amount);
    directExpenses.push(expense);
  }
  if (!directExpenses.length) {
    throw new Error("На листе «Прямые затраты» не найдено ни одной заполненной строки расходов.");
  }
  return {
    directExpenses,
    directExpenseSheetName: "Прямые затраты",
    directExpenseSourceRows: sourceRowCount,
    directExpenseSkippedRows: Math.max(0, sourceRowCount - directExpenses.length)
  };
}

function attachDirectExpensesToStudents(students, directExpenses) {
  const studentsByUid = new Map();
  students.forEach((student) => {
    student.directExpenses = [];
    const uid = String(student.uid || "").trim();
    if (uid && !studentsByUid.has(uid)) studentsByUid.set(uid, student);
  });
  const unlinkedDirectExpenses = [];
  let linkedDirectExpenseCount = 0;
  directExpenses.forEach((expense) => {
    const uid = String(expense.uid || "").trim();
    const student = uid ? studentsByUid.get(uid) : null;
    if (!student) {
      unlinkedDirectExpenses.push(expense);
      return;
    }
    student.directExpenses.push(expense);
    linkedDirectExpenseCount += 1;
  });
  return {
    unlinkedDirectExpenses,
    linkedDirectExpenseCount,
    totalDirectExpenseCount: directExpenses.length
  };
}

function parseStudentDatabaseWorkbook(bytes, onProgress = () => {}) {
  let workbook;
  onProgress({ progress: 0, message: "Чтение структуры XLSB..." });
  try {
    workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  } catch (error) {
    throw new Error(`Не удалось прочитать базу Excel: ${error.message}`);
  }
  onProgress({ progress: 12, message: "Чтение листа «База»..." });
  const worksheet = workbook.Sheets["База"];
  if (!worksheet) throw new Error("В файле не найден лист «База».");
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true, UTC: true });
  const headerRowIndex = rows.findIndex((row) => (
    row.some((value) => String(value || "").trim() === "uid")
    && row.some((value) => String(value || "").trim() === "ФИО")
  ));
  if (headerRowIndex < 0) throw new Error("На листе «База» не найдены колонки uid и ФИО.");
  const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
  const mappedColumns = headers
    .map((header, index) => ({ header, index, fieldName: STUDENT_DATABASE_COLUMN_MAP[header] || "" }))
    .filter((column) => column.fieldName);
  const uidColumn = headers.indexOf("uid");
  const nameColumn = headers.indexOf("ФИО");
  const eventSettingsColumn = headers.indexOf("ДопНастрСлушат");
  const students = [];
  const usedIds = new Map();
  const sourceRowCount = Math.max(0, rows.length - headerRowIndex - 1);
  const progressStep = Math.max(1, Math.floor(sourceRowCount / 100));
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const processedRows = rowIndex - headerRowIndex;
    if (processedRows === 1 || processedRows % progressStep === 0 || processedRows === sourceRowCount) {
      onProgress({
        progress: 15 + Math.floor((processedRows / Math.max(1, sourceRowCount)) * 50),
        message: `Обработка слушателей: ${processedRows} из ${sourceRowCount}`,
        processedRows,
        totalRows: sourceRowCount
      });
    }
    const row = rows[rowIndex] || [];
    const uid = String(row[uidColumn] ?? "").trim().replace(/\.0+$/, "");
    const name = String(row[nameColumn] ?? "").trim();
    if (!uid || !name) continue;
    const student = {};
    mappedColumns.forEach((column) => {
      const value = normalizeStudentDatabaseValue(row[column.index], column.fieldName);
      if (value === "") return;
      student[column.fieldName] = value;
    });
    if (eventSettingsColumn >= 0) {
      Object.assign(student, parseStudentEventSettings(row[eventSettingsColumn]));
    }
    const baseId = buildStudentDatabaseRecordId(uid, rowIndex + 1);
    const duplicateNumber = (usedIds.get(baseId) || 0) + 1;
    usedIds.set(baseId, duplicateNumber);
    student.id = duplicateNumber === 1 ? baseId : `${baseId}-${duplicateNumber}`;
    student.uid = uid;
    student.name = name;
    if (student.enrollmentDate) student.enrollmentOrderDate = student.enrollmentDate;
    if (student.expulsionDate) student.expulsionOrderDate = student.expulsionDate;
    students.push(student);
  }
  if (!students.length) throw new Error("На листе «База» не найдено ни одного слушателя с uid и ФИО.");
  const directExpenseResult = parseDirectExpenseDatabaseSheet(workbook, onProgress);
  onProgress({ progress: 97, message: "Привязка прямых затрат к слушателям..." });
  const {
    unlinkedDirectExpenses,
    linkedDirectExpenseCount,
    totalDirectExpenseCount
  } = attachDirectExpensesToStudents(students, directExpenseResult.directExpenses);
  onProgress({ progress: 100, message: "Обработка базы завершена." });
  return {
    students,
    sheetName: "База",
    sourceRows: sourceRowCount,
    skippedRows: Math.max(0, sourceRowCount - students.length),
    ...directExpenseResult,
    directExpenses: unlinkedDirectExpenses,
    linkedDirectExpenseCount,
    totalDirectExpenseCount
  };
}

async function loadStudentDatabaseBytes(databasePath, onProgress = null) {
  const source = String(
    databasePath
    || serverSettings.studentDatabaseWebDavPath
    || DEFAULT_STUDENT_DATABASE_WEBDAV_PATH
  ).trim();
  if (!source) throw new Error("Не указан WebDAV-путь или ссылка на базу слушателей.");
  const remoteUrl = parseHttpResourceUrl(source);
  let bytes;
  if (remoteUrl && isYandexDiskHost(remoteUrl.hostname.toLowerCase())) {
    bytes = await downloadYandexDiskPublicFile(source, { onProgress });
  } else if (remoteUrl && !isYandexWebDavHost(remoteUrl.hostname)) {
    bytes = await requestBuffer(source, { onProgress });
  } else {
    bytes = await loadYandexWebDavResourceBytes(source, {
      maxResponseBytes: MAX_STUDENT_DATABASE_BYTES,
      onProgress
    });
  }
  if (!bytes.length) throw new Error("Загруженный файл базы пуст.");
  if (bytes.length > MAX_STUDENT_DATABASE_BYTES) throw new Error("Файл базы превышает допустимый размер 24 МБ.");
  return bytes;
}

function countWorksheetFormulaCells(worksheet) {
  if (!worksheet) return 0;
  return Object.entries(worksheet)
    .filter(([address, cell]) => address[0] !== "!" && cell && typeof cell.f === "string")
    .length;
}

function inspectStudentDatabaseBinary(bytes) {
  const workbook = XLSX.read(bytes, { type: "buffer", bookVBA: true });
  const baseSheet = workbook.Sheets["База"];
  const directExpenseSheet = workbook.Sheets["Прямые затраты"];
  if (!baseSheet) throw new Error("В файле не найден лист «База».");
  if (!directExpenseSheet) throw new Error("В файле не найден лист «Прямые затраты».");
  return {
    hasVba: Boolean(workbook.vbaraw?.length),
    vbaBytes: Number(workbook.vbaraw?.length || 0),
    baseFormulaCount: countWorksheetFormulaCells(baseSheet),
    directExpenseFormulaCount: countWorksheetFormulaCells(directExpenseSheet)
  };
}

function runStudentDatabaseSyncScript(inputPath, outputPath, payloadPath, onProgress = () => {}) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Синхронизация XLSB требует Microsoft Excel на сервере Windows."));
  }
  const powershellPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const launcher = [
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
    "$scriptText = [IO.File]::ReadAllText($env:AIS_SYNC_SCRIPT, [Text.UTF8Encoding]::new($false))",
    "& ([ScriptBlock]::Create($scriptText)) -InputPath $env:AIS_SYNC_INPUT -OutputPath $env:AIS_SYNC_OUTPUT -PayloadPath $env:AIS_SYNC_PAYLOAD"
  ].join("; ");
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(launcher, "utf16le").toString("base64")
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershellPath,
      args,
      {
        windowsHide: true,
        env: {
          ...process.env,
          AIS_SYNC_SCRIPT: STUDENT_DATABASE_SYNC_SCRIPT,
          AIS_SYNC_INPUT: inputPath,
          AIS_SYNC_OUTPUT: outputPath,
          AIS_SYNC_PAYLOAD: payloadPath
        }
      }
    );
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let result = null;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Microsoft Excel не завершил синхронизацию за 10 минут."));
    }, 10 * 60 * 1000);
    const consumeLine = (line) => {
      const value = String(line || "").replace(/^\uFEFF/, "").trim();
      if (!value) return;
      try {
        const message = JSON.parse(value);
        if (message?.type === "progress") {
          onProgress({
            progress: Number(message.progress) || 0,
            message: String(message.message || "")
          });
        } else if (message?.type === "result") {
          result = message;
        }
      } catch {
        stdoutBuffer += `${value}\n`;
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      lines.forEach(consumeLine);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderrBuffer.length < 4 * 1024 * 1024) stderrBuffer += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      consumeLine(stdoutBuffer);
      if (code !== 0) {
        const detail = String(stderrBuffer || stdoutBuffer || "").trim();
        reject(new Error(detail || `Microsoft Excel завершил синхронизацию с кодом ${code}.`));
        return;
      }
      resolve(result || {});
    });
  });
}

function runStudentApplicationsQuery(filters) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Импорт заявок через ODBC доступен только на сервере Windows."));
  }
  const connectionString = String(
    serverSettings.studentApplicationsMySqlConnectionString
      || process.env.STUDENT_APPLICATIONS_MYSQL_CONNECTION_STRING
      || ""
  ).trim();
  if (!connectionString) {
    return Promise.reject(new Error("Не настроено подключение к базе заявок."));
  }
  const powershellPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const launcher = [
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
    "$scriptText = [IO.File]::ReadAllText($env:AIS_APPLICATIONS_SCRIPT, [Text.UTF8Encoding]::new($false))",
    "try { & ([ScriptBlock]::Create($scriptText)) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"
  ].join("; ");
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(launcher, "utf16le").toString("base64")
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(powershellPath, args, {
      windowsHide: true,
      env: {
        ...process.env,
        AIS_APPLICATIONS_SCRIPT: STUDENT_APPLICATIONS_QUERY_SCRIPT,
        AIS_APPLICATIONS_DB: connectionString,
        AIS_APPLICATIONS_DATE_FROM: filters.dateFrom,
        AIS_APPLICATIONS_DATE_TO: filters.dateTo,
        AIS_APPLICATIONS_PROGRAM_NAME: filters.programName,
        AIS_APPLICATIONS_PRODUCT_ID: filters.productId,
        AIS_APPLICATIONS_ONLY_PAID: filters.onlyPaid ? "1" : "0"
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("База заявок не ответила за 60 секунд."));
    }, 60 * 1000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 24 * 1024 * 1024) stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2 * 1024 * 1024) stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        const detail = String(stderr || stdout || "")
          .replace(/#< CLIXML[\s\S]*$/i, "")
          .trim();
        reject(new Error(detail || `Запрос заявок завершился с кодом ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(String(stdout || "").replace(/^\uFEFF/, "").trim()));
      } catch {
        reject(new Error("Сервер заявок вернул некорректный ответ."));
      }
    });
  });
}

function getStudentApplicationsEmailSettings() {
  const host = String(
    serverSettings.studentApplicationsEmailHost
      || process.env.STUDENT_APPLICATIONS_EMAIL_HOST
      || ""
  ).trim();
  const port = Number(
    serverSettings.studentApplicationsEmailPort
      || process.env.STUDENT_APPLICATIONS_EMAIL_PORT
      || 993
  );
  const login = String(
    serverSettings.studentApplicationsEmailLogin
      || process.env.STUDENT_APPLICATIONS_EMAIL_LOGIN
      || ""
  ).trim();
  const password = String(
    serverSettings.studentApplicationsEmailPassword
      || process.env.STUDENT_APPLICATIONS_EMAIL_PASSWORD
      || ""
  );
  return {
    host,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 993,
    login,
    password
  };
}

function hasStudentApplicationsEmailSettings() {
  const settings = getStudentApplicationsEmailSettings();
  return Boolean(settings.host && settings.login && settings.password);
}

function quoteImapValue(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function createImapResponseReader(socket) {
  let buffer = Buffer.alloc(0);
  let pending = null;
  let closedError = null;

  const checkPending = () => {
    if (!pending) return;
    let result;
    try {
      result = pending.matcher(buffer);
    } catch (error) {
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      current.reject(error);
      return;
    }
    if (!result) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    const response = buffer.subarray(0, result.end);
    buffer = buffer.subarray(result.end);
    current.resolve({ ...result, response });
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 32 * 1024 * 1024) {
      const error = new Error("Ответ IMAP-сервера превышает допустимый размер.");
      if (pending) {
        const current = pending;
        pending = null;
        clearTimeout(current.timer);
        current.reject(error);
      }
      socket.destroy(error);
      return;
    }
    checkPending();
  });
  socket.on("error", (error) => {
    closedError = error;
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.reject(error);
  });
  socket.on("close", () => {
    closedError ||= new Error("IMAP-сервер закрыл соединение.");
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.reject(closedError);
  });

  return {
    waitFor(matcher, timeoutMessage, timeout = 30000) {
      if (pending) return Promise.reject(new Error("Предыдущая команда IMAP ещё не завершена."));
      if (closedError) return Promise.reject(closedError);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending) return;
          pending = null;
          reject(new Error(timeoutMessage));
          socket.destroy();
        }, timeout);
        pending = { matcher, resolve, reject, timer };
        checkPending();
      });
    }
  };
}

async function connectStudentApplicationsImap() {
  const settings = getStudentApplicationsEmailSettings();
  if (!settings.host || !settings.login || !settings.password) {
    throw new Error("В админке не настроено подключение к почтовому ящику заявок.");
  }
  const trustedCertificates = typeof tls.getCACertificates === "function"
    ? [
      ...tls.getCACertificates("default"),
      ...tls.getCACertificates("system")
    ]
    : [];
  const socket = tls.connect({
    host: settings.host,
    port: settings.port,
    servername: settings.host,
    rejectUnauthorized: true,
    ...(trustedCertificates.length ? { ca: trustedCertificates } : {})
  });
  socket.setTimeout(45000, () => socket.destroy(new Error("Истекло время ожидания IMAP-сервера.")));
  const reader = createImapResponseReader(socket);
  await reader.waitFor((buffer) => {
    const end = buffer.indexOf("\r\n");
    if (end < 0) return null;
    const greeting = buffer.subarray(0, end + 2).toString("utf8");
    if (!/^\*\s+(?:OK|PREAUTH)\b/i.test(greeting)) {
      throw new Error(`IMAP-сервер отклонил подключение: ${greeting.trim()}`);
    }
    return { end: end + 2, status: "OK" };
  }, "IMAP-сервер не прислал приветствие.", 20000);

  let commandNumber = 0;
  const command = async (commandText, timeout = 30000) => {
    const tag = `A${String(++commandNumber).padStart(4, "0")}`;
    const responsePromise = reader.waitFor((buffer) => {
      const text = buffer.toString("latin1");
      const match = new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)(?: ([^\\r\\n]*))?\\r\\n`, "i").exec(text);
      if (!match) return null;
      return {
        end: match.index + match[0].length,
        status: match[1].toUpperCase(),
        message: String(match[2] || "").trim()
      };
    }, `IMAP-сервер не ответил на команду ${tag}.`, timeout);
    socket.write(`${tag} ${commandText}\r\n`, "utf8");
    const result = await responsePromise;
    if (result.status !== "OK") {
      throw new Error(`IMAP: ${result.message || "команда отклонена"}`);
    }
    return result.response;
  };

  try {
    await command(`LOGIN ${quoteImapValue(settings.login)} ${quoteImapValue(settings.password)}`);
    await command('EXAMINE "INBOX"');
  } catch (error) {
    socket.destroy();
    if (/auth|login|credential|password|authentication/i.test(error.message)) {
      throw new Error("IMAP-сервер отклонил логин или пароль.");
    }
    throw error;
  }

  return {
    command,
    async close() {
      try {
        await command("LOGOUT", 10000);
      } catch {
        // Соединение могло закрыться сразу после ответа BYE.
      } finally {
        socket.end();
      }
    }
  };
}

function formatImapDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  if (!match) throw new Error("Не удалось подготовить дату для IMAP.");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])}-${months[Number(match[2]) - 1]}-${match[1]}`;
}

function addDaysToIsoDate(isoDate, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function parseImapSearchUids(response) {
  const text = Buffer.from(response || "").toString("latin1");
  const match = /^\* SEARCH(?: ([0-9 ]+))?\r?$/im.exec(text);
  return match?.[1]
    ? match[1].trim().split(/\s+/).filter((value) => /^\d+$/.test(value))
    : [];
}

function extractImapLiteral(response) {
  const bytes = Buffer.from(response || "");
  const text = bytes.toString("latin1");
  const match = /\{(\d+)\}\r\n/.exec(text);
  if (!match) throw new Error("IMAP-сервер не вернул содержимое письма.");
  const length = Number(match[1]);
  const start = match.index + match[0].length;
  const end = start + length;
  if (!Number.isFinite(length) || length < 1 || end > bytes.length) {
    throw new Error("IMAP-сервер вернул повреждённое письмо.");
  }
  return bytes.subarray(start, end);
}

function extractImapFetchLiterals(response) {
  const bytes = Buffer.from(response || "");
  const text = bytes.toString("latin1");
  const entries = [];
  const literalPattern = /\{(\d+)\}\r\n/g;
  let cursor = 0;
  while (cursor < bytes.length) {
    literalPattern.lastIndex = cursor;
    const match = literalPattern.exec(text);
    if (!match) break;
    const length = Number(match[1]);
    const start = match.index + match[0].length;
    const end = start + length;
    if (!Number.isFinite(length) || length < 0 || end > bytes.length) {
      throw new Error("IMAP-сервер вернул повреждённый пакет писем.");
    }
    const responseStart = Math.max(
      text.lastIndexOf("\r\n* ", match.index),
      text.lastIndexOf("\n* ", match.index),
      text.lastIndexOf("* ", match.index)
    );
    const prefix = text.slice(Math.max(cursor, responseStart >= 0 ? responseStart : cursor), match.index);
    const uid = /\bUID\s+(\d+)\b/i.exec(prefix)?.[1] || "";
    if (uid) entries.push({ uid, bytes: bytes.subarray(start, end) });
    cursor = end;
  }
  return entries;
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function readEmailSubject(rawHeaders) {
  const { headers } = splitMimeEntity(rawHeaders);
  return decodeMimeHeader(headers.subject);
}

async function fetchImapSubjects(client, uids, warnings) {
  const subjects = new Map();
  const readResponse = (response) => {
    extractImapFetchLiterals(response).forEach((entry) => {
      subjects.set(entry.uid, readEmailSubject(entry.bytes));
    });
  };
  for (const batch of chunkValues(uids, 200)) {
    try {
      const response = await client.command(
        `UID FETCH ${batch.join(",")} (UID BODY.PEEK[HEADER.FIELDS (SUBJECT)])`,
        45000
      );
      readResponse(response);
    } catch {
      for (const uid of batch) {
        try {
          const response = await client.command(
            `UID FETCH ${uid} (UID BODY.PEEK[HEADER.FIELDS (SUBJECT)])`,
            30000
          );
          readResponse(response);
        } catch (error) {
          warnings.push(`Тема письма UID ${uid} не прочитана: ${error.message}`);
        }
      }
    }
  }
  return subjects;
}

async function fetchImapMessages(client, uids, warnings) {
  const messages = [];
  const readResponse = (response) => {
    messages.push(...extractImapFetchLiterals(response));
  };
  for (const batch of chunkValues(uids, 20)) {
    try {
      const response = await client.command(
        `UID FETCH ${batch.join(",")} (UID BODY.PEEK[])`,
        60000
      );
      readResponse(response);
    } catch {
      for (const uid of batch) {
        try {
          const response = await client.command(`UID FETCH ${uid} (UID BODY.PEEK[])`, 45000);
          readResponse(response);
        } catch (error) {
          warnings.push(`Письмо UID ${uid} пропущено: ${error.message}`);
        }
      }
    }
  }
  return messages;
}

function splitMimeEntity(bytes) {
  const buffer = Buffer.from(bytes || "");
  let separatorIndex = buffer.indexOf("\r\n\r\n");
  let separatorLength = 4;
  if (separatorIndex < 0) {
    separatorIndex = buffer.indexOf("\n\n");
    separatorLength = 2;
  }
  if (separatorIndex < 0) return { headers: {}, body: buffer };
  const rawHeaders = buffer.subarray(0, separatorIndex).toString("latin1");
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, " ");
  const headers = {};
  unfolded.split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  });
  return {
    headers,
    body: buffer.subarray(separatorIndex + separatorLength)
  };
}

function decodeQuotedPrintableBytes(bytes) {
  const source = Buffer.from(bytes || "").toString("latin1").replace(/=\r?\n/g, "");
  const output = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "=" && /^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
      output.push(Number.parseInt(source.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      output.push(source.charCodeAt(index) & 0xff);
    }
  }
  return Buffer.from(output);
}

function decodeMimeTransfer(body, transferEncoding) {
  const encoding = String(transferEncoding || "").toLowerCase();
  if (encoding === "base64") {
    return Buffer.from(Buffer.from(body || "").toString("ascii").replace(/\s+/g, ""), "base64");
  }
  if (encoding === "quoted-printable") return decodeQuotedPrintableBytes(body);
  return Buffer.from(body || "");
}

function decodeTextBytes(bytes, charset = "utf-8") {
  const normalized = String(charset || "utf-8").trim().replace(/^"|"$/g, "").toLowerCase();
  try {
    return new TextDecoder(normalized || "utf-8").decode(bytes);
  } catch {
    return Buffer.from(bytes || "").toString("utf8");
  }
}

function parseMimeContentType(value) {
  const source = String(value || "text/plain");
  const type = source.split(";")[0].trim().toLowerCase();
  const parameters = {};
  source.replace(/;\s*([^=;\s]+)\s*=\s*(?:"([^"]*)"|([^;\s]*))/g, (match, name, quoted, plain) => {
    parameters[String(name).toLowerCase()] = quoted ?? plain ?? "";
    return match;
  });
  return { type, parameters };
}

function extractMimeText(bytes) {
  const { headers, body } = splitMimeEntity(bytes);
  const contentType = parseMimeContentType(headers["content-type"]);
  if (contentType.type.startsWith("multipart/") && contentType.parameters.boundary) {
    const delimiter = `--${contentType.parameters.boundary}`;
    const sections = body.toString("latin1").split(delimiter).slice(1);
    let htmlFallback = "";
    for (const sectionSource of sections) {
      if (/^--/.test(sectionSource)) break;
      const section = sectionSource.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      if (!section.trim()) continue;
      const result = extractMimeText(Buffer.from(section, "latin1"));
      if (result.plain) return result;
      if (!htmlFallback && result.html) htmlFallback = result.html;
    }
    return { plain: "", html: htmlFallback };
  }
  if (contentType.type === "message/rfc822") return extractMimeText(body);
  if (contentType.type !== "text/plain" && contentType.type !== "text/html") {
    return { plain: "", html: "" };
  }
  const decoded = decodeMimeTransfer(body, headers["content-transfer-encoding"]);
  const text = decodeTextBytes(decoded, contentType.parameters.charset || "utf-8").replace(/\u0000/g, "");
  return contentType.type === "text/plain"
    ? { plain: text, html: "" }
    : { plain: "", html: text };
}

function decodeMimeHeader(value) {
  const source = String(value || "").replace(/\r?\n[ \t]+/g, " ");
  return source.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=\s*/gi, (match, charset, encoding, encoded) => {
    const bytes = encoding.toLowerCase() === "b"
      ? Buffer.from(encoded, "base64")
      : decodeQuotedPrintableBytes(Buffer.from(encoded.replace(/_/g, " "), "latin1"));
    return decodeTextBytes(bytes, charset);
  }).trim();
}

function htmlToPlainText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeEmailOrderText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function parseEmailMoney(value) {
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeEmailCustomerName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 3) return parts.join(" ");
  const patronymicPattern = /(?:ович|евич|ич|овна|евна|ична|инична)$/iu;
  if (patronymicPattern.test(parts[1]) && !patronymicPattern.test(parts[2])) {
    return [parts[2], parts[0], parts[1]].join(" ");
  }
  return parts.join(" ");
}

function parseInSalesOrderEmail(rawMessage) {
  const { headers } = splitMimeEntity(rawMessage);
  const subject = decodeMimeHeader(headers.subject);
  if (!/^Новый заказ №/iu.test(subject)) return [];
  const mimeText = extractMimeText(rawMessage);
  const text = normalizeEmailOrderText(mimeText.plain || htmlToPlainText(mimeText.html));
  const orderMatch = /Поступил заказ №\s*(\d+)\s+от\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})/iu.exec(text);
  if (!orderMatch) return [];
  const [, orderId, day, month, year, time] = orderMatch;
  const readField = (label) => {
    const match = new RegExp(`${label}:\\s*\\n+([^\\n]+)`, "iu").exec(text);
    return String(match?.[1] || "").trim();
  };
  const name = normalizeEmailCustomerName(readField("Имя"));
  const email = readField("E-mail");
  const phone = readField("Телефон");
  const composition = /Состав заказа:\s*\n+([\s\S]*?)\n+Сумма:/iu.exec(text)?.[1] || "";
  const products = [];
  const productPattern = /(?:^|\n)\s*(\d+)\s*\n+([\s\S]*?)\n+цена:\s*([0-9\s.,]+)\s*₽,\s*количество:\s*(\d+)\s*шт\./giu;
  let productMatch;
  while ((productMatch = productPattern.exec(composition))) {
    products.push({
      productId: String(productMatch[1]).trim(),
      program: String(productMatch[2]).replace(/\s+/g, " ").trim(),
      baseAmount: parseEmailMoney(productMatch[3]) * Math.max(1, Number(productMatch[4]) || 1)
    });
  }
  if (!products.length) return [];

  const coupon = /Скидка:\s*\n+([^\n]+)/iu.exec(text)?.[1]?.trim() || "";
  const paymentMethod = /Способ оплаты:\s*\n+([^\n]+)/iu.exec(text)?.[1]?.trim() || "";
  const paymentStatus = /Статус оплаты:\s*\n+([^\n]+)/iu.exec(text)?.[1]?.trim() || "";
  const paid = /оплачен/iu.test(paymentStatus) && !/не\s+оплачен/iu.test(paymentStatus);
  const totalAmount = parseEmailMoney(
    /Итого\s+к\s+оплате\s*:\s*([0-9][0-9\s.,]*)\s*(?:₽|руб)/iu.exec(text)?.[1] || ""
  );
  const deliveryBlock = /Способ получения товара:\s*\n+([\s\S]*?)\n+Способ оплаты:/iu.exec(text)?.[1] || "";
  const deliveryLines = deliveryBlock.split("\n").map((line) => line.trim()).filter(Boolean);
  const city = deliveryLines.slice(1).find((line) => !/^[\d\s.,-]+\s*₽$/u.test(line)) || "";
  const totalBaseAmount = products.reduce((sum, product) => sum + product.baseAmount, 0);
  const dateCreated = `${year}-${month}-${day}T${time}:00`;
  const messageId = String(headers["message-id"] || "").replace(/[<>\s]+/g, "").slice(0, 120);

  return products.map((product, index) => {
    const paymentAmount = Math.round((products.length === 1
      ? totalAmount
      : totalAmount * (product.baseAmount / Math.max(totalBaseAmount, 1))) * 100) / 100;
    const orderParts = [
      orderId,
      paid ? `опл ${paymentAmount}` : "",
      coupon
    ].filter(Boolean);
    return {
      id: `email-${orderId}-${product.productId || index + 1}-${messageId || index + 1}`,
      sourceType: "email",
      date: `${day}.${month}.${year} ${time}:00`,
      dateCreated,
      name,
      order: orderParts.join(" "),
      orderId,
      program: product.program,
      productId: product.productId,
      phone,
      email,
      city,
      organization: "",
      position: "",
      source: "Электронная почта / InSales",
      note: [paymentMethod, paymentStatus, coupon].filter(Boolean).join("\n"),
      paid,
      paymentAmount
    };
  });
}

function studentEmailApplicationMatchesFilters(row, filters) {
  if (filters.onlyPaid && !row.paid) return false;
  const productId = String(filters.productId || "").trim();
  const programName = String(filters.programName || "").trim().toLocaleLowerCase("ru-RU");
  if (!productId && !programName) return true;
  const matchesProduct = productId && String(row.productId || "").trim() === productId;
  const rowProgram = String(row.program || "").toLocaleLowerCase("ru-RU");
  const matchesProgram = programName && (
    rowProgram.includes(programName)
    || programName.includes(rowProgram.replace(/\s*\([^)]*\)\s*$/u, "").trim())
  );
  return Boolean(matchesProduct || matchesProgram);
}

async function runStudentApplicationsEmailQuery(filters) {
  const client = await connectStudentApplicationsImap();
  const warnings = [];
  try {
    const beforeDate = addDaysToIsoDate(filters.dateTo, 1);
    const searchResponse = await client.command(
      `UID SEARCH SINCE ${formatImapDate(filters.dateFrom)} BEFORE ${formatImapDate(beforeDate)}`,
      45000
    );
    const allUids = parseImapSearchUids(searchResponse);
    const uids = allUids.slice(-1000).reverse();
    const subjects = await fetchImapSubjects(client, uids, warnings);
    const orderUids = uids.filter((uid) => /^Новый заказ №/iu.test(subjects.get(uid) || ""));
    const messages = await fetchImapMessages(client, orderUids, warnings);
    const rows = [];
    for (const message of messages) {
      try {
        rows.push(...parseInSalesOrderEmail(message.bytes).filter((row) => (
          studentEmailApplicationMatchesFilters(row, filters)
        )));
      } catch (error) {
        warnings.push(`Письмо UID ${message.uid} пропущено: ${error.message}`);
      }
    }
    return {
      rows,
      total: rows.length,
      truncated: allUids.length > uids.length,
      warnings
    };
  } finally {
    await client.close();
  }
}

async function testStudentApplicationsEmailConnection() {
  const client = await connectStudentApplicationsImap();
  await client.close();
  return getStudentApplicationsEmailSettings();
}

function parseStudentApplicationsQueryFilters(body = {}) {
  const parseDate = (value, label) => {
    const source = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
    if (!match) throw new Error(`Укажите ${label}.`);
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (
      Number.isNaN(date.getTime())
      || date.getFullYear() !== Number(match[1])
      || date.getMonth() !== Number(match[2]) - 1
      || date.getDate() !== Number(match[3])
    ) {
      throw new Error(`Укажите корректную ${label}.`);
    }
    return source;
  };
  const dateFrom = parseDate(body.dateFrom, "дату начала периода");
  const dateTo = parseDate(body.dateTo, "дату окончания периода");
  if (dateFrom > dateTo) {
    throw new Error("Дата начала периода не может быть позже даты окончания.");
  }
  return {
    dateFrom,
    dateTo,
    programName: String(body.programName || "").trim().slice(0, 500),
    productId: String(body.productId || "").trim().slice(0, 80),
    onlyPaid: Boolean(body.onlyPaid)
  };
}

async function handleStudentApplicationsQuery(req, res) {
  try {
    const body = await readJsonBody(req);
    const filters = parseStudentApplicationsQueryFilters(body);
    const sources = [];
    if (String(
      serverSettings.studentApplicationsMySqlConnectionString
        || process.env.STUDENT_APPLICATIONS_MYSQL_CONNECTION_STRING
        || ""
    ).trim()) {
      sources.push({
        label: "База сайта",
        promise: runStudentApplicationsQuery(filters)
      });
    }
    if (hasStudentApplicationsEmailSettings()) {
      sources.push({
        label: "Электронная почта",
        promise: runStudentApplicationsEmailQuery(filters)
      });
    }
    if (!sources.length) {
      throw new Error("Не настроены источники заявок: база сайта и электронная почта.");
    }

    const settled = await Promise.allSettled(sources.map((source) => source.promise));
    const warnings = [];
    const rows = [];
    let truncated = false;
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        warnings.push(`${sources[index].label}: ${result.reason?.message || "источник недоступен"}`);
        return;
      }
      rows.push(...(Array.isArray(result.value?.rows) ? result.value.rows : []));
      truncated ||= Boolean(result.value?.truncated);
      warnings.push(...(Array.isArray(result.value?.warnings) ? result.value.warnings : []));
    });
    if (settled.every((result) => result.status === "rejected")) {
      throw new Error(warnings.join("\n"));
    }

    const uniqueRows = [];
    const seen = new Set();
    rows
      .slice()
      .sort((left, right) => (
        String(right.dateCreated || "").localeCompare(String(left.dateCreated || ""))
        || String(right.id || "").localeCompare(String(left.id || ""))
      ))
      .forEach((row) => {
        const key = `${row.sourceType || "mysql"}\u0000${row.orderId || ""}\u0000${row.productId || ""}\u0000${row.id || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        uniqueRows.push(row);
      });
    sendJson(res, 200, {
      rows: uniqueRows,
      total: uniqueRows.length,
      truncated,
      warnings
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

function sanitizeStudentDatabaseExportPayload(body) {
  if (!Array.isArray(body.students) || !body.students.length) {
    throw new Error("В облачной базе нет слушателей для синхронизации.");
  }
  if (body.students.length > MAX_STUDENT_DATABASE_EXPORT_STUDENTS) {
    throw new Error(`Число слушателей превышает допустимый предел ${MAX_STUDENT_DATABASE_EXPORT_STUDENTS}.`);
  }
  if (!Array.isArray(body.directExpenses)) {
    throw new Error("Не передан список прямых затрат.");
  }
  if (body.directExpenses.length > MAX_STUDENT_DATABASE_EXPORT_EXPENSES) {
    throw new Error(`Число прямых затрат превышает допустимый предел ${MAX_STUDENT_DATABASE_EXPORT_EXPENSES}.`);
  }
  const students = body.students
    .filter((student) => student && typeof student === "object" && !Array.isArray(student))
    .map((student) => {
      const {
        photoData,
        photoUrl,
        directExpenses,
        ...databaseFields
      } = student;
      return databaseFields;
    });
  const directExpenses = body.directExpenses
    .filter((expense) => expense && typeof expense === "object" && !Array.isArray(expense))
    .map((expense) => ({ ...expense }));
  return {
    students,
    directExpenses,
    studentColumnMap: {
      ...STUDENT_DATABASE_COLUMN_MAP,
      "ДопНастрСлушат": "__eventSettings"
    },
    studentDateFields: [...STUDENT_DATABASE_DATE_FIELDS],
    studentNumberFields: [...STUDENT_DATABASE_NUMBER_FIELDS],
    directExpenseColumnMap: DIRECT_EXPENSE_DATABASE_COLUMN_MAP,
    studentEventTemplates: STUDENT_EVENT_IMPORT_TEMPLATES
  };
}

async function safelyRemoveStudentDatabaseExportDirectory(directoryPath) {
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedPath = path.resolve(directoryPath);
  const relativePath = path.relative(tempRoot, resolvedPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return;
  await fs.rm(resolvedPath, { recursive: true, force: true });
}

function buildStudentDatabaseExportFileName() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-")
    + "_"
    + [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0")
    ].join("-");
  return `АИС Допобразование_${stamp}.xlsb`;
}

function formatImportBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function parseStudentDatabaseInWorker(bytes, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(ROOT, "student-import-worker.js"), {
      workerData: bytes
    });
    let settled = false;
    worker.on("message", (message) => {
      if (message?.type === "progress") {
        onProgress(message.progress || {});
        return;
      }
      if (message?.type === "result") {
        settled = true;
        resolve(message.result);
        return;
      }
      if (message?.type === "error") {
        settled = true;
        reject(new Error(message.message || "Не удалось обработать базу Excel."));
      }
    });
    worker.on("error", (error) => {
      if (!settled) reject(error);
    });
    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        reject(new Error(`Обработка базы Excel завершилась с кодом ${code}.`));
      }
    });
  });
}

function buildStudentDatabaseImportResult(result) {
  return {
    ...result,
    count: result.students.length,
    directExpenseCount: result.directExpenses.length,
    linkedDirectExpenseCount: result.linkedDirectExpenseCount,
    totalDirectExpenseCount: result.totalDirectExpenseCount,
    sourceName: "АИС Допобразование.xlsb",
    importedAt: new Date().toISOString()
  };
}

function cleanupStudentImportJobs() {
  const expiresBefore = Date.now() - STUDENT_IMPORT_JOB_TTL_MS;
  studentImportJobs.forEach((job, id) => {
    if (job.updatedAt < expiresBefore) studentImportJobs.delete(id);
  });
}

function updateStudentImportJob(job, patch) {
  if (Number.isFinite(Number(patch.progress))) {
    job.progress = Math.max(
      Number(job.progress) || 0,
      Math.min(100, Math.round(Number(patch.progress)))
    );
  }
  if (patch.status) job.status = patch.status;
  if (patch.stage) job.stage = patch.stage;
  if (patch.message) job.message = patch.message;
  if (Object.prototype.hasOwnProperty.call(patch, "error")) job.error = patch.error;
  job.updatedAt = Date.now();
}

function publicStudentImportJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    error: job.error || "",
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString()
  };
}

async function runStudentImportJob(job, databasePath) {
  try {
    updateStudentImportJob(job, {
      stage: "download",
      message: "Получение файла через WebDAV...",
      progress: 0
    });
    const bytes = await loadStudentDatabaseBytes(databasePath, ({ receivedBytes, totalBytes }) => {
      const downloadPercent = totalBytes > 0
        ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100))
        : 0;
      updateStudentImportJob(job, {
        stage: "download",
        progress: totalBytes > 0 ? downloadPercent / 2 : job.progress,
        message: totalBytes > 0
          ? `Скачивание файла: ${downloadPercent}% (${formatImportBytes(receivedBytes)} из ${formatImportBytes(totalBytes)})`
          : `Скачано ${formatImportBytes(receivedBytes)}`
      });
    });
    updateStudentImportJob(job, {
      stage: "parse",
      progress: 50,
      message: `Файл загружен (${formatImportBytes(bytes.length)}). Чтение XLSB...`
    });
    const result = await parseStudentDatabaseInWorker(bytes, (parseProgress) => {
      const value = Math.max(0, Math.min(100, Number(parseProgress.progress) || 0));
      updateStudentImportJob(job, {
        stage: "parse",
        progress: 50 + value * 0.49,
        message: parseProgress.message || "Обработка данных Excel..."
      });
    });
    job.result = buildStudentDatabaseImportResult(result);
    updateStudentImportJob(job, {
      status: "completed",
      stage: "complete",
      progress: 100,
      message: `Обработано: ${job.result.count} слушателей, ${job.result.totalDirectExpenseCount} расходов`
    });
  } catch (error) {
    updateStudentImportJob(job, {
      status: "failed",
      stage: "error",
      error: error instanceof Error ? error.message : String(error),
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function loadLocalTemplateBytes(templatePath) {
  const requestedPath = String(templatePath || "").trim();
  if (!requestedPath) throw new Error("Не указана ссылка или путь к шаблону договора.");
  const fullPath = path.isAbsolute(requestedPath)
    ? requestedPath
    : path.resolve(ROOT, requestedPath);
  const extension = path.extname(fullPath).replace(/^\./, "").toLowerCase();
  if (!WORD_TEMPLATE_EXTENSIONS.has(extension)) {
    throw new Error("Шаблон договора должен быть файлом Word.");
  }
  const stat = await fs.stat(fullPath);
  if (!stat.isFile()) throw new Error("Шаблон договора не найден.");
  if (stat.size > MAX_DOCX_BYTES) throw new Error("Шаблон договора слишком большой.");
  return fs.readFile(fullPath);
}

async function loadRemoteTemplateBytes(templateUrl) {
  const source = String(templateUrl || "").trim();
  const parsed = parseHttpResourceUrl(source);
  const host = parsed?.hostname.toLowerCase() || "";
  let bytes;
  if (!parsed || isYandexWebDavHost(host)) {
    bytes = await loadYandexWebDavResourceBytes(source, { maxResponseBytes: MAX_DOCX_BYTES });
  } else if (isYandexDiskHost(host)) bytes = await downloadYandexDiskPublicFile(source);
  else if (isGoogleDriveHost(host)) bytes = await downloadGoogleDrivePublicFile(source);
  else if (isOneDriveHost(host)) bytes = await downloadOneDrivePublicFile(source);
  else bytes = await requestBuffer(source);
  if (bytes.length > MAX_DOCX_BYTES) throw new Error("Скачанный шаблон договора слишком большой.");
  return bytes;
}

async function loadTemplateBytes(templateUrl, templatePath) {
  const url = String(templateUrl || "").trim();
  if (!url) return loadLocalTemplateBytes(templatePath);
  try {
    return await loadRemoteTemplateBytes(url);
  } catch (error) {
    if (!String(templatePath || "").trim()) throw error;
    return loadLocalTemplateBytes(templatePath);
  }
}

function getWordTemplateExtension(fileName) {
  return String(fileName || "").split(".").pop()?.toLowerCase() || "";
}

function stripWordTemplateExtension(fileName) {
  return String(fileName || "").replace(/\.(?:doc|docx|docm|dot|dotx|dotm|rtf)$/i, "");
}

function parseWordTemplateDataUrl(dataUrl, fileName) {
  const extension = getWordTemplateExtension(fileName);
  if (!WORD_TEMPLATE_EXTENSIONS.has(extension)) {
    throw new Error("Выберите файл Word: doc, docx, docm, dot, dotx, dotm или rtf.");
  }
  const match = /^data:[^,]*;base64,([\s\S]+)$/i.exec(String(dataUrl || ""));
  if (!match) throw new Error("Expected Word file data URL");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length) throw new Error("Empty Word file");
  if (bytes.length > MAX_DOCX_BYTES) throw new Error("Шаблон договора слишком большой.");
  return bytes;
}

function buildDocumentTemplateFileName(fileName) {
  const extension = WORD_TEMPLATE_EXTENSIONS.has(getWordTemplateExtension(fileName))
    ? getWordTemplateExtension(fileName)
    : "docx";
  const base = safeNamePart(stripWordTemplateExtension(fileName || "template"), "template");
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${base}_${suffix}.${extension}`;
}

function extractWordTextBlocks(xml) {
  const paragraphMatches = [...String(xml || "").matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  const blocks = paragraphMatches.length ? paragraphMatches.map((match) => match[0]) : [String(xml || "")];
  return blocks
    .map((block) => {
      const parts = [];
      for (const textMatch of block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) {
        parts.push(decodeXmlText(textMatch[1]));
      }
      return parts.join("");
    })
    .filter(Boolean);
}

function isValidDocxTextMarkerName(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 120) return false;
  return !/[\\\/&;]/.test(text);
}

function parseDocxTextMarkers(entries) {
  const markers = new Set();
  entries
    .filter((entry) => /^word\/(?:document|header\d*|footer\d*)\.xml$/i.test(entry.name))
    .forEach((entry) => {
      const xml = entry.content.toString("utf8");
      extractWordTextBlocks(xml).forEach((textBlock) => {
        for (const match of textBlock.matchAll(/#([^#<>\r\n]{1,120})#/g)) {
          const marker = match[1].trim();
          if (isValidDocxTextMarkerName(marker)) markers.add(marker);
        }
      });
    });
  return [...markers].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
}

function parseDocxIndexedFields(entries) {
  const fields = [];
  const seen = new Set();
  entries
    .filter((entry) => /^word\/(?:document|header\d*|footer\d*)\.xml$/i.test(entry.name))
    .forEach((entry) => {
      const xml = entry.content.toString("utf8");
      const fieldPattern = /<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>([\s\S]*?)<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>/g;
      for (const fieldMatch of xml.matchAll(fieldPattern)) {
        const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(fieldMatch[1] || ""));
        if (!indexedField || seen.has(indexedField.position)) continue;
        seen.add(indexedField.position);
        fields.push({
          position: indexedField.position,
          value: indexedField.value,
          source: `${indexedField.type}-field`
        });
      }
      const simpleFieldPattern = /<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>/g;
      for (const fieldMatch of xml.matchAll(simpleFieldPattern)) {
        const indexedField = parseIndexedWordFieldInstruction(fieldMatch[1] || "");
        if (!indexedField || seen.has(indexedField.position)) continue;
        seen.add(indexedField.position);
        fields.push({
          position: indexedField.position,
          value: indexedField.value,
          source: `${indexedField.type}-field`
        });
      }
    });
  return fields.sort((left, right) => left.position - right.position);
}

function mapIndexedFieldsToDocumentProperties(indexedFields, properties) {
  const propertiesByFieldNumber = new Map();
  const propertiesByPosition = new Map();
  (Array.isArray(properties) ? properties : []).forEach((property) => {
    const fieldNumber = Number(property?.fieldNumber);
    if (Number.isFinite(fieldNumber) && fieldNumber > 0 && property?.name) {
      propertiesByFieldNumber.set(fieldNumber, property);
    }
    const position = Number(property?.position);
    if (Number.isFinite(position) && position > 0 && property?.name) {
      propertiesByPosition.set(position, property);
    }
  });
  return (Array.isArray(indexedFields) ? indexedFields : []).map((field) => {
    const property = propertiesByFieldNumber.get(Number(field.position))
      || propertiesByPosition.get(Number(field.position));
    return {
      ...field,
      name: property?.name || "",
      formula: property?.value || "",
      hideEmpty: Boolean(property?.hideEmpty),
      source: field.source || "indexed-field"
    };
  });
}

function inspectDocxTemplate(templateBytes) {
  const entries = readDocxZipEntries(templateBytes);
  const formulaProperties = getDocumentFormulaPropertiesFromEntries(entries);
  const properties = formulaProperties
    .map((property) => ({
      name: property.name,
      formula: property.value,
      isFormula: isFormulaLike(property.value),
      fieldNumber: property.fieldNumber,
      position: property.position,
      hideEmpty: Boolean(property.hideEmpty),
      source: property.source || "custom-property"
    }))
    .filter((property) => property.name);
  return {
    properties,
    subjectFields: mapIndexedFieldsToDocumentProperties(parseDocxIndexedFields(entries), formulaProperties),
    markers: parseDocxTextMarkers(entries)
  };
}

function inspectWordTemplate(templateBytes, fileName = "") {
  const extension = getWordTemplateExtension(fileName);
  if (extension && WORD_TEMPLATE_EXTENSIONS.has(extension) && !OPENXML_WORD_EXTENSIONS.has(extension)) {
    return { properties: [], markers: [], unsupportedInspection: true };
  }
  try {
    return inspectDocxTemplate(templateBytes);
  } catch (error) {
    return { properties: [], markers: [], unsupportedInspection: true, inspectionMessage: error.message };
  }
}

async function handleDocumentTemplateInspect(req, res) {
  try {
    const body = await readJsonBody(req);
    const templateBytes = await loadTemplateBytes(body.templateUrl, body.templatePath);
    sendJson(res, 200, inspectWordTemplate(templateBytes, body.fileName || body.templateUrl || body.templatePath || ""));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleDocumentTemplateUpload(req, res) {
  try {
    const body = await readJsonBody(req);
    const bytes = parseWordTemplateDataUrl(body.dataUrl, body.fileName);
    const fileName = buildDocumentTemplateFileName(body.fileName);
    const fullPath = path.join(DOCUMENT_TEMPLATE_ROOT, fileName);
    await fs.writeFile(fullPath, bytes);
    sendJson(res, 201, {
      templatePath: `storage/document-templates/${fileName}`,
      fileName,
      ...inspectWordTemplate(bytes, fileName)
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentDatabaseImport(req, res) {
  try {
    const body = await readJsonBody(req);
    const bytes = await loadStudentDatabaseBytes(body.databasePath);
    const result = await parseStudentDatabaseInWorker(bytes);
    sendJson(res, 200, buildStudentDatabaseImportResult(result));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function buildStudentDatabaseExport(body, onProgress = () => {}) {
  let tempDirectory = "";
  try {
    onProgress({ progress: 1, stage: "prepare", message: "Подготовка данных веб-базы..." });
    const payload = sanitizeStudentDatabaseExportPayload(body);
    onProgress({ progress: 2, stage: "download", message: "Получение исходного XLSB..." });
    const sourceBytes = await loadStudentDatabaseBytes(body.databasePath, ({ receivedBytes, totalBytes }) => {
      const downloadPercent = totalBytes > 0
        ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100))
        : 0;
      onProgress({
        progress: totalBytes > 0 ? 2 + downloadPercent * 0.13 : 2,
        stage: "download",
        message: totalBytes > 0
          ? `Скачивание исходной базы: ${downloadPercent}%`
          : `Скачано ${formatImportBytes(receivedBytes)}`
      });
    });
    onProgress({ progress: 16, stage: "inspect", message: "Проверка структуры исходной книги..." });
    const sourceInspection = inspectStudentDatabaseBinary(sourceBytes);
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ais-student-database-export-"));
    const inputPath = path.join(tempDirectory, "source.xlsb");
    const outputPath = path.join(tempDirectory, "updated.xlsb");
    const payloadPath = path.join(tempDirectory, "payload.json");
    onProgress({ progress: 19, stage: "prepare", message: "Подготовка файлов для Microsoft Excel..." });
    await Promise.all([
      fs.writeFile(inputPath, sourceBytes),
      fs.writeFile(payloadPath, JSON.stringify(payload), "utf8")
    ]);
    await runStudentDatabaseSyncScript(inputPath, outputPath, payloadPath, (scriptProgress) => {
      const value = Math.max(0, Math.min(100, Number(scriptProgress.progress) || 0));
      onProgress({
        progress: 20 + value * 0.7,
        stage: "excel",
        message: scriptProgress.message || "Обновление книги в Microsoft Excel..."
      });
    });
    onProgress({ progress: 92, stage: "verify", message: "Чтение сформированной книги..." });
    const outputBytes = await fs.readFile(outputPath);
    if (!outputBytes.length) throw new Error("Microsoft Excel создал пустой файл.");
    onProgress({ progress: 95, stage: "verify", message: "Проверка VBA и формул..." });
    const outputInspection = inspectStudentDatabaseBinary(outputBytes);
    if (sourceInspection.hasVba && !outputInspection.hasVba) {
      throw new Error("Проверка сформированной книги не пройдена: VBA-модули не сохранены.");
    }
    const baseFormulaLoss = sourceInspection.baseFormulaCount - outputInspection.baseFormulaCount;
    const directExpenseFormulaLoss = (
      sourceInspection.directExpenseFormulaCount - outputInspection.directExpenseFormulaCount
    );
    if (baseFormulaLoss > 5 || directExpenseFormulaLoss > 5) {
      throw new Error(
        "Проверка сформированной книги не пройдена: потеряно слишком много формул "
        + `(База: ${sourceInspection.baseFormulaCount} → ${outputInspection.baseFormulaCount}; `
        + `Прямые затраты: ${sourceInspection.directExpenseFormulaCount} → ${outputInspection.directExpenseFormulaCount}).`
      );
    }
    onProgress({ progress: 99, stage: "complete", message: "Подготовка XLSB к скачиванию..." });
    await safelyRemoveStudentDatabaseExportDirectory(tempDirectory);
    tempDirectory = "";
    return {
      bytes: outputBytes,
      fileName: buildStudentDatabaseExportFileName(),
      studentCount: payload.students.length,
      directExpenseCount: payload.directExpenses.length
    };
  } finally {
    if (tempDirectory) {
      await safelyRemoveStudentDatabaseExportDirectory(tempDirectory).catch(() => {});
    }
  }
}

async function handleStudentDatabaseExport(req, res) {
  try {
    const body = await readJsonBody(req);
    const result = await buildStudentDatabaseExport(body);
    sendFile(
      res,
      200,
      result.bytes,
      result.fileName,
      "application/vnd.ms-excel.sheet.binary.macroEnabled.12"
    );
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

function cleanupStudentExportJobs() {
  const expiresBefore = Date.now() - STUDENT_IMPORT_JOB_TTL_MS;
  studentExportJobs.forEach((job, id) => {
    if (job.updatedAt < expiresBefore) studentExportJobs.delete(id);
  });
}

function updateStudentExportJob(job, patch) {
  if (Number.isFinite(Number(patch.progress))) {
    job.progress = Math.max(
      Number(job.progress) || 0,
      Math.min(100, Math.round(Number(patch.progress)))
    );
  }
  if (patch.status) job.status = patch.status;
  if (patch.stage) job.stage = patch.stage;
  if (patch.message) job.message = patch.message;
  if (Object.prototype.hasOwnProperty.call(patch, "error")) job.error = patch.error;
  job.updatedAt = Date.now();
}

function publicStudentExportJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    error: job.error || "",
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString()
  };
}

async function runStudentExportJob(job, body) {
  try {
    job.result = await buildStudentDatabaseExport(body, (progress) => {
      updateStudentExportJob(job, progress);
    });
    updateStudentExportJob(job, {
      status: "completed",
      stage: "complete",
      progress: 100,
      message: `Готово: ${job.result.studentCount} слушателей, ${job.result.directExpenseCount} расходов`
    });
  } catch (error) {
    updateStudentExportJob(job, {
      status: "failed",
      stage: "error",
      error: error instanceof Error ? error.message : String(error),
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleStudentDatabaseExportStart(req, res) {
  try {
    const body = await readJsonBody(req);
    cleanupStudentExportJobs();
    const now = Date.now();
    const job = {
      id: crypto.randomUUID(),
      status: "running",
      stage: "prepare",
      message: "Подготовка синхронизации...",
      progress: 0,
      error: "",
      result: null,
      createdAt: now,
      updatedAt: now
    };
    studentExportJobs.set(job.id, job);
    setImmediate(() => runStudentExportJob(job, body));
    sendJson(res, 202, publicStudentExportJob(job));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

function getStudentExportJob(requestUrl) {
  cleanupStudentExportJobs();
  const id = String(requestUrl.searchParams.get("id") || "").trim();
  return id ? studentExportJobs.get(id) : null;
}

function handleStudentDatabaseExportStatus(res, requestUrl) {
  const job = getStudentExportJob(requestUrl);
  if (!job) {
    sendError(res, 404, "Задача синхронизации не найдена или срок её хранения истёк.");
    return;
  }
  sendJson(res, 200, publicStudentExportJob(job));
}

function handleStudentDatabaseExportResult(res, requestUrl) {
  const job = getStudentExportJob(requestUrl);
  if (!job) {
    sendError(res, 404, "Задача синхронизации не найдена или срок её хранения истёк.");
    return;
  }
  if (job.status === "failed") {
    sendError(res, 400, job.error || "Синхронизация завершилась с ошибкой.");
    return;
  }
  if (job.status !== "completed" || !job.result?.bytes) {
    sendError(res, 409, "Синхронизация ещё не завершена.");
    return;
  }
  sendFile(
    res,
    200,
    job.result.bytes,
    job.result.fileName,
    "application/vnd.ms-excel.sheet.binary.macroEnabled.12"
  );
}

async function handleStudentDatabaseImportStart(req, res) {
  try {
    const body = await readJsonBody(req);
    const databasePath = String(
      body.databasePath
      || serverSettings.studentDatabaseWebDavPath
      || DEFAULT_STUDENT_DATABASE_WEBDAV_PATH
    ).trim();
    if (!databasePath) throw new Error("Не указан WebDAV-путь или ссылка на базу слушателей.");
    cleanupStudentImportJobs();
    const now = Date.now();
    const job = {
      id: crypto.randomUUID(),
      status: "running",
      stage: "prepare",
      message: "Подготовка импорта...",
      progress: 0,
      error: "",
      result: null,
      createdAt: now,
      updatedAt: now
    };
    studentImportJobs.set(job.id, job);
    setImmediate(() => runStudentImportJob(job, databasePath));
    sendJson(res, 202, publicStudentImportJob(job));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

function getStudentImportJob(requestUrl) {
  cleanupStudentImportJobs();
  const id = String(requestUrl.searchParams.get("id") || "").trim();
  return id ? studentImportJobs.get(id) : null;
}

function handleStudentDatabaseImportStatus(res, requestUrl) {
  const job = getStudentImportJob(requestUrl);
  if (!job) {
    sendError(res, 404, "Задача импорта не найдена или срок ее хранения истек.");
    return;
  }
  sendJson(res, 200, publicStudentImportJob(job));
}

function handleStudentDatabaseImportResult(res, requestUrl) {
  const job = getStudentImportJob(requestUrl);
  if (!job) {
    sendError(res, 404, "Задача импорта не найдена или срок ее хранения истек.");
    return;
  }
  if (job.status === "failed") {
    sendError(res, 400, job.error || "Импорт завершился с ошибкой.");
    return;
  }
  if (job.status !== "completed" || !job.result) {
    sendError(res, 409, "Импорт еще не завершен.");
    return;
  }
  sendJson(res, 200, job.result);
}

async function handleContractDocument(req, res) {
  try {
    const body = await readJsonBody(req);
    const templateBytes = await loadTemplateBytes(body.templateUrl, body.templatePath);
    const inputFieldValues = body.fieldValues || {};
    const fieldValues = body.useCustomDocumentProperties
      ? applyCustomDocumentPropertyFormulas(templateBytes, inputFieldValues, body.sourceValues || {})
      : inputFieldValues;
    const propertyUpdateNames = new Set(Object.keys(inputFieldValues || {}));
    const sourceValues = body.sourceValues || {};
    const photo = await loadContractPhoto({
      ...fieldValues,
      "Фото": sourceValues["Фото"] || fieldValues["Фото"] || "",
      photo: sourceValues.photo || fieldValues.photo || "",
      photoPath: sourceValues.photoPath || fieldValues.photoPath || ""
    });
    const outputFieldValues = { ...fieldValues, "Фото": "" };
    if (!photo) outputFieldValues["ПутьСохр"] = "";
    const result = fillDocxMarkers(templateBytes, outputFieldValues, photo ? { "Фото": photo } : { "Фото": null }, propertyUpdateNames);
    const extraHeaders = {};
    if (body.saveToYandexDisk) {
      try {
        const uploadedPath = await uploadStudentDocumentToYandexDisk(
          result,
          body.fileName || "договор",
          body
        );
        extraHeaders["X-Yandex-Disk-Saved"] = "true";
        extraHeaders["X-Yandex-Disk-Path"] = encodeURIComponent(uploadedPath);
      } catch (uploadError) {
        extraHeaders["X-Yandex-Disk-Saved"] = "false";
        extraHeaders["X-Yandex-Disk-Error"] = encodeURIComponent(uploadError.message);
      }
    }
    sendFile(
      res,
      200,
      result,
      safeDocumentFileName(body.fileName || "договор"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extraHeaders
    );
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new Error("Payload is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([\s\S]+)$/i.exec(String(dataUrl || ""));
  if (!match) throw new Error("Expected image data URL");
  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const bytes = Buffer.from(match[3], "base64");
  if (!bytes.length) throw new Error("Empty image");
  return { bytes, ext, mime: match[1].toLowerCase() };
}

function safeNamePart(value, fallback) {
  const cleaned = String(value || "")
    .normalize("NFC")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_().-]+/gu, "")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function buildStudentCompactName(value) {
  const parts = String(value || "").normalize("NFC").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const surname = safeNamePart(parts[0], "");
  const initials = [];
  for (const part of parts.slice(1)) {
    const letters = part.match(/\p{L}/gu) || [];
    if (!letters.length) continue;
    if (part.includes(".")) {
      initials.push(...letters);
    } else {
      initials.push(letters[0]);
    }
    if (initials.length >= 2) break;
  }
  return safeNamePart(`${surname}${initials.slice(0, 2).join("")}`, "");
}

function managedStudentPhotoRelativePath(value) {
  if (usesParentSystemDocumentsFolder(value)) return "";
  const relativePath = normalizeSystemDocumentsRelativePath(value);
  return /^Слушатели\/[^/]+\/Документы\/[^/]+\.(?:png|jpe?g|webp|gif)$/iu.test(relativePath)
    ? relativePath
    : "";
}

async function deleteManagedStudentPhoto(photoPath) {
  const relativePath = managedStudentPhotoRelativePath(photoPath);
  if (!relativePath) return false;
  const remotePath = normalizeWebDavPath(`${resolveYandexDiskBasePath(false)}/${relativePath}`);
  const response = await requestYandexWebDav("DELETE", remotePath, {
    acceptedStatuses: [200, 204, 404]
  });
  return response.statusCode === 200 || response.statusCode === 204;
}

function isInsideRoot(fullPath) {
  const relativePath = path.relative(ROOT, fullPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function deletePhoto(photoPath) {
  const fullPath = resolveStoredPhotoPath(photoPath);
  if (!fullPath) return false;
  const relativePath = path.relative(PHOTO_ROOT, fullPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return false;
  try {
    await fs.unlink(fullPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function handlePhotoUpload(req, res) {
  try {
    const body = await readJsonBody(req);
    const { bytes, ext, mime } = parseDataUrl(body.dataUrl);
    const studentName = String(
      body.studentName || body.studentFio || body.fio || body.fullName || body.name || ""
    ).trim();
    const compactName = buildStudentCompactName(studentName);
    if (!compactName) throw new Error("Сначала укажите ФИО слушателя.");
    const relativeFolder = `Слушатели/${compactName}/Документы`;
    const relativePath = `${relativeFolder}/${compactName}.${ext}`;
    const folderPath = normalizeWebDavPath(
      `${resolveYandexDiskBasePath(false)}/${relativeFolder}`
    );
    await ensureYandexDiskFolder(folderPath);
    const targetPath = normalizeWebDavPath(`${resolveYandexDiskBasePath(false)}/${relativePath}`);
    await requestYandexWebDav("PUT", targetPath, {
      acceptedStatuses: [200, 201, 204],
      body: bytes,
      contentType: mime
    });
    const previousPath = String(body.previousPath || "").trim();
    if (previousPath && previousPath !== relativePath) {
      try {
        if (!await deleteManagedStudentPhoto(previousPath)) await deletePhoto(previousPath);
      } catch (cleanupError) {
        console.warn(`Не удалось удалить предыдущее фото: ${cleanupError.message}`);
      }
    }
    sendJson(res, 201, {
      photoPath: relativePath,
      photoUrl: `/api/student-photo?path=${encodeURIComponent(relativePath)}`
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handlePhotoDelete(req, res) {
  try {
    const body = await readJsonBody(req);
    const deleted = await deleteManagedStudentPhoto(body.photoPath)
      || await deletePhoto(body.photoPath);
    sendJson(res, 200, { deleted });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentSourcePhoto(req, res, requestUrl) {
  const sourcePath = String(requestUrl.searchParams.get("path") || "").trim();
  const ext = imageExtensionFromPath(sourcePath);
  if (!ext) {
    sendError(res, 404, "Фото не найдено.");
    return;
  }
  try {
    const bytes = await loadSystemDocumentFromYandexDisk(sourcePath);
    if (!bytes) {
      sendError(res, 404, "Фото не найдено.");
      return;
    }
    const headers = {
      ...CORS_HEADERS,
      "Content-Type": IMAGE_CONTENT_TYPES[ext],
      "Content-Length": bytes.length,
      "Cache-Control": "no-store"
    };
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(bytes);
  } catch (error) {
    sendError(res, 404, "Фото не найдено.");
  }
}

function publicSystemDocumentSettings() {
  return {
    databasePath: normalizeYandexDiskResourceSetting(
      serverSettings.studentDatabaseWebDavPath,
      DEFAULT_STUDENT_DATABASE_WEBDAV_PATH
    ),
    basePath: normalizeWebDavPath(
      serverSettings.yandexDiskBasePath || DEFAULT_YANDEX_DISK_BASE_PATH
    ).replace(/^\/+/, ""),
    localDocumentsRoot: String(
      serverSettings.localDocumentsRoot || DEFAULT_LOCAL_DOCUMENTS_ROOT
    ).trim(),
    localDocumentsRootIsSystemParent: Boolean(
      serverSettings.localDocumentsRootIsSystemParent
    ),
    login: String(serverSettings.yandexDiskLogin || process.env.YANDEX_DISK_LOGIN || "").trim(),
    hasPassword: Boolean(
      serverSettings.yandexDiskPassword || process.env.YANDEX_DISK_PASSWORD
    ),
    autoSave: Boolean(serverSettings.yandexDiskAutoSave),
    emailHost: String(serverSettings.studentApplicationsEmailHost || "").trim(),
    emailPort: Number(serverSettings.studentApplicationsEmailPort || 993),
    emailLogin: String(serverSettings.studentApplicationsEmailLogin || "").trim(),
    emailHasPassword: Boolean(
      serverSettings.studentApplicationsEmailPassword
        || process.env.STUDENT_APPLICATIONS_EMAIL_PASSWORD
    )
  };
}

async function handleSystemDocumentSettings(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, publicSystemDocumentSettings());
    return;
  }
  try {
    const body = await readJsonBody(req);
    const databasePath = normalizeYandexDiskResourceSetting(
      body.databasePath,
      DEFAULT_STUDENT_DATABASE_WEBDAV_PATH
    );
    const basePath = normalizeWebDavPath(body.basePath || DEFAULT_YANDEX_DISK_BASE_PATH);
    const localDocumentsRoot = String(
      body.localDocumentsRoot || DEFAULT_LOCAL_DOCUMENTS_ROOT
    ).trim();
    if (!path.isAbsolute(localDocumentsRoot)) {
      throw new Error("Укажите абсолютный путь к локальной папке документов.");
    }
    const login = String(body.login || "").trim();
    const password = String(body.password || "");
    const emailHost = String(body.emailHost || "").trim();
    const emailPort = Number(body.emailPort || 993);
    const emailLogin = String(body.emailLogin || "").trim();
    const emailPassword = String(body.emailPassword || "");
    if (!Number.isInteger(emailPort) || emailPort < 1 || emailPort > 65535) {
      throw new Error("Укажите корректный порт IMAP.");
    }
    const patch = {
      studentDatabaseWebDavPath: databasePath,
      yandexDiskBasePath: basePath.replace(/^\/+/, ""),
      localDocumentsRoot: path.resolve(localDocumentsRoot),
      localDocumentsRootIsSystemParent: Boolean(body.localDocumentsRootIsSystemParent),
      yandexDiskLogin: login,
      yandexDiskAutoSave: Boolean(body.autoSave),
      studentApplicationsEmailHost: emailHost,
      studentApplicationsEmailPort: emailPort,
      studentApplicationsEmailSecure: true,
      studentApplicationsEmailLogin: emailLogin
    };
    if (password) patch.yandexDiskPassword = password;
    if (body.clearPassword) patch.yandexDiskPassword = "";
    if (emailPassword) patch.studentApplicationsEmailPassword = emailPassword;
    if (body.clearEmailPassword) patch.studentApplicationsEmailPassword = "";
    await saveServerSettings(patch);
    sendJson(res, 200, publicSystemDocumentSettings());
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleYandexDiskConnectionTest(req, res) {
  try {
    const basePath = await testYandexDiskConnection();
    sendJson(res, 200, {
      ok: true,
      basePath,
      message: "Подключение к Яндекс-Диску по WebDAV работает."
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentApplicationsEmailConnectionTest(req, res) {
  try {
    const settings = await testStudentApplicationsEmailConnection();
    sendJson(res, 200, {
      ok: true,
      host: settings.host,
      message: "Подключение к почтовому ящику по IMAP работает."
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const normalizedPublicPath = decodedPath.replace(/\\/g, "/").toLowerCase();
  const isPublicPhotoPath = normalizedPublicPath.startsWith("/storage/photos/");
  if (
    (normalizedPublicPath.startsWith("/storage/") && !isPublicPhotoPath)
    || normalizedPublicPath.startsWith("/scripts/")
  ) {
    sendError(res, 404, "Not found");
    return;
  }
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const fullPath = path.resolve(ROOT, relativePath);
  if (!isInsideRoot(fullPath)) {
    sendError(res, 403, "Forbidden");
    return;
  }
  try {
    if (path.extname(fullPath).toLowerCase() === ".php") {
      sendError(res, 404, "Not found");
      return;
    }
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      res.writeHead(301, { Location: `${requestUrl.pathname.replace(/\/$/, "")}/index.html` });
      res.end();
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    const headers = { ...CORS_HEADERS, "Content-Type": MIME_TYPES[ext] || "application/octet-stream" };
    if (decodedPath.startsWith("/storage/photos/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    const file = await fs.readFile(fullPath);
    res.writeHead(200, headers);
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendError(res, 404, "Not found");
      return;
    }
    sendError(res, 500, error.message);
  }
}

async function route(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, storage: "yandex-disk" });
    return;
  }
  if (req.method === "POST" && req.url === "/api/photos") {
    await handlePhotoUpload(req, res);
    return;
  }
  if (req.method === "DELETE" && req.url === "/api/photos") {
    await handlePhotoDelete(req, res);
    return;
  }
  if ((req.method === "GET" || req.method === "HEAD") && requestUrl.pathname === "/api/student-photo") {
    await handleStudentSourcePhoto(req, res, requestUrl);
    return;
  }
  if (
    (req.method === "GET" || req.method === "POST")
    && requestUrl.pathname === "/api/settings/system-documents"
  ) {
    await handleSystemDocumentSettings(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/local-documents/open-folder") {
    await handleOpenLocalDocumentsFolder(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/yandex-disk/test") {
    await handleYandexDiskConnectionTest(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/student-applications-email/test") {
    await handleStudentApplicationsEmailConnectionTest(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/import-applications/query") {
    await handleStudentApplicationsQuery(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/ensure-document-folders") {
    await handleEnsureStudentDocumentFolders(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/documents/template-inspect") {
    await handleDocumentTemplateInspect(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/documents/template-upload") {
    await handleDocumentTemplateUpload(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/import-database/start") {
    await handleStudentDatabaseImportStart(req, res);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/students/import-database/status") {
    handleStudentDatabaseImportStatus(res, requestUrl);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/students/import-database/result") {
    handleStudentDatabaseImportResult(res, requestUrl);
    return;
  }
  if (req.method === "POST" && req.url === "/api/students/import-database") {
    await handleStudentDatabaseImport(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/export-database/start") {
    await handleStudentDatabaseExportStart(req, res);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/students/export-database/status") {
    handleStudentDatabaseExportStatus(res, requestUrl);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/students/export-database/result") {
    handleStudentDatabaseExportResult(res, requestUrl);
    return;
  }
  if (req.method === "POST" && req.url === "/api/students/export-database") {
    await handleStudentDatabaseExport(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/contracts/student-document") {
    await handleContractDocument(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/send-mail.php") {
    sendError(res, 501, "PHP-отправщик доступен только на веб-сервере с настроенным PHP mail().");
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }
  sendError(res, 405, "Method not allowed");
}

if (isMainThread) {
  ensureStorage()
    .then(() => {
      http.createServer((req, res) => {
        route(req, res).catch((error) => sendError(res, 500, error.message));
      }).listen(PORT, () => {
        console.log(`АИС Допобразование Web: http://localhost:${PORT}`);
        console.log(`Фото: ${PHOTO_ROOT}`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  parseStudentDatabaseWorkbook
};
