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

const SERVER_CODE_ROOT = __dirname;
const ROOT = path.resolve(process.env.AIS_APP_ROOT || SERVER_CODE_ROOT);
const XLSX = require(path.join(ROOT, "vendor", "sheetjs", "xlsx.full.min.js"));
const PDF_LIB = require(path.join(ROOT, "vendor", "pdf-lib.min.js"));
const QR_CODE_GENERATOR = require(path.join(
  ROOT,
  "vendor",
  "qrcode-runtime",
  "node_modules",
  "qrcode-generator",
  "qrcode.js"
));

QR_CODE_GENERATOR.stringToBytes = QR_CODE_GENERATOR.stringToBytesFuncs["UTF-8"];
const MYSQL2_BUNDLE_PATH = path.join(ROOT, "vendor", "mysql2-bundle.cjs");
const STORAGE_ROOT = path.join(ROOT, "storage");
const PHOTO_ROOT = path.join(STORAGE_ROOT, "photos");
const SERVER_SETTINGS_PATH = path.join(STORAGE_ROOT, "server-settings.json");
const AUTH_USERS_PATH = path.join(STORAGE_ROOT, "users.json");
const AUTH_SESSIONS_PATH = path.join(STORAGE_ROOT, "auth-sessions.json");
const AUDIT_LOG_PATH = path.join(STORAGE_ROOT, "audit-log.jsonl");
const SHARED_APPLICATION_STATE_CACHE_PATH = path.join(STORAGE_ROOT, "shared-application-state.json");
const SHARED_APPLICATION_STATE_PENDING_PATH = path.join(STORAGE_ROOT, "shared-application-state-pending.json");
const SHARED_APPLICATION_STATE_BACKUP_ROOT = path.join(STORAGE_ROOT, "shared-state-backups");
const SHARED_RECORD_LOCKS_CACHE_PATH = path.join(STORAGE_ROOT, "shared-record-locks.json");
const SHARED_APPLICATION_STATE_RELATIVE_PATH = "Системные данные/Общая база АИС.json.gz";
const SHARED_RECORD_LOCKS_RELATIVE_PATH = `${SHARED_APPLICATION_STATE_RELATIVE_PATH}.locks.json`;
const AUTH_COOKIE_NAME = "AIS_SESSION";
const AUTH_PASSWORD_ITERATIONS = 210000;
const AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const AUDIT_MAX_ROWS = 100000;
const AUDIT_MAX_CHANGES = 100;
const STUDENT_DATABASE_SYNC_SCRIPT = path.join(ROOT, "scripts", "sync-student-database.ps1");
const STUDENT_APPLICATIONS_QUERY_SCRIPT = path.join(ROOT, "scripts", "query-student-applications.ps1");
const FRDO_EXPORT_TEMPLATE_PATH = path.join(ROOT, "data", "frdo-export-template.xlsx");
const DEFAULT_FRDO_EXPORT_FOLDER = "ФРДО";
const FRDO_UPLOAD_DEADLINE_POLICY_VERSION = 2;
let defaultStudentApplicationsSqlQuery = "";
const DEFAULT_STUDENT_DATABASE_WEBDAV_PATH = "ООО Цифровизация Плюс/АИС Допобразование/АИС Допобразование.xlsb";
const DEFAULT_YANDEX_DISK_BASE_PATH = "ООО Цифровизация Плюс/АИС Допобразование";
const DEFAULT_LOCAL_DOCUMENTS_ROOT = "Y:\\";
const DEFAULT_STUDENT_ADDITIONAL_STATUS = "На зачисление (пока без документов)";
const DEFAULT_STUDENT_APPLICATIONS_EMAIL_HOST = "imap.timeweb.ru";
const DEFAULT_STUDENT_APPLICATIONS_EMAIL_SMTP_HOST = "smtp.timeweb.ru";
const DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN = "mail@edu-plus.ru";
const DEFAULT_WOOCOMMERCE_EMAIL_LOGIN = "mail@zifra-plus.ru";
const DEFAULT_STUDENT_ORDER_ADMIN_URL_TEMPLATE = "https://zifra-plus.ru/wp-admin/post.php?post={НомерЗаказа}&action=edit&classic-editor";
let serverSettings = {};
const DOCUMENT_TEMPLATE_ROOT = path.join(STORAGE_ROOT, "document-templates");
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_DOCUMENT_CONVERTER_URL = "http://127.0.0.1:8082";
const DEFAULT_DOCUMENT_CONVERTER_SOURCE_URL = `http://host.docker.internal:${PORT}`;
const DEFAULT_OCR_SERVICE_URL = "http://127.0.0.1:8083";
const OCR_CLI_SCRIPT = path.join(SERVER_CODE_ROOT, "services", "ocr", "server.py");
const OCR_CLI_RUNTIME_ROOT = path.join(SERVER_CODE_ROOT, "services", "ocr", "runtime");
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const MAX_SHARED_APPLICATION_STATE_BYTES = 36 * 1024 * 1024;
const MAX_SHARED_RECORD_LOCKS_BYTES = 1024 * 1024;
const SHARED_RECORD_LOCK_TTL_MS = 30 * 1000;
const SHARED_RECORD_LOCK_MAX_COUNT = 5000;
const SHARED_STATE_MIRROR_INTERVAL_MS = 2000;
const SHARED_STATE_MYSQL_KEY = String(process.env.AIS_SHARED_STATE_KEY || "main").trim().slice(0, 64) || "main";
const SHARED_STATE_OFFLINE_QUEUE_MAX_OPERATIONS = 5000;
const SHARED_STATE_MYSQL_OFFLINE_RETRY_MS = 15 * 1000;
const MAX_DOCX_BYTES = 24 * 1024 * 1024;
const MAX_STUDENT_DATABASE_BYTES = 24 * 1024 * 1024;
const MAX_STUDENT_PHOTO_BYTES = 16 * 1024 * 1024;
const MAX_OCR_DOCUMENT_BYTES = 24 * 1024 * 1024;
const MAX_WEBDAV_BROWSER_FILE_BYTES = 24 * 1024 * 1024;
const MAX_WEBDAV_BROWSER_ENTRIES = 1000;
const MAX_WEBDAV_BROWSER_PREVIEW_TEXT_CHARS = 400000;
const MAX_OCR_DOCUMENT_FILES = 40;
const MAX_OCR_TOTAL_BYTES = 160 * 1024 * 1024;
const MAX_STUDENT_DATABASE_EXPORT_STUDENTS = 20000;
const MAX_STUDENT_DATABASE_EXPORT_EXPENSES = 100000;
const MAX_STUDENT_DATABASE_EXPORT_CONTRACTS = 20000;
const MAX_STUDENT_DATABASE_EXPORT_PROGRAMS = 20000;
const MAX_FRDO_EXPORT_RECORDS = 5000;
const MAX_PROGRAM_PROMO_MESSAGE_LENGTH = 32767;
const MAX_PAYMENT_DATABASE_CONSTANTS = 200;
const MAX_EMAIL_SUBJECT_LENGTH = 200;
const STUDENT_IMPORT_JOB_TTL_MS = 15 * 60 * 1000;
const STUDENT_DOCUMENT_RECOGNITION_JOB_TTL_MS = 30 * 60 * 1000;
const studentImportJobs = new Map();
const studentExportJobs = new Map();
const studentDocumentRecognitionJobs = new Map();
const serverEmailRateLimits = new Map();
const documentConversionSources = new Map();
let sharedApplicationStateWriteQueue = Promise.resolve();
let sharedRecordLocksWriteQueue = Promise.resolve();
let sharedRecordLocksMySqlPool = null;
let sharedRecordLocksMySqlInitialization = null;
let studentApplicationsMySqlPool = null;
let studentApplicationsMySqlInitialization = null;
let sharedStateMirrorRunning = false;
let sharedStateMirrorVersionTag = "";
let sharedStateMirrorLastError = "";
let sharedStateOfflineSyncPromise = null;
let sharedStateMySqlUnavailableUntil = 0;
let sharedApplicationStateCacheMemory = null;
let sharedApplicationStateCacheLoaded = false;
let sharedApplicationStatePendingMemory = null;
let sharedApplicationStatePendingLoaded = false;
const DOCUMENT_CONVERSION_SOURCE_TTL_MS = 5 * 60 * 1000;
const WORD_TEMPLATE_EXTENSIONS = new Set(["doc", "docx", "docm", "dot", "dotx", "dotm", "rtf"]);
const OPENXML_WORD_EXTENSIONS = new Set(["docx", "docm", "dotx", "dotm"]);
const OCR_DOCUMENT_CONTENT_TYPES = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".rtf": "application/rtf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text"
});
const WEBDAV_BROWSER_CONTENT_TYPES = Object.freeze({
  ".bmp": "image/bmp",
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docm": "application/vnd.ms-word.document.macroEnabled.12",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsb": "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".eml": "message/rfc822",
  ".zip": "application/zip"
});
const OCR_DOCUMENT_FIELD_LABELS = Object.freeze({
  name: "ФИО",
  birthDate: "Дата рождения",
  gender: "Пол",
  citizenship: "Гражданство",
  passportType: "Вид документа",
  passportNumber: "Серия и номер паспорта",
  passportDate: "Дата выдачи паспорта",
  passportCode: "Код подразделения",
  passportIssuer: "Кем выдан паспорт",
  registrationAddress: "Адрес места регистрации",
  snils: "СНИЛС",
  inn: "ИНН",
  educationLevel: "Уровень образования",
  educationDocument: "Документ об образовании",
  educationDocumentSeries: "Серия документа об образовании",
  educationDocumentNumber: "Номер документа об образовании",
  educationDocumentDate: "Дата выдачи документа об образовании",
  educationDocumentIssuer: "Кем выдан документ об образовании",
  educationSpecialty: "Специальность",
  educationQualification: "Квалификация",
  educationDocumentSurname: "Фамилия в документе",
  mailingAddress: "Адрес для отправки документов",
  phone: "Мобильный телефон",
  email: "Адрес электронной почты",
  workPlace: "Место работы",
  position: "Должность",
  program: "Программа обучения",
  studyForm: "Форма обучения",
  hours: "Количество часов",
  applicationDate: "Дата подачи заявления",
  startDate: "Дата начала обучения",
  endDate: "Дата окончания обучения",
  contractNo: "Номер договора",
  contractDate: "Дата договора"
});
const PAYMENT_DATABASE_CONSTANT_DEFINITIONS = Object.freeze([
  {
    key: "employeeRate",
    marker: "СтавкаОплатыСотруднику",
    legacyNames: ["СтавкаОплатыСотрудника"],
    legacyRow: 2
  },
  {
    key: "teacherRate",
    marker: "СтавкаОплатыПреподавателю",
    legacyNames: ["СтавкаОплатыПреподавателя", "СтавкаПреподавателя"],
    legacyRow: 3
  },
  {
    key: "commissionChairRate",
    marker: "СтавкаОплатыИАК",
    legacyNames: ["СтавкаИАК", "СтавкаОплатыПредседателюИАК"],
    legacyRow: 4
  },
  {
    key: "practiceReviewRate",
    marker: "СтавкаОплатыПроверкаПрактики",
    legacyNames: ["СтавкаПроверкиПрактики"],
    legacyRow: 5
  },
  {
    key: "authorRate",
    marker: "АвторскаяСтавка",
    legacyNames: ["СтавкаАвтора"],
    legacyRow: 6,
    percent: true
  }
]);
const DEFAULT_AGENT_PAYMENT_RATES = Object.freeze({
  withAuthorPercent: 10,
  withoutAuthorPercent: 25
});
const AGENT_PAYMENT_RATE_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "withAuthorPercent",
    definedName: "AIS_AgentRateWithAuthor",
    defaultPercent: DEFAULT_AGENT_PAYMENT_RATES.withAuthorPercent
  }),
  Object.freeze({
    key: "withoutAuthorPercent",
    definedName: "AIS_AgentRateWithoutAuthor",
    defaultPercent: DEFAULT_AGENT_PAYMENT_RATES.withoutAuthorPercent
  })
]);
const PROGRAM_DATABASE_COLUMN_MAP = Object.freeze({
  "Наименование программы (без часов)": "shortName",
  "Статус": "status",
  "Код лендинга": "landingCode",
  "Стоимость": "price",
  "Старая цена": "oldPrice",
  "Тип": "type",
  "Часы": "hours",
  "Срок": "duration",
  "Форма обучения": "studyForm",
  "Индекс группы": "groupIndex",
  "На промо сайте": "promoSite",
  "Гр. Телеграмм": "telegramGroup",
  "Ссылка на отчет по оценкам": "gradeReportUrl",
  "Автор": "authorSource",
  "Квалификация": "qualification",
  "Сфера деятельности": "activityScope",
  "ФГОС": "fgos",
  "ФГОС компетенция": "fgosCompetency",
  "Профстандарт": "professionalStandard",
  "Профстандарт трудовые функции": "professionalStandardFunctions",
  "Область профессиональной деятельности (для ФРДО)": "frdoProfessionalArea",
  "Вид экономической деятельности (для 1-ПК)": "economicActivity",
  "Минимальный уровень образования слушателя": "minimumEducationLevel",
  "Номер приказа": "programOrderNo",
  "Дата приказа": "programOrderDate",
  "Папка ОП": "opFolder",
  "Имя файла ОП": "opFileName",
  "Председатель": "commissionChair",
  "Член1": "commissionMember1",
  "Член2": "commissionMember2",
  "Секретарь": "secretary",
  "Разработчик": "developer",
  "Менеджер": "manager",
  "Преподаватели": "teachers",
  "Литература ОП": "literature",
  "Промосообщение1": "promoMessage1",
  "Промосообщение2": "promoMessage2",
  "СообщПочты": "emailMessageTemplate"
});
const PROGRAM_DATABASE_COMMENT_FIELDS = new Set([
  "promoMessage1",
  "promoMessage2",
  "emailMessageTemplate"
]);
const PROGRAM_DATABASE_NUMBER_FIELDS = new Set([
  "price",
  "oldPrice",
  "hours"
]);
const PROGRAM_DATABASE_LIST_FIELDS = new Set([
  "qualification",
  "activityScope",
  "fgos",
  "fgosCompetency",
  "professionalStandard",
  "professionalStandardFunctions",
  "teachers",
  "literature"
]);
const PROGRAM_DATABASE_DICTIONARY_RANGES = Object.freeze({
  frdoProfessionalAreas: {
    names: ["Деятельность"],
    header: "Область профессиональной деятельности (для ФРДО)"
  },
  economicActivities: {
    names: ["ВидыДеятПК1"],
    header: "Вид экономической деятельности (для 1-ПК)"
  }
});
const TRAINING_PLAN_DATABASE_COLUMN_MAP = Object.freeze({
  "Код": "code",
  "Наименование программы": "programName",
  "Дисциплины": "discipline",
  "Дисциплина": "discipline",
  "Описание": "description",
  "Всего": "totalHours",
  "Всего часов": "totalHours",
  "Теория": "theoryHours",
  "Практика": "practiceHours",
  "Аттестация": "attestation",
  "Преподаватель": "teacher",
  "Материалы": "materials",
  "Содержание": "content"
});
const TRAINING_PLAN_DATABASE_NUMBER_FIELDS = new Set([
  "totalHours",
  "theoryHours",
  "practiceHours"
]);
const STUDENT_DATABASE_COLUMN_MAP = Object.freeze({
  "uid": "uid",
  "ФИО": "name",
  "Дата подачи заявки": "applicationDate",
  "Статус": "status",
  "Источник": "source",
  "Теги": "tags",
  "Агент": "agent",
  "АгентСумма": "agentAmount",
  "АгентСумма1": "agentPayment1Amount",
  "АгентДата1": "agentPayment1Date",
  "АгентСумма2": "agentPayment2Amount",
  "АгентДата2": "agentPayment2Date",
  "Купон": "coupon",
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
  "agentPayment1Date",
  "agentPayment2Date",
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
  "agentAmount",
  "agentPayment1Amount",
  "agentPayment2Amount",
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
const GENERAL_EXPENSE_DATABASE_COLUMN_MAP = Object.freeze({
  "Контрагент": "counterparty",
  "Дата": "date",
  "Вид работ": "workType",
  "Описание": "description",
  "Сумма": "amount",
  "Оплачено": "paid",
  "Закрыто в бухгалтерии": "accountingClosed",
  "Номер в расходах БК": "bkExpenseNo",
  "Прочие затраты": "otherExpenses"
});
const GENERAL_EXPENSE_DATABASE_SECTIONS = Object.freeze({
  individuals: "Физлица",
  organizations: "Организации"
});
const CONTRACT_DATABASE_COLUMN_MAP = Object.freeze({
  "ФИО": "name",
  "Выплата": "amount",
  "Услуги": "paid",
  "Агентские": "agencyAmount",
  "Остаток": "balance",
  "Купон": "coupon",
  "Договор": "contractNo",
  "Дата договора": "contractDate",
  "Срок с": "startDate",
  "Срок по": "endDate",
  "Сумма": "paymentTerms",
  "Вид договора": "type",
  "ДоговорВбухг": "accountingRecorded",
  "Предмет": "subject",
  "Должность": "position",
  "Степень": "degree",
  "Звание": "academicTitle",
  "Примечание": "note",
  "Телефон": "phone",
  "WhatsApp": "whatsapp",
  "Email": "email",
  "АккаунтTelegram": "telegram",
  "Логин": "login",
  "Пароль": "password",
  "ДатаРождения": "birthDate",
  "Адрес": "address",
  "СНИЛСф": "snils",
  "ИННф": "inn",
  "Гражданство": "citizenship",
  "ДокумВид": "identityDocumentType",
  "ДокумСерияНомер": "identityDocument",
  "ДокумДатаВыдачи": "identityIssueDate",
  "ДокумКемВыдан": "identityIssuer",
  "ДокумКодПодразд": "identityDepartmentCode",
  "Примечание1": "message1",
  "Примечание2": "message2",
  "Примечание3": "message3",
  "Примечание4": "message4",
  "Примечание5": "message5",
  "Примечание6": "message6",
  "Примечание7": "message7",
  "Примечание8": "message8",
  "Примечание9": "message9",
  "Фото": "photoPath",
  "РасчСч": "settlementAccount",
  "Банк": "bank",
  "КорСчет": "correspondentAccount",
  "БИК": "bic",
  "EmailУвед": "notificationEmail",
  "СпрСудДата": "courtCertificateDate",
  "СпрСудНомер": "courtCertificateNo",
  "ФлюорогрДата": "fluorographyDate",
  "СпрСработыДата": "employmentCertificateDate",
  "КопияТрудовойДата": "employmentRecordCopyDate",
  "Обр_Вид образования": "educationType",
  "Обр_Уровень": "educationLevel",
  "Обр_Серия": "educationSeries",
  "Обр_Номер": "educationNumber",
  "Обр_Дата выдачи": "educationIssueDate",
  "Обр_Кем выдан": "educationIssuer",
  "Обр_Специальность": "educationSpecialty",
  "Обр_Квалификация": "educationQualification",
  "Купон_ID": "couponId",
  "РеквизитыПортала": "portalCredentials",
  "ДопНастрКонтр": "additionalSettings"
});
const CONTRACT_DATABASE_SECTIONS = Object.freeze({
  active: "ДЕЙСТВУЮЩИЕ ДОГОВОРА",
  partners: "ПАРТНЕРСКАЯ ПРОГРАММА",
  expired: "ИСТЕКШИЕ ДОГОВОРА"
});
const CONTRACT_DATABASE_DATE_FIELDS = new Set([
  "contractDate",
  "startDate",
  "endDate",
  "birthDate",
  "identityIssueDate",
  "courtCertificateDate",
  "fluorographyDate",
  "employmentCertificateDate",
  "employmentRecordCopyDate",
  "educationIssueDate"
]);
const CONTRACT_DATABASE_NUMBER_FIELDS = new Set(["amount", "paid", "agencyAmount", "balance"]);
const INVENTORY_DATABASE_COLUMN_MAP = Object.freeze({
  "Дата": "date",
  "Вид ТМЦ": "itemType",
  "Сумма": "amount",
  "Примечание": "note",
  "uid": "uid"
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
const CONTRACT_EVENT_IMPORT_TEMPLATES = Object.freeze([
  { key: "portalAccessSent", label: "Отправлены данные для доступа к порталу" },
  { key: "partnerMessagesSent", label: "Отправлены партнерские сообщения" },
  { key: "contractPrepared", label: "Сформирован договор" },
  { key: "contractSigned", label: "Подписан договор" },
  { key: "employmentCertificate", label: "Справка о трудовой деятельности" },
  { key: "criminalRecordCertificate", label: "Справка об отсутствии судимости" }
]);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Content-Disposition, X-Frdo-Export-Count, X-Frdo-Saved, X-Frdo-Storage, X-Frdo-Path, X-Frdo-Relative-Folder, X-Frdo-Revealed, X-Frdo-Warning, X-Generated-Document-Format, X-Generated-Document-File-Name, X-Document-Conversion-Fallback, X-Document-Conversion-Error, X-Yandex-Disk-Saved, X-Yandex-Disk-Path, X-Yandex-Disk-Error, X-Local-Document-Saved, X-Local-Document-Path, X-Local-Document-Error, X-Local-Document-Cancelled"
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
  if (process.env.AIS_TRUST_GATEWAY !== "1") await ensureAuthUsers();
  try {
    serverSettings = JSON.parse(await fs.readFile(SERVER_SETTINGS_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Не удалось прочитать настройки сервера: ${error.message}`);
    serverSettings = {};
  }
  try {
    const queryScript = await fs.readFile(STUDENT_APPLICATIONS_QUERY_SCRIPT, "utf8");
    defaultStudentApplicationsSqlQuery = String(
      /\$query\s*=\s*@'\r?\n([\s\S]*?)\r?\n'@/u.exec(queryScript)?.[1] || ""
    ).trim();
  } catch (error) {
    console.warn(`Не удалось прочитать стандартный SQL-запрос интернет-магазина: ${error.message}`);
  }
  serverSettings = {
    studentDatabaseWebDavPath: DEFAULT_STUDENT_DATABASE_WEBDAV_PATH,
    yandexDiskBasePath: DEFAULT_YANDEX_DISK_BASE_PATH,
    localDocumentsRoot: DEFAULT_LOCAL_DOCUMENTS_ROOT,
    localDocumentsRootIsSystemParent: false,
    openDocumentsLocally: true,
    sharedRecordLocksMySqlConnectionString: "",
    sharedRecordLocksMySqlUseApplicationsConnection: true,
    sharedRecordLocksMySqlHost: "",
    sharedRecordLocksMySqlPort: 3306,
    sharedRecordLocksMySqlDatabase: "",
    sharedRecordLocksMySqlUser: "",
    sharedRecordLocksMySqlPassword: "",
    studentApplicationsMySqlConnectionString: "",
    studentApplicationsOrderAdminUrlTemplate: DEFAULT_STUDENT_ORDER_ADMIN_URL_TEMPLATE,
    studentApplicationsEmailHost: DEFAULT_STUDENT_APPLICATIONS_EMAIL_HOST,
    studentApplicationsEmailPort: 993,
    studentApplicationsEmailSecure: true,
    studentApplicationsEmailSmtpHost: DEFAULT_STUDENT_APPLICATIONS_EMAIL_SMTP_HOST,
    studentApplicationsEmailSmtpPort: 465,
    studentApplicationsEmailSmtpSecure: true,
    studentApplicationsEmailLogin: DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN,
    studentDocumentMailboxes: [],
    documentConverterUrl: DEFAULT_DOCUMENT_CONVERTER_URL,
    documentConverterSourceUrl: DEFAULT_DOCUMENT_CONVERTER_SOURCE_URL,
    yandexDiskLogin: "",
    yandexDiskAutoSave: false,
    ...serverSettings
  };
  const mailboxMigration = migrateStudentApplicationsMailboxSettings(serverSettings);
  serverSettings = mailboxMigration.settings;
  const savedApplicationsSqlQuery = String(serverSettings.studentApplicationsSqlQuery || "").trim();
  const optimizedApplicationsSqlQuery = optimizeStudentApplicationsSqlQuery(savedApplicationsSqlQuery);
  if (savedApplicationsSqlQuery && optimizedApplicationsSqlQuery !== savedApplicationsSqlQuery) {
    serverSettings.studentApplicationsSqlQuery = optimizedApplicationsSqlQuery;
    mailboxMigration.changed = true;
  }
  if (
    !String(serverSettings.documentConverterJwtSecret || "").trim()
    && !String(process.env.ONLYOFFICE_JWT_SECRET || "").trim()
  ) {
    serverSettings.documentConverterJwtSecret = crypto.randomBytes(32).toString("hex");
    mailboxMigration.changed = true;
  }
  if (mailboxMigration.changed) {
    await fs.writeFile(SERVER_SETTINGS_PATH, `${JSON.stringify(serverSettings, null, 2)}\n`, "utf8");
  }
  delete serverSettings.systemDocumentsPublicUrl;
  delete serverSettings.systemDocumentsPublicPassword;
  delete serverSettings.studentDatabaseUrl;
  delete serverSettings.studentPhotoBasePath;
}

function migrateStudentApplicationsMailboxSettings(settings = {}) {
  const next = { ...settings };
  const currentLogin = String(next.studentApplicationsEmailLogin || "").trim();
  let changed = false;

  // mail@edu-plus.ru is the primary mailbox. When upgrading an installation
  // where it was stored among additional mailboxes, swap the mailbox roles and
  // preserve both sets of credentials without exposing or re-entering passwords.
  if (currentLogin && currentLogin.toLowerCase() !== DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN) {
    const documentMailboxes = Array.isArray(next.studentDocumentMailboxes)
      ? [...next.studentDocumentMailboxes]
      : [];
    const primaryIndex = documentMailboxes.findIndex((mailbox) => (
      String(mailbox?.login || "").trim().toLowerCase() === DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN
    ));
    const primaryMailbox = primaryIndex >= 0
      ? documentMailboxes.splice(primaryIndex, 1)[0]
      : null;
    const currentAlreadyAdditional = documentMailboxes.some((mailbox) => (
      String(mailbox?.login || "").trim().toLowerCase() === currentLogin.toLowerCase()
    ));
    if (!currentAlreadyAdditional) {
      documentMailboxes.push({
        id: currentLogin.toLowerCase() === DEFAULT_WOOCOMMERCE_EMAIL_LOGIN
          ? "student-documents-zifra-plus"
          : normalizeMailboxId(`student-documents-${currentLogin}`, "student-documents-previous-primary"),
        label: getStudentMailboxRoleLabel(currentLogin, `Дополнительный ящик · ${currentLogin}`),
        host: String(next.studentApplicationsEmailHost || DEFAULT_STUDENT_APPLICATIONS_EMAIL_HOST).trim(),
        port: normalizeMailboxPort(next.studentApplicationsEmailPort, 993),
        secure: next.studentApplicationsEmailSecure !== false,
        smtpHost: String(
          next.studentApplicationsEmailSmtpHost || DEFAULT_STUDENT_APPLICATIONS_EMAIL_SMTP_HOST
        ).trim(),
        smtpPort: normalizeMailboxPort(next.studentApplicationsEmailSmtpPort, 465),
        smtpSecure: next.studentApplicationsEmailSmtpSecure !== false,
        login: currentLogin,
        password: String(next.studentApplicationsEmailPassword || "")
      });
    }
    next.studentDocumentMailboxes = documentMailboxes;
    next.studentApplicationsEmailHost = String(
      primaryMailbox?.host || primaryMailbox?.imapHost || DEFAULT_STUDENT_APPLICATIONS_EMAIL_HOST
    ).trim();
    next.studentApplicationsEmailPort = normalizeMailboxPort(
      primaryMailbox?.port || primaryMailbox?.imapPort,
      993
    );
    next.studentApplicationsEmailSecure = primaryMailbox?.secure !== false;
    next.studentApplicationsEmailSmtpHost = String(
      primaryMailbox?.smtpHost || DEFAULT_STUDENT_APPLICATIONS_EMAIL_SMTP_HOST
    ).trim();
    next.studentApplicationsEmailSmtpPort = normalizeMailboxPort(primaryMailbox?.smtpPort, 465);
    next.studentApplicationsEmailSmtpSecure = primaryMailbox?.smtpSecure !== false;
    next.studentApplicationsEmailLogin = DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN;
    next.studentApplicationsEmailPassword = String(primaryMailbox?.password || "");
    changed = true;
  }

  const defaults = {
    studentApplicationsEmailHost: DEFAULT_STUDENT_APPLICATIONS_EMAIL_HOST,
    studentApplicationsEmailSmtpHost: DEFAULT_STUDENT_APPLICATIONS_EMAIL_SMTP_HOST,
    studentApplicationsEmailLogin: DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN
  };
  Object.entries(defaults).forEach(([key, value]) => {
    if (String(next[key] || "").trim()) return;
    next[key] = value;
    changed = true;
  });
  if (Array.isArray(next.studentDocumentMailboxes)) {
    next.studentDocumentMailboxes = next.studentDocumentMailboxes.map((mailbox) => {
      const label = getStudentMailboxRoleLabel(mailbox?.login, mailbox?.label);
      if (label === String(mailbox?.label || "").trim()) return mailbox;
      changed = true;
      return { ...mailbox, label };
    });
  }
  return { settings: next, changed };
}

function authBase64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function authHashPassword(password) {
  const salt = crypto.randomBytes(18);
  const hash = crypto.pbkdf2Sync(
    String(password),
    salt,
    AUTH_PASSWORD_ITERATIONS,
    32,
    "sha256"
  );
  return `pbkdf2_sha256$${AUTH_PASSWORD_ITERATIONS}$${authBase64UrlEncode(salt)}$${authBase64UrlEncode(hash)}`;
}

function authVerifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
  try {
    const salt = Buffer.from(parts[2], "base64url");
    const expected = Buffer.from(parts[3], "base64url");
    const actual = crypto.pbkdf2Sync(String(password), salt, iterations, expected.length, "sha256");
    return expected.length > 0 && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function defaultAuthUsers() {
  const now = new Date().toISOString();
  const adminPassword = String(process.env.AIS_INITIAL_ADMIN_PASSWORD || "").trim();
  if (adminPassword.length < 12) {
    throw new Error("Для первичного запуска задайте AIS_INITIAL_ADMIN_PASSWORD длиной не менее 12 символов.");
  }
  return [
    { login: "admin", name: "Администратор", role: "admin", password: adminPassword },
    { login: "simak.varvara", name: "Симак Варвара", role: "manager", password: "123" },
    { login: "simak.yuriy", name: "Симак Юрий", role: "manager", password: "123" }
  ].map((item) => ({
    id: crypto.randomBytes(12).toString("hex"),
    login: item.login,
    name: item.name,
    role: item.role,
    status: "active",
    email: "",
    phone: "",
    passwordHash: authHashPassword(item.password),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: ""
  }));
}

async function writeJsonAtomic(filePath, value, compact = false) {
  const temporaryPath = `${filePath}.tmp-${crypto.randomBytes(6).toString("hex")}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, compact ? 0 : 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

async function ensureAuthUsers() {
  try {
    const payload = JSON.parse(await fs.readFile(AUTH_USERS_PATH, "utf8"));
    if (Array.isArray(payload?.users) && payload.users.length) return payload.users;
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Не удалось прочитать пользователей: ${error.message}`);
  }
  const users = defaultAuthUsers();
  await writeJsonAtomic(AUTH_USERS_PATH, { version: 1, users });
  return users;
}

async function loadAuthUsers() {
  const payload = JSON.parse(await fs.readFile(AUTH_USERS_PATH, "utf8"));
  if (!Array.isArray(payload?.users) || !payload.users.length) {
    throw new Error("Список пользователей пуст или повреждён.");
  }
  return payload.users;
}

async function saveAuthUsers(users) {
  await writeJsonAtomic(AUTH_USERS_PATH, { version: 1, users });
}

function normalizeAuthLogin(value) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU");
}

function validateAuthLogin(value) {
  const login = normalizeAuthLogin(value);
  if (!/^[\p{L}\p{N}._-]{3,64}$/u.test(login)) {
    throw new Error("Логин должен содержать от 3 до 64 букв, цифр, точек, дефисов или знаков подчёркивания.");
  }
  return login;
}

function publicAuthUser(user) {
  return {
    id: String(user?.id || ""),
    login: String(user?.login || ""),
    name: String(user?.name || ""),
    role: String(user?.role || "manager"),
    status: String(user?.status || "blocked"),
    email: String(user?.email || ""),
    phone: String(user?.phone || ""),
    createdAt: String(user?.createdAt || ""),
    updatedAt: String(user?.updatedAt || ""),
    lastLoginAt: String(user?.lastLoginAt || "")
  };
}

function auditText(value, limit = 2000) {
  let text = value;
  if (text && typeof text === "object") {
    try {
      text = JSON.stringify(text);
    } catch {
      text = "";
    }
  }
  return Array.from(String(text ?? "").replaceAll("\0", "").trim()).slice(0, limit).join("");
}

function isAuditSecretField(field) {
  return /(?:password|passwd|парол|secret|token|credential|jwt|photoData|authorization)/iu
    .test(String(field || ""));
}

function normalizeAuditChanges(source) {
  if (!Array.isArray(source)) return [];
  return source.slice(0, AUDIT_MAX_CHANGES).flatMap((change) => {
    if (!change || typeof change !== "object") return [];
    const field = auditText(change.field, 160);
    const label = auditText(change.label || field, 240);
    if (!field && !label) return [];
    const secret = isAuditSecretField(`${field} ${label}`);
    return [{
      field,
      label,
      before: secret ? "[скрыто]" : auditText(change.before, 4000),
      after: secret ? "[скрыто]" : auditText(change.after, 4000)
    }];
  });
}

function getAuditClientIp(req) {
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  if (realIp) return realIp.slice(0, 80);
  return String(req.socket?.remoteAddress || "").trim().slice(0, 80);
}

async function appendAuditEntry(payload, user, req) {
  const action = auditText(payload?.action, 240);
  if (!action) throw new Error("Не указано действие для журнала изменений.");
  const changes = normalizeAuditChanges(payload?.changes);
  const entry = {
    id: crypto.randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
    userId: String(user?.id || ""),
    user: String(user?.login || "system"),
    userName: String(user?.name || ""),
    role: String(user?.role || ""),
    action,
    area: auditText(payload?.area, 240),
    entityType: auditText(payload?.entityType, 160),
    entityId: auditText(payload?.entityId, 240),
    entityLabel: auditText(payload?.entityLabel, 500),
    field: auditText(payload?.field, 240),
    before: auditText(payload?.before, 4000),
    after: auditText(payload?.after, 4000),
    details: auditText(payload?.details, 4000),
    changes,
    ip: getAuditClientIp(req),
    userAgent: auditText(req.headers["user-agent"], 500),
    source: auditText(payload?.source || "web", 80)
  };
  if (changes.length) {
    if (!entry.field) {
      entry.field = [...new Set(changes.map((change) => change.label || change.field))].join(", ");
    }
    if (changes.length === 1) {
      entry.before = changes[0].before;
      entry.after = changes[0].after;
    }
  }
  if (isAuditSecretField(entry.field)) {
    entry.before = "[скрыто]";
    entry.after = "[скрыто]";
  }
  await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return entry;
}

async function safelyAppendAuditEntry(payload, user, req) {
  try {
    return await appendAuditEntry(payload, user, req);
  } catch (error) {
    console.warn(`Не удалось записать журнал изменений: ${error.message}`);
    return null;
  }
}

async function readAuditRows() {
  let text = "";
  try {
    text = await fs.readFile(AUDIT_LOG_PATH, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/)
    .filter(Boolean)
    .slice(-AUDIT_MAX_ROWS)
    .flatMap((line) => {
      try {
        const row = JSON.parse(line);
        return row && typeof row === "object" ? [row] : [];
      } catch {
        return [];
      }
    })
    .reverse();
}

function auditFilterText(filters, key) {
  return String(filters?.[key] || "").trim().toLocaleLowerCase("ru-RU");
}

function auditRowSearchText(row) {
  const changes = normalizeAuditChanges(row?.changes)
    .map((change) => Object.values(change).join(" ")).join(" ");
  return [
    row?.createdAt, row?.user, row?.userName, row?.role, row?.action, row?.area,
    row?.entityType, row?.entityId, row?.entityLabel, row?.field, row?.before,
    row?.after, row?.details, row?.ip, row?.userAgent, row?.source, changes
  ].map((value) => String(value || "")).join(" ").toLocaleLowerCase("ru-RU");
}

function parseAuditBoundary(value, endOfDay) {
  let source = String(value || "").trim();
  if (!source) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) source += endOfDay ? "T23:59:59" : "T00:00:00";
  const timestamp = Date.parse(source);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function auditRowMatches(row, filters) {
  const exactEntityType = String(filters?.entityTypeExact || "").trim();
  const exactEntityId = String(filters?.entityIdExact || "").trim();
  if (exactEntityType && String(row?.entityType || "") !== exactEntityType) return false;
  if (exactEntityId && String(row?.entityId || "") !== exactEntityId) return false;
  const from = parseAuditBoundary(filters.from, false);
  const to = parseAuditBoundary(filters.to, true);
  const createdAt = Date.parse(String(row.createdAt || "")) || 0;
  if (from !== null && createdAt < from) return false;
  if (to !== null && createdAt > to) return false;
  const keys = {
    user: "user", userName: "userName", role: "role", action: "action", area: "area",
    entityType: "entityType", entityId: "entityId", entityLabel: "entityLabel",
    field: "field", before: "before", after: "after", details: "details", ip: "ip",
    userAgent: "userAgent", source: "source"
  };
  for (const [filterKey, rowKey] of Object.entries(keys)) {
    const needle = auditFilterText(filters, filterKey);
    if (!needle) continue;
    const haystack = auditText(row[rowKey], 12000).toLocaleLowerCase("ru-RU");
    if (haystack.includes(needle)) continue;
    const changes = normalizeAuditChanges(row.changes);
    let changeValues = "";
    if (filterKey === "field") {
      changeValues = changes.map((change) => `${change.field} ${change.label}`).join(" ");
    } else if (["before", "after"].includes(filterKey)) {
      changeValues = changes.map((change) => change[filterKey]).join(" ");
    } else {
      return false;
    }
    if (!changeValues.toLocaleLowerCase("ru-RU").includes(needle)) return false;
  }
  const query = auditFilterText(filters, "q");
  return !query || auditRowSearchText(row).includes(query);
}

function getAuditFilters(searchParams) {
  const filters = {};
  for (const key of [
    "q", "from", "to", "user", "userName", "role", "action", "area", "entityType",
    "entityId", "entityLabel", "field", "before", "after", "details", "ip",
    "userAgent", "source"
  ]) filters[key] = String(searchParams.get(key) || "");
  return filters;
}

function getAuditFilterOptions(rows) {
  const options = {};
  for (const key of ["user", "role", "action", "area", "entityType", "source"]) {
    options[key] = [...new Set(rows.map((row) => String(row[key] || "").trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "ru", { numeric: true, sensitivity: "base" }));
  }
  return options;
}

function auditCsvCell(value) {
  return `"${auditText(value, 32000).replaceAll('"', '""')}"`;
}

function auditChangesColumn(row, key) {
  return normalizeAuditChanges(row.changes).map((change) => {
    const label = change.label || change.field;
    return `${label}${change[key] ? `: ${change[key]}` : ""}`;
  }).join("\n");
}

function buildAuditCsv(rows) {
  const columns = [
    ["createdAt", "Дата и время"], ["user", "Логин"], ["userName", "Пользователь"],
    ["role", "Роль"], ["action", "Действие"], ["area", "Раздел"],
    ["entityType", "Тип объекта"], ["entityId", "ID объекта"], ["entityLabel", "Объект"],
    ["field", "Поля"], ["before", "Было"], ["after", "Стало"],
    ["details", "Подробности"], ["ip", "IP"], ["userAgent", "Клиент"], ["source", "Источник"]
  ];
  const lines = [columns.map(([, label]) => auditCsvCell(label)).join(";")];
  rows.forEach((row) => {
    lines.push(columns.map(([key]) => {
      if (key === "before" && row.changes?.length) return auditCsvCell(auditChangesColumn(row, "before"));
      if (key === "after" && row.changes?.length) return auditCsvCell(auditChangesColumn(row, "after"));
      return auditCsvCell(row[key]);
    }).join(";"));
  });
  return Buffer.from(`\ufeff${lines.join("\r\n")}`, "utf8");
}

async function handleAuditRequest(req, res, user, requestUrl) {
  if (req.method === "POST" && requestUrl.pathname === "/api/audit/log") {
    const entry = await appendAuditEntry(await readJsonBody(req), user, req);
    sendJson(res, 201, { ok: true, entry });
    return true;
  }
  const adminPaths = new Set(["/api/admin/audit", "/api/admin/audit/export"]);
  const studentPaths = new Set(["/api/students/audit", "/api/students/audit/export"]);
  if (!adminPaths.has(requestUrl.pathname) && !studentPaths.has(requestUrl.pathname)) return false;
  if (adminPaths.has(requestUrl.pathname) && user.role !== "admin") {
    sendError(res, 403, "Раздел доступен только администратору.");
    return true;
  }
  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed");
    return true;
  }
  const rows = await readAuditRows();
  const filters = getAuditFilters(requestUrl.searchParams);
  let scopedRows = rows;
  let exportPrefix = "audit-log";
  if (studentPaths.has(requestUrl.pathname)) {
    const legacyStudentId = String(requestUrl.searchParams.get("studentId") || "").trim();
    const requestedEntityType = String(requestUrl.searchParams.get("entityType") || "").trim();
    const entityType = requestedEntityType === "contracts" ? "contracts" : "students";
    const entityId = String(requestUrl.searchParams.get("entityId") || legacyStudentId).trim();
    if (!entityId || entityId.length > 240) {
      sendError(res, 400, entityType === "contracts"
        ? "Не указан сотрудник для просмотра журнала."
        : "Не указан слушатель для просмотра журнала.");
      return true;
    }
    const scope = { entityTypeExact: entityType, entityIdExact: entityId };
    scopedRows = rows.filter((row) => auditRowMatches(row, scope));
    filters.entityTypeExact = entityType;
    filters.entityIdExact = entityId;
    const exportEntity = entityType === "contracts" ? "employee" : "student";
    exportPrefix = `${exportEntity}-audit-${entityId.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80) || "log"}`;
  }
  const filtered = rows.filter((row) => auditRowMatches(row, filters));
  if (requestUrl.pathname.endsWith("/export")) {
    sendFile(
      res,
      200,
      buildAuditCsv(filtered),
      `${exportPrefix}-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}.csv`,
      "text/csv; charset=utf-8"
    );
    return true;
  }
  const pageSize = Math.max(10, Math.min(200, Number(requestUrl.searchParams.get("pageSize")) || 50));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.max(1, Math.min(pages, Number(requestUrl.searchParams.get("page")) || 1));
  sendJson(res, 200, {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    pages,
    options: getAuditFilterOptions(scopedRows)
  });
  return true;
}

async function loadAuthSessions() {
  try {
    const payload = JSON.parse(await fs.readFile(AUTH_SESSIONS_PATH, "utf8"));
    return Array.isArray(payload?.sessions) ? payload.sessions : [];
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Не удалось прочитать сессии: ${error.message}`);
    return [];
  }
}

async function saveAuthSessions(sessions) {
  await writeJsonAtomic(AUTH_SESSIONS_PATH, { version: 1, sessions });
}

function parseRequestCookies(req) {
  return String(req.headers.cookie || "").split(";").reduce((result, item) => {
    const separator = item.indexOf("=");
    if (separator < 1) return result;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
    return result;
  }, {});
}

function authCookieHeader(token, req, maxAge = null) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  const secure = forwardedProto === "https" || Boolean(req.socket?.encrypted);
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict"
  ];
  if (secure) parts.push("Secure");
  if (maxAge !== null) parts.push(`Max-Age=${Math.max(0, Number(maxAge) || 0)}`);
  return parts.join("; ");
}

async function createAuthSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  const expiresAt = now + AUTH_SESSION_TTL_MS;
  const sessions = (await loadAuthSessions()).filter((session) => Number(session.expiresAt) > now);
  sessions.push({ tokenHash, userId, createdAt: now, expiresAt });
  await saveAuthSessions(sessions);
  return { token, expiresAt };
}

async function destroyAuthSession(req) {
  const token = parseRequestCookies(req)[AUTH_COOKIE_NAME] || "";
  if (!token) return;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const sessions = (await loadAuthSessions()).filter((session) => session.tokenHash !== tokenHash);
  await saveAuthSessions(sessions);
}

async function getRequestAuthUser(req) {
  if (process.env.AIS_TRUST_GATEWAY === "1") {
    return {
      id: String(req.headers["x-ais-user-id"] || "gateway").slice(0, 160),
      login: String(req.headers["x-ais-user-login"] || "gateway").slice(0, 160),
      name: String(req.headers["x-ais-user-name"] || "Gateway").slice(0, 240),
      role: String(req.headers["x-ais-user-role"] || "admin") === "manager" ? "manager" : "admin",
      status: "active"
    };
  }
  const token = parseRequestCookies(req)[AUTH_COOKIE_NAME] || "";
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  const sessions = await loadAuthSessions();
  const session = sessions.find((item) => item.tokenHash === tokenHash && Number(item.expiresAt) > now);
  if (!session) return null;
  const users = await loadAuthUsers();
  const user = users.find((item) => item.id === session.userId && item.status === "active");
  return user
    ? { ...publicAuthUser(user), sessionExpiresAt: Number(session.expiresAt) || 0 }
    : null;
}

function validateAuthEmail(value) {
  const email = String(value || "").trim();
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email)) {
    throw new Error("Укажите корректный email.");
  }
  return email.slice(0, 160);
}

function validateAuthPhone(value) {
  const phone = String(value || "").trim();
  if (Array.from(phone).length > 40) throw new Error("Номер телефона слишком длинный.");
  return phone;
}

async function handleAuthLogin(req, res) {
  const body = await readJsonBody(req);
  const users = await loadAuthUsers();
  const login = normalizeAuthLogin(body.login);
  const index = users.findIndex((user) => normalizeAuthLogin(user.login) === login);
  if (index < 0 || users[index].status !== "active" || !authVerifyPassword(body.password, users[index].passwordHash)) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    sendError(res, 401, "Неверный логин или пароль.");
    return;
  }
  users[index].lastLoginAt = new Date().toISOString();
  await saveAuthUsers(users);
  const session = await createAuthSession(users[index].id);
  await safelyAppendAuditEntry({
    action: "Вход в систему",
    area: "Авторизация",
    entityType: "user",
    entityId: users[index].id,
    entityLabel: users[index].login
  }, publicAuthUser(users[index]), req);
  sendJson(res, 200, {
    ok: true,
    user: publicAuthUser(users[index]),
    sessionExpiresAt: session.expiresAt
  }, {
    "Set-Cookie": authCookieHeader(session.token, req)
  });
}

async function handleAuthMe(req, res, user) {
  if (!user) {
    sendError(res, 401, "Требуется вход в систему.");
    return;
  }
  sendJson(res, 200, {
    ok: true,
    user: publicAuthUser(user),
    sessionExpiresAt: Number(user.sessionExpiresAt) || 0
  });
}

async function handleAuthLogout(req, res) {
  const user = await getRequestAuthUser(req);
  if (user) {
    await safelyAppendAuditEntry({
      action: "Выход из системы",
      area: "Авторизация",
      entityType: "user",
      entityId: user.id,
      entityLabel: user.login
    }, user, req);
  }
  await destroyAuthSession(req);
  sendJson(res, 200, { ok: true }, {
    "Set-Cookie": authCookieHeader("", req, 0)
  });
}

async function handleAuthProfile(req, res, user) {
  const body = await readJsonBody(req);
  const users = await loadAuthUsers();
  const index = users.findIndex((item) => item.id === user.id);
  if (index < 0) throw new Error("Пользователь не найден.");
  users[index].email = validateAuthEmail(body.email);
  users[index].phone = validateAuthPhone(body.phone);
  users[index].updatedAt = new Date().toISOString();
  await saveAuthUsers(users);
  await safelyAppendAuditEntry({
    action: "Изменён личный кабинет",
    area: "Пользователи",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.login,
    changes: [
      { field: "email", label: "Email", before: user.email, after: users[index].email },
      { field: "phone", label: "Телефон", before: user.phone, after: users[index].phone }
    ]
  }, publicAuthUser(users[index]), req);
  sendJson(res, 200, { ok: true, user: publicAuthUser(users[index]) });
}

async function handleAuthPassword(req, res, user) {
  const body = await readJsonBody(req);
  const newPassword = String(body.newPassword || "");
  if (Array.from(newPassword).length < 6) throw new Error("Новый пароль должен содержать не менее 6 символов.");
  const users = await loadAuthUsers();
  const index = users.findIndex((item) => item.id === user.id);
  if (index < 0) throw new Error("Пользователь не найден.");
  if (!authVerifyPassword(body.currentPassword, users[index].passwordHash)) {
    sendError(res, 400, "Текущий пароль указан неверно.");
    return;
  }
  users[index].passwordHash = authHashPassword(newPassword);
  users[index].updatedAt = new Date().toISOString();
  await saveAuthUsers(users);
  await safelyAppendAuditEntry({
    action: "Изменён пароль",
    area: "Пользователи",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.login,
    field: "password",
    before: "[скрыто]",
    after: "[скрыто]"
  }, user, req);
  sendJson(res, 200, { ok: true });
}

async function handleAdminUsers(req, res, user) {
  if (user.role !== "admin") {
    sendError(res, 403, "Раздел доступен только администратору.");
    return;
  }
  if (req.method === "GET") {
    sendJson(res, 200, { users: (await loadAuthUsers()).map(publicAuthUser) });
    return;
  }
  if (req.method !== "POST") {
    sendError(res, 405, "Method not allowed");
    return;
  }
  const body = await readJsonBody(req);
  const users = await loadAuthUsers();
  const id = String(body.id || "").trim();
  const before = users.find((item) => item.id === id);
  const login = validateAuthLogin(body.login);
  const name = String(body.name || "").trim();
  const role = String(body.role || "manager");
  const status = String(body.status || "active");
  let password = String(body.password || "");
  if (!name || Array.from(name).length > 120) throw new Error("Укажите имя пользователя.");
  if (!new Set(["admin", "manager"]).has(role)) throw new Error("Выбрана неизвестная роль.");
  if (!new Set(["active", "blocked"]).has(status)) throw new Error("Выбран неизвестный статус.");
  if (users.some((item) => item.id !== id && normalizeAuthLogin(item.login) === login)) {
    throw new Error("Пользователь с таким логином уже существует.");
  }
  const now = new Date().toISOString();
  let index = users.findIndex((item) => item.id === id);
  if (index < 0) {
    if (!password) password = role === "manager" ? "123" : "";
    if (Array.from(password).length < 3) throw new Error("Для новой учётной записи укажите пароль.");
    users.push({
      id: crypto.randomBytes(12).toString("hex"), login, name, role, status,
      email: validateAuthEmail(body.email), phone: validateAuthPhone(body.phone),
      passwordHash: authHashPassword(password), createdAt: now, updatedAt: now, lastLoginAt: ""
    });
    index = users.length - 1;
  } else {
    if (users[index].id === user.id && (role !== "admin" || status !== "active")) {
      throw new Error("Нельзя ограничить доступ текущей учётной записи администратора.");
    }
    users[index] = {
      ...users[index], login, name, role, status,
      email: validateAuthEmail(body.email), phone: validateAuthPhone(body.phone), updatedAt: now
    };
    if (password) {
      if (Array.from(password).length < 3) throw new Error("Пароль должен содержать не менее 3 символов.");
      users[index].passwordHash = authHashPassword(password);
    }
  }
  const activeAdmins = users.filter((item) => item.role === "admin" && item.status === "active").length;
  if (!activeAdmins) throw new Error("В системе должен оставаться хотя бы один активный администратор.");
  await saveAuthUsers(users);
  const saved = publicAuthUser(users[index]);
  const changes = [];
  for (const [key, label] of Object.entries({
    login: "Логин", name: "Имя", role: "Роль", status: "Статус", email: "Email", phone: "Телефон"
  })) {
    const oldValue = String(before?.[key] || "");
    const newValue = String(saved[key] || "");
    if (oldValue !== newValue) changes.push({ field: key, label, before: oldValue, after: newValue });
  }
  if (String(body.password || "")) {
    changes.push({ field: "password", label: "Пароль", before: "[скрыто]", after: "[скрыто]" });
  }
  await safelyAppendAuditEntry({
    action: before ? "Изменён пользователь" : "Создан пользователь",
    area: "Пользователи",
    entityType: "user",
    entityId: saved.id,
    entityLabel: saved.login,
    changes
  }, user, req);
  sendJson(res, 200, { ok: true, user: saved });
}

async function saveServerSettings(patch) {
  const resetsStudentApplicationsMySql = Object.prototype.hasOwnProperty.call(
    patch || {},
    "studentApplicationsMySqlConnectionString"
  ) && serverSettings.studentApplicationsMySqlConnectionString !== patch.studentApplicationsMySqlConnectionString;
  const resetsSharedRecordLocksMySql = Object.keys(patch || {}).some((key) => {
    const isMySqlSetting = key.startsWith("sharedRecordLocksMySql")
      || key === "studentApplicationsMySqlConnectionString";
    return isMySqlSetting && serverSettings[key] !== patch[key];
  });
  serverSettings = {
    ...serverSettings,
    ...patch
  };
  await fs.writeFile(
    SERVER_SETTINGS_PATH,
    `${JSON.stringify(serverSettings, null, 2)}\n`,
    "utf8"
  );
  if (resetsSharedRecordLocksMySql) {
    sharedStateMySqlUnavailableUntil = 0;
    await closeSharedRecordLocksStorage();
  }
  if (resetsStudentApplicationsMySql) await closeStudentApplicationsMySqlStorage();
  return serverSettings;
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
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

function normalizeGeneratedDocumentFormat(value) {
  return String(value || "").trim().toLowerCase() === "docx" ? "docx" : "pdf";
}

function safeDocumentFileName(value, format = "") {
  const source = String(value || "документ");
  const extension = format
    ? normalizeGeneratedDocumentFormat(format)
    : (/\.docx$/i.test(source) ? "docx" : "pdf");
  const base = safeNamePart(source.replace(/\.(?:pdf|docx)$/i, ""), "документ");
  return `${base}.${extension}`;
}

function generatedDocumentContentType(format) {
  return normalizeGeneratedDocumentFormat(format) === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
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

function buildImageDrawingXml({ relationshipId, hyperlinkRelationshipId = "", cx, cy, docPrId, name }) {
  const safeName = escapeXmlAttribute(name || "Фото слушателя");
  const safeHyperlinkRelationshipId = escapeXmlAttribute(hyperlinkRelationshipId);
  const hyperlinkXml = safeHyperlinkRelationshipId
    ? `<a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${safeHyperlinkRelationshipId}"/>`
    : "";
  const docPrXml = hyperlinkXml
    ? `<wp:docPr id="${docPrId}" name="${safeName}">${hyperlinkXml}</wp:docPr>`
    : `<wp:docPr id="${docPrId}" name="${safeName}"/>`;
  const picturePropertiesXml = hyperlinkXml
    ? `<pic:cNvPr id="0" name="${safeName}">${hyperlinkXml}</pic:cNvPr>`
    : `<pic:cNvPr id="0" name="${safeName}"/>`;
  return `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPrXml}<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr>${picturePropertiesXml}<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function getDrawingHyperlinkRelationshipId(xml) {
  return /<a:hlinkClick\b[^>]*\br:id="([^"]+)"/i.exec(String(xml || ""))?.[1] || "";
}

function getImageFrameHyperlinkRelationshipId(xml, markerIndex, sourceRunXml = "") {
  const runRelationshipId = getDrawingHyperlinkRelationshipId(sourceRunXml);
  if (runRelationshipId) return runRelationshipId;
  const hyperlink = getEnclosingXmlElement(xml, markerIndex, "w:hyperlink");
  const hyperlinkRelationshipId = /<w:hyperlink\b[^>]*\br:id="([^"]+)"/i.exec(hyperlink?.xml || "")?.[1] || "";
  if (hyperlinkRelationshipId) return hyperlinkRelationshipId;
  for (const tagName of ["wp:inline", "wp:anchor", "w:drawing", "v:shape", "mc:AlternateContent"]) {
    const container = getEnclosingXmlElement(xml, markerIndex, tagName);
    const relationshipId = getDrawingHyperlinkRelationshipId(container?.xml);
    if (relationshipId) return relationshipId;
  }
  return "";
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
  const markerIndex = documentXml.indexOf(marker);
  const hyperlinkRelationshipId = getImageFrameHyperlinkRelationshipId(documentXml, markerIndex);
  const frame = getImageFrameConstraints(documentXml, marker);
  const { cx, cy } = imageExtentEmu(image, frame);
  const drawingXml = buildImageDrawingXml({
    relationshipId,
    hyperlinkRelationshipId,
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
  let documentXml = documentEntry.content.toString("utf8");
  const paragraphs = [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  const replacements = [];
  for (const paragraph of paragraphs) {
    const anchor = findIndexedWordFieldImageAnchor(paragraph[0], fieldName, fieldPositionMap);
    if (!anchor) continue;
    replacements.push({ paragraph, anchor });
  }
  if (!replacements.length) return false;

  const hasImage = Boolean(image?.bytes?.length);
  let relationshipId = "";
  let mediaName = "";
  let contentType = "";
  if (hasImage) {
    const ext = image.ext === "jpeg" ? "jpg" : image.ext;
    contentType = IMAGE_CONTENT_TYPES[ext];
    if (!contentType) return false;
    mediaName = uniqueMediaName(entries, ext);
    relationshipId = addDocumentImageRelationship(entries, mediaName.replace(/^word\//, ""));
  }

  let docPrId = nextDocPrId(documentXml);
  replacements.reverse().forEach(({ paragraph, anchor }) => {
    let replacementRun = "";
    if (hasImage) {
      const hyperlinkRelationshipId = getImageFrameHyperlinkRelationshipId(
        documentXml,
        paragraph.index + anchor.insertionIndex,
        anchor.runXml
      );
      const frame = anchor.runXml ? {
        width: parseXmlTagNumberAttribute(anchor.runXml, "wp:extent", "cx"),
        height: parseXmlTagNumberAttribute(anchor.runXml, "wp:extent", "cy")
      } : null;
      const { cx, cy } = imageExtentEmu(image, frame);
      const drawingXml = buildImageDrawingXml({
        relationshipId,
        hyperlinkRelationshipId,
        cx,
        cy,
        docPrId,
        name: image.name || fieldName
      });
      docPrId += 1;
      const runOpenTag = /^<w:r\b[^>]*>/.exec(anchor.runXml)?.[0] || "<w:r>";
      const runProperties = /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(anchor.runXml)?.[0] || "";
      const imageRun = `${runOpenTag}${runProperties}${drawingXml}</w:r>`;
      replacementRun = hyperlinkRelationshipId
        ? `<w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${escapeXmlAttribute(hyperlinkRelationshipId)}">${imageRun}</w:hyperlink>`
        : imageRun;
    }
    const replacementStart = anchor.runStart >= 0 ? anchor.runStart : anchor.insertionIndex;
    const replacementEnd = anchor.runEnd >= 0 ? anchor.runEnd : anchor.insertionIndex;
    const paragraphXml = `${paragraph[0].slice(0, replacementStart)}${replacementRun}${paragraph[0].slice(replacementEnd)}`;
    documentXml = `${documentXml.slice(0, paragraph.index)}${paragraphXml}${documentXml.slice(paragraph.index + paragraph[0].length)}`;
  });

  if (hasImage) {
    entries.push({ name: mediaName, content: image.bytes });
    ensureContentType(entries, image.ext === "jpeg" ? "jpg" : image.ext, contentType);
  }
  documentEntry.content = Buffer.from(documentXml, "utf8");
  return true;
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

function getAssistantOptionConfigText(properties) {
  const optionProperties = (Array.isArray(properties) ? properties : [])
    .filter((property) => isAssistantOptionPropertyName(property?.name))
    .sort((a, b) => (
      Number(String(a.name).replace(/^Опции/, "")) - Number(String(b.name).replace(/^Опции/, ""))
    ));
  return optionProperties.length
    ? decodeAssistantOptionText(optionProperties.map((property) => property.value || "").join(""))
    : "";
}

function normalizeAssistantOptionKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s_-]+/g, "")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

function parseAssistantEmailProperties(properties) {
  const configText = getAssistantOptionConfigText(properties);
  if (!configText) return [];
  const aliases = new Map([
    ["шаблон", "Шаблон"],
    ["шаблонсообщения", "Шаблон"],
    ["текстсообщения", "Шаблон"],
    ["текстписьма", "Шаблон"],
    ["темасообщ", "Тема сообщения"],
    ["темасообщения", "Тема сообщения"],
    ["темаписьма", "Тема сообщения"],
    ["темаemail", "Тема сообщения"],
    ["темаe-mail", "Тема сообщения"]
  ]);
  const values = new Map();
  String(configText).split("\n").forEach((line) => {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) return;
    const sourceName = line.slice(0, separatorIndex).trim();
    const targetName = aliases.get(normalizeAssistantOptionKey(sourceName));
    if (!targetName || values.has(targetName)) return;
    values.set(
      targetName,
      line.slice(separatorIndex + 1).replace(/\u000b/g, "\n")
    );
  });
  const emailProperties = Array.from(values, ([name, value]) => ({
    name,
    value,
    source: "assistant-options"
  }));
  const constants = [];
  const seenConstants = new Set();
  const constantPattern = /\[([^\]\r\n]+)\]=\{([\s\S]*?)\}/g;
  for (const match of configText.matchAll(constantPattern)) {
    const name = String(match[1] || "").trim();
    if (!name || seenConstants.has(name)) continue;
    constants.push({
      name,
      value: String(match[2] || "").replace(/\u000b/g, "\n"),
      source: "assistant-constant"
    });
    seenConstants.add(name);
  }
  return [...emailProperties, ...constants];
}

function parseAssistantDocumentFieldProperties(properties) {
  const configText = getAssistantOptionConfigText(properties);
  if (!configText) return [];
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

function getDocumentFormulaPropertiesFromEntries(entries, customProperties = null) {
  const properties = Array.isArray(customProperties)
    ? customProperties
    : parseCustomDocumentProperties(entries);
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
  const multiplicative = findTopLevelMultiplicativeOperator(text);
  if (multiplicative) {
    const left = Number(evaluateDocumentFormulaExpression(text.slice(0, multiplicative.index), context));
    const right = Number(evaluateDocumentFormulaExpression(text.slice(multiplicative.index + 1), context));
    if (!Number.isFinite(left) || !Number.isFinite(right) || (multiplicative.operator === "/" && right === 0)) {
      throw new Error("Некорректное арифметическое выражение");
    }
    return multiplicative.operator === "*" ? left * right : left / right;
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

const DOCUMENT_TRANSLITERATION_PAIRS = [
  ["А", "A"], ["Б", "B"], ["В", "V"], ["Г", "G"], ["Д", "D"], ["Е", "E"], ["Ё", "Yo"], ["Ж", "Zh"],
  ["З", "Z"], ["И", "I"], ["Й", "Y"], ["К", "K"], ["Л", "L"], ["М", "M"], ["Н", "N"], ["О", "O"],
  ["П", "P"], ["Р", "R"], ["С", "S"], ["Т", "T"], ["У", "U"], ["Ф", "F"], ["Х", "Kh"], ["Ц", "Ts"],
  ["Ч", "Ch"], ["Ш", "Sh"], ["Щ", "Shch"], ["Ъ", ""], ["Ы", "Y"], ["Ь", ""], ["Э", "E"], ["Ю", "Yu"],
  ["Я", "Ya"]
];
const DOCUMENT_TRANSLITERATION_MAP = DOCUMENT_TRANSLITERATION_PAIRS.reduce((result, [cyrillic, latin]) => {
  result[cyrillic] = latin;
  result[cyrillic.toLocaleLowerCase("ru-RU")] = latin.toLocaleLowerCase("en-US");
  return result;
}, {});

function transliterateDocumentFormulaText(value) {
  return String(value || "")
    .replace(/[А-Яа-яЁё]/g, (character) => DOCUMENT_TRANSLITERATION_MAP[character] ?? character)
    .replace(/\s+/g, " ")
    .trim();
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
  if (compactName === "ТРАНСЛИТЕРАЦИЯ") return transliterateDocumentFormulaText(text(0));
  if (compactName === "QRКОД") return text(0).trim();
  if (compactName === "ОКРУГЛВНИЗ") {
    const number = Number(String(value(0)).replace(",", "."));
    const digitsValue = Number(String(value(1)).replace(",", "."));
    if (!Number.isFinite(number) || !Number.isFinite(digitsValue)) {
      throw new Error("ОКРУГЛВНИЗ: некорректное числовое значение");
    }
    const digits = Math.trunc(digitsValue);
    const factor = 10 ** Math.abs(digits);
    if (!Number.isFinite(factor) || factor === 0) {
      throw new Error("ОКРУГЛВНИЗ: некорректное количество разрядов");
    }
    return digits >= 0
      ? Math.trunc(number * factor) / factor
      : Math.trunc(number / factor) * factor;
  }
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
    const extendedSignature = args.length >= 5;
    const grammaticalCase = text(extendedSignature ? 2 : 1).toUpperCase();
    const mode = text(extendedSignature ? 4 : 2).toUpperCase();
    return inflectFio(
      text(0),
      grammaticalCase,
      mode,
      formulaValueToBoolean(getFormulaContextValue("ФИО_несклон", context))
    );
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

function inflectFio(name, grammaticalCase = "Р", mode = "ФИО", preserveSurname = false) {
  const gender = inferGenderFromFio(name);
  const parts = splitFullName(name);
  const normalizedCase = String(grammaticalCase || "Р").toUpperCase();
  const normalizedMode = String(mode || "ФИО").toUpperCase();
  const inflectPart = normalizedCase === "Д"
    ? inflectRussianNamePartDative
    : inflectRussianNamePart;
  const surname = normalizedCase === "И" || preserveSurname
    ? parts.surname
    : inflectPart(parts.surname, gender, "surname");
  const firstName = normalizedCase === "И"
    ? parts.firstName
    : inflectPart(parts.firstName, gender, "firstName");
  const patronymic = normalizedCase === "И"
    ? parts.patronymic
    : inflectPart(parts.patronymic, gender, "patronymic");
  if (normalizedMode === "Ф") return surname;
  if (normalizedMode === "ИО") return [firstName, patronymic].filter(Boolean).join(" ");
  return [surname, firstName, patronymic].filter(Boolean).join(" ");
}

function inflectFioGenitive(name, preserveSurname = false) {
  return inflectFio(name, "Р", "ФИО", preserveSurname);
}

function inflectFioDative(name, preserveSurname = false) {
  return inflectFio(name, "Д", "ФИО", preserveSurname);
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
const EMPLOYEE_ACT_PAYMENT_FIELDS = new Set([
  "\u041f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0435 \u0432\u044b\u043f\u043b\u0430\u0442\u044b",
  "\u041f\u0430\u0440\u0442\u043d\u0435\u0440\u0441\u043a\u0430\u044f \u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0430"
]);

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

function parseEmployeeActPaymentTableRows(value) {
  return splitEducationTrainingPlanLines(value)
    .map((line) => {
      const parts = String(line || "").split("\t").map((part) => part.trim());
      if (!parts.some(Boolean)) return null;
      return {
        description: parts[0] || "",
        amount: parts.slice(1).join(" ").trim()
      };
    })
    .filter((row) => row && (row.description || row.amount));
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

function buildEmployeeActPaymentTableRow(rowXml, row, rowIndex, fieldCellIndex) {
  const cells = splitWordTableRowCells(rowXml);
  if (!cells.length) return rowXml;
  const descriptionIndex = fieldCellIndex >= 0 ? fieldCellIndex : (cells.length >= 3 ? 1 : 0);
  const numberIndex = descriptionIndex > 0 ? descriptionIndex - 1 : -1;
  const amountIndex = descriptionIndex + 1 < cells.length ? descriptionIndex + 1 : -1;
  const cellValues = new Map();
  if (numberIndex >= 0) {
    cellValues.set(numberIndex, /<w:numPr\b/.test(cells[numberIndex].xml) ? "" : String(rowIndex + 1));
  }
  cellValues.set(descriptionIndex, row.description || "");
  if (amountIndex >= 0) cellValues.set(amountIndex, row.amount || "");
  const nextCells = cells.map((cell, index) => (
    cellValues.has(index) ? buildWordTableCellValueXml(cell.xml, cellValues.get(index)) : cell.xml
  ));
  return replaceWordTableRowCells(rowXml, nextCells);
}

function applyEmployeeActPaymentTableFieldRows(xml, fieldName, value, fieldPositionMap) {
  const rows = parseEmployeeActPaymentTableRows(value);
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
    const fieldCellIndex = cells.findIndex((cell) => paragraphHasDocumentField(
      cell.xml,
      fieldName,
      fieldPositionMap
    ));
    if (fieldCellIndex < 0) continue;
    result += sourceXml.slice(cursor, match.index);
    result += rows.map((row, rowIndex) => (
      buildEmployeeActPaymentTableRow(rowXml, row, rowIndex, fieldCellIndex)
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

function applyEmployeeActPaymentTableRows(xml, fieldValues, fieldPositionMap) {
  let result = String(xml || "");
  EMPLOYEE_ACT_PAYMENT_FIELDS.forEach((fieldName) => {
    if (!Object.prototype.hasOwnProperty.call(fieldValues || {}, fieldName)) return;
    result = applyEmployeeActPaymentTableFieldRows(
      result,
      fieldName,
      fieldValues[fieldName],
      fieldPositionMap
    );
  });
  return result;
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

function normalizeUnavailableDocumentFonts(entries) {
  const fallbackFonts = new Map([
    ["Batang", "Times New Roman"]
  ]);
  entries.forEach((entry) => {
    if (!/^word\/.+\.xml$/i.test(entry.name)) return;
    let xml = entry.content.toString("utf8");
    fallbackFonts.forEach((fallback, unavailable) => {
      const escapedName = unavailable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      xml = xml
        .replace(
          new RegExp(`(\\bw:(?:ascii|hAnsi|eastAsia|cs)=")${escapedName}(")`, "g"),
          `$1${fallback}$2`
        )
        .replace(
          new RegExp(`(<w:font\\b[^>]*\\bw:name=")${escapedName}(")`, "g"),
          `$1${fallback}$2`
        );
    });
    entry.content = Buffer.from(xml, "utf8");
  });
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
  normalizeUnavailableDocumentFonts(entries);
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
    xml = applyEmployeeActPaymentTableRows(xml, fieldValues, indexedFieldPositionMap);
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

function normalizeFrdoExportFolder(value) {
  const source = String(value || DEFAULT_FRDO_EXPORT_FOLDER).trim();
  if (source.length > 500) throw new Error("Путь к папке выгрузки ФРДО слишком длинный.");
  const relativePath = normalizeSystemDocumentsRelativePath(source);
  if (!relativePath) {
    throw new Error("Укажите корректный путь к папке выгрузки ФРДО в настройках.");
  }
  return relativePath;
}

function usesParentSystemDocumentsFolder(value) {
  return /^\s*\[-1\](?:[\\/]+|$)/u.test(String(value || ""));
}

function getAbsoluteFileSystemPathApi(value) {
  const source = String(value || "").trim();
  if (/^[a-z]:[\\/]/i.test(source) || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(source)) {
    return path.win32;
  }
  if (path.posix.isAbsolute(source)) return path.posix;
  return null;
}

function findTopLevelMultiplicativeOperator(value) {
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
    else if (depth === 0 && squareDepth === 0 && (char === "*" || char === "/")) {
      return { index, operator: char };
    }
  }
  return null;
}

function normalizeAbsoluteFileSystemPath(value) {
  const source = String(value || "").trim();
  const pathApi = getAbsoluteFileSystemPathApi(source);
  return pathApi ? pathApi.normalize(source) : "";
}

function getRuntimeFileSystemPathApi(value) {
  const pathApi = getAbsoluteFileSystemPathApi(value);
  if (process.platform === "win32") return pathApi === path.win32 ? pathApi : null;
  return pathApi === path.posix ? pathApi : null;
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

function resolveLocalDocumentsPath(source, missingPathMessage = "Не удалось определить папку документов слушателя.") {
  const rootSource = String(
    serverSettings.localDocumentsRoot || DEFAULT_LOCAL_DOCUMENTS_ROOT
  ).trim();
  const pathApi = getRuntimeFileSystemPathApi(rootSource);
  if (!pathApi) {
    throw new Error("Укажите абсолютный путь к локальной папке документов.");
  }
  const relativePath = normalizeSystemDocumentsRelativePath(source);
  if (!relativePath) throw new Error(missingPathMessage);
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
  const rootPath = pathApi.resolve(rootSource);
  const folderPath = pathApi.resolve(rootPath, ...baseParts, ...relativeParts);
  const pathFromRoot = pathApi.relative(rootPath, folderPath);
  if (pathFromRoot.startsWith("..") || pathApi.isAbsolute(pathFromRoot)) {
    throw new Error("Папка документов находится за пределами локального хранилища.");
  }
  return folderPath;
}

function resolveLocalSystemDocumentsFolder() {
  const rootSource = String(
    serverSettings.localDocumentsRoot || DEFAULT_LOCAL_DOCUMENTS_ROOT
  ).trim();
  const pathApi = getRuntimeFileSystemPathApi(rootSource);
  if (!pathApi) return "";
  const baseParts = normalizeWebDavPath(
    serverSettings.yandexDiskBasePath || DEFAULT_YANDEX_DISK_BASE_PATH
  ).split("/").filter(Boolean);
  if (serverSettings.localDocumentsRootIsSystemParent && baseParts.length > 1) {
    baseParts.splice(0, baseParts.length - 1);
  }
  return pathApi.resolve(rootSource, ...baseParts);
}

async function getLocalSystemDocumentsAvailability() {
  const folderPath = resolveLocalSystemDocumentsFolder();
  if (!folderPath) return { available: false, path: "" };
  try {
    const stats = await fs.stat(folderPath);
    return { available: stats.isDirectory(), path: folderPath };
  } catch {
    return { available: false, path: folderPath };
  }
}

async function useWebDavWhenLocalDocumentsUnavailable(source) {
  if (source !== "local") return source;
  const localDocuments = await getLocalSystemDocumentsAvailability();
  return localDocuments.available ? "local" : "webdav";
}

function resolveLocalDocumentsFolder(source) {
  return resolveLocalDocumentsPath(source);
}

function resolveLocalDocumentFile(source, fileName) {
  const folderPath = resolveLocalDocumentsFolder(source);
  const targetPath = path.resolve(folderPath, safeDocumentFileName(fileName));
  const pathFromFolder = path.relative(folderPath, targetPath);
  if (pathFromFolder.startsWith("..") || path.isAbsolute(pathFromFolder)) {
    throw new Error("Файл документа находится за пределами выбранной папки.");
  }
  return targetPath;
}

async function resolveLocalDocumentTemplateFile(templateUrl, templatePath) {
  const candidates = [];
  const remoteSource = String(templateUrl || "").trim();
  const normalizedRemoteSource = normalizeSystemDocumentsRelativePath(remoteSource);
  if (normalizedRemoteSource) {
    candidates.push(resolveLocalDocumentsPath(
      normalizedRemoteSource,
      "Не удалось определить локальный путь к шаблону."
    ));
  }
  const storedSource = String(templatePath || "").trim();
  if (storedSource) {
    candidates.push(path.isAbsolute(storedSource)
      ? path.resolve(storedSource)
      : path.resolve(ROOT, storedSource));
  }
  if (!candidates.length) {
    throw new Error("Для шаблона не задан локальный путь.");
  }
  for (const candidate of [...new Set(candidates)]) {
    const extension = path.extname(candidate).replace(/^\./, "").toLowerCase();
    if (!WORD_TEMPLATE_EXTENSIONS.has(extension)) continue;
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("Локальный файл шаблона не найден.");
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

function revealFileInExplorer(filePath) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Выделение файла в Проводнике доступно только в Windows."));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("explorer.exe", ["/select,", filePath], {
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

function openFileInDefaultApplication(filePath) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Открытие файла доступно только в Windows."));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("explorer.exe", [filePath], {
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

async function resolveLocalOperationalDocumentFile(folderPath, requestedFileName) {
  const fileName = String(requestedFileName || "").trim();
  if (
    !fileName
    || fileName !== path.basename(fileName)
    || /[<>:"/\\|?*\u0000-\u001f]/u.test(fileName)
  ) {
    throw new Error("Имя файла ОП содержит недопустимые символы.");
  }
  const candidates = [fileName];
  if (!path.extname(fileName)) {
    candidates.push(`${fileName}.docx`, `${fileName}.pdf`, `${fileName}.doc`);
  }
  for (const candidate of candidates) {
    const filePath = path.resolve(folderPath, candidate);
    const relativePath = path.relative(folderPath, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;
    try {
      const stats = await fs.stat(filePath);
      if (stats.isFile()) return filePath;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!path.extname(fileName)) {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const requestedStem = fileName.toLocaleLowerCase("ru-RU");
    const extensionPriority = new Map([[".docx", 0], [".pdf", 1], [".doc", 2]]);
    const matchingEntry = entries
      .filter((entry) => (
        entry.isFile()
        && path.parse(entry.name).name.toLocaleLowerCase("ru-RU") === requestedStem
      ))
      .sort((left, right) => (
        (extensionPriority.get(path.extname(left.name).toLowerCase()) ?? 9)
        - (extensionPriority.get(path.extname(right.name).toLowerCase()) ?? 9)
      ))[0];
    if (matchingEntry) return path.join(folderPath, matchingEntry.name);
  }
  throw new Error(`Файл «${fileName}» не найден в папке ОП.`);
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

async function handleOpenLocalDocumentResource(req, res) {
  try {
    const body = await readJsonBody(req);
    const folderPath = resolveLocalDocumentsFolder(body.folder);
    const folderStats = await fs.stat(folderPath).catch((error) => {
      if (error.code === "ENOENT") throw new Error("Папка ОП не найдена на локальном диске.");
      throw error;
    });
    if (!folderStats.isDirectory()) throw new Error("Указанный путь ОП не является папкой.");
    const fileName = String(body.fileName || "").trim();
    if (!fileName) {
      await openFolderInExplorer(folderPath);
      sendJson(res, 200, { ok: true, path: folderPath, type: "folder" });
      return;
    }
    const filePath = await resolveLocalOperationalDocumentFile(folderPath, fileName);
    await openFileInDefaultApplication(filePath);
    sendJson(res, 200, { ok: true, path: filePath, type: "file" });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleResolveLocalDocumentFile(req, res) {
  try {
    const body = await readJsonBody(req);
    const filePath = resolveLocalDocumentFile(body.folder, body.fileName || "документ.docx");
    let exists = false;
    try {
      const stats = await fs.stat(filePath);
      exists = stats.isFile();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    sendJson(res, 200, { path: filePath, exists });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleRevealLocalDocumentFile(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!serverSettings.openDocumentsLocally) {
      throw new Error("Включите режим работы с документами на локальном компьютере.");
    }
    const filePath = resolveLocalDocumentFile(body.folder, body.fileName || "документ.docx");
    const stats = await fs.stat(filePath).catch((error) => {
      if (error.code === "ENOENT") throw new Error("Сформированный документ не найден на локальном диске.");
      throw error;
    });
    if (!stats.isFile()) throw new Error("Указанный путь не является файлом.");
    await revealFileInExplorer(filePath);
    sendJson(res, 200, { ok: true, path: filePath });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleRevealLocalDocumentTemplate(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!serverSettings.openDocumentsLocally) {
      throw new Error("Включите режим открытия документов на локальном компьютере.");
    }
    const filePath = await resolveLocalDocumentTemplateFile(body.templateUrl, body.templatePath);
    await revealFileInExplorer(filePath);
    sendJson(res, 200, { ok: true, path: filePath });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

function showLocalDocumentSaveDialog(initialPath, outputFormat) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Диалог сохранения доступен только на локальном сервере Windows."));
  }
  const powershellPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const launcher = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.SaveFileDialog",
    "$dialog.Title = 'Сохранить сформированный документ'",
    "$dialog.InitialDirectory = [IO.Path]::GetDirectoryName($env:AIS_SAVE_INITIAL_PATH)",
    "$dialog.FileName = [IO.Path]::GetFileName($env:AIS_SAVE_INITIAL_PATH)",
    "$dialog.Filter = if ($env:AIS_SAVE_FORMAT -eq 'pdf') { 'Документ PDF (*.pdf)|*.pdf' } else { 'Документ Word (*.docx)|*.docx' }",
    "$dialog.DefaultExt = $env:AIS_SAVE_FORMAT",
    "$dialog.AddExtension = $true",
    "$dialog.OverwritePrompt = $false",
    "$dialog.RestoreDirectory = $true",
    "function Confirm-RussianFileReplacement([string]$FilePath) {",
    "  $form = New-Object System.Windows.Forms.Form",
    "  $form.Text = 'Подтверждение замены'",
    "  $form.ClientSize = New-Object System.Drawing.Size(460, 150)",
    "  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
    "  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog",
    "  $form.MaximizeBox = $false",
    "  $form.MinimizeBox = $false",
    "  $form.ShowInTaskbar = $true",
    "  $form.TopMost = $true",
    "  $label = New-Object System.Windows.Forms.Label",
    "  $label.AutoSize = $false",
    "  $label.Location = New-Object System.Drawing.Point(20, 18)",
    "  $label.Size = New-Object System.Drawing.Size(420, 62)",
    "  $label.Text = 'Файл «' + [IO.Path]::GetFileName($FilePath) + '» уже существует.' + [Environment]::NewLine + 'Заменить его?'",
    "  $yesButton = New-Object System.Windows.Forms.Button",
    "  $yesButton.Text = 'Да'",
    "  $yesButton.DialogResult = [System.Windows.Forms.DialogResult]::Yes",
    "  $yesButton.Location = New-Object System.Drawing.Point(270, 98)",
    "  $yesButton.Size = New-Object System.Drawing.Size(80, 30)",
    "  $noButton = New-Object System.Windows.Forms.Button",
    "  $noButton.Text = 'Нет'",
    "  $noButton.DialogResult = [System.Windows.Forms.DialogResult]::No",
    "  $noButton.Location = New-Object System.Drawing.Point(360, 98)",
    "  $noButton.Size = New-Object System.Drawing.Size(80, 30)",
    "  $form.Controls.AddRange(@($label, $yesButton, $noButton))",
    "  $form.AcceptButton = $yesButton",
    "  $form.CancelButton = $noButton",
    "  return $form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::Yes",
    "}",
    "while ($true) {",
    "  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { break }",
    "  $selectedPath = [IO.Path]::ChangeExtension($dialog.FileName, '.' + $env:AIS_SAVE_FORMAT)",
    "  if ((Test-Path -LiteralPath $selectedPath -PathType Leaf) -and -not (Confirm-RussianFileReplacement $selectedPath)) { continue }",
    "  [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($selectedPath)))",
    "  break",
    "}"
  ].join("; ");
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-STA",
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
        AIS_SAVE_INITIAL_PATH: initialPath,
        AIS_SAVE_FORMAT: outputFormat
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Окно сохранения не было закрыто в течение 10 минут."));
    }, 10 * 60 * 1000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 64 * 1024) stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 256 * 1024) stderr += chunk;
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
        reject(new Error(String(stderr || stdout || "").trim() || "Не удалось открыть окно сохранения."));
        return;
      }
      const encodedPath = String(stdout || "").replace(/^\uFEFF/, "").trim();
      if (!encodedPath) {
        resolve("");
        return;
      }
      try {
        resolve(Buffer.from(encodedPath, "base64").toString("utf8"));
      } catch {
        reject(new Error("Окно сохранения вернуло некорректный путь."));
      }
    });
  });
}

async function promptAndSaveStudentDocumentLocally(bytes, fileName, body, outputFormat) {
  const initialPath = resolveLocalDocumentFile(body.studentFolder, fileName);
  await fs.mkdir(path.dirname(initialPath), { recursive: true });
  const selectedPath = await showLocalDocumentSaveDialog(initialPath, outputFormat);
  if (!selectedPath) return { saved: false, cancelled: true, path: initialPath };
  await fs.mkdir(path.dirname(selectedPath), { recursive: true });
  await fs.writeFile(selectedPath, bytes);
  try {
    await revealFileInExplorer(selectedPath);
  } catch (error) {
    console.warn(`Не удалось показать сохранённый документ в Проводнике: ${error.message}`);
  }
  return { saved: true, cancelled: false, path: selectedPath };
}

async function saveStudentDocumentLocally(bytes, fileName, body) {
  if (!serverSettings.openDocumentsLocally) {
    throw new Error("Включите режим работы с документами на локальном компьютере.");
  }
  const targetPath = resolveLocalDocumentFile(body.studentFolder, fileName);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, bytes);
  return { saved: true, cancelled: false, path: targetPath };
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

function createDocumentQrCodeImage(value) {
  const payload = String(value || "").trim();
  if (!payload) return null;
  try {
    if (/^data:image\//i.test(payload)) {
      const parsedImage = parseDataUrl(payload);
      return {
        ...parsedImage,
        ...imageDimensions(parsedImage.bytes, parsedImage.ext),
        name: "QR-код документа"
      };
    }
    const qrCode = QR_CODE_GENERATOR(0, "M");
    qrCode.addData(payload, "Byte");
    qrCode.make();
    const parsed = createQrCodePng(qrCode, 12, 4);
    return {
      ...parsed,
      ...imageDimensions(parsed.bytes, parsed.ext),
      name: "QR-код документа"
    };
  } catch (error) {
    throw new Error(`Не удалось сформировать QR-код документа: ${error.message}`);
  }
}

function pngCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildPngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  const chunk = Buffer.allocUnsafe(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return chunk;
}

function createQrCodePng(qrCode, scale = 12, marginModules = 4) {
  const moduleCount = qrCode.getModuleCount();
  const cellSize = Math.max(1, Math.trunc(Number(scale) || 12));
  const margin = Math.max(0, Math.trunc(Number(marginModules) || 0));
  const size = (moduleCount + margin * 2) * cellSize;
  const stride = size + 1;
  const pixels = Buffer.alloc(stride * size, 0xFF);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * stride;
    pixels[rowOffset] = 0;
    const moduleY = Math.floor(y / cellSize) - margin;
    for (let x = 0; x < size; x += 1) {
      const moduleX = Math.floor(x / cellSize) - margin;
      const dark = moduleX >= 0 && moduleX < moduleCount
        && moduleY >= 0 && moduleY < moduleCount
        && qrCode.isDark(moduleY, moduleX);
      pixels[rowOffset + 1 + x] = dark ? 0 : 0xFF;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 0;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    buildPngChunk("IHDR", header),
    buildPngChunk("IDAT", zlib.deflateSync(pixels, { level: 9 })),
    buildPngChunk("IEND", Buffer.alloc(0))
  ]);
  return { bytes, ext: "png", mime: "image/png", width: size, height: size };
}

function requestBuffer(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const requestBody = options.body === undefined || options.body === null
      ? null
      : (Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body));
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
          reject(new Error(options.redirectError || "Слишком много перенаправлений при выполнении запроса."));
          return;
        }
        const preserveBody = [307, 308].includes(res.statusCode);
        const nextOptions = preserveBody
          ? options
          : {
              ...options,
              method: "GET",
              body: null,
              headers: Object.fromEntries(
                Object.entries(options.headers || {}).filter(([name]) => (
                  !["content-length", "content-type"].includes(name.toLowerCase())
                ))
              )
            };
        resolve(requestBuffer(new URL(location, target).toString(), nextOptions, redirectCount + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => reject(new Error(
          `${options.errorPrefix || "HTTP-запрос завершился с ошибкой"}: HTTP ${res.statusCode} `
          + Buffer.concat(chunks).toString("utf8").slice(0, 500)
        )));
        return;
      }
      const chunks = [];
      let size = 0;
      const totalSize = Number(res.headers["content-length"]) || 0;
      const maxResponseBytes = Number(options.maxResponseBytes) || MAX_DOCX_BYTES;
      res.on("data", (chunk) => {
        size += chunk.length;
        options.onProgress?.({
          receivedBytes: size,
          totalBytes: totalSize
        });
        if (size > maxResponseBytes) {
          req.destroy(new Error(options.sizeError || "Ответ сервера превышает допустимый размер."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(
      Number(options.timeoutMs) || 30000,
      () => req.destroy(new Error(options.timeoutError || "Истекло время ожидания ответа сервера."))
    );
    req.end(requestBody);
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
        let targetPath = target.pathname;
        try {
          targetPath = decodeURIComponent(targetPath);
        } catch {
          // Keep the encoded path when it contains a malformed escape sequence.
        }
        reject(new Error(
          `Яндекс-Диск вернул HTTP ${response.statusCode} для ${targetPath}: ${Buffer.concat(chunks).toString("utf8").slice(0, 240)}`
        ));
      });
    });
    request.on("error", reject);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Истекло время ожидания ответа Яндекс-Диска.")));
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
    const existing = await requestYandexWebDav("PROPFIND", currentPath, {
      acceptedStatuses: [207, 404],
      headers: { Depth: "0" },
      contentType: "application/xml; charset=utf-8",
      body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
      maxResponseBytes: 64 * 1024
    });
    if (existing.statusCode === 207) continue;
    const created = await requestYandexWebDav("MKCOL", currentPath, {
      acceptedStatuses: [201, 405, 423]
    });
    if (created.statusCode === 423) {
      await requestYandexWebDav("PROPFIND", currentPath, {
        acceptedStatuses: [207],
        headers: { Depth: "0" },
        contentType: "application/xml; charset=utf-8",
        body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
        maxResponseBytes: 64 * 1024
      });
    }
  }
  return currentPath || "/";
}

function getSharedApplicationStateWebDavPath() {
  const basePath = normalizeWebDavPath(
    serverSettings.yandexDiskBasePath || DEFAULT_YANDEX_DISK_BASE_PATH
  );
  return normalizeWebDavPath(`${basePath}/${SHARED_APPLICATION_STATE_RELATIVE_PATH}`);
}

function getSharedApplicationStateLocalPath() {
  return path.resolve(
    process.env.AIS_SHARED_STATE_LOCAL_PATH || SHARED_APPLICATION_STATE_CACHE_PATH
  );
}

function getSharedRecordLocksLocalPath() {
  return path.resolve(
    process.env.AIS_SHARED_RECORD_LOCKS_LOCAL_PATH || SHARED_RECORD_LOCKS_CACHE_PATH
  );
}

function normalizeSharedApplicationData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Общая база передана в некорректном формате.");
  }
  if (!value.collections || typeof value.collections !== "object" || Array.isArray(value.collections)) {
    throw new Error("В общей базе отсутствуют коллекции данных.");
  }
  if (!value.dictionaries || typeof value.dictionaries !== "object" || Array.isArray(value.dictionaries)) {
    throw new Error("В общей базе отсутствуют справочники.");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SHARED_APPLICATION_STATE_BYTES) {
    throw new Error("Общая база превышает допустимый размер 36 МБ.");
  }
  const normalized = JSON.parse(serialized);
  normalized.meta = normalized.meta && typeof normalized.meta === "object" && !Array.isArray(normalized.meta)
    ? normalized.meta
    : {};
  if (Number(normalized.meta.frdoUploadDeadlinePolicyVersion || 0) < FRDO_UPLOAD_DEADLINE_POLICY_VERSION) {
    const settings = Array.isArray(normalized.dictionaries.issuedDocumentSettings)
      ? normalized.dictionaries.issuedDocumentSettings.map((setting) => ({ ...setting }))
      : [];
    const deadlineIndex = settings.findIndex((setting) => setting?.key === "frdoUploadDeadlineDays");
    if (deadlineIndex < 0) {
      settings.push({
        key: "frdoUploadDeadlineDays",
        label: "Норматив выгрузки в ФРДО, дней",
        value: "30"
      });
    } else if (Number(settings[deadlineIndex].value) === 60) {
      settings[deadlineIndex].value = "30";
    }
    normalized.dictionaries.issuedDocumentSettings = settings;
    normalized.meta.frdoUploadDeadlinePolicyVersion = FRDO_UPLOAD_DEADLINE_POLICY_VERSION;
  }
  return normalized;
}

function normalizeSharedApplicationStatePatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SHARED_APPLICATION_STATE_BYTES) {
    throw new Error("Пакет синхронизации общей базы превышает допустимый размер.");
  }
  const source = JSON.parse(serialized);
  const patch = { collections: {}, dictionaries: {}, meta: {}, root: {}, recordKeys: [] };
  const collections = source.collections && typeof source.collections === "object" && !Array.isArray(source.collections)
    ? source.collections
    : {};
  for (const [collectionName, rawChange] of Object.entries(collections)) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(collectionName) || !rawChange || typeof rawChange !== "object") continue;
    if (Array.isArray(rawChange.replace)) {
      patch.collections[collectionName] = { replace: rawChange.replace };
      continue;
    }
    const upserts = Array.isArray(rawChange.upserts)
      ? rawChange.upserts.filter((record) => record && typeof record === "object" && !Array.isArray(record) && String(record.id || "").trim())
      : [];
    const deletes = Array.isArray(rawChange.deletes)
      ? [...new Set(rawChange.deletes.map((id) => String(id || "").trim()).filter(Boolean))]
      : [];
    const order = Array.isArray(rawChange.order)
      ? [...new Set(rawChange.order.map((id) => String(id || "").trim()).filter(Boolean))]
      : [];
    if (upserts.length || deletes.length || order.length) {
      patch.collections[collectionName] = { upserts, deletes, order };
    }
  }
  for (const key of ["dictionaries", "meta", "root"]) {
    const values = source[key];
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const [name, nextValue] of Object.entries(values)) {
      if (String(name).length > 160) continue;
      patch[key][name] = nextValue;
    }
  }
  if (Array.isArray(source.recordKeys)) {
    patch.recordKeys = [...new Set(source.recordKeys
      .map((key) => String(key || "").trim())
      .filter((key) => /^[A-Za-z0-9_-]{1,120}:[^:\r\n]{1,191}$/.test(key)))];
  }
  return patch;
}

function applySharedApplicationStatePatch(currentData, patch) {
  const next = normalizeSharedApplicationData(currentData);
  next.collections = next.collections && typeof next.collections === "object" ? next.collections : {};
  next.dictionaries = next.dictionaries && typeof next.dictionaries === "object" ? next.dictionaries : {};
  next.meta = next.meta && typeof next.meta === "object" ? next.meta : {};
  for (const [collectionName, change] of Object.entries(patch?.collections || {})) {
    if (Array.isArray(change.replace)) {
      next.collections[collectionName] = JSON.parse(JSON.stringify(change.replace));
      continue;
    }
    const currentRows = Array.isArray(next.collections[collectionName]) ? next.collections[collectionName] : [];
    const rowsById = new Map(currentRows
      .filter((record) => record && typeof record === "object" && String(record.id || "").trim())
      .map((record) => [String(record.id), record]));
    for (const id of change.deletes || []) rowsById.delete(String(id));
    for (const record of change.upserts || []) rowsById.set(String(record.id), record);
    const ordered = [];
    const used = new Set();
    for (const id of change.order || []) {
      const record = rowsById.get(String(id));
      if (!record || used.has(String(id))) continue;
      ordered.push(record);
      used.add(String(id));
    }
    for (const record of rowsById.values()) {
      const id = String(record.id || "");
      if (used.has(id)) continue;
      ordered.push(record);
    }
    next.collections[collectionName] = ordered;
  }
  Object.assign(next.dictionaries, patch?.dictionaries || {});
  Object.assign(next.meta, patch?.meta || {});
  for (const [name, value] of Object.entries(patch?.root || {})) {
    if (["collections", "dictionaries", "meta"].includes(name)) continue;
    next[name] = value;
  }
  return normalizeSharedApplicationData(next);
}

function getSharedApplicationStatePatchRecordKeys(patch) {
  const keys = Array.isArray(patch?.recordKeys) ? patch.recordKeys.map(String) : [];
  for (const [collectionName, change] of Object.entries(patch?.collections || {})) {
    for (const record of change.upserts || []) {
      if (record?.id) keys.push(`${collectionName}:${record.id}`);
    }
    for (const id of change.deletes || []) {
      if (id) keys.push(`${collectionName}:${id}`);
    }
  }
  return [...new Set(keys)];
}

function normalizeSharedApplicationStateDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Файл общей базы повреждён.");
  }
  const revision = Math.max(0, Math.floor(Number(value.revision) || 0));
  if (!revision) throw new Error("В файле общей базы отсутствует ревизия.");
  return {
    schemaVersion: 1,
    revision,
    updatedAt: String(value.updatedAt || ""),
    updatedBy: String(value.updatedBy || "").slice(0, 160),
    data: normalizeSharedApplicationData(value.data)
  };
}

function sharedApplicationStateVersionTag(value) {
  return String(value || "").trim().slice(0, 240);
}

function gzipSharedApplicationState(value) {
  return new Promise((resolve, reject) => {
    zlib.gzip(value, { level: zlib.constants.Z_BEST_COMPRESSION }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function gunzipSharedApplicationState(value) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(value, { maxOutputLength: MAX_SHARED_APPLICATION_STATE_BYTES + 1024 * 1024 }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function writeSharedApplicationStateCache(document) {
  const cachePath = getSharedApplicationStateLocalPath();
  if (!sharedApplicationStateCacheLoaded) await readSharedApplicationStateCache();
  if (Number(sharedApplicationStateCacheMemory?.revision) === Number(document?.revision)) return;
  await writeJsonAtomic(cachePath, document, true);
  sharedApplicationStateCacheMemory = document;
  sharedApplicationStateCacheLoaded = true;
}

async function readSharedApplicationStateCache() {
  if (sharedApplicationStateCacheLoaded) return sharedApplicationStateCacheMemory;
  try {
    sharedApplicationStateCacheMemory = normalizeSharedApplicationStateDocument(
      JSON.parse(await fs.readFile(getSharedApplicationStateLocalPath(), "utf8"))
    );
    sharedApplicationStateCacheLoaded = true;
    return sharedApplicationStateCacheMemory;
  } catch {
    sharedApplicationStateCacheMemory = null;
    sharedApplicationStateCacheLoaded = true;
    return null;
  }
}

async function readLegacySharedApplicationStateDocument(options = {}) {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") {
    const localPath = getSharedApplicationStateLocalPath();
    try {
      const document = normalizeSharedApplicationStateDocument(
        JSON.parse(await fs.readFile(localPath, "utf8"))
      );
      return {
        exists: true,
        document,
        versionTag: `local-${document.revision}`,
        source: "local-test",
        offline: false
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { exists: false, document: null, versionTag: "", source: "local-test", offline: false };
      }
      throw error;
    }
  }

  const davPath = getSharedApplicationStateWebDavPath();
  try {
    const response = await requestYandexWebDav("GET", davPath, {
      acceptedStatuses: [200, 404],
      maxResponseBytes: MAX_SHARED_APPLICATION_STATE_BYTES + 1024 * 1024
    });
    if (response.statusCode === 404) {
      return { exists: false, document: null, versionTag: "", source: "webdav", offline: false };
    }
    const decompressed = await gunzipSharedApplicationState(response.body);
    const document = normalizeSharedApplicationStateDocument(JSON.parse(decompressed.toString("utf8")));
    await writeSharedApplicationStateCache(document).catch(() => {});
    return {
      exists: true,
      document,
      versionTag: sharedApplicationStateVersionTag(response.headers.etag) || `revision-${document.revision}`,
      source: "webdav",
      offline: false
    };
  } catch (error) {
    if (options.allowCache === false) throw error;
    const cachedDocument = await readSharedApplicationStateCache();
    if (!cachedDocument) throw error;
    return {
      exists: true,
      document: cachedDocument,
      versionTag: `cache-${cachedDocument.revision}`,
      source: "cache",
      offline: true,
      warning: error.message
    };
  }
}

async function readLegacySharedApplicationStateMetadata() {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") {
    const result = await readLegacySharedApplicationStateDocument({ allowCache: false });
    return {
      exists: result.exists,
      revision: result.document?.revision || 0,
      updatedAt: result.document?.updatedAt || "",
      updatedBy: result.document?.updatedBy || "",
      versionTag: result.versionTag,
      offline: false
    };
  }
  let response;
  try {
    response = await requestYandexWebDav("HEAD", getSharedApplicationStateWebDavPath(), {
      acceptedStatuses: [200, 404],
      maxResponseBytes: 16 * 1024
    });
  } catch {
    const result = await readLegacySharedApplicationStateDocument();
    return {
      exists: result.exists,
      revision: result.document?.revision || 0,
      updatedAt: result.document?.updatedAt || "",
      updatedBy: result.document?.updatedBy || "",
      versionTag: result.versionTag,
      offline: result.offline
    };
  }
  if (response.statusCode === 404) {
    return { exists: false, revision: 0, updatedAt: "", updatedBy: "", versionTag: "", offline: false };
  }
  const versionTag = sharedApplicationStateVersionTag(response.headers.etag);
  if (versionTag) {
    return { exists: true, revision: 0, updatedAt: "", updatedBy: "", versionTag, offline: false };
  }
  const result = await readLegacySharedApplicationStateDocument();
  return {
    exists: result.exists,
    revision: result.document?.revision || 0,
    updatedAt: result.document?.updatedAt || "",
    updatedBy: result.document?.updatedBy || "",
    versionTag: result.versionTag,
    offline: result.offline
  };
}

async function refreshSharedApplicationStateMirror() {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1" || sharedStateMirrorRunning) return;
  sharedStateMirrorRunning = true;
  try {
    await flushSharedApplicationStateOfflineQueue();
    const metadata = await readSharedApplicationStateMetadata();
    if (!metadata.exists) return;
    const cached = await readSharedApplicationStateCache();
    const unchangedByRevision = Number(metadata.revision) > 0
      && Number(cached?.revision || 0) === Number(metadata.revision);
    const unchangedByVersion = Boolean(
      metadata.versionTag
      && sharedStateMirrorVersionTag
      && metadata.versionTag === sharedStateMirrorVersionTag
    );
    if (unchangedByRevision || unchangedByVersion) return;
    const result = await readSharedApplicationStateDocument({ allowCache: false });
    sharedStateMirrorVersionTag = String(result.versionTag || metadata.versionTag || "");
    sharedStateMirrorLastError = "";
  } catch (error) {
    const message = String(error?.message || error);
    if (message !== sharedStateMirrorLastError) {
      console.warn(`Обновление локального зеркала общей базы отложено: ${message}`);
      sharedStateMirrorLastError = message;
    }
  } finally {
    sharedStateMirrorRunning = false;
  }
}

function startSharedApplicationStateMirror() {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") return;
  refreshSharedApplicationStateMirror().catch(() => {});
  const timer = setInterval(() => {
    refreshSharedApplicationStateMirror().catch(() => {});
  }, SHARED_STATE_MIRROR_INTERVAL_MS);
  timer.unref?.();
}

async function maybeBackupSharedApplicationState(document) {
  if (!document || process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") return;
  await fs.mkdir(SHARED_APPLICATION_STATE_BACKUP_ROOT, { recursive: true });
  const existing = (await fs.readdir(SHARED_APPLICATION_STATE_BACKUP_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^shared-state-.*\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (existing.length) {
    const latest = await fs.stat(path.join(SHARED_APPLICATION_STATE_BACKUP_ROOT, existing[0]));
    if (Date.now() - latest.mtimeMs < 15 * 60 * 1000) return;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    SHARED_APPLICATION_STATE_BACKUP_ROOT,
    `shared-state-${timestamp}-r${document.revision}.json`
  );
  await writeJsonAtomic(backupPath, document);
  const stale = existing.slice(49);
  await Promise.all(stale.map((name) => fs.unlink(
    path.join(SHARED_APPLICATION_STATE_BACKUP_ROOT, name)
  ).catch(() => {})));
}

async function writeLegacySharedApplicationStateDocument(current, document) {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") {
    const localPath = getSharedApplicationStateLocalPath();
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await writeJsonAtomic(localPath, document);
    return { saved: true, versionTag: `local-${document.revision}` };
  }
  const davPath = getSharedApplicationStateWebDavPath();
  await ensureYandexDiskFolder(path.posix.dirname(davPath));
  const compressedDocument = await gzipSharedApplicationState(Buffer.from(`${JSON.stringify(document)}\n`, "utf8"));
  const headers = current.exists
    ? { "If-Match": current.versionTag && !current.versionTag.startsWith("revision-") ? current.versionTag : "*" }
    : { "If-None-Match": "*" };
  const response = await requestYandexWebDav("PUT", davPath, {
    acceptedStatuses: [200, 201, 204, 412],
    contentType: "application/gzip",
    headers,
    body: compressedDocument,
    maxResponseBytes: 64 * 1024,
    timeoutMs: 120000
  });
  if (response.statusCode === 412) return { saved: false, versionTag: "" };
  await writeSharedApplicationStateCache(document).catch(() => {});
  let versionTag = sharedApplicationStateVersionTag(response.headers.etag);
  if (!versionTag) {
    const metadata = await readLegacySharedApplicationStateMetadata().catch(() => null);
    versionTag = metadata?.versionTag || `revision-${document.revision}`;
  }
  return { saved: true, versionTag };
}

function enqueueSharedApplicationStateWrite(operation) {
  const result = sharedApplicationStateWriteQueue.catch(() => {}).then(operation);
  sharedApplicationStateWriteQueue = result.catch(() => {});
  return result;
}

function parseSharedRecordLocksMySqlConnectionString(value) {
  const result = {};
  const source = String(value || "");
  const expression = /(?:^|;)\s*([^=;]+)\s*=\s*(\{[^}]*\}|[^;]*)/g;
  let match;
  while ((match = expression.exec(source))) {
    const key = String(match[1] || "").trim().toLowerCase();
    let item = String(match[2] || "").trim();
    if (item.startsWith("{") && item.endsWith("}")) item = item.slice(1, -1);
    result[key] = item;
  }
  return result;
}

function getStudentApplicationsMySqlConnectionString() {
  return String(
    serverSettings.studentApplicationsMySqlConnectionString
      || process.env.STUDENT_APPLICATIONS_MYSQL_CONNECTION_STRING
      || ""
  ).trim();
}

function getStudentApplicationsSqlQuery() {
  return optimizeStudentApplicationsSqlQuery(String(
    serverSettings.studentApplicationsSqlQuery || defaultStudentApplicationsSqlQuery || ""
  ).trim());
}

function normalizeStudentApplicationsOrderAdminUrlTemplate(value) {
  const template = String(value || DEFAULT_STUDENT_ORDER_ADMIN_URL_TEMPLATE).trim();
  if (!template || template.length > 2048) {
    throw new Error("Укажите корректный шаблон ссылки на заказ интернет-магазина.");
  }
  if (!/[{]НомерЗаказа[}]|НомерЗаказа|[{]orderNo[}]|%ORDER_ID%/u.test(template)) {
    throw new Error("Добавьте в шаблон ссылки маркер {НомерЗаказа}.");
  }
  const candidate = template
    .replaceAll("{НомерЗаказа}", "1")
    .replaceAll("НомерЗаказа", "1")
    .replaceAll("{orderNo}", "1")
    .replaceAll("%ORDER_ID%", "1");
  let url;
  try {
    url = new URL(candidate);
  } catch (error) {
    throw new Error("Укажите корректный адрес страницы заказа интернет-магазина.");
  }
  if (!["http:", "https:"].includes(url.protocol.toLowerCase())) {
    throw new Error("Ссылка на заказ должна использовать протокол HTTP или HTTPS.");
  }
  return template;
}

function optimizeStudentApplicationsSqlQuery(value) {
  let query = String(value || "").trim();
  if (!query || !/FROM\s+wp_wc_order_product_lookup\s+AS\s+t_opl/iu.test(query)) return query;
  query = query.replace(
    /INNER\s+JOIN\s+wp_woocommerce_order_items\s+oi\s+ON\s+t_opl\.order_id\s*=\s*oi\.order_id/iu,
    "INNER JOIN wp_woocommerce_order_items oi\n    ON t_opl.order_item_id = oi.order_item_id"
  );
  const outerDateFilter = /\n\)\s+AS\s+t_all\s*\nWHERE\s+date_created\s*>=\s*\?\s*\n\s*AND\s+date_created\s*<\s*\?\s*$/iu;
  if (outerDateFilter.test(query)) {
    query = query.replace(
      outerDateFilter,
      "\n  WHERE t_opl.date_created >= ?\n    AND t_opl.date_created < ?\n) AS t_all\nWHERE 1 = 1"
    );
  }
  return query;
}

function upgradeLegacyStudentApplicationsSqlQuery(value) {
  let query = String(value || "")
    .replace(/^\s*--[^\r\n]*(?:\r?\n|$)/gmu, "")
    .trim();
  if (!query || query.includes("source_order_id")) return query;
  if (
    !/FROM\s+wp_wc_order_product_lookup\s+AS\s+t_opl/iu.test(query)
    || !/SELECT\s+DISTINCTROW/iu.test(query)
  ) return query;
  query = query.replace(
    /,\s*t_opl\.date_created\s*\r?\nFROM/iu,
    `,
    IFNULL(coup.order_item_name, '') AS source_coupon,
    t_opl.date_created,
    t_opl.order_id AS source_order_id,
    oi.order_item_id AS source_line_item_id,
    IFNULL(iprod.meta_value, '') AS source_product_id,
    (os.status IN ('wc-completed', 'wc-processing') AND os.total_sales > 0) AS source_is_paid,
    ((os.status IN ('wc-completed', 'wc-processing') AND os.total_sales > 0) * IFNULL(itotal.meta_value, 0)) AS source_payment_amount
FROM`
  );
  query = query.replace(
    /\r?\n\s*ORDER\s+BY\s+t_opl\.order_id[\s\S]*?\)\s+AS\s+t_all\s*$/iu,
    `
  WHERE t_opl.date_created >= ?
    AND t_opl.date_created < ?
) AS t_all
WHERE 1 = 1`
  );
  [
    "Дата", "ФИО", "Заказ (оплата)", "Программа", "Телефон", "Email", "Город",
    "Организация", "Должность", "Источник", "Примечание"
  ].forEach((label) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query = query.replace(
      new RegExp(`\\bAS\\s+(?:\`${escapedLabel}\`|'${escapedLabel}'|${escapedLabel})(?=\\s*,)`, "giu"),
      `AS \`${label}\``
    );
  });
  return query;
}

function compactSqlQueryForMacroSettings(value) {
  const source = String(value || "").trim();
  let result = "";
  let quote = "";
  let pendingSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      result += char;
      if (char === quote) {
        if (source[index + 1] === quote) {
          result += source[index + 1];
          index += 1;
        } else {
          quote = "";
        }
      } else if (char === "\\" && index + 1 < source.length) {
        result += source[index + 1];
        index += 1;
      }
      continue;
    }
    if (["'", '"', "`"].includes(char)) {
      if (pendingSpace && result && !result.endsWith(" ")) result += " ";
      pendingSpace = false;
      quote = char;
      result += char;
      continue;
    }
    if (/\s/u.test(char)) {
      pendingSpace = true;
      continue;
    }
    if (",()=<>".includes(char)) {
      result = result.trimEnd();
      pendingSpace = false;
      result += char;
      continue;
    }
    if (pendingSpace && result && !result.endsWith(" ")) result += " ";
    pendingSpace = false;
    result += char;
  }
  return result.trim().replace(/\s+AS\s+(?=[`A-Za-zА-Яа-я_])/gu, " ");
}

function normalizeStudentApplicationsSqlQuery(value) {
  const query = optimizeStudentApplicationsSqlQuery(
    upgradeLegacyStudentApplicationsSqlQuery(value)
  );
  if (!query) throw new Error("Укажите SQL-запрос получения заявок интернет-магазина.");
  if (query.length > 100000) throw new Error("SQL-запрос интернет-магазина слишком большой.");
  if (!/^SELECT\b/iu.test(query)) {
    throw new Error("SQL-запрос интернет-магазина должен начинаться с SELECT.");
  }
  if (/;|--|\/\*|\*\/|(?:^|\s)#/u.test(query)) {
    throw new Error("В SQL-запросе интернет-магазина нельзя использовать несколько команд или комментарии.");
  }
  if (/\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL|LOAD|OUTFILE|DUMPFILE|LOCK|UNLOCK)\b/iu.test(query)) {
    throw new Error("SQL-запрос интернет-магазина может только читать данные.");
  }
  if ((query.match(/\?/g) || []).length !== 2) {
    throw new Error("SQL-запрос должен содержать два параметра ?: начало периода и конец периода.");
  }
  const requiredColumns = [
    "date_created", "source_order_id", "source_line_item_id", "source_product_id",
    "source_is_paid", "source_payment_amount", "`Дата`", "`ФИО`",
    "`Заказ (оплата)`", "`Программа`", "`Телефон`", "`Email`", "`Город`",
    "`Организация`", "`Должность`", "`Источник`", "`Примечание`"
  ];
  const missing = requiredColumns.filter((column) => !query.includes(column));
  if (missing.length) {
    throw new Error(`SQL-запрос не возвращает обязательные поля: ${missing.join(", ")}.`);
  }
  return query;
}

function buildStudentApplicationsMySqlConnectionString(values = {}) {
  const encode = (value) => `{${String(value || "")}}`;
  return [
    ["Driver", values.driver],
    ["Server", values.host],
    ["Port", values.port],
    ["Database", values.database],
    ["Uid", values.user],
    ["Pwd", values.password]
  ].map(([key, value]) => `${key}=${encode(value)}`).join(";");
}

function publicStudentApplicationsMySqlSettings() {
  const connectionString = getStudentApplicationsMySqlConnectionString();
  const connection = parseSharedRecordLocksMySqlConnectionString(connectionString);
  return {
    applicationsMysqlDriver: String(connection.driver || "MySQL ODBC 9.4 Unicode Driver").trim(),
    applicationsMysqlHost: String(connection.server || connection.host || "").trim(),
    applicationsMysqlPort: Math.max(1, Number(connection.port) || 3306),
    applicationsMysqlDatabase: String(connection.database || connection.initialcatalog || "").trim(),
    applicationsMysqlUser: String(connection.uid || connection.user || connection.userid || "").trim(),
    applicationsMysqlHasPassword: Boolean(connection.pwd || connection.password),
    applicationsMysqlConfigured: Boolean(connectionString),
    applicationsMysqlManagedByEnvironment: Boolean(process.env.STUDENT_APPLICATIONS_MYSQL_CONNECTION_STRING),
    applicationsSqlQuery: getStudentApplicationsSqlQuery(),
    applicationsOrderAdminUrlTemplate: normalizeStudentApplicationsOrderAdminUrlTemplate(
      serverSettings.studentApplicationsOrderAdminUrlTemplate
    )
  };
}

async function getStudentApplicationsMySqlPool() {
  const connectionString = getStudentApplicationsMySqlConnectionString();
  if (!connectionString) return null;
  if (studentApplicationsMySqlPool) return studentApplicationsMySqlPool;
  if (studentApplicationsMySqlInitialization) return studentApplicationsMySqlInitialization;
  studentApplicationsMySqlInitialization = (async () => {
    const connection = parseSharedRecordLocksMySqlConnectionString(connectionString);
    let host = String(connection.server || connection.host || "").trim();
    const database = String(connection.database || connection.initialcatalog || "").trim();
    const user = String(connection.uid || connection.user || connection.userid || "").trim();
    const password = String(connection.pwd || connection.password || "");
    if (!host || !database || !user || !password) {
      throw new Error("Не настроено подключение MySQL к интернет-магазину.");
    }
    if (process.platform !== "win32" && /\.timeweb\.ru$/i.test(host)) host = "127.0.0.1";
    let mysql;
    try {
      mysql = require(MYSQL2_BUNDLE_PATH);
    } catch (error) {
      throw new Error(`Драйвер MySQL интернет-магазина не установлен: ${error.message}`);
    }
    const pool = mysql.createPool({
      host,
      port: Math.max(1, Number(connection.port) || 3306),
      database,
      user,
      password,
      charset: "utf8mb4",
      dateStrings: true,
      waitForConnections: true,
      connectionLimit: 2,
      maxIdle: 1,
      idleTimeout: 30000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 4000
    });
    try {
      await pool.query({ sql: "SELECT 1 AS ok", timeout: 6000 });
    } catch (error) {
      await pool.end().catch(() => {});
      throw error;
    }
    studentApplicationsMySqlPool = pool;
    return pool;
  })();
  try {
    return await studentApplicationsMySqlInitialization;
  } finally {
    studentApplicationsMySqlInitialization = null;
  }
}

async function closeStudentApplicationsMySqlStorage() {
  const pool = studentApplicationsMySqlPool;
  studentApplicationsMySqlPool = null;
  if (pool) await pool.end().catch(() => {});
}

function getSharedRecordLocksMySqlConnectionString() {
  const environmentConnection = String(
    process.env.AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING || ""
  ).trim();
  if (environmentConnection) return environmentConnection;
  const legacyConnection = String(
    serverSettings.sharedRecordLocksMySqlConnectionString || ""
  ).trim();
  if (legacyConnection) return legacyConnection;
  if (serverSettings.sharedRecordLocksMySqlUseApplicationsConnection !== false) {
    return String(
      serverSettings.studentApplicationsMySqlConnectionString
        || process.env.STUDENT_APPLICATIONS_MYSQL_CONNECTION_STRING
        || ""
    ).trim();
  }
  const values = {
    Server: String(serverSettings.sharedRecordLocksMySqlHost || "").trim(),
    Port: Math.max(1, Number(serverSettings.sharedRecordLocksMySqlPort) || 3306),
    Database: String(serverSettings.sharedRecordLocksMySqlDatabase || "").trim(),
    Uid: String(serverSettings.sharedRecordLocksMySqlUser || "").trim(),
    Pwd: String(serverSettings.sharedRecordLocksMySqlPassword || "")
  };
  if (!values.Server || !values.Database || !values.Uid || !values.Pwd) return "";
  const encode = (value) => `{${String(value)}}`;
  return Object.entries(values).map(([key, value]) => `${key}=${encode(value)}`).join(";");
}

function publicSharedRecordLocksMySqlSettings() {
  const useApplicationsConnection = serverSettings.sharedRecordLocksMySqlUseApplicationsConnection !== false;
  const connectionString = getSharedRecordLocksMySqlConnectionString();
  const connection = parseSharedRecordLocksMySqlConnectionString(connectionString);
  return {
    mysqlUseApplicationsConnection: useApplicationsConnection,
    mysqlHost: String(connection.server || connection.host || "").trim(),
    mysqlPort: Math.max(1, Number(connection.port) || 3306),
    mysqlDatabase: String(connection.database || connection.initialcatalog || "").trim(),
    mysqlUser: String(connection.uid || connection.user || connection.userid || "").trim(),
    mysqlHasPassword: Boolean(connection.pwd || connection.password),
    mysqlConfigured: Boolean(connectionString),
    mysqlManagedByEnvironment: Boolean(process.env.AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING),
    mysqlSource: process.env.AIS_RECORD_LOCKS_MYSQL_CONNECTION_STRING
      ? "environment"
      : useApplicationsConnection ? "applications" : "dedicated"
  };
}

async function getSharedRecordLocksMySqlPool() {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") return null;
  const connectionString = getSharedRecordLocksMySqlConnectionString();
  if (!connectionString) return null;
  if (sharedRecordLocksMySqlPool) return sharedRecordLocksMySqlPool;
  if (sharedRecordLocksMySqlInitialization) return sharedRecordLocksMySqlInitialization;
  sharedRecordLocksMySqlInitialization = (async () => {
    const connection = parseSharedRecordLocksMySqlConnectionString(connectionString);
    let host = String(connection.server || connection.host || "").trim();
    const database = String(connection.database || connection.initialcatalog || "").trim();
    const user = String(connection.uid || connection.user || connection.userid || "").trim();
    const password = String(connection.pwd || connection.password || "");
    if (!host || !database || !user || !password) {
      throw new Error("Не настроено подключение MySQL для блокировок записей.");
    }
    if (process.platform !== "win32" && /\.timeweb\.ru$/i.test(host)) host = "127.0.0.1";
    let mysql;
    try {
      mysql = require(MYSQL2_BUNDLE_PATH);
    } catch (error) {
      throw new Error(`Драйвер MySQL для блокировок не установлен: ${error.message}`);
    }
    const pool = mysql.createPool({
      host,
      port: Math.max(1, Number(connection.port) || 3306),
      database,
      user,
      password,
      charset: "utf8mb4",
      timezone: "Z",
      waitForConnections: true,
      connectionLimit: 4,
      maxIdle: 2,
      idleTimeout: 30000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 2500
    });
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ais_record_locks (
          entity_type VARCHAR(120) NOT NULL,
          entity_id VARCHAR(160) NOT NULL,
          client_id VARCHAR(160) NOT NULL,
          owner_login VARCHAR(160) NOT NULL DEFAULT '',
          owner_name VARCHAR(240) NOT NULL DEFAULT '',
          acquired_at DATETIME(3) NOT NULL,
          expires_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          PRIMARY KEY (entity_type, entity_id),
          KEY ais_record_locks_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ais_shared_state_meta (
          state_key VARCHAR(64) NOT NULL,
          revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
          updated_at DATETIME(3) NOT NULL,
          updated_by VARCHAR(160) NOT NULL DEFAULT '',
          PRIMARY KEY (state_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ais_shared_state_entries (
          state_key VARCHAR(64) NOT NULL,
          entry_type VARCHAR(32) NOT NULL,
          group_name VARCHAR(120) NOT NULL DEFAULT '',
          item_key VARCHAR(191) NOT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          data_json LONGTEXT NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          PRIMARY KEY (state_key, entry_type, group_name, item_key),
          KEY ais_shared_state_entries_order (state_key, entry_type, group_name, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } catch (error) {
      await pool.end().catch(() => {});
      throw error;
    }
    sharedRecordLocksMySqlPool = pool;
    return pool;
  })();
  try {
    return await sharedRecordLocksMySqlInitialization;
  } finally {
    sharedRecordLocksMySqlInitialization = null;
  }
}

function isMySqlConnectivityError(error) {
  const code = String(error?.code || "").toUpperCase();
  if ([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "PROTOCOL_CONNECTION_LOST",
    "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR"
  ].includes(code)) return true;
  return /connect|connection|network|socket|timeout|closed/i.test(String(error?.message || ""));
}

function getSharedApplicationStatePendingPath() {
  return path.resolve(
    process.env.AIS_SHARED_STATE_PENDING_PATH || SHARED_APPLICATION_STATE_PENDING_PATH
  );
}

function sharedApplicationStateMySqlVersionTag(revision) {
  return `mysql-${Math.max(0, Math.floor(Number(revision) || 0))}`;
}

function parseSharedApplicationStateEntryValue(row) {
  const source = Buffer.isBuffer(row?.data_json)
    ? row.data_json.toString("utf8")
    : String(row?.data_json ?? "null");
  return JSON.parse(source);
}

async function readSharedApplicationStateMySqlDocument(pool, connection = null) {
  const queryable = connection || pool;
  const [metaRows] = await queryable.query(
    `SELECT revision, updated_at, updated_by
       FROM ais_shared_state_meta
      WHERE state_key = ?
      LIMIT 1`,
    [SHARED_STATE_MYSQL_KEY]
  );
  if (!metaRows.length) {
    return { exists: false, document: null, versionTag: "", source: "mysql", offline: false };
  }
  const [rows] = await queryable.query(
    `SELECT entry_type, group_name, item_key, sort_order, data_json
       FROM ais_shared_state_entries
      WHERE state_key = ?
      ORDER BY entry_type, group_name, sort_order, item_key`,
    [SHARED_STATE_MYSQL_KEY]
  );
  const data = { collections: {}, dictionaries: {}, meta: {} };
  const collectionRows = new Map();
  const collectionReplacements = new Map();
  for (const row of rows) {
    const entryType = String(row.entry_type || "");
    const groupName = String(row.group_name || "");
    const itemKey = String(row.item_key || "");
    if (entryType === "collection_meta") {
      if (!collectionRows.has(groupName)) collectionRows.set(groupName, []);
      continue;
    }
    if (entryType === "collection_replace") {
      collectionReplacements.set(groupName, parseSharedApplicationStateEntryValue(row));
      continue;
    }
    if (entryType === "collection") {
      if (!collectionRows.has(groupName)) collectionRows.set(groupName, []);
      collectionRows.get(groupName).push({
        order: Number(row.sort_order) || 0,
        key: itemKey,
        value: parseSharedApplicationStateEntryValue(row)
      });
      continue;
    }
    if (entryType === "dictionary") data.dictionaries[itemKey] = parseSharedApplicationStateEntryValue(row);
    else if (entryType === "meta") data.meta[itemKey] = parseSharedApplicationStateEntryValue(row);
    else if (entryType === "root") data[itemKey] = parseSharedApplicationStateEntryValue(row);
  }
  for (const [name, items] of collectionRows) {
    data.collections[name] = items
      .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
      .map((item) => item.value);
  }
  for (const [name, value] of collectionReplacements) data.collections[name] = value;
  const meta = metaRows[0];
  const revision = Math.max(0, Math.floor(Number(meta.revision) || 0));
  const updatedAt = meta.updated_at instanceof Date
    ? meta.updated_at.toISOString()
    : new Date(String(meta.updated_at || "").replace(" ", "T") + "Z").toISOString();
  const document = normalizeSharedApplicationStateDocument({
    schemaVersion: 2,
    revision,
    updatedAt,
    updatedBy: String(meta.updated_by || ""),
    data
  });
  return {
    exists: true,
    document,
    versionTag: sharedApplicationStateMySqlVersionTag(revision),
    source: "mysql",
    offline: false
  };
}

function buildSharedApplicationStateMySqlEntries(data) {
  const entries = [];
  for (const [collectionName, value] of Object.entries(data.collections || {})) {
    const rows = Array.isArray(value) ? value : [];
    entries.push(["collection_meta", collectionName, "__collection__", 0, "null"]);
    const rowsHaveIds = rows.every((record) => (
      record && typeof record === "object" && !Array.isArray(record) && String(record.id || "").trim()
    ));
    if (!rowsHaveIds) {
      entries.push(["collection_replace", collectionName, "__replace__", 0, JSON.stringify(rows)]);
      continue;
    }
    rows.forEach((record, index) => {
      entries.push(["collection", collectionName, String(record.id), index, JSON.stringify(record)]);
    });
  }
  for (const [name, value] of Object.entries(data.dictionaries || {})) {
    entries.push(["dictionary", "", name, 0, JSON.stringify(value)]);
  }
  for (const [name, value] of Object.entries(data.meta || {})) {
    entries.push(["meta", "", name, 0, JSON.stringify(value)]);
  }
  for (const [name, value] of Object.entries(data)) {
    if (["collections", "dictionaries", "meta"].includes(name)) continue;
    entries.push(["root", "", name, 0, JSON.stringify(value)]);
  }
  return entries;
}

async function upsertSharedApplicationStateMySqlEntries(connection, entries, preserveExistingOrder = false) {
  const chunks = [];
  let currentChunk = [];
  let currentBytes = 0;
  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(String(entry[4] || ""), "utf8") + 1024;
    if (currentChunk.length && (currentChunk.length >= 200 || currentBytes + entryBytes > 8 * 1024 * 1024)) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentBytes = 0;
    }
    currentChunk.push(entry);
    currentBytes += entryBytes;
  }
  if (currentChunk.length) chunks.push(currentChunk);
  for (const chunk of chunks) {
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))").join(", ");
    const parameters = chunk.flatMap(([entryType, groupName, itemKey, sortOrder, dataJson]) => [
      SHARED_STATE_MYSQL_KEY,
      entryType,
      groupName,
      itemKey,
      sortOrder,
      dataJson
    ]);
    await connection.query(
      `INSERT INTO ais_shared_state_entries
        (state_key, entry_type, group_name, item_key, sort_order, data_json, updated_at)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         sort_order = ${preserveExistingOrder ? "ais_shared_state_entries.sort_order" : "VALUES(sort_order)"},
         data_json = VALUES(data_json),
         updated_at = VALUES(updated_at)`,
      parameters
    );
  }
}

async function replaceSharedApplicationStateMySqlEntries(connection, data) {
  await connection.query(
    "DELETE FROM ais_shared_state_entries WHERE state_key = ?",
    [SHARED_STATE_MYSQL_KEY]
  );
  await upsertSharedApplicationStateMySqlEntries(
    connection,
    buildSharedApplicationStateMySqlEntries(data)
  );
}

async function updateSharedApplicationStateMySqlOrder(connection, collectionName, order) {
  for (let offset = 0; offset < order.length; offset += 100) {
    const chunk = order.slice(offset, offset + 100);
    if (!chunk.length) continue;
    const caseSql = chunk.map(() => "WHEN ? THEN ?").join(" ");
    const itemPlaceholders = chunk.map(() => "?").join(", ");
    const parameters = [];
    chunk.forEach((itemKey, index) => parameters.push(itemKey, offset + index));
    parameters.push(SHARED_STATE_MYSQL_KEY, collectionName, ...chunk);
    await connection.query(
      `UPDATE ais_shared_state_entries
          SET sort_order = CASE item_key ${caseSql} ELSE sort_order END,
              updated_at = UTC_TIMESTAMP(3)
        WHERE state_key = ?
          AND entry_type = 'collection'
          AND group_name = ?
          AND item_key IN (${itemPlaceholders})`,
      parameters
    );
  }
}

async function applySharedApplicationStateMySqlPatch(connection, patch) {
  for (const [collectionName, change] of Object.entries(patch?.collections || {})) {
    if (Array.isArray(change.replace)) {
      await connection.query(
        `DELETE FROM ais_shared_state_entries
          WHERE state_key = ? AND group_name = ?
            AND entry_type IN ('collection', 'collection_meta', 'collection_replace')`,
        [SHARED_STATE_MYSQL_KEY, collectionName]
      );
      await upsertSharedApplicationStateMySqlEntries(
        connection,
        buildSharedApplicationStateMySqlEntries({
          collections: { [collectionName]: change.replace },
          dictionaries: {},
          meta: {}
        })
      );
      continue;
    }
    await upsertSharedApplicationStateMySqlEntries(connection, [
      ["collection_meta", collectionName, "__collection__", 0, "null"]
    ]);
    await connection.query(
      `DELETE FROM ais_shared_state_entries
        WHERE state_key = ? AND group_name = ? AND entry_type = 'collection_replace'`,
      [SHARED_STATE_MYSQL_KEY, collectionName]
    );
    if ((change.deletes || []).length) {
      for (let offset = 0; offset < change.deletes.length; offset += 200) {
        const chunk = change.deletes.slice(offset, offset + 200);
        await connection.query(
          `DELETE FROM ais_shared_state_entries
            WHERE state_key = ? AND entry_type = 'collection' AND group_name = ?
              AND item_key IN (${chunk.map(() => "?").join(", ")})`,
          [SHARED_STATE_MYSQL_KEY, collectionName, ...chunk]
        );
      }
    }
    if ((change.upserts || []).length) {
      const orderById = new Map((change.order || []).map((id, index) => [String(id), index]));
      await upsertSharedApplicationStateMySqlEntries(
        connection,
        change.upserts.map((record, index) => [
          "collection",
          collectionName,
          String(record.id),
          orderById.has(String(record.id)) ? orderById.get(String(record.id)) : 1000000000 + index,
          JSON.stringify(record)
        ]),
        !(change.order || []).length
      );
    }
    if ((change.order || []).length) {
      await updateSharedApplicationStateMySqlOrder(connection, collectionName, change.order);
    }
  }
  for (const [entryType, values] of [
    ["dictionary", patch?.dictionaries || {}],
    ["meta", patch?.meta || {}],
    ["root", patch?.root || {}]
  ]) {
    const entries = Object.entries(values).map(([name, value]) => [
      entryType,
      "",
      name,
      0,
      JSON.stringify(value)
    ]);
    if (entries.length) await upsertSharedApplicationStateMySqlEntries(connection, entries);
  }
}

async function ensureSharedApplicationStateMySqlDocument(pool) {
  let current = await readSharedApplicationStateMySqlDocument(pool);
  if (current.exists || process.env.AIS_SHARED_STATE_DISABLE_LEGACY_MIGRATION === "1") return current;
  const legacy = await readLegacySharedApplicationStateDocument().catch(() => null);
  if (!legacy?.exists || !legacy.document) return current;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [insert] = await connection.query(
      `INSERT IGNORE INTO ais_shared_state_meta
        (state_key, revision, updated_at, updated_by)
       VALUES (?, ?, ?, ?)`,
      [
        SHARED_STATE_MYSQL_KEY,
        legacy.document.revision,
        new Date(legacy.document.updatedAt || Date.now()),
        legacy.document.updatedBy || "migration"
      ]
    );
    if (insert.affectedRows) {
      await replaceSharedApplicationStateMySqlEntries(connection, legacy.document.data);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  current = await readSharedApplicationStateMySqlDocument(pool);
  if (current.document) await writeSharedApplicationStateCache(current.document).catch(() => {});
  return current;
}

async function readSharedApplicationStatePendingDocument() {
  if (sharedApplicationStatePendingLoaded) return sharedApplicationStatePendingMemory;
  try {
    const parsed = JSON.parse(await fs.readFile(getSharedApplicationStatePendingPath(), "utf8"));
    const operations = Array.isArray(parsed?.operations) ? parsed.operations : [];
    sharedApplicationStatePendingMemory = { schemaVersion: 1, operations };
  } catch {
    sharedApplicationStatePendingMemory = { schemaVersion: 1, operations: [] };
  }
  sharedApplicationStatePendingLoaded = true;
  return sharedApplicationStatePendingMemory;
}

async function writeSharedApplicationStatePendingDocument(document) {
  const pendingPath = getSharedApplicationStatePendingPath();
  sharedApplicationStatePendingMemory = document;
  sharedApplicationStatePendingLoaded = true;
  if (!document.operations.length) {
    await fs.unlink(pendingPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  await writeJsonAtomic(pendingPath, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    operations: document.operations
  }, true);
}

async function saveSharedApplicationStateMySqlOperation(pool, operation, authUser = null, options = {}) {
  const requestedRevision = Math.max(0, Math.floor(Number(operation.baseRevision) || 0));
  const patch = normalizeSharedApplicationStatePatch(operation.patch);
  const suppliedData = operation.data ? normalizeSharedApplicationData(operation.data) : null;
  const clientId = operation.clientId
    ? normalizeRecordLockIdentifier(operation.clientId, "Идентификатор клиента")
    : "";
  if (patch) {
    const lockedRecord = await findSharedRecordLockConflict(patch, clientId);
    if (lockedRecord) {
      return {
        conflict: false,
        locked: true,
        lock: publicSharedRecordLock(lockedRecord, clientId)
      };
    }
  }
  const connection = await pool.getConnection();
  let currentRevision = 0;
  let updatedAt = "";
  let updatedBy = "";
  try {
    await connection.beginTransaction();
    const [metaRows] = await connection.query(
      `SELECT revision, updated_at, updated_by
         FROM ais_shared_state_meta
        WHERE state_key = ?
        FOR UPDATE`,
      [SHARED_STATE_MYSQL_KEY]
    );
    currentRevision = Math.max(0, Math.floor(Number(metaRows[0]?.revision) || 0));
    if (requestedRevision !== currentRevision && !patch) {
      await connection.rollback();
      return {
        conflict: true,
        locked: false,
        revision: currentRevision,
        versionTag: sharedApplicationStateMySqlVersionTag(currentRevision),
        updatedAt: metaRows[0]?.updated_at || "",
        updatedBy: String(metaRows[0]?.updated_by || "")
      };
    }
    if (!metaRows.length && !suppliedData) {
      throw new Error("Общая база ещё не создана.");
    }
    if (suppliedData) await replaceSharedApplicationStateMySqlEntries(connection, suppliedData);
    else await applySharedApplicationStateMySqlPatch(connection, patch);
    const nextRevision = currentRevision + 1;
    updatedAt = new Date().toISOString();
    updatedBy = String(
      operation.updatedBy || authUser?.login || authUser?.name || "system"
    ).slice(0, 160);
    await connection.query(
      `INSERT INTO ais_shared_state_meta
        (state_key, revision, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         revision = VALUES(revision),
         updated_at = VALUES(updated_at),
         updated_by = VALUES(updated_by)`,
      [SHARED_STATE_MYSQL_KEY, nextRevision, new Date(updatedAt), updatedBy]
    );
    await connection.commit();
    const merged = Boolean(patch && requestedRevision !== currentRevision);
    let mergedData = null;
    if (!options.skipCache) {
      const cached = await readSharedApplicationStateCache();
      let nextData = suppliedData;
      if (!nextData && patch && cached && cached.revision === currentRevision) {
        nextData = applySharedApplicationStatePatch(cached.data, patch);
      }
      if (nextData) {
        await writeSharedApplicationStateCache({
          schemaVersion: 2,
          revision: nextRevision,
          updatedAt,
          updatedBy,
          data: nextData
        }).catch(() => {});
      }
      if (merged || !nextData) {
        const latest = await readSharedApplicationStateMySqlDocument(pool);
        mergedData = merged ? latest.document?.data || null : null;
        if (latest.document) await writeSharedApplicationStateCache(latest.document).catch(() => {});
      }
    }
    return {
      conflict: false,
      locked: false,
      merged,
      revision: nextRevision,
      versionTag: sharedApplicationStateMySqlVersionTag(nextRevision),
      updatedAt,
      updatedBy,
      source: "mysql",
      offline: false,
      pendingCount: 0,
      data: mergedData
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function queueSharedApplicationStateOfflineOperation(operation, authUser, options = {}) {
  const pending = await readSharedApplicationStatePendingDocument();
  if (pending.operations.length >= SHARED_STATE_OFFLINE_QUEUE_MAX_OPERATIONS) {
    throw new Error("Очередь автономных изменений переполнена. Подключите интернет для синхронизации.");
  }
  const current = await readSharedApplicationStateCache();
  const patch = normalizeSharedApplicationStatePatch(operation.patch);
  const suppliedData = operation.data ? normalizeSharedApplicationData(operation.data) : null;
  const baseData = current?.data || suppliedData;
  if (!baseData) throw new Error("Нет локальной копии общей базы для автономной работы.");
  const data = patch ? applySharedApplicationStatePatch(baseData, patch) : suppliedData;
  const revision = Math.max(0, Number(current?.revision) || Number(operation.baseRevision) || 0) + 1;
  const updatedAt = new Date().toISOString();
  const updatedBy = String(authUser?.login || authUser?.name || operation.updatedBy || "offline").slice(0, 160);
  pending.operations.push({
    id: crypto.randomUUID(),
    createdAt: updatedAt,
    baseRevision: Math.max(0, Number(operation.baseRevision) || 0),
    clientId: String(operation.clientId || "").slice(0, 160),
    updatedBy,
    ...(patch ? { patch } : { data: suppliedData })
  });
  await writeSharedApplicationStateCache({
    schemaVersion: 2,
    revision,
    updatedAt,
    updatedBy,
    data
  });
  await writeSharedApplicationStatePendingDocument(pending);
  return {
    conflict: false,
    locked: false,
    merged: false,
    revision,
    versionTag: `offline-${revision}-${pending.operations.length}`,
    updatedAt,
    updatedBy,
    source: "local-queue",
    offline: options.offline !== false,
    syncPending: true,
    syncBlockedReason: String(options.syncBlockedReason || ""),
    writable: true,
    pendingCount: pending.operations.length,
    data: null
  };
}

async function flushSharedApplicationStateOfflineQueue(options = {}) {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") return null;
  const pending = await readSharedApplicationStatePendingDocument();
  if (!pending.operations.length) return { flushed: 0, pendingCount: 0 };
  if (sharedStateOfflineSyncPromise) return sharedStateOfflineSyncPromise;
  if (!options.force && Date.now() < sharedStateMySqlUnavailableUntil) {
    return { flushed: 0, pendingCount: pending.operations.length, deferred: true };
  }
  const syncPromise = (async () => {
    let flushed = 0;
    let syncBlockedReason = "";
    let syncBlockedLock = null;
    try {
      const pool = await getSharedRecordLocksMySqlPool();
      if (!pool) throw new Error("MySQL не настроен.");
      await ensureSharedApplicationStateMySqlDocument(pool);
      while (pending.operations.length) {
        const operation = pending.operations[0];
        const result = await saveSharedApplicationStateMySqlOperation(pool, operation, {
          login: operation.updatedBy || "offline"
        }, { skipCache: true });
        if (result.conflict) {
          syncBlockedReason = "conflict";
          break;
        }
        if (result.locked) {
          syncBlockedReason = "locked";
          syncBlockedLock = result.lock || null;
          break;
        }
        pending.operations.shift();
        flushed += 1;
        await writeSharedApplicationStatePendingDocument(pending);
      }
      if (!pending.operations.length) {
        const latest = await readSharedApplicationStateMySqlDocument(pool);
        if (latest.document) await writeSharedApplicationStateCache(latest.document);
      }
      sharedStateMySqlUnavailableUntil = 0;
      return {
        flushed,
        pendingCount: pending.operations.length,
        syncBlockedReason,
        syncBlockedLock
      };
    } catch (error) {
      sharedStateMySqlUnavailableUntil = Date.now() + SHARED_STATE_MYSQL_OFFLINE_RETRY_MS;
      if (isMySqlConnectivityError(error)) await closeSharedRecordLocksStorage();
      throw error;
    }
  })();
  sharedStateOfflineSyncPromise = syncPromise;
  try {
    return await syncPromise;
  } finally {
    if (sharedStateOfflineSyncPromise === syncPromise) sharedStateOfflineSyncPromise = null;
  }
}

async function readSharedApplicationStateCacheResult(error, options = {}) {
  const cached = await readSharedApplicationStateCache();
  if (!cached) throw (error || new Error("Локальная копия общей базы недоступна."));
  const pending = await readSharedApplicationStatePendingDocument();
  const offline = options.offline !== false;
  const source = offline ? "local-cache" : "local-queue";
  const versionTag = `${offline ? "offline" : "pending"}-${cached.revision}-${pending.operations.length}`;
  const common = {
    exists: true,
    versionTag,
    source,
    offline,
    writable: true,
    pendingCount: pending.operations.length,
    syncPending: pending.operations.length > 0,
    syncBlockedReason: String(options.syncResult?.syncBlockedReason || ""),
    syncBlockedLock: options.syncResult?.syncBlockedLock || null,
    warning: offline ? String(error?.message || "") : ""
  };
  if (options.metadata) {
    return {
      ...common,
      revision: cached.revision,
      updatedAt: cached.updatedAt,
      updatedBy: cached.updatedBy
    };
  }
  return { ...common, document: cached };
}

async function readSharedApplicationStateDocument(options = {}) {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") {
    return readLegacySharedApplicationStateDocument(options);
  }
  if (Date.now() < sharedStateMySqlUnavailableUntil) {
    const error = new Error("MySQL временно недоступен.");
    if (options.allowCache === false) throw error;
    return readSharedApplicationStateCacheResult(error);
  }
  try {
    const syncResult = await flushSharedApplicationStateOfflineQueue();
    const pool = await getSharedRecordLocksMySqlPool();
    if (!pool) throw new Error("MySQL для общей базы не настроен.");
    const result = await ensureSharedApplicationStateMySqlDocument(pool);
    const pending = await readSharedApplicationStatePendingDocument();
    if (pending.operations.length) {
      return readSharedApplicationStateCacheResult(null, { offline: false, syncResult });
    }
    sharedStateMySqlUnavailableUntil = 0;
    const cached = await readSharedApplicationStateCache();
    if (result.document && Number(cached?.revision || 0) !== Number(result.document.revision || 0)) {
      await writeSharedApplicationStateCache(result.document).catch(() => {});
    }
    return {
      ...result,
      offline: false,
      writable: true,
      pendingCount: 0,
      syncPending: false,
      syncBlockedReason: "",
      syncBlockedLock: null
    };
  } catch (error) {
    sharedStateMySqlUnavailableUntil = Date.now() + SHARED_STATE_MYSQL_OFFLINE_RETRY_MS;
    if (isMySqlConnectivityError(error)) await closeSharedRecordLocksStorage();
    if (options.allowCache === false) throw error;
    return readSharedApplicationStateCacheResult(error);
  }
}

async function readSharedApplicationStateMetadata() {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") {
    return readLegacySharedApplicationStateMetadata();
  }
  if (Date.now() < sharedStateMySqlUnavailableUntil) {
    return readSharedApplicationStateCacheResult(
      new Error("MySQL временно недоступен."),
      { metadata: true }
    );
  }
  try {
    const syncResult = await flushSharedApplicationStateOfflineQueue();
    const pool = await getSharedRecordLocksMySqlPool();
    if (!pool) throw new Error("MySQL для общей базы не настроен.");
    const [rows] = await pool.query(
      `SELECT revision, updated_at, updated_by
         FROM ais_shared_state_meta
        WHERE state_key = ?
        LIMIT 1`,
      [SHARED_STATE_MYSQL_KEY]
    );
    const pending = await readSharedApplicationStatePendingDocument();
    if (pending.operations.length) {
      return readSharedApplicationStateCacheResult(null, {
        metadata: true,
        offline: false,
        syncResult
      });
    }
    sharedStateMySqlUnavailableUntil = 0;
    if (!rows.length) {
      return {
        exists: false,
        revision: 0,
        updatedAt: "",
        updatedBy: "",
        versionTag: "",
        source: "mysql",
        offline: false,
        writable: true,
        pendingCount: 0,
        syncPending: false,
        syncBlockedReason: "",
        syncBlockedLock: null
      };
    }
    const revision = Math.max(0, Number(rows[0].revision) || 0);
    return {
      exists: true,
      revision,
      updatedAt: rows[0].updated_at instanceof Date ? rows[0].updated_at.toISOString() : String(rows[0].updated_at || ""),
      updatedBy: String(rows[0].updated_by || ""),
      versionTag: sharedApplicationStateMySqlVersionTag(revision),
      source: "mysql",
      offline: false,
      writable: true,
      pendingCount: 0,
      syncPending: false,
      syncBlockedReason: "",
      syncBlockedLock: null
    };
  } catch (error) {
    sharedStateMySqlUnavailableUntil = Date.now() + SHARED_STATE_MYSQL_OFFLINE_RETRY_MS;
    if (isMySqlConnectivityError(error)) await closeSharedRecordLocksStorage();
    return readSharedApplicationStateCacheResult(error, { metadata: true });
  }
}

function sharedRecordLockFromMySqlRow(row) {
  if (!row) return null;
  const acquiredAt = row.acquired_at instanceof Date
    ? row.acquired_at
    : new Date(String(row.acquired_at || "").replace(" ", "T") + "Z");
  const expiresAt = row.expires_at instanceof Date
    ? row.expires_at
    : new Date(String(row.expires_at || "").replace(" ", "T") + "Z");
  const entityType = String(row.entity_type || "");
  const entityId = String(row.entity_id || "");
  return {
    key: `${entityType}:${entityId}`,
    entityType,
    entityId,
    clientId: String(row.client_id || ""),
    ownerLogin: String(row.owner_login || ""),
    ownerName: String(row.owner_name || ""),
    acquiredAt: acquiredAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

async function readSharedRecordLocksMySqlDocument(pool) {
  const [rows] = await pool.query(`
    SELECT entity_type, entity_id, client_id, owner_login, owner_name, acquired_at, expires_at
    FROM ais_record_locks
    WHERE expires_at > UTC_TIMESTAMP(3)
    ORDER BY updated_at DESC
    LIMIT ${SHARED_RECORD_LOCK_MAX_COUNT}
  `);
  return {
    exists: true,
    document: {
      schemaVersion: 1,
      revision: Date.now(),
      updatedAt: new Date().toISOString(),
      locks: rows.map(sharedRecordLockFromMySqlRow).filter(Boolean)
    },
    versionTag: `mysql-locks-${Date.now()}`,
    source: "mysql"
  };
}

async function mutateSharedRecordLockMySql(pool, action, entityType, entityId, clientId, authUser) {
  const key = `${entityType}:${entityId}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(`
        SELECT entity_type, entity_id, client_id, owner_login, owner_name, acquired_at, expires_at
        FROM ais_record_locks
        WHERE entity_type = ? AND entity_id = ?
        FOR UPDATE
      `, [entityType, entityId]);
      const now = Date.now();
      const existing = sharedRecordLockFromMySqlRow(rows[0]);
      const existingActive = existing && new Date(existing.expiresAt).getTime() > now;
      const takenOver = Boolean(
        action === "takeover"
        && existingActive
        && existing.clientId !== clientId
      );
      if (existingActive && existing.clientId !== clientId && action !== "takeover") {
        await connection.commit();
        return { locked: true, lock: publicSharedRecordLock(existing, clientId), source: "mysql" };
      }
      if (action === "release") {
        await connection.execute(
          "DELETE FROM ais_record_locks WHERE entity_type = ? AND entity_id = ? AND client_id = ?",
          [entityType, entityId, clientId]
        );
        await connection.commit();
        return { locked: false, released: true, lock: null, revision: now, ttlMs: SHARED_RECORD_LOCK_TTL_MS, source: "mysql" };
      }
      const acquiredAt = existingActive && existing.clientId === clientId
        ? new Date(existing.acquiredAt)
        : new Date(now);
      const expiresAt = new Date(now + SHARED_RECORD_LOCK_TTL_MS);
      const ownerLogin = String(authUser?.login || "").slice(0, 160);
      const ownerName = String(authUser?.name || authUser?.login || "Пользователь").slice(0, 240);
      await connection.execute(`
        INSERT INTO ais_record_locks (
          entity_type, entity_id, client_id, owner_login, owner_name, acquired_at, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          client_id = VALUES(client_id),
          owner_login = VALUES(owner_login),
          owner_name = VALUES(owner_name),
          acquired_at = VALUES(acquired_at),
          expires_at = VALUES(expires_at),
          updated_at = VALUES(updated_at)
      `, [entityType, entityId, clientId, ownerLogin, ownerName, acquiredAt, expiresAt, new Date(now)]);
      await connection.commit();
      const lock = {
        key,
        entityType,
        entityId,
        clientId,
        ownerLogin,
        ownerName,
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: expiresAt.toISOString()
      };
      return {
        locked: false,
        released: false,
        takenOver,
        lock: publicSharedRecordLock(lock, clientId),
        revision: now,
        ttlMs: SHARED_RECORD_LOCK_TTL_MS,
        source: "mysql"
      };
    } catch (error) {
      await connection.rollback().catch(() => {});
      if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "ER_DUP_ENTRY"].includes(error.code) && attempt < 3) {
        continue;
      }
      throw error;
    } finally {
      connection.release();
    }
  }
  throw new Error("Блокировка записи была одновременно изменена. Повторите действие.");
}

async function closeSharedRecordLocksStorage() {
  const pool = sharedRecordLocksMySqlPool;
  sharedRecordLocksMySqlPool = null;
  if (pool) await pool.end().catch(() => {});
}

function getSharedRecordLocksWebDavPath() {
  const basePath = normalizeWebDavPath(
    serverSettings.yandexDiskBasePath || DEFAULT_YANDEX_DISK_BASE_PATH
  );
  return normalizeWebDavPath(`${basePath}/${SHARED_RECORD_LOCKS_RELATIVE_PATH}`);
}

function normalizeRecordLockIdentifier(value, label) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || !/^[A-Za-z0-9_.:@-]+$/.test(text)) {
    throw new Error(`${label} блокировки указан некорректно.`);
  }
  return text;
}

function normalizeSharedRecordLocksDocument(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const locks = Array.isArray(source.locks) ? source.locks : [];
  return {
    schemaVersion: 1,
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    updatedAt: String(source.updatedAt || ""),
    locks: locks.slice(0, SHARED_RECORD_LOCK_MAX_COUNT).flatMap((lock) => {
      try {
        const entityType = normalizeRecordLockIdentifier(lock?.entityType, "Раздел");
        const entityId = normalizeRecordLockIdentifier(lock?.entityId, "Идентификатор записи");
        const clientId = normalizeRecordLockIdentifier(lock?.clientId, "Идентификатор клиента");
        const expiresAt = new Date(lock?.expiresAt || 0).getTime();
        if (!Number.isFinite(expiresAt)) return [];
        return [{
          key: `${entityType}:${entityId}`,
          entityType,
          entityId,
          clientId,
          ownerLogin: String(lock?.ownerLogin || "").slice(0, 160),
          ownerName: String(lock?.ownerName || "").slice(0, 240),
          acquiredAt: String(lock?.acquiredAt || ""),
          expiresAt: new Date(expiresAt).toISOString()
        }];
      } catch {
        return [];
      }
    })
  };
}

function activeSharedRecordLocks(document, now = Date.now()) {
  return (document?.locks || []).filter((lock) => new Date(lock.expiresAt).getTime() > now);
}

async function readSharedRecordLocksDocument(forceLocal = false) {
  let mysqlPool = null;
  if (!forceLocal) {
    try {
      mysqlPool = await getSharedRecordLocksMySqlPool();
    } catch {
      forceLocal = true;
    }
  }
  if (mysqlPool) {
    try {
      return await readSharedRecordLocksMySqlDocument(mysqlPool);
    } catch (error) {
      if (!isMySqlConnectivityError(error)) throw error;
      forceLocal = true;
    }
  }
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1" || forceLocal) {
    const localPath = getSharedRecordLocksLocalPath();
    try {
      const document = normalizeSharedRecordLocksDocument(
        JSON.parse(await fs.readFile(localPath, "utf8"))
      );
      return { exists: true, document, versionTag: `local-locks-${document.revision}`, source: "local" };
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          exists: false,
          document: normalizeSharedRecordLocksDocument({}),
          versionTag: "",
          source: "local"
        };
      }
      throw error;
    }
  }
  const response = await requestYandexWebDav("GET", getSharedRecordLocksWebDavPath(), {
    acceptedStatuses: [200, 404],
    maxResponseBytes: MAX_SHARED_RECORD_LOCKS_BYTES,
    timeoutMs: 30000
  });
  if (response.statusCode === 404) {
    return {
      exists: false,
      document: normalizeSharedRecordLocksDocument({}),
      versionTag: ""
    };
  }
  return {
    exists: true,
    document: normalizeSharedRecordLocksDocument(JSON.parse(response.body.toString("utf8"))),
    versionTag: sharedApplicationStateVersionTag(response.headers.etag)
  };
}

async function writeSharedRecordLocksDocument(current, document, forceLocal = false) {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1" || forceLocal) {
    const localPath = getSharedRecordLocksLocalPath();
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await writeJsonAtomic(localPath, document);
    return { saved: true, versionTag: `local-locks-${document.revision}` };
  }
  const davPath = getSharedRecordLocksWebDavPath();
  await ensureYandexDiskFolder(path.posix.dirname(davPath));
  const headers = current.exists
    ? { "If-Match": current.versionTag || "*" }
    : { "If-None-Match": "*" };
  const response = await requestYandexWebDav("PUT", davPath, {
    acceptedStatuses: [200, 201, 204, 412],
    contentType: "application/json; charset=utf-8",
    headers,
    body: Buffer.from(`${JSON.stringify(document)}\n`, "utf8"),
    maxResponseBytes: 64 * 1024,
    timeoutMs: 30000
  });
  return {
    saved: response.statusCode !== 412,
    versionTag: sharedApplicationStateVersionTag(response.headers.etag)
  };
}

function enqueueSharedRecordLocksWrite(operation) {
  const result = sharedRecordLocksWriteQueue.catch(() => {}).then(operation);
  sharedRecordLocksWriteQueue = result.catch(() => {});
  return result;
}

function publicSharedRecordLock(lock, clientId = "") {
  return {
    entityType: lock.entityType,
    entityId: lock.entityId,
    ownerLogin: lock.ownerLogin,
    ownerName: lock.ownerName,
    acquiredAt: lock.acquiredAt,
    expiresAt: lock.expiresAt,
    ownedByClient: Boolean(clientId && lock.clientId === clientId)
  };
}

async function mutateSharedRecordLock(body, authUser) {
  const action = String(body?.action || "acquire").trim().toLowerCase();
  if (!new Set(["acquire", "renew", "release", "takeover"]).has(action)) {
    throw new Error("Неизвестное действие с блокировкой записи.");
  }
  const entityType = normalizeRecordLockIdentifier(body?.entityType, "Раздел");
  const entityId = normalizeRecordLockIdentifier(body?.entityId, "Идентификатор записи");
  const clientId = normalizeRecordLockIdentifier(body?.clientId, "Идентификатор клиента");
  let mysqlPool = null;
  let forceLocal = false;
  try {
    mysqlPool = await getSharedRecordLocksMySqlPool();
  } catch {
    forceLocal = true;
  }
  if (mysqlPool) {
    try {
      return await mutateSharedRecordLockMySql(mysqlPool, action, entityType, entityId, clientId, authUser);
    } catch (error) {
      if (!isMySqlConnectivityError(error)) throw error;
      forceLocal = true;
    }
  }
  const key = `${entityType}:${entityId}`;
  return enqueueSharedRecordLocksWrite(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await readSharedRecordLocksDocument(forceLocal);
      const now = Date.now();
      const locks = activeSharedRecordLocks(current.document, now);
      const existing = locks.find((lock) => lock.key === key);
      const takenOver = Boolean(
        action === "takeover"
        && existing
        && existing.clientId !== clientId
      );
      if (action !== "release" && action !== "takeover" && existing && existing.clientId !== clientId) {
        return { locked: true, lock: publicSharedRecordLock(existing, clientId) };
      }
      let nextLocks = locks.filter((lock) => lock.key !== key);
      let lock = null;
      if (action !== "release") {
        const acquiredAt = existing && existing.clientId === clientId
          ? existing.acquiredAt
          : new Date(now).toISOString();
        lock = {
          key,
          entityType,
          entityId,
          clientId,
          ownerLogin: String(authUser?.login || "").slice(0, 160),
          ownerName: String(authUser?.name || authUser?.login || "Пользователь").slice(0, 240),
          acquiredAt,
          expiresAt: new Date(now + SHARED_RECORD_LOCK_TTL_MS).toISOString()
        };
        nextLocks.push(lock);
      } else if (existing && existing.clientId !== clientId) {
        return { locked: true, lock: publicSharedRecordLock(existing, clientId) };
      }
      const document = {
        schemaVersion: 1,
        revision: current.document.revision + 1,
        updatedAt: new Date(now).toISOString(),
        locks: nextLocks
      };
      const written = await writeSharedRecordLocksDocument(current, document, forceLocal);
      if (!written.saved) continue;
      return {
        locked: false,
        released: action === "release",
        takenOver,
        lock: lock ? publicSharedRecordLock(lock, clientId) : null,
        revision: document.revision,
        ttlMs: SHARED_RECORD_LOCK_TTL_MS,
        source: forceLocal || process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1" ? "local" : "webdav"
      };
    }
    throw new Error("Блокировка записи была одновременно изменена. Повторите действие.");
  });
}

async function findSharedRecordLockConflict(patch, clientId) {
  const affectedKeys = new Set(getSharedApplicationStatePatchRecordKeys(patch));
  if (!affectedKeys.size) return null;
  const current = await readSharedRecordLocksDocument();
  return activeSharedRecordLocks(current.document)
    .find((lock) => affectedKeys.has(lock.key) && lock.clientId !== clientId) || null;
}

async function handleSharedRecordLocks(req, res, authUser, requestUrl) {
  try {
    if (req.method === "GET") {
      const clientId = String(requestUrl.searchParams.get("clientId") || "").trim();
      const current = await readSharedRecordLocksDocument();
      sendJson(res, 200, {
        locks: activeSharedRecordLocks(current.document).map((lock) => publicSharedRecordLock(lock, clientId)),
        revision: current.document.revision,
        ttlMs: SHARED_RECORD_LOCK_TTL_MS,
        pollIntervalMs: 1000,
        source: current.source || "webdav"
      });
      return;
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await mutateSharedRecordLock(body, authUser);
      if (result.locked) {
        sendJson(res, 423, {
          error: "Запись уже редактируется другим пользователем.",
          ...result
        });
        return;
      }
      if (result.takenOver) {
        await safelyAppendAuditEntry({
          action: "Перехвачена блокировка записи",
          area: "Блокировки записей",
          details: `${String(body.entityType || "Запись")}: ${String(body.entityId || "")}`,
          entityType: String(body.entityType || ""),
          entityId: String(body.entityId || ""),
          source: "record-lock"
        }, authUser, req);
      }
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    sendError(res, 405, "Method not allowed");
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function saveLegacySharedApplicationState(body, authUser) {
  const requestedRevision = Math.max(0, Math.floor(Number(body.baseRevision) || 0));
  const patch = normalizeSharedApplicationStatePatch(body.patch);
  const suppliedData = body.data ? normalizeSharedApplicationData(body.data) : null;
  if (!patch && !suppliedData) throw new Error("Не переданы изменения общей базы.");
  let clientId = "";
  if (body.clientId) clientId = normalizeRecordLockIdentifier(body.clientId, "Идентификатор клиента");
  return enqueueSharedApplicationStateWrite(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await readLegacySharedApplicationStateDocument({ allowCache: false });
      const currentRevision = current.document?.revision || 0;
      if (requestedRevision !== currentRevision && !patch) {
        return {
          conflict: true,
          revision: currentRevision,
          versionTag: current.versionTag,
          updatedAt: current.document?.updatedAt || "",
          updatedBy: current.document?.updatedBy || ""
        };
      }
      if (patch) {
        const lockedRecord = await findSharedRecordLockConflict(patch, clientId);
        if (lockedRecord) {
          return {
            conflict: false,
            locked: true,
            lock: publicSharedRecordLock(lockedRecord, clientId),
            revision: currentRevision,
            versionTag: current.versionTag,
            updatedAt: current.document?.updatedAt || "",
            updatedBy: current.document?.updatedBy || ""
          };
        }
      }
      const baseData = current.document?.data || suppliedData;
      if (!baseData) throw new Error("Общая база ещё не создана.");
      const data = patch
        ? applySharedApplicationStatePatch(baseData, patch)
        : suppliedData;
      const merged = Boolean(patch && requestedRevision !== currentRevision);
      const document = {
        schemaVersion: 1,
        revision: currentRevision + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: String(authUser?.login || authUser?.name || "system").slice(0, 160),
        data
      };
      if (current.document) await maybeBackupSharedApplicationState(current.document);
      const writeResult = await writeLegacySharedApplicationStateDocument(current, document);
      if (!writeResult.saved) {
        if (patch) continue;
        const latest = await readLegacySharedApplicationStateDocument({ allowCache: false });
        return {
          conflict: true,
          revision: latest.document?.revision || currentRevision,
          versionTag: latest.versionTag,
          updatedAt: latest.document?.updatedAt || "",
          updatedBy: latest.document?.updatedBy || ""
        };
      }
      return {
        conflict: false,
        locked: false,
        merged,
        revision: document.revision,
        versionTag: writeResult.versionTag,
        updatedAt: document.updatedAt,
        updatedBy: document.updatedBy,
        data: merged ? document.data : null
      };
    }
    const latest = await readLegacySharedApplicationStateDocument({ allowCache: false });
    return {
      conflict: true,
      revision: latest.document?.revision || 0,
      versionTag: latest.versionTag,
      updatedAt: latest.document?.updatedAt || "",
      updatedBy: latest.document?.updatedBy || ""
    };
  });
}

async function saveSharedApplicationState(body, authUser) {
  if (process.env.AIS_SHARED_STATE_LOCAL_ONLY === "1") {
    return saveLegacySharedApplicationState(body, authUser);
  }
  const operation = {
    baseRevision: Math.max(0, Math.floor(Number(body.baseRevision) || 0)),
    clientId: String(body.clientId || "").slice(0, 160),
    ...(body.patch ? { patch: normalizeSharedApplicationStatePatch(body.patch) } : {}),
    ...(body.data ? { data: normalizeSharedApplicationData(body.data) } : {})
  };
  if (!operation.patch && !operation.data) {
    throw new Error("Не переданы изменения общей базы.");
  }
  try {
    if (Date.now() < sharedStateMySqlUnavailableUntil) {
      return queueSharedApplicationStateOfflineOperation(operation, authUser);
    }
    const syncResult = await flushSharedApplicationStateOfflineQueue();
    const pending = await readSharedApplicationStatePendingDocument();
    if (pending.operations.length) {
      return queueSharedApplicationStateOfflineOperation(operation, authUser, {
        offline: false,
        syncBlockedReason: syncResult?.syncBlockedReason || ""
      });
    }
    const pool = await getSharedRecordLocksMySqlPool();
    if (!pool) throw new Error("MySQL для общей базы не настроен.");
    await ensureSharedApplicationStateMySqlDocument(pool);
    const result = await saveSharedApplicationStateMySqlOperation(pool, operation, authUser);
    sharedStateMySqlUnavailableUntil = 0;
    return result;
  } catch (error) {
    sharedStateMySqlUnavailableUntil = Date.now() + SHARED_STATE_MYSQL_OFFLINE_RETRY_MS;
    console.warn(`Общая MySQL-база недоступна, изменение поставлено в очередь: ${error.message}`);
    return queueSharedApplicationStateOfflineOperation(operation, authUser);
  }
}

async function handleSharedApplicationState(req, res, authUser, requestUrl) {
  try {
    if (req.method === "GET") {
      if (requestUrl.searchParams.get("metadata") === "1") {
        const metadata = await readSharedApplicationStateMetadata();
        sendJson(res, 200, metadata);
        return;
      }
      const result = await readSharedApplicationStateDocument();
      sendJson(res, 200, {
        exists: result.exists,
        revision: result.document?.revision || 0,
        versionTag: result.versionTag,
        updatedAt: result.document?.updatedAt || "",
        updatedBy: result.document?.updatedBy || "",
        source: result.source,
        offline: Boolean(result.offline),
        writable: result.writable !== false,
        pendingCount: Math.max(0, Number(result.pendingCount) || 0),
        syncPending: Boolean(result.syncPending),
        syncBlockedReason: String(result.syncBlockedReason || ""),
        syncBlockedLock: result.syncBlockedLock || null,
        warning: result.warning || "",
        data: result.document?.data || null
      });
      return;
    }
    if (req.method === "POST") {
      const result = await saveSharedApplicationState(await readJsonBody(req), authUser);
      if (result.locked) {
        sendJson(res, 423, {
          error: "Одна из изменяемых записей сейчас заблокирована другим пользователем.",
          ...result
        });
        return;
      }
      if (result.conflict) {
        sendJson(res, 409, {
          error: "Общая база уже изменена другим пользователем.",
          conflict: true,
          ...result
        });
        return;
      }
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (
      req.method === "DELETE"
      && process.env.AIS_SHARED_STATE_TEST_MODE === "1"
      && SHARED_STATE_MYSQL_KEY.startsWith("test-")
    ) {
      const pool = await getSharedRecordLocksMySqlPool();
      if (pool) {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.query(
            "DELETE FROM ais_shared_state_entries WHERE state_key = ?",
            [SHARED_STATE_MYSQL_KEY]
          );
          await connection.query(
            "DELETE FROM ais_shared_state_meta WHERE state_key = ?",
            [SHARED_STATE_MYSQL_KEY]
          );
          await connection.commit();
        } catch (error) {
          await connection.rollback().catch(() => {});
          throw error;
        } finally {
          connection.release();
        }
      }
      await fs.unlink(getSharedApplicationStatePendingPath()).catch(() => {});
      await fs.unlink(getSharedApplicationStateLocalPath()).catch(() => {});
      sendJson(res, 200, { ok: true, deleted: true });
      return;
    }
    sendError(res, 405, "Method not allowed");
  } catch (error) {
    sendError(res, 400, error.message);
  }
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

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function webDavXmlTagValue(block, localName) {
  const expression = new RegExp(
    `<(?:(?:[\\w.-]+):)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${localName}>`,
    "i"
  );
  const match = expression.exec(block);
  return match ? decodeXmlEntities(match[1].replace(/<[^>]*>/g, "")).trim() : "";
}

function decodeWebDavHref(value) {
  try {
    return normalizeWebDavPath(decodeURIComponent(
      new URL(String(value || ""), "https://webdav.yandex.ru").pathname
    ));
  } catch {
    return normalizeWebDavPath(String(value || ""));
  }
}

function parseWebDavDirectoryEntries(xml) {
  const responseBlocks = String(xml || "").match(
    /<(?:(?:[\w.-]+):)?response\b[\s\S]*?<\/(?:(?:[\w.-]+):)?response>/gi
  ) || [];
  return responseBlocks.map((block) => {
    const href = decodeWebDavHref(webDavXmlTagValue(block, "href"));
    const displayName = webDavXmlTagValue(block, "displayname");
    const contentLength = Number(webDavXmlTagValue(block, "getcontentlength")) || 0;
    const modifiedAt = webDavXmlTagValue(block, "getlastmodified");
    const isCollection = /<(?:(?:[\w.-]+):)?collection(?:\s[^>]*)?\/?>/i.test(block);
    return {
      href,
      displayName: displayName || path.posix.basename(href),
      contentLength,
      modifiedAt,
      isCollection
    };
  }).filter((entry) => entry.href);
}

function getOcrDocumentContentType(fileName) {
  return OCR_DOCUMENT_CONTENT_TYPES[path.extname(String(fileName || "")).toLowerCase()] || "";
}

async function collectLocalOcrDocuments(folderSource) {
  const rootPath = resolveLocalDocumentsFolder(folderSource);
  const rootStat = await fs.stat(rootPath);
  if (!rootStat.isDirectory()) throw new Error("Локальный путь слушателя не является папкой.");
  const documents = [];
  let skippedCount = 0;
  let totalBytes = 0;
  const pending = [{ folderPath: rootPath, relativeFolder: "", depth: 0 }];
  while (pending.length && documents.length < MAX_OCR_DOCUMENT_FILES) {
    const current = pending.shift();
    const entries = await fs.readdir(current.folderPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "ru", {
      numeric: true,
      sensitivity: "base"
    }));
    for (const entry of entries) {
      if (documents.length >= MAX_OCR_DOCUMENT_FILES) {
        skippedCount += 1;
        continue;
      }
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const entryPath = path.join(current.folderPath, entry.name);
      const relativeName = current.relativeFolder
        ? `${current.relativeFolder}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        if (current.depth < 2) {
          pending.push({
            folderPath: entryPath,
            relativeFolder: relativeName,
            depth: current.depth + 1
          });
        }
        continue;
      }
      const contentType = getOcrDocumentContentType(entry.name);
      if (!entry.isFile() || !contentType) continue;
      const stat = await fs.stat(entryPath);
      if (
        !stat.size
        || stat.size > MAX_OCR_DOCUMENT_BYTES
        || totalBytes + stat.size > MAX_OCR_TOTAL_BYTES
      ) {
        skippedCount += 1;
        continue;
      }
      totalBytes += stat.size;
      documents.push({
        source: "local",
        fileName: entry.name,
        relativeName,
        contentType,
        size: stat.size,
        localPath: entryPath
      });
    }
  }
  return {
    source: "local",
    sourceLabel: "Локальная папка",
    documents,
    skippedCount,
    totalBytes
  };
}

async function readWebDavDirectory(davPath) {
  const response = await requestYandexWebDav("PROPFIND", davPath, {
    acceptedStatuses: [207],
    headers: { Depth: "1" },
    contentType: "application/xml; charset=utf-8",
    body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><displayname/><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>',
    maxResponseBytes: 4 * 1024 * 1024
  });
  return parseWebDavDirectoryEntries(response.body.toString("utf8"));
}

function normalizeStudentWebDavRelativePath(value, allowEmpty = true) {
  const source = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!source) {
    if (allowEmpty) return "";
    throw new Error("Не указан путь к файлу.");
  }
  const parts = source.split("/").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Путь содержит недопустимые сегменты.");
  }
  return parts.join("/");
}

function resolveStudentWebDavBrowserResource(folderSource, relativePath = "", allowEmpty = true) {
  const rootPath = normalizeWebDavPath(resolveConfiguredYandexWebDavPath(folderSource)).replace(/\/+$/g, "");
  if (!rootPath) throw new Error("Не удалось определить папку документов слушателя.");
  const normalizedRelativePath = normalizeStudentWebDavRelativePath(relativePath, allowEmpty);
  const targetPath = normalizedRelativePath
    ? normalizeWebDavPath(`${rootPath}/${normalizedRelativePath}`).replace(/\/+$/g, "")
    : rootPath;
  const rootKey = rootPath.toLocaleLowerCase("ru-RU");
  const targetKey = targetPath.toLocaleLowerCase("ru-RU");
  if (targetKey !== rootKey && !targetKey.startsWith(`${rootKey}/`)) {
    throw new Error("Запрошенный путь находится за пределами папки слушателя.");
  }
  return { rootPath, targetPath, relativePath: normalizedRelativePath };
}

function getWebDavBrowserContentType(fileName) {
  return WEBDAV_BROWSER_CONTENT_TYPES[path.extname(String(fileName || "")).toLowerCase()]
    || "application/octet-stream";
}

function isWebDavBrowserPreviewable(contentType) {
  const type = String(contentType || "").toLowerCase();
  return type.startsWith("image/")
    || type.startsWith("text/")
    || type.startsWith("application/json")
    || type.startsWith("application/xml")
    || type === "application/pdf";
}

function getWebDavBrowserPreviewKind(fileName, contentType = "") {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const type = String(contentType || getWebDavBrowserContentType(fileName)).toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if ([".doc", ".docm", ".docx", ".odt", ".rtf"].includes(extension)) return "document";
  if ([".ods", ".xls", ".xlsb", ".xlsm", ".xlsx"].includes(extension)) return "spreadsheet";
  if ([".ppt", ".pptx"].includes(extension)) return "presentation";
  if (type.startsWith("text/")
    || type.startsWith("application/json")
    || type.startsWith("application/xml")
    || type === "message/rfc822") return "text";
  return "";
}

function getWebDavBrowserIconKind(fileName, isDirectory = false) {
  if (isDirectory) return "folder";
  const extension = path.extname(String(fileName || "")).toLowerCase();
  if ([".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(extension)) return "image";
  if (extension === ".pdf") return "pdf";
  if ([".doc", ".docm", ".docx", ".odt", ".rtf"].includes(extension)) return "word";
  if ([".ods", ".xls", ".xlsb", ".xlsm", ".xlsx"].includes(extension)) return "spreadsheet";
  if ([".ppt", ".pptx"].includes(extension)) return "presentation";
  if ([".zip", ".7z", ".rar"].includes(extension)) return "archive";
  if ([".csv", ".eml", ".htm", ".html", ".ini", ".json", ".log", ".md", ".txt", ".tsv", ".xml", ".yaml", ".yml"].includes(extension)) return "text";
  return "file";
}

function normalizeWebDavBrowserPreviewText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function limitWebDavBrowserPreviewText(value) {
  const text = normalizeWebDavBrowserPreviewText(value);
  const truncated = text.length > MAX_WEBDAV_BROWSER_PREVIEW_TEXT_CHARS;
  return {
    text: truncated ? `${text.slice(0, MAX_WEBDAV_BROWSER_PREVIEW_TEXT_CHARS)}\n\n… Предпросмотр сокращён …` : text,
    truncated
  };
}

function decodeWebDavBrowserTextBytes(bytes) {
  const buffer = Buffer.from(bytes || "");
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const swapped = Buffer.alloc(Math.max(0, buffer.length - 2));
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1];
      swapped[index - 1] = buffer[index];
    }
    return swapped.toString("utf16le");
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))) {
    return buffer.subarray(3).toString("utf8");
  }
  const oddNulls = buffer.subarray(0, Math.min(buffer.length, 4000)).filter((value, index) => index % 2 === 1 && value === 0).length;
  if (oddNulls > Math.min(buffer.length, 4000) / 8) return buffer.toString("utf16le");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1251").decode(buffer);
  }
}

function extractXmlPreviewText(xml) {
  return normalizeWebDavBrowserPreviewText(decodeXmlEntities(String(xml || "")
    .replace(/<(?:w:tab|text:tab)\b[^>]*\/?\s*>/giu, "\t")
    .replace(/<(?:w:br|a:br)\b[^>]*\/?\s*>/giu, "\n")
    .replace(/<\/(?:w:p|a:p|text:p|text:h|table:table-row)>/giu, "\n")
    .replace(/<\/(?:w:tc|table:table-cell)>/giu, "\t")
    .replace(/<[^>]+>/g, "")));
}

function extractOpenXmlWordPreviewText(bytes) {
  const entries = readDocxZipEntries(Buffer.from(bytes));
  const names = [
    "word/document.xml",
    ...entries.map((entry) => entry.name).filter((name) => /^word\/(?:header|footer|footnotes|endnotes)\d*\.xml$/i.test(name))
  ];
  return names.map((name) => {
    const entry = entries.find((item) => item.name === name);
    return entry ? extractXmlPreviewText(entry.content.toString("utf8")) : "";
  }).filter(Boolean).join("\n\n");
}

function extractOdtPreviewText(bytes) {
  const entries = readDocxZipEntries(Buffer.from(bytes));
  const content = entries.find((entry) => entry.name === "content.xml");
  if (!content) throw new Error("В документе ODT не найден текстовый слой.");
  return extractXmlPreviewText(content.content.toString("utf8"));
}

function extractPresentationPreviewText(bytes) {
  const entries = readDocxZipEntries(Buffer.from(bytes));
  return entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "ru", { numeric: true }))
    .map((entry, index) => `Слайд ${index + 1}\n${extractXmlPreviewText(entry.content.toString("utf8"))}`)
    .join("\n\n");
}

function extractRtfPreviewText(bytes) {
  const decoder = new TextDecoder("windows-1251");
  return normalizeWebDavBrowserPreviewText(decoder.decode(Buffer.from(bytes))
    .replace(/\\u(-?\d+)\??/g, (match, value) => String.fromCharCode((Number(value) + 65536) % 65536))
    .replace(/\\'([0-9a-f]{2})/gi, (match, hex) => decoder.decode(Uint8Array.from([Number.parseInt(hex, 16)])))
    .replace(/\\(?:par|line)\b/gi, "\n")
    .replace(/\\tab\b/gi, "\t")
    .replace(/\\[a-z]+-?\d*\s?/gi, "")
    .replace(/\\([{}\\])/g, "$1")
    .replace(/[{}]/g, ""));
}

function extractLegacyOfficePreviewText(bytes) {
  const buffer = Buffer.from(bytes || "");
  const candidates = [
    buffer.toString("utf16le"),
    new TextDecoder("windows-1251").decode(buffer)
  ];
  const lines = [];
  const seen = new Set();
  candidates.forEach((candidate) => {
    const normalized = candidate.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, "\n");
    const matches = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}\s.,:;!?()«»"'№%+\-–—/\\]{3,500}/gu) || [];
    matches.forEach((match) => {
      const line = match.replace(/\s+/g, " ").trim();
      if (line.length < 4 || !/(?:[А-Яа-яЁё]{2}|[A-Za-z]{3})/u.test(line)) return;
      const key = line.toLocaleLowerCase("ru-RU");
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(line);
    });
  });
  return lines.join("\n");
}

function extractSpreadsheetPreviewText(bytes) {
  const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer", cellDates: true });
  return workbook.SheetNames.slice(0, 8).map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const body = XLSX.utils.sheet_to_csv(sheet, { FS: "\t", RS: "\n", blankrows: false });
    return `Лист: ${sheetName}\n${body}`;
  }).join("\n\n");
}

function convertHtmlPreviewToText(value) {
  return normalizeWebDavBrowserPreviewText(decodeXmlEntities(String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "\t")
    .replace(/<[^>]+>/g, "")));
}

function extractWebDavBrowserPreviewText(fileName, bytes) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  if ([".docm", ".docx"].includes(extension)) return extractOpenXmlWordPreviewText(bytes);
  if (extension === ".odt") return extractOdtPreviewText(bytes);
  if (extension === ".rtf") return extractRtfPreviewText(bytes);
  if (extension === ".doc" || extension === ".ppt") return extractLegacyOfficePreviewText(bytes);
  if (extension === ".pptx") return extractPresentationPreviewText(bytes);
  if ([".ods", ".xls", ".xlsb", ".xlsm", ".xlsx"].includes(extension)) return extractSpreadsheetPreviewText(bytes);
  if (extension === ".eml") {
    const extracted = extractMimeText(Buffer.from(bytes));
    return extracted.plain || convertHtmlPreviewToText(extracted.html || "");
  }
  let text = decodeWebDavBrowserTextBytes(bytes);
  if ([".htm", ".html"].includes(extension)) text = convertHtmlPreviewToText(text);
  if (extension === ".json") {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep source text */ }
  }
  return text;
}

function safeWebDavUploadFileName(value) {
  const source = path.posix.basename(String(value || "").trim().replace(/\\/g, "/"));
  const cleaned = source
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180)
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("У файла отсутствует корректное имя.");
  }
  return cleaned;
}

async function handleStudentWebDavDocumentsList(req, res) {
  try {
    const body = await readJsonBody(req);
    const location = resolveStudentWebDavBrowserResource(body.folder, body.path || "");
    const targetKey = location.targetPath.toLocaleLowerCase("ru-RU");
    const entries = (await readWebDavDirectory(location.targetPath))
      .filter((entry) => {
        const entryPath = normalizeWebDavPath(entry.href).replace(/\/+$/g, "");
        const entryKey = entryPath.toLocaleLowerCase("ru-RU");
        if (entryKey === targetKey || !entryKey.startsWith(`${targetKey}/`)) return false;
        return !path.posix.relative(location.targetPath, entryPath).includes("/");
      })
      .slice(0, MAX_WEBDAV_BROWSER_ENTRIES)
      .map((entry) => {
        const name = String(path.posix.basename(normalizeWebDavPath(entry.href))).trim();
        const relativePath = normalizeStudentWebDavRelativePath(
          [location.relativePath, name].filter(Boolean).join("/"),
          false
        );
        const contentType = entry.isCollection ? "" : getWebDavBrowserContentType(name);
        const previewKind = entry.isCollection ? "" : getWebDavBrowserPreviewKind(name, contentType);
        return {
          name,
          path: relativePath,
          isDirectory: Boolean(entry.isCollection),
          size: Number(entry.contentLength || 0),
          modifiedAt: String(entry.modifiedAt || ""),
          contentType,
          previewKind,
          iconKind: getWebDavBrowserIconKind(name, entry.isCollection),
          previewable: Boolean(previewKind)
        };
      })
      .sort((left, right) => (
        Number(right.isDirectory) - Number(left.isDirectory)
        || left.name.localeCompare(right.name, "ru", { numeric: true, sensitivity: "base" })
      ));
    sendJson(res, 200, {
      path: location.relativePath,
      entries,
      truncated: entries.length >= MAX_WEBDAV_BROWSER_ENTRIES
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentWebDavDocumentFile(req, res, requestUrl) {
  try {
    const folder = String(requestUrl.searchParams.get("folder") || "");
    const relativePath = String(requestUrl.searchParams.get("path") || "");
    const location = resolveStudentWebDavBrowserResource(folder, relativePath, false);
    const fileName = path.posix.basename(location.relativePath);
    const response = await requestYandexWebDav("GET", location.targetPath, {
      acceptedStatuses: [200],
      maxResponseBytes: MAX_WEBDAV_BROWSER_FILE_BYTES
    });
    if (!response.body.length) throw new Error("Файл пустой.");
    const disposition = requestUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    const encodedName = encodeURIComponent(fileName).replace(/['()]/g, escape);
    const contentType = getWebDavBrowserContentType(fileName);
    const securityHeaders = {
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff"
    };
    if (/^(?:text\/html|image\/svg\+xml|application\/(?:xml|xhtml\+xml))/iu.test(contentType)) {
      securityHeaders["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    }
    sendFile(res, 200, response.body, fileName, contentType, securityHeaders);
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentWebDavDocumentPreview(req, res, requestUrl) {
  try {
    const folder = String(requestUrl.searchParams.get("folder") || "");
    const relativePath = String(requestUrl.searchParams.get("path") || "");
    const location = resolveStudentWebDavBrowserResource(folder, relativePath, false);
    const fileName = path.posix.basename(location.relativePath);
    const contentType = getWebDavBrowserContentType(fileName);
    const previewKind = getWebDavBrowserPreviewKind(fileName, contentType);
    if (!previewKind || ["image", "pdf"].includes(previewKind)) {
      throw new Error("Для этого файла используется прямой предпросмотр.");
    }
    const response = await requestYandexWebDav("GET", location.targetPath, {
      acceptedStatuses: [200],
      maxResponseBytes: MAX_WEBDAV_BROWSER_FILE_BYTES
    });
    if (!response.body.length) throw new Error("Файл пустой.");
    const preview = limitWebDavBrowserPreviewText(
      extractWebDavBrowserPreviewText(fileName, response.body)
    );
    const extension = path.extname(fileName).toLowerCase();
    sendJson(res, 200, {
      fileName,
      contentType,
      previewKind,
      text: preview.text || "Текстовый слой файла не содержит данных для отображения.",
      truncated: preview.truncated,
      limitedExtraction: [".doc", ".ppt"].includes(extension)
    });
  } catch (error) {
    sendError(res, 400, `Не удалось подготовить предпросмотр: ${error.message}`);
  }
}

async function handleStudentWebDavDocumentUpload(req, res) {
  try {
    const body = await readJsonBody(req);
    const directory = resolveStudentWebDavBrowserResource(body.folder, body.path || "");
    const fileName = safeWebDavUploadFileName(body.fileName);
    const encoded = String(body.dataBase64 || "").replace(/\s+/g, "");
    if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded)) throw new Error("Файл передан в некорректном формате.");
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length) throw new Error("Нельзя загрузить пустой файл.");
    if (bytes.length > MAX_WEBDAV_BROWSER_FILE_BYTES) {
      throw new Error("Размер одного файла не должен превышать 24 МБ.");
    }
    await ensureYandexDiskFolder(directory.targetPath);
    const target = resolveStudentWebDavBrowserResource(
      body.folder,
      [directory.relativePath, fileName].filter(Boolean).join("/"),
      false
    );
    const contentType = String(body.contentType || "").trim() || getWebDavBrowserContentType(fileName);
    await requestYandexWebDav("PUT", target.targetPath, {
      acceptedStatuses: [200, 201, 204],
      body: bytes,
      contentType
    });
    const previewKind = getWebDavBrowserPreviewKind(fileName, contentType);
    sendJson(res, 201, {
      name: fileName,
      path: target.relativePath,
      size: bytes.length,
      contentType,
      previewKind,
      iconKind: getWebDavBrowserIconKind(fileName),
      previewable: Boolean(previewKind)
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function collectWebDavOcrDocuments(folderSource) {
  const rootPath = resolveConfiguredYandexWebDavPath(folderSource);
  const rootKey = normalizeWebDavPath(rootPath).replace(/\/+$/g, "").toLocaleLowerCase("ru-RU");
  const documents = [];
  let skippedCount = 0;
  let totalBytes = 0;
  const visited = new Set();
  const pending = [{ davPath: rootPath, relativeFolder: "", depth: 0 }];
  while (pending.length && documents.length < MAX_OCR_DOCUMENT_FILES) {
    const current = pending.shift();
    const currentKey = normalizeWebDavPath(current.davPath).replace(/\/+$/g, "").toLocaleLowerCase("ru-RU");
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);
    const entries = await readWebDavDirectory(current.davPath);
    for (const entry of entries) {
      const entryKey = normalizeWebDavPath(entry.href).replace(/\/+$/g, "").toLocaleLowerCase("ru-RU");
      if (
        entryKey === currentKey
        || (entryKey !== rootKey && !entryKey.startsWith(`${rootKey}/`))
      ) continue;
      const relativeName = current.relativeFolder
        ? `${current.relativeFolder}/${entry.displayName}`
        : entry.displayName;
      if (entry.isCollection) {
        if (current.depth < 2 && !visited.has(entryKey)) {
          pending.push({
            davPath: entry.href,
            relativeFolder: relativeName,
            depth: current.depth + 1
          });
        }
        continue;
      }
      const contentType = getOcrDocumentContentType(entry.displayName);
      if (!contentType) continue;
      if (documents.length >= MAX_OCR_DOCUMENT_FILES) {
        skippedCount += 1;
        continue;
      }
      if (
        entry.contentLength > MAX_OCR_DOCUMENT_BYTES
        || totalBytes + entry.contentLength > MAX_OCR_TOTAL_BYTES
      ) {
        skippedCount += 1;
        continue;
      }
      totalBytes += entry.contentLength;
      documents.push({
        source: "webdav",
        fileName: entry.displayName,
        relativeName,
        contentType,
        size: entry.contentLength,
        davPath: entry.href
      });
    }
  }
  documents.sort((left, right) => left.relativeName.localeCompare(right.relativeName, "ru", {
    numeric: true,
    sensitivity: "base"
  }));
  return {
    source: "webdav",
    sourceLabel: "Яндекс-Диск",
    documents,
    skippedCount,
    totalBytes
  };
}

function normalizeStudentOcrSource(value) {
  const fallback = serverSettings.openDocumentsLocally !== false ? "local" : "webdav";
  const source = String(value || fallback).trim().toLowerCase();
  if (!["local", "webdav"].includes(source)) {
    throw new Error("Указан неподдерживаемый источник документов слушателя.");
  }
  return source;
}

function getStudentOcrSourceLabel(source) {
  return source === "local" ? "Локальная папка" : "Яндекс-Диск";
}

async function findStudentOcrDocuments(folderSource, source) {
  const normalizedSource = normalizeStudentOcrSource(source);
  return normalizedSource === "local"
    ? collectLocalOcrDocuments(folderSource)
    : collectWebDavOcrDocuments(folderSource);
}

function normalizeSelectedOcrDocumentNames(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new Error("Список выбранных документов передан в некорректном формате.");
  }
  const selectedNames = [];
  const seen = new Set();
  value.forEach((item) => {
    const relativeName = normalizeStudentWebDavRelativePath(item, false);
    if (relativeName.length > 600) {
      throw new Error("Путь к выбранному документу слишком длинный.");
    }
    const key = relativeName.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) return;
    seen.add(key);
    selectedNames.push(relativeName);
  });
  if (!selectedNames.length) {
    throw new Error("Выберите хотя бы один документ для распознавания.");
  }
  if (selectedNames.length > MAX_OCR_DOCUMENT_FILES) {
    throw new Error(`Для одного распознавания можно выбрать не более ${MAX_OCR_DOCUMENT_FILES} файлов.`);
  }
  return selectedNames;
}

function selectOcrDocuments(documents, selectedNames) {
  if (selectedNames === null) return documents;
  const documentsByName = new Map(documents.map((document) => [
    String(document.relativeName || "").replace(/\\/g, "/").toLocaleLowerCase("ru-RU"),
    document
  ]));
  const selectedDocuments = selectedNames
    .map((relativeName) => documentsByName.get(relativeName.toLocaleLowerCase("ru-RU")))
    .filter(Boolean);
  if (selectedDocuments.length !== selectedNames.length) {
    throw new Error("Один или несколько выбранных документов больше не доступны. Обновите список файлов.");
  }
  return selectedDocuments;
}

async function loadOcrDocumentBytes(document) {
  if (document.source === "local") {
    const bytes = await fs.readFile(document.localPath);
    if (!bytes.length || bytes.length > MAX_OCR_DOCUMENT_BYTES) {
      throw new Error("Файл пустой или превышает 24 МБ.");
    }
    return bytes;
  }
  const response = await requestYandexWebDav("GET", document.davPath, {
    acceptedStatuses: [200],
    maxResponseBytes: MAX_OCR_DOCUMENT_BYTES
  });
  if (!response.body.length) throw new Error("Файл пустой.");
  return response.body;
}

function shouldUseOcrCli() {
  return ["1", "true", "yes"].includes(String(process.env.AIS_OCR_CLI || "").trim().toLowerCase());
}

function runOcrCli(argumentsList, payload = null, timeoutMs = 6 * 60 * 1000, maxStdoutBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const pythonBinary = String(process.env.OCR_PYTHON_BINARY || (
      process.platform === "win32" ? "python" : "/usr/bin/python3"
    )).trim();
    const binaryRoot = path.join(OCR_CLI_RUNTIME_ROOT, "bin");
    const libraryRoot = path.join(OCR_CLI_RUNTIME_ROOT, "lib");
    const tessdataRoot = path.join(OCR_CLI_RUNTIME_ROOT, "tessdata");
    const child = spawn(pythonBinary, [OCR_CLI_SCRIPT, ...argumentsList], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${binaryRoot}${path.delimiter}${process.env.PATH || ""}`,
        LD_LIBRARY_PATH: `${libraryRoot}${path.delimiter}${process.env.LD_LIBRARY_PATH || ""}`,
        TESSDATA_PREFIX: tessdataRoot,
        OCR_TESSERACT_BINARY: path.join(binaryRoot, process.platform === "win32" ? "tesseract.exe" : "tesseract"),
        OCR_CONVERT_BINARY: process.env.OCR_CONVERT_BINARY || "convert",
        OCR_IDENTIFY_BINARY: process.env.OCR_IDENTIFY_BINARY || "identify",
        OCR_PDFTOPPM_BINARY: process.env.OCR_PDFTOPPM_BINARY || "pdftoppm",
        OCR_PDFTOTEXT_BINARY: process.env.OCR_PDFTOTEXT_BINARY || "pdftotext"
      }
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("OCR-сервис не завершил распознавание вовремя.")));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("Ответ OCR-сервиса превышает допустимый размер.")));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes >= 512 * 1024) return;
      stderrBytes += chunk.length;
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      finish(() => reject(new Error(`Не удалось запустить OCR-сервис: ${error.message}`)));
    });
    child.on("close", (code) => {
      finish(() => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        let response = null;
        try {
          response = JSON.parse(code === 0 ? stdout : stderr || stdout);
        } catch {
          response = null;
        }
        if (code !== 0) {
          reject(new Error(response?.error || stderr || `OCR-сервис завершился с кодом ${code}.`));
          return;
        }
        if (!response || typeof response !== "object") {
          reject(new Error("OCR-сервис вернул некорректный ответ."));
          return;
        }
        resolve(response);
      });
    });
    if (payload === null) {
      child.stdin.end();
    } else {
      child.stdin.end(Buffer.from(JSON.stringify(payload), "utf8"));
    }
  });
}

async function recognizeOcrDocument(document) {
  const bytes = await loadOcrDocumentBytes(document);
  const requestPayload = {
    fileName: document.fileName,
    mimeType: document.contentType,
    base64: bytes.toString("base64")
  };
  if (shouldUseOcrCli()) {
    return runOcrCli(["--recognize-stdin"], requestPayload);
  }
  const body = Buffer.from(JSON.stringify(requestPayload), "utf8");
  const serviceUrl = String(
    process.env.OCR_SERVICE_URL || DEFAULT_OCR_SERVICE_URL
  ).trim().replace(/\/+$/g, "");
  const response = await requestBuffer(`${serviceUrl}/v1/recognize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length
    },
    body,
    timeoutMs: 6 * 60 * 1000,
    maxResponseBytes: 8 * 1024 * 1024,
    errorPrefix: "Локальный OCR-сервис отклонил файл",
    timeoutError: "Локальный OCR-сервис не завершил распознавание вовремя"
  });
  let payload;
  try {
    payload = JSON.parse(response.toString("utf8"));
  } catch {
    throw new Error("Локальный OCR-сервис вернул некорректный ответ.");
  }
  if (!payload?.ok) throw new Error(payload?.error || "Не удалось распознать файл.");
  return payload;
}

async function renderOcrDocumentPage(document, page) {
  const bytes = await loadOcrDocumentBytes(document);
  const requestPayload = {
    fileName: document.fileName,
    mimeType: document.contentType,
    page: Math.max(1, Math.min(20, Number(page) || 1)),
    base64: bytes.toString("base64")
  };
  if (shouldUseOcrCli()) {
    return runOcrCli(["--render-page-stdin"], requestPayload, 2 * 60 * 1000);
  }
  const body = Buffer.from(JSON.stringify(requestPayload), "utf8");
  const serviceUrl = String(
    process.env.OCR_SERVICE_URL || DEFAULT_OCR_SERVICE_URL
  ).trim().replace(/\/+$/g, "");
  const response = await requestBuffer(`${serviceUrl}/v1/render-page`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length
    },
    body,
    timeoutMs: 2 * 60 * 1000,
    maxResponseBytes: 1024 * 1024,
    errorPrefix: "OCR-сервис не смог подготовить страницу",
    timeoutError: "OCR-сервис не подготовил страницу вовремя"
  });
  const payload = JSON.parse(response.toString("utf8"));
  if (!payload?.ok) throw new Error(payload?.error || "Не удалось подготовить страницу документа.");
  return payload;
}

function normalizeOcrFieldPreview(value) {
  if (!value || typeof value !== "object") return null;
  if (String(value.mimeType || "").toLowerCase() !== "image/jpeg") return null;
  const encoded = String(value.base64 || "").replace(/\s+/g, "");
  if (!encoded || encoded.length > 320_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  let bytes;
  try {
    bytes = Buffer.from(encoded, "base64");
  } catch {
    return null;
  }
  if (
    !bytes.length
    || bytes.length > 220 * 1024
    || bytes[0] !== 0xFF
    || bytes[1] !== 0xD8
    || bytes[2] !== 0xFF
  ) return null;
  const normalized = {
    page: Math.max(1, Math.min(99, Number(value.page) || 1)),
    mimeType: "image/jpeg",
    base64: bytes.toString("base64")
  };
  const sourceBox = value.box;
  if (sourceBox && typeof sourceBox === "object") {
    const box = {
      x: Math.max(0, Math.min(1, Number(sourceBox.x) || 0)),
      y: Math.max(0, Math.min(1, Number(sourceBox.y) || 0)),
      width: Math.max(0, Math.min(1, Number(sourceBox.width) || 0)),
      height: Math.max(0, Math.min(1, Number(sourceBox.height) || 0))
    };
    if (box.width > 0 && box.height > 0) normalized.box = box;
  }
  return normalized;
}

function normalizeOcrPagePreview(value) {
  if (!value || typeof value !== "object") return null;
  if (String(value.mimeType || "").toLowerCase() !== "image/jpeg") return null;
  const encoded = String(value.base64 || "").replace(/\s+/g, "");
  if (!encoded || encoded.length > 420_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  let bytes;
  try {
    bytes = Buffer.from(encoded, "base64");
  } catch {
    return null;
  }
  if (
    !bytes.length
    || bytes.length > 280 * 1024
    || bytes[0] !== 0xFF
    || bytes[1] !== 0xD8
    || bytes[2] !== 0xFF
  ) return null;
  return {
    page: Math.max(1, Math.min(99, Number(value.page) || 1)),
    mimeType: "image/jpeg",
    base64: bytes.toString("base64")
  };
}

function normalizeOcrPhotoCandidate(value, sourceFile) {
  const preview = normalizeOcrFieldPreview(value);
  if (!preview) return null;
  return {
    ...preview,
    confidence: Math.round(Math.max(0, Math.min(1, Number(value?.confidence) || 0)) * 100) / 100,
    method: String(value?.method || "face").trim().slice(0, 40),
    sourceFile: String(sourceFile || "").trim().slice(0, 260)
  };
}

function normalizeOcrFieldCandidate(field, sourceFile) {
  const key = String(field?.key || "").trim();
  if (!Object.hasOwn(OCR_DOCUMENT_FIELD_LABELS, key)) return null;
  const value = String(field?.value || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  const manualEntry = key === "registrationAddress" && field?.manualEntry === true;
  if (!value && !manualEntry) return null;
  const confidence = Math.max(0, Math.min(1, Number(field?.confidence) || 0));
  const candidate = {
    key,
    label: OCR_DOCUMENT_FIELD_LABELS[key],
    value,
    confidence: Math.round(confidence * 100) / 100,
    evidence: String(field?.evidence || "").replace(/\s+/g, " ").trim().slice(0, 280),
    sourceFile: String(sourceFile || "").slice(0, 260),
    manualEntry
  };
  const preview = normalizeOcrFieldPreview(field?.preview);
  if (preview) candidate.preview = preview;
  return candidate;
}

function aggregateOcrFieldCandidates(fileResults) {
  const candidatesByKey = new Map();
  fileResults.forEach((fileResult) => {
    (fileResult.fields || []).forEach((field) => {
      const candidate = normalizeOcrFieldCandidate(field, fileResult.relativeName);
      if (!candidate) return;
      const candidates = candidatesByKey.get(candidate.key) || [];
      const duplicate = candidates.find((item) => (
        item.value.toLocaleLowerCase("ru-RU") === candidate.value.toLocaleLowerCase("ru-RU")
      ));
      if (duplicate) {
        if (candidate.confidence > duplicate.confidence) {
          Object.assign(duplicate, candidate);
        } else if (!duplicate.sourceFile.includes(candidate.sourceFile)) {
          duplicate.sourceFile = `${duplicate.sourceFile}; ${candidate.sourceFile}`.slice(0, 260);
        }
      } else {
        candidates.push(candidate);
      }
      candidatesByKey.set(candidate.key, candidates);
    });
  });
  return Object.keys(OCR_DOCUMENT_FIELD_LABELS).flatMap((key) => {
    const candidates = (candidatesByKey.get(key) || [])
      .sort((left, right) => right.confidence - left.confidence);
    if (!candidates.length) return [];
    return [{
      ...candidates[0],
      alternatives: candidates.slice(1).map((item) => ({
        value: item.value,
        confidence: item.confidence,
        sourceFile: item.sourceFile,
        evidence: item.evidence
      }))
    }];
  });
}

function cleanupStudentDocumentRecognitionJobs() {
  const expiresBefore = Date.now() - STUDENT_DOCUMENT_RECOGNITION_JOB_TTL_MS;
  studentDocumentRecognitionJobs.forEach((job, jobId) => {
    if (job.createdAt < expiresBefore) studentDocumentRecognitionJobs.delete(jobId);
  });
}

function publicStudentDocumentRecognitionJob(job) {
  const finishedAt = job.completedAt || Date.now();
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    source: job.source,
    sourceLabel: job.sourceLabel,
    startedAt: new Date(job.startedAt || job.createdAt).toISOString(),
    completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : "",
    elapsedMs: Math.max(0, finishedAt - (job.startedAt || job.createdAt)),
    processedFiles: job.processedFiles,
    totalFiles: job.totalFiles,
    error: job.error || ""
  };
}

function isTrustedBrowserOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin || origin === "null") return true;
  try {
    return new URL(origin).host.toLocaleLowerCase("en-US")
      === String(req.headers.host || "").trim().toLocaleLowerCase("en-US");
  } catch {
    return false;
  }
}

async function runStudentDocumentRecognitionJob(job, options) {
  try {
    job.startedAt = Date.now();
    job.status = "running";
    job.progress = 2;
    job.stage = `Поиск документов: ${job.sourceLabel}`;
    const sourceResult = await findStudentOcrDocuments(options.folder, job.source);
    const documents = selectOcrDocuments(sourceResult.documents, options.selectedFiles);
    if (!documents.length) {
      throw new Error("В папке слушателя не найдены файлы JPG, PNG, PDF, TXT, CSV, RTF, DOCX или ODT.");
    }
    job.totalFiles = documents.length;
    job.progress = 8;
    job.stage = `Найдено файлов: ${documents.length}`;
    const fileResults = [];
    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index];
      const fileStartedAt = Date.now();
      job.stage = `Распознавание ${index + 1} из ${documents.length}: ${document.relativeName}`;
      job.progress = Math.min(94, 10 + Math.round((index / documents.length) * 84));
      try {
        const payload = await recognizeOcrDocument(document);
        fileResults.push({
          fileName: document.fileName,
          relativeName: document.relativeName,
          contentType: document.contentType,
          pageCount: Number(payload.pageCount) || 1,
          documentTypes: Array.isArray(payload.documentTypes)
            ? payload.documentTypes.map((item) => String(item || "")).filter(Boolean)
            : [],
          fields: Array.isArray(payload.fields) ? payload.fields : [],
          pagePreviews: Array.isArray(payload.pagePreviews)
            ? payload.pagePreviews.map(normalizeOcrPagePreview).filter(Boolean)
            : [],
          photoCandidates: Array.isArray(payload.photoCandidates)
            ? payload.photoCandidates
              .map((candidate) => normalizeOcrPhotoCandidate(candidate, document.relativeName))
              .filter(Boolean)
            : [],
          textPreview: String(payload.textPreview || "").slice(0, 3000),
          textExtraction: String(payload.textExtraction || "ocr").slice(0, 24),
          durationMs: Number(payload.durationMs) || Date.now() - fileStartedAt,
          error: ""
        });
      } catch (error) {
        fileResults.push({
          fileName: document.fileName,
          relativeName: document.relativeName,
          contentType: document.contentType,
          pageCount: 0,
          documentTypes: [],
          fields: [],
          pagePreviews: [],
          photoCandidates: [],
          textPreview: "",
          textExtraction: "",
          durationMs: Date.now() - fileStartedAt,
          error: error.message
        });
      }
      job.processedFiles = index + 1;
    }
    const successfulFiles = fileResults.filter((item) => !item.error);
    if (!successfulFiles.length) {
      const firstError = fileResults.find((item) => item.error)?.error;
      throw new Error(firstError || "Не удалось распознать документы в папке.");
    }
    job.completedAt = Date.now();
    const durationMs = job.completedAt - job.startedAt;
    const aggregatedFields = aggregateOcrFieldCandidates(successfulFiles);
    const photoCandidates = successfulFiles
      .flatMap((fileResult) => fileResult.photoCandidates || [])
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 16);
    const previewSourceFiles = new Set(aggregatedFields.flatMap((field) => (
      String(field.sourceFile || "").split(/;\s*/g).map((item) => item.trim()).filter(Boolean)
    )));
    job.result = {
      folder: options.folder,
      source: sourceResult.source,
      sourceLabel: sourceResult.sourceLabel,
      recognizedAt: new Date(job.completedAt).toISOString(),
      durationMs,
      sourceFileCount: sourceResult.documents.length,
      selectedFileCount: documents.length,
      unselectedFileCount: Math.max(0, sourceResult.documents.length - documents.length),
      documentCount: successfulFiles.length,
      processedCount: successfulFiles.length,
      imageFileCount: successfulFiles.filter((item) => /^image\//i.test(item.contentType)).length,
      pdfFileCount: successfulFiles.filter((item) => item.contentType === "application/pdf").length,
      textFileCount: successfulFiles.filter((item) => (
        !/^image\//i.test(item.contentType) && item.contentType !== "application/pdf"
      )).length,
      failedCount: fileResults.length - successfulFiles.length,
      skippedCount: sourceResult.skippedCount,
      fields: aggregatedFields,
      photoCandidates,
      files: fileResults.map(({ fields, photoCandidates: ignoredPhotoCandidates, ...fileResult }) => {
        if (!previewSourceFiles.has(fileResult.relativeName)) delete fileResult.pagePreviews;
        return fileResult;
      })
    };
    job.status = "completed";
    job.progress = 100;
    job.stage = "Распознавание завершено";
  } catch (error) {
    job.completedAt = Date.now();
    job.status = "failed";
    job.error = error.message;
    job.stage = "Распознавание не выполнено";
  }
}

async function handleStudentDocumentRecognitionFiles(req, res) {
  try {
    if (
      String(req.headers["x-requested-with"] || "") !== "AIS-Web"
      || !isTrustedBrowserOrigin(req)
    ) {
      sendError(res, 403, "Запрос списка документов отклонён сервером.");
      return;
    }
    const body = await readJsonBody(req);
    const folder = String(body.folder || "").trim();
    if (!folder || folder.length > 600) {
      throw new Error("Не удалось определить папку документов слушателя.");
    }
    if (!normalizeSystemDocumentsRelativePath(folder)) {
      throw new Error("Путь к папке документов слушателя содержит недопустимые элементы.");
    }
    const source = await useWebDavWhenLocalDocumentsUnavailable(
      normalizeStudentOcrSource(body.source)
    );
    const sourceResult = await findStudentOcrDocuments(folder, source);
    sendJson(res, 200, {
      source: sourceResult.source,
      sourceLabel: sourceResult.sourceLabel,
      skippedCount: sourceResult.skippedCount,
      totalBytes: sourceResult.totalBytes,
      files: sourceResult.documents.map((document) => ({
        fileName: document.fileName,
        relativeName: document.relativeName,
        contentType: document.contentType,
        size: document.size
      }))
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentDocumentRecognitionStart(req, res) {
  try {
    if (
      String(req.headers["x-requested-with"] || "") !== "AIS-Web"
      || !isTrustedBrowserOrigin(req)
    ) {
      sendError(res, 403, "Запрос распознавания документов отклонён сервером.");
      return;
    }
    const body = await readJsonBody(req);
    const folder = String(body.folder || "").trim();
    if (!folder || folder.length > 600) {
      throw new Error("Не удалось определить папку документов слушателя.");
    }
    if (!normalizeSystemDocumentsRelativePath(folder)) {
      throw new Error("Путь к папке документов слушателя содержит недопустимые элементы.");
    }
    const source = await useWebDavWhenLocalDocumentsUnavailable(
      normalizeStudentOcrSource(body.source)
    );
    const selectedFiles = normalizeSelectedOcrDocumentNames(body.selectedFiles);
    cleanupStudentDocumentRecognitionJobs();
    const jobId = crypto.randomBytes(18).toString("hex");
    const job = {
      id: jobId,
      createdAt: Date.now(),
      startedAt: Date.now(),
      completedAt: 0,
      status: "queued",
      progress: 0,
      stage: "Подготовка",
      source,
      sourceLabel: getStudentOcrSourceLabel(source),
      processedFiles: 0,
      totalFiles: 0,
      result: null,
      error: ""
    };
    studentDocumentRecognitionJobs.set(jobId, job);
    setImmediate(() => {
      runStudentDocumentRecognitionJob(job, { folder, source, selectedFiles }).catch((error) => {
        job.status = "failed";
        job.error = error.message;
      });
    });
    sendJson(res, 202, publicStudentDocumentRecognitionJob(job));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentDocumentRecognitionDirect(req, res) {
  try {
    if (
      String(req.headers["x-requested-with"] || "") !== "AIS-Web"
      || !isTrustedBrowserOrigin(req)
    ) {
      sendError(res, 403, "Запрос распознавания документов отклонён сервером.");
      return;
    }
    const body = await readJsonBody(req);
    const folder = String(body.folder || "").trim();
    if (!folder || folder.length > 600) {
      throw new Error("Не удалось определить папку документов слушателя.");
    }
    if (!normalizeSystemDocumentsRelativePath(folder)) {
      throw new Error("Путь к папке документов слушателя содержит недопустимые элементы.");
    }
    const source = shouldUseOcrCli()
      ? "webdav"
      : await useWebDavWhenLocalDocumentsUnavailable(normalizeStudentOcrSource(body.source));
    const selectedFiles = normalizeSelectedOcrDocumentNames(body.selectedFiles);
    const job = {
      id: crypto.randomBytes(18).toString("hex"),
      createdAt: Date.now(),
      startedAt: Date.now(),
      completedAt: 0,
      status: "queued",
      progress: 0,
      stage: "Подготовка",
      source,
      sourceLabel: getStudentOcrSourceLabel(source),
      processedFiles: 0,
      totalFiles: 0,
      result: null,
      error: ""
    };
    await runStudentDocumentRecognitionJob(job, { folder, source, selectedFiles });
    if (job.status !== "completed" || !job.result) {
      sendError(res, 400, job.error || "Распознавание документов не выполнено.");
      return;
    }
    sendJson(res, 200, job.result);
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentDocumentRecognitionPage(req, res) {
  try {
    if (
      String(req.headers["x-requested-with"] || "") !== "AIS-Web"
      || !isTrustedBrowserOrigin(req)
    ) {
      sendError(res, 403, "Запрос страницы документа отклонён сервером.");
      return;
    }
    const body = await readJsonBody(req);
    const folder = String(body.folder || "").trim();
    const relativeName = String(body.relativeName || "").replace(/\\/g, "/").trim();
    const page = Math.max(1, Math.min(20, Number(body.page) || 1));
    if (!folder || folder.length > 600 || !normalizeSystemDocumentsRelativePath(folder)) {
      throw new Error("Некорректно указана папка документов слушателя.");
    }
    if (!relativeName || relativeName.length > 600 || relativeName.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("Некорректно указан файл документа.");
    }
    const source = await useWebDavWhenLocalDocumentsUnavailable(
      normalizeStudentOcrSource(body.source)
    );
    const sourceResult = await findStudentOcrDocuments(folder, source);
    const document = sourceResult.documents.find((item) => (
      String(item.relativeName || "").replace(/\\/g, "/") === relativeName
    ));
    if (!document) throw new Error("Файл не найден в папке слушателя.");
    const payload = await renderOcrDocumentPage(document, page);
    const preview = normalizeOcrPagePreview(payload.preview);
    if (!preview) throw new Error("Сервер не смог сформировать изображение страницы.");
    sendJson(res, 200, {
      fileName: document.fileName,
      relativeName: document.relativeName,
      page: Math.max(1, Number(payload.page) || page),
      pageCount: Math.max(1, Number(payload.pageCount) || 1),
      preview
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

function getStudentDocumentRecognitionJob(requestUrl) {
  cleanupStudentDocumentRecognitionJobs();
  const jobId = String(requestUrl.searchParams.get("jobId") || "").trim();
  return jobId ? studentDocumentRecognitionJobs.get(jobId) : null;
}

function handleStudentDocumentRecognitionStatus(req, res, requestUrl) {
  if (!isTrustedBrowserOrigin(req)) {
    sendError(res, 403, "Запрос состояния распознавания отклонён сервером.");
    return;
  }
  const job = getStudentDocumentRecognitionJob(requestUrl);
  if (!job) {
    sendError(res, 404, "Задание распознавания не найдено.");
    return;
  }
  sendJson(res, 200, publicStudentDocumentRecognitionJob(job));
}

function handleStudentDocumentRecognitionResult(req, res, requestUrl) {
  if (!isTrustedBrowserOrigin(req)) {
    sendError(res, 403, "Запрос результата распознавания отклонён сервером.");
    return;
  }
  const job = getStudentDocumentRecognitionJob(requestUrl);
  if (!job) {
    sendError(res, 404, "Задание распознавания не найдено.");
    return;
  }
  if (job.status === "failed") {
    sendError(res, 400, job.error || "Распознавание завершилось с ошибкой.");
    return;
  }
  if (job.status !== "completed" || !job.result) {
    sendError(res, 409, "Распознавание ещё не завершено.");
    return;
  }
  sendJson(res, 200, job.result);
}

async function handleOcrHealth(req, res) {
  try {
    if (shouldUseOcrCli()) {
      sendJson(res, 200, await runOcrCli(["--health"], null, 30 * 1000));
      return;
    }
    const serviceUrl = String(
      process.env.OCR_SERVICE_URL || DEFAULT_OCR_SERVICE_URL
    ).trim().replace(/\/+$/g, "");
    const response = await requestBuffer(`${serviceUrl}/health`, {
      timeoutMs: 5000,
      maxResponseBytes: 64 * 1024,
      errorPrefix: "OCR-сервис недоступен",
      timeoutError: "OCR-сервис не ответил"
    });
    const payload = JSON.parse(response.toString("utf8"));
    sendJson(res, 200, payload);
  } catch (error) {
    sendError(res, 503, error.message);
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
  const outputFormat = normalizeGeneratedDocumentFormat(body.outputFormat);
  const { relativeFolder, useParentFolder } = resolveStudentDocumentRelativeFolder(body);
  const basePath = resolveYandexDiskBasePath(useParentFolder);
  const folderPath = normalizeWebDavPath(`${basePath}/${relativeFolder}`);
  await ensureYandexDiskFolder(folderPath);
  const targetPath = normalizeWebDavPath(`${folderPath}/${safeDocumentFileName(fileName, outputFormat)}`);
  await requestYandexWebDav("PUT", targetPath, {
    acceptedStatuses: [200, 201, 204],
    body: bytes,
    contentType: generatedDocumentContentType(outputFormat)
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

const FRDO_EXPORT_HEADERS = Object.freeze([
  "Вид документа",
  "Статус документа",
  "Подтверждение утраты",
  "Подтверждение обмена",
  "Подтверждение уничтожения",
  "Серия документа",
  "Номер документа",
  "Дата выдачи документа",
  "Регистрационный номер",
  "Дополнительная профессиональная программа (повышение квалификации/ профессиональная переподготовка)",
  "Наименование дополнительной профессиональной программы",
  "Наименование области профессиональной деятельности",
  "Укрупненные группы специальностей",
  "Наименование квалификации, профессии, специальности",
  "Уровень образования ВО/СПО",
  "Фамилия указанная в дипломе о ВО или СПО",
  "Серия документа о ВО/СПО",
  "Номер документа о ВО/СПО",
  "Год начала обучения (для документа о квалификации)",
  "Год окончания обучения (для документа о квалификации)",
  "Срок обучения, часов (для документа о квалификации)",
  "Фамилия получателя",
  "Имя получателя",
  "Отчество получателя",
  "Дата рождения получателя",
  "Пол получателя",
  "СНИЛС",
  "Форма обучения",
  "Источник финансирования обучения",
  "Форма получения образования на момент прекращения образовательных отношений",
  "Гражданство получателя (код страны по ОКСМ)",
  "Наименование документа об образовании (оригинала)",
  "Серия (оригинала)",
  "Номер (оригинала)",
  "Регистрационный N (оригинала)",
  "Дата выдачи (оригинала)",
  "Фамилия получателя (оригинала)",
  "Имя получателя (оригинала)",
  "Отчество получателя (оригинала)",
  "Номер документа для изменения"
]);

const FRDO_CITIZENSHIP_CODES = new Map([
  ["россия", "643"],
  ["российская федерация", "643"],
  ["рф", "643"],
  ["казахстан", "398"],
  ["республика казахстан", "398"],
  ["узбекистан", "860"],
  ["республика узбекистан", "860"],
  ["беларусь", "112"],
  ["республика беларусь", "112"],
  ["армения", "051"],
  ["республика армения", "051"],
  ["азербайджан", "031"],
  ["кыргызстан", "417"],
  ["киргизия", "417"],
  ["таджикистан", "762"],
  ["туркменистан", "795"],
  ["грузия", "268"],
  ["молдова", "498"],
  ["украина", "804"]
]);

function normalizeFrdoText(value, maxLength = 5000) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeFrdoProgramType(value) {
  const text = normalizeFrdoText(value, 100).toLocaleUpperCase("ru-RU");
  if (text.includes("КПК") || text.includes("ПОВЫШ")) return "КПК";
  if (text.includes("ППП") || text.includes("ПЕРЕПОД")) return "ППП";
  return text;
}

function splitFrdoFullName(value) {
  const [surname = "", firstName = "", ...patronymicParts] = normalizeFrdoText(value, 500).split(" ");
  return { surname, firstName, patronymic: patronymicParts.join(" ") };
}

function formatFrdoExportDate(value) {
  const iso = normalizeStudentDatabaseDate(value);
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

function getFrdoExportYear(value) {
  const iso = normalizeStudentDatabaseDate(value);
  return iso ? Number(iso.slice(0, 4)) : "";
}

function normalizeFrdoGender(value) {
  const text = normalizeFrdoText(value, 50).toLocaleLowerCase("ru-RU");
  if (/^(?:жен|ж)$/.test(text) || text.includes("женск")) return "Жен";
  if (/^(?:муж|м)$/.test(text) || text.includes("мужск")) return "Муж";
  return normalizeFrdoText(value, 50);
}

function normalizeFrdoStudyForm(value) {
  const text = normalizeFrdoText(value, 100);
  const normalized = text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  if (normalized.includes("очно-заоч")) return "Очно-заочная";
  if (normalized.includes("дистан") || normalized.includes("дистант") || normalized.includes("заоч")) return "Заочная";
  if (normalized.includes("очн")) return "Очная";
  return text;
}

function normalizeFrdoFundingSource(value) {
  const normalized = normalizeFrdoText(value, 200).toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  return /бюджет|субсид|сертификат/u.test(normalized) ? "Бюджетное обучение" : "Платное обучение";
}

function normalizeFrdoEducationLevel(level, documentName) {
  const source = `${normalizeFrdoText(level, 200)} ${normalizeFrdoText(documentName, 300)}`
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е");
  if (/спо|средн[^ ]*\s+профессион|начальн[^ ]*\s+профессион/u.test(source)) {
    return "Среднее профессиональное образование";
  }
  if (/высш|бакалав|специалист|магистр/u.test(source)) return "Высшее образование";
  return normalizeFrdoText(level, 200);
}

function normalizeFrdoCitizenshipCode(value) {
  const text = normalizeFrdoText(value, 100);
  if (/^\d{1,3}$/.test(text)) return text.padStart(3, "0");
  const normalized = text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  return FRDO_CITIZENSHIP_CODES.get(normalized) || "";
}

function isFrdoRecordAlreadyExported(record) {
  if (normalizeStudentDatabaseDate(record.frdoDate)) return true;
  const statusDate = normalizeStudentDatabaseDate(record.frdoStatus);
  if (statusDate) return true;
  const status = normalizeFrdoText(record.frdoStatus, 200).toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const explicitlyNotExported = status.includes("не выгруж")
    || status.includes("не загруж")
    || status.includes("не отправ")
    || ["нет", "-", "0"].includes(status);
  return Boolean(!explicitlyNotExported && (
    status === "+"
    || status === "1"
    || status === "да"
    || /выгруж|загруж|отправ/u.test(status)
  ));
}

function sanitizeFrdoExportPayload(body) {
  const source = Array.isArray(body?.records) ? body.records : [];
  if (!source.length) throw new Error("Нет невыгруженных документов для экспорта в ФРДО.");
  if (source.length > MAX_FRDO_EXPORT_RECORDS) {
    throw new Error(`За один раз можно экспортировать не более ${MAX_FRDO_EXPORT_RECORDS} документов.`);
  }
  const records = source
    .filter((record) => record && typeof record === "object")
    .map((record) => ({
      documentNumber: normalizeFrdoText(record.documentNumber, 200),
      registrationNumber: normalizeFrdoText(record.registrationNumber, 200),
      issueDate: normalizeStudentDatabaseDate(record.issueDate),
      program: normalizeFrdoText(record.program, 2000),
      programType: normalizeFrdoProgramType(record.programType),
      frdoProfessionalArea: normalizeFrdoText(record.frdoProfessionalArea, 2000),
      qualification: normalizeFrdoText(record.qualification, 2000),
      programQualification: normalizeFrdoText(record.programQualification, 2000),
      startDate: normalizeStudentDatabaseDate(record.startDate),
      endDate: normalizeStudentDatabaseDate(record.endDate),
      hours: normalizeFrdoText(record.hours, 100),
      name: normalizeFrdoText(record.name, 500),
      birthDate: normalizeStudentDatabaseDate(record.birthDate),
      gender: normalizeFrdoText(record.gender, 50),
      snils: normalizeFrdoText(record.snils, 100),
      studyForm: normalizeFrdoText(record.studyForm, 100),
      fundingSource: normalizeFrdoText(record.fundingSource, 200),
      citizenship: normalizeFrdoText(record.citizenship, 100),
      educationLevel: normalizeFrdoText(record.educationLevel, 300),
      educationDocument: normalizeFrdoText(record.educationDocument, 1000),
      educationDocumentSeries: normalizeFrdoText(record.educationDocumentSeries, 300),
      educationDocumentNumber: normalizeFrdoText(record.educationDocumentNumber, 300),
      educationDocumentSurname: normalizeFrdoText(record.educationDocumentSurname, 500),
      frdoStatus: normalizeFrdoText(record.frdoStatus, 200),
      frdoDate: normalizeStudentDatabaseDate(record.frdoDate)
    }))
    .filter((record) => (
      ["КПК", "ППП"].includes(record.programType)
      && !isFrdoRecordAlreadyExported(record)
      && Boolean(record.documentNumber || record.registrationNumber || record.issueDate)
    ));
  if (!records.length) throw new Error("Нет невыгруженных документов КПК или ППП для экспорта в ФРДО.");
  return records.sort((left, right) => (
    String(left.issueDate || "9999-12-31").localeCompare(String(right.issueDate || "9999-12-31"))
    || left.registrationNumber.localeCompare(right.registrationNumber, "ru", { numeric: true })
    || left.name.localeCompare(right.name, "ru", { sensitivity: "base" })
  ));
}

function buildFrdoExportRow(record) {
  const name = splitFrdoFullName(record.name);
  const educationSurname = record.educationDocumentSurname || name.surname;
  const qualification = record.qualification || record.programQualification || record.program;
  const documentKind = record.programType === "ППП"
    ? "Диплом о профессиональной переподготовке"
    : "Удостоверение о повышении квалификации";
  const programKind = record.programType === "ППП"
    ? "Профессиональная переподготовка"
    : "Повышение квалификации";
  return [
    documentKind,
    "Оригинал",
    "Нет",
    "Нет",
    "Нет",
    "Нет",
    record.documentNumber,
    formatFrdoExportDate(record.issueDate),
    record.registrationNumber,
    programKind,
    record.program,
    record.frdoProfessionalArea,
    "",
    qualification,
    normalizeFrdoEducationLevel(record.educationLevel, record.educationDocument),
    educationSurname,
    record.educationDocumentSeries,
    record.educationDocumentNumber,
    getFrdoExportYear(record.startDate),
    getFrdoExportYear(record.endDate),
    record.hours,
    name.surname,
    name.firstName,
    name.patronymic,
    formatFrdoExportDate(record.birthDate),
    normalizeFrdoGender(record.gender),
    record.snils,
    normalizeFrdoStudyForm(record.studyForm),
    normalizeFrdoFundingSource(record.fundingSource),
    "в образовательной организации",
    normalizeFrdoCitizenshipCode(record.citizenship),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ];
}

function renderFrdoExportCell(address, value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<x:c r="${address}" s="11"><x:v>${value}</x:v></x:c>`;
  }
  const text = escapeXmlText(value);
  return `<x:c r="${address}" s="11" t="inlineStr"><x:is><x:t xml:space="preserve">${text}</x:t></x:is></x:c>`;
}

function buildFrdoExportWorksheetXml(templateXml, rows) {
  const sheetDataMatch = /<x:sheetData>([\s\S]*?)<\/x:sheetData>/u.exec(templateXml);
  const headerMatch = sheetDataMatch && /<x:row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/x:row>/u.exec(sheetDataMatch[1]);
  if (!sheetDataMatch || !headerMatch) throw new Error("Шаблон ФРДО повреждён: не найдена строка заголовков.");
  const dataXml = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const cells = row.map((value, columnIndex) => (
      renderFrdoExportCell(`${XLSX.utils.encode_col(columnIndex)}${rowNumber}`, value)
    )).join("");
    return `<x:row r="${rowNumber}" ht="45" customHeight="1">${cells}</x:row>`;
  }).join("");
  return templateXml.replace(
    sheetDataMatch[0],
    `<x:sheetData>${headerMatch[0]}${dataXml}</x:sheetData>`
  );
}

function verifyFrdoExportTemplate(workbookBytes) {
  const workbook = XLSX.read(workbookBytes, { type: "buffer", raw: true });
  const worksheet = workbook.Sheets["Шаблон"];
  if (!worksheet) throw new Error("Шаблон ФРДО повреждён: отсутствует лист «Шаблон».");
  const headers = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true })[0] || [];
  if (FRDO_EXPORT_HEADERS.some((header, index) => String(headers[index] || "").trim() !== header)) {
    throw new Error("Шаблон ФРДО повреждён: состав или порядок колонок изменён.");
  }
}

function formatFrdoExportFileDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}.${value.month}.${value.day}`;
}

async function buildFrdoExportWorkbook(body) {
  const records = sanitizeFrdoExportPayload(body);
  const templateBytes = await fs.readFile(FRDO_EXPORT_TEMPLATE_PATH);
  verifyFrdoExportTemplate(templateBytes);
  const entries = readDocxZipEntries(templateBytes);
  const worksheetEntry = entries.find((entry) => entry.name === "xl/worksheets/sheet1.xml");
  if (!worksheetEntry) throw new Error("Шаблон ФРДО повреждён: не найден XML листа.");
  worksheetEntry.content = Buffer.from(
    buildFrdoExportWorksheetXml(worksheetEntry.content.toString("utf8"), records.map(buildFrdoExportRow)),
    "utf8"
  );
  const outputBytes = buildDocxZip(entries);
  const verification = XLSX.read(outputBytes, { type: "buffer", raw: true });
  const outputRows = XLSX.utils.sheet_to_json(verification.Sheets["Шаблон"], {
    header: 1,
    defval: "",
    raw: true
  });
  if (outputRows.length !== records.length + 1 || outputRows[0]?.length !== FRDO_EXPORT_HEADERS.length) {
    throw new Error("Не удалось проверить сформированную выгрузку ФРДО.");
  }
  return {
    bytes: outputBytes,
    count: records.length,
    fileName: `ВыгрузкаДПО_${formatFrdoExportFileDate()}.xls`
  };
}

async function saveFrdoExportWorkbook(result, folderSource) {
  const relativeFolder = normalizeFrdoExportFolder(folderSource);
  const localDocuments = serverSettings.openDocumentsLocally !== false
    ? await getLocalSystemDocumentsAvailability()
    : { available: false };
  if (localDocuments.available) {
    const folderPath = resolveLocalDocumentsPath(
      relativeFolder,
      "Не удалось определить локальную папку выгрузки ФРДО."
    );
    await fs.mkdir(folderPath, { recursive: true });
    const pathApi = getRuntimeFileSystemPathApi(folderPath) || path;
    const targetPath = pathApi.resolve(folderPath, result.fileName);
    const pathFromFolder = pathApi.relative(folderPath, targetPath);
    if (pathFromFolder.startsWith("..") || pathApi.isAbsolute(pathFromFolder)) {
      throw new Error("Файл выгрузки ФРДО находится за пределами настроенной папки.");
    }
    await fs.writeFile(targetPath, result.bytes);
    let revealed = false;
    let warning = "";
    try {
      await revealFileInExplorer(targetPath);
      revealed = true;
    } catch (error) {
      warning = `Не удалось выделить файл в Проводнике: ${error.message}`;
      console.warn(warning);
    }
    return {
      storage: "local",
      path: targetPath,
      relativeFolder,
      revealed,
      warning
    };
  }
  const folderPath = normalizeWebDavPath(`${resolveYandexDiskBasePath(false)}/${relativeFolder}`);
  await ensureYandexDiskFolder(folderPath);
  const targetPath = normalizeWebDavPath(`${folderPath}/${result.fileName}`);
  await requestYandexWebDav("PUT", targetPath, {
    acceptedStatuses: [200, 201, 204],
    body: result.bytes,
    contentType: "application/vnd.ms-excel",
    timeoutMs: 60000
  });
  return {
    storage: "webdav",
    path: targetPath.replace(/^\/+/, ""),
    relativeFolder,
    revealed: false,
    warning: ""
  };
}

async function handleFrdoExport(req, res) {
  try {
    const body = await readJsonBody(req);
    const result = await buildFrdoExportWorkbook(body);
    const saved = await saveFrdoExportWorkbook(result, body.frdoExportFolder);
    sendFile(
      res,
      200,
      result.bytes,
      result.fileName,
      "application/vnd.ms-excel",
      {
        "X-Frdo-Export-Count": String(result.count),
        "X-Frdo-Saved": "true",
        "X-Frdo-Storage": saved.storage,
        "X-Frdo-Path": encodeURIComponent(saved.path),
        "X-Frdo-Relative-Folder": encodeURIComponent(saved.relativeFolder),
        "X-Frdo-Revealed": String(saved.revealed),
        "X-Frdo-Warning": encodeURIComponent(saved.warning)
      }
    );
  } catch (error) {
    sendError(res, 400, error.message);
  }
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
const CONTRACT_EVENT_IMPORT_KEY_BY_LABEL = new Map(
  CONTRACT_EVENT_IMPORT_TEMPLATES.map((event) => [
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

function parseRecordEventSettings(
  value,
  rootSection,
  eventTemplates,
  eventKeyByLabel
) {
  const lines = String(value || "").replace(/\u000b/g, "").split(/\r?\n/);
  const escapedRootSection = String(rootSection || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const eventSectionPattern = new RegExp(
    `^\\[${escapedRootSection}\\\\События(?:\\\\(\\d+))?\\]$`,
    "u"
  );
  const blocks = [];
  let block = null;
  let currentEvent = null;
  let insideEventSection = false;
  lines.forEach((line) => {
    const section = eventSectionPattern.exec(line.trim());
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
        .filter((item) => Number.isInteger(item) && item >= 0);
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
      let eventKey = eventKeyByLabel.get(normalizedLabel) || "";
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
      const isSelected = selected.has(event.index - 1);
      eventOrder.push(eventKey);
      result[`event_${eventKey}_label`] = event.label;
      if (date) result[`event_${eventKey}_date`] = date;
      if (isSelected) result[`event_${eventKey}_state`] = date ? "dated" : "checked";
      if (!isSelected && date) result[`event_${eventKey}_state`] = "unchecked";
    });
  result.eventOrder = eventOrder.join(",");
  result.eventCustomKeys = customKeys.join(",");
  result.eventDeleted = eventTemplates
    .map((event) => event.key)
    .filter((key) => !usedBaseKeys.has(key))
    .join(",");
  return result;
}

function parseStudentEventSettings(
  value,
  eventTemplates = STUDENT_EVENT_IMPORT_TEMPLATES,
  eventKeyByLabel = STUDENT_EVENT_IMPORT_KEY_BY_LABEL
) {
  return parseRecordEventSettings(
    value,
    "КарточкаСлушателя",
    eventTemplates,
    eventKeyByLabel
  );
}

function parseContractEventSettings(
  value,
  eventTemplates = CONTRACT_EVENT_IMPORT_TEMPLATES,
  eventKeyByLabel = CONTRACT_EVENT_IMPORT_KEY_BY_LABEL
) {
  return parseRecordEventSettings(
    value,
    "КарточкаКонтрагента",
    eventTemplates,
    eventKeyByLabel
  );
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

function normalizeGeneralExpenseDatabaseSection(value) {
  const normalized = String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
  if (["физлица", "физические лица"].includes(normalized)) {
    return GENERAL_EXPENSE_DATABASE_SECTIONS.individuals;
  }
  if (["организации", "юридические лица", "юрлица"].includes(normalized)) {
    return GENERAL_EXPENSE_DATABASE_SECTIONS.organizations;
  }
  return "";
}

function normalizeGeneralExpenseDatabaseValue(value, fieldName) {
  if (fieldName === "date" || fieldName === "paid") return normalizeStudentDatabaseDate(value);
  if (fieldName === "amount") return normalizeStudentDatabaseNumber(value);
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return value;
}

function buildGeneralExpenseDatabaseRecordId(expense, rowNumber) {
  const fingerprint = [
    expense.section,
    expense.counterparty,
    expense.date,
    expense.workType,
    expense.amount,
    expense.description,
    rowNumber
  ].map((value) => String(value ?? "").trim()).join(":");
  const hash = crypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 16);
  return `general-expense-db-${hash}`;
}

function normalizeContractDatabaseSection(value) {
  const normalized = String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
  if (["действующие договора", "действующие договоры", "действует", "активный"].includes(normalized)) {
    return CONTRACT_DATABASE_SECTIONS.active;
  }
  if (["партнерская программа", "партнеры", "партнерский"].includes(normalized)) {
    return CONTRACT_DATABASE_SECTIONS.partners;
  }
  if (["истекшие договора", "истекшие договоры", "истек", "истекший"].includes(normalized)) {
    return CONTRACT_DATABASE_SECTIONS.expired;
  }
  return "";
}

function normalizeContractDatabaseSectionHeading(value) {
  const normalized = String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
  return Object.values(CONTRACT_DATABASE_SECTIONS).find((section) => (
    section.toLocaleLowerCase("ru-RU").replace(/ё/g, "е") === normalized
  )) || "";
}

function findContractDatabaseSectionRanges(rows, nameColumn, headerRowIndex) {
  const sectionRows = new Map();
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const section = normalizeContractDatabaseSectionHeading(rows[rowIndex]?.[nameColumn]);
    if (!section) continue;
    if (sectionRows.has(section)) {
      throw new Error(
        `На листе «Реестр договоров» раздел «${section}» встречается несколько раз `
        + `(строки ${sectionRows.get(section) + 1} и ${rowIndex + 1}).`
      );
    }
    sectionRows.set(section, rowIndex);
  }
  const missingSections = Object.values(CONTRACT_DATABASE_SECTIONS)
    .filter((section) => !sectionRows.has(section));
  if (missingSections.length) {
    throw new Error(`На листе «Реестр договоров» не найдены разделы: ${missingSections.join(", ")}.`);
  }
  const orderedSections = Object.values(CONTRACT_DATABASE_SECTIONS);
  const orderedRows = orderedSections.map((section) => sectionRows.get(section));
  if (orderedRows.some((rowIndex, index) => index > 0 && rowIndex <= orderedRows[index - 1])) {
    throw new Error(
      "Разделы листа «Реестр договоров» должны идти по порядку: «ДЕЙСТВУЮЩИЕ ДОГОВОРА», "
      + "«ПАРТНЕРСКАЯ ПРОГРАММА», «ИСТЕКШИЕ ДОГОВОРА»."
    );
  }
  return orderedSections.map((section, index) => ({
    section,
    headingRowIndex: orderedRows[index],
    firstDataRowIndex: orderedRows[index] + 1,
    endRowIndex: index + 1 < orderedRows.length ? orderedRows[index + 1] : rows.length
  }));
}

function normalizeContractDatabaseValue(value, fieldName) {
  if (CONTRACT_DATABASE_DATE_FIELDS.has(fieldName)) return normalizeStudentDatabaseDate(value);
  if (CONTRACT_DATABASE_NUMBER_FIELDS.has(fieldName)) return normalizeStudentDatabaseNumber(value);
  if (fieldName === "contractNo") return String(value ?? "").trim().replace(/\.0+$/, "");
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return value;
}

function buildContractDatabaseRecordId(contract, rowNumber) {
  const fingerprint = [
    contract.section,
    contract.name,
    contract.contractNo,
    contract.contractDate,
    rowNumber
  ].map((value) => String(value ?? "").trim()).join(":");
  const hash = crypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 16);
  return `contract-db-${hash}`;
}

function parseWorkbookNamedCellReference(reference) {
  const source = String(reference || "").trim().replace(/^=/, "");
  const separatorIndex = source.lastIndexOf("!");
  if (separatorIndex < 0) return null;
  let sheetName = source.slice(0, separatorIndex).trim();
  if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
    sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
  }
  const addresses = source.slice(separatorIndex + 1).split(":")
    .map((address) => address.replace(/\$/g, "").trim().toUpperCase());
  if (!/^[A-Z]{1,3}[1-9]\d*$/.test(addresses[0]) || (addresses[1] && addresses[1] !== addresses[0])) {
    return null;
  }
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(addresses[0]);
  return {
    sheetName,
    cellAddress: addresses[0],
    column: match[1],
    row: Number(match[2])
  };
}

function getWorkbookNamedCell(workbook, names) {
  const requestedNames = (Array.isArray(names) ? names : [names])
    .map((name) => String(name || "").trim().toLocaleLowerCase("ru-RU"))
    .filter(Boolean);
  const namedRange = (workbook.Workbook?.Names || []).find((item) => (
    requestedNames.includes(String(item?.Name || "").trim().toLocaleLowerCase("ru-RU"))
  ));
  const reference = parseWorkbookNamedCellReference(namedRange?.Ref);
  if (!namedRange || !reference) return null;
  return {
    name: String(namedRange.Name || "").trim(),
    ...reference,
    value: workbook.Sheets[reference.sheetName]?.[reference.cellAddress]?.v ?? ""
  };
}

function normalizeMacroSettingEventType(value) {
  const source = String(value || "").trim().toLocaleUpperCase("ru-RU");
  if (!source) return "";
  if (source.includes("КПК") || source.includes("ПОВЫШ")) return "КПК";
  if (source.includes("ППП") || source.includes("ПЕРЕПОД")) return "ППП";
  if (source.includes("ДОП")) return "ДОП";
  if (source.includes("ПРО")) return "ПРО";
  return "";
}

function buildMacroSettingEventKey(label, knownKeys = STUDENT_EVENT_IMPORT_KEY_BY_LABEL) {
  const normalizedLabel = normalizeImportedStudentEventLabel(label);
  const knownKey = knownKeys.get(normalizedLabel);
  if (knownKey) return knownKey;
  let hash = 2166136261;
  for (let index = 0; index < normalizedLabel.length; index += 1) {
    hash = Math.imul(hash ^ normalizedLabel.charCodeAt(index), 16777619);
  }
  return `macro_${(hash >>> 0).toString(36)}`;
}

function parseMacroSettingLines(value) {
  return String(value || "")
    .split(/\u000b+|\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseMacroStudentEventTemplates(value) {
  const usedKeys = new Set();
  return parseMacroSettingLines(value).map((line) => {
    const [rawLabel, ...rawConditions] = line.split(";");
    const label = String(rawLabel || "").trim();
    if (!label) return null;
    let key = buildMacroSettingEventKey(label);
    if (usedKeys.has(key)) {
      let suffix = 2;
      while (usedKeys.has(`${key}_${suffix}`)) suffix += 1;
      key = `${key}_${suffix}`;
    }
    usedKeys.add(key);
    const includeTypes = [];
    const excludeTypes = [];
    rawConditions.forEach((condition) => {
      const token = String(condition || "").trim();
      const type = normalizeMacroSettingEventType(token.replace(/^[-–—]+/u, ""));
      if (!type) return;
      const target = /^[-–—]/u.test(token) ? excludeTypes : includeTypes;
      if (!target.includes(type)) target.push(type);
    });
    return { key, label, includeTypes, excludeTypes };
  }).filter(Boolean);
}

function parseMacroContractEventTemplates(value) {
  const usedKeys = new Set();
  return parseMacroSettingLines(value).map((label) => {
    let key = buildMacroSettingEventKey(label, CONTRACT_EVENT_IMPORT_KEY_BY_LABEL);
    if (usedKeys.has(key)) {
      let suffix = 2;
      while (usedKeys.has(`${key}_${suffix}`)) suffix += 1;
      key = `${key}_${suffix}`;
    }
    usedKeys.add(key);
    return { key, label };
  });
}

function parseMacroSettingsBlock(value) {
  const source = String(value || "");
  const lines = source.split(/\r?\n/u);
  const entries = new Map();
  const requestedKeys = new Set([
    "События",
    "СобытияКонтрагент",
    "Магазин_SQL",
    "Магазин_SQL_сервер",
    "Магазин_SQL_база",
    "Магазин_SQL_пароль",
    "Магазин_SQL_пользователь"
  ]);
  let currentKey = "";
  lines.forEach((line) => {
    const match = /^([^\s=]{1,100})=(.*)$/u.exec(line);
    const key = String(match?.[1] || "").trim();
    if (match) {
      currentKey = requestedKeys.has(key) ? key : "";
      if (currentKey) entries.set(currentKey, String(match[2] || ""));
      return;
    }
    if (!currentKey) return;
    entries.set(currentKey, `${entries.get(currentKey) || ""}\n${line}`);
  });
  return entries;
}

function parseStudentDatabaseMacroSettings(workbook) {
  const namedCell = getWorkbookNamedCell(workbook, "НастройкиМакросов");
  if (!namedCell) {
    return {
      macroSettings: {
        provided: false,
        studentEventTemplates: [],
        contractEventTemplates: []
      },
      macroSettingsSecret: {}
    };
  }
  const entries = parseMacroSettingsBlock(namedCell.value);
  const studentEventTemplates = parseMacroStudentEventTemplates(entries.get("События"));
  const contractEventTemplates = parseMacroContractEventTemplates(entries.get("СобытияКонтрагент"));
  return {
    macroSettings: {
      provided: true,
      namedRange: namedCell.name,
      studentEventTemplates,
      contractEventTemplates,
      applicationsSqlQuery: String(entries.get("Магазин_SQL") || "").replace(/\u000b+/gu, "\n").trim(),
      applicationsMysqlHost: String(entries.get("Магазин_SQL_сервер") || "").trim(),
      applicationsMysqlDatabase: String(entries.get("Магазин_SQL_база") || "").trim(),
      applicationsMysqlUser: String(entries.get("Магазин_SQL_пользователь") || "").trim()
    },
    macroSettingsSecret: {
      applicationsMysqlPassword: String(entries.get("Магазин_SQL_пароль") || "")
    }
  };
}

function normalizeAgentPaymentWorkbookRate(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(",", ".").trim());
  if (!Number.isFinite(number)) return null;
  const percent = Math.abs(number) <= 1 ? number * 100 : number;
  if (percent < 0 || percent > 100) return null;
  return Math.round(percent * 10000) / 10000;
}

function parseAgentPaymentRatesFromFormula(formula) {
  const source = String(formula || "").trim();
  if (!/VLOOKUP/iu.test(source)) return null;
  const percentMatch = /VLOOKUP[\s\S]*?<>\s*""\s*[,;]\s*(\d+(?:[.,]\d+)?)\s*%\s*[,;]\s*(\d+(?:[.,]\d+)?)\s*%/iu.exec(source);
  if (percentMatch) {
    const withAuthorPercent = Number(percentMatch[1].replace(",", "."));
    const withoutAuthorPercent = Number(percentMatch[2].replace(",", "."));
    if (
      Number.isFinite(withAuthorPercent)
      && Number.isFinite(withoutAuthorPercent)
      && withAuthorPercent >= 0
      && withAuthorPercent <= 100
      && withoutAuthorPercent >= 0
      && withoutAuthorPercent <= 100
    ) {
      return { withAuthorPercent, withoutAuthorPercent };
    }
  }
  const fractionMatch = /VLOOKUP[\s\S]*?<>\s*""\s*[,;]\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*[,;]\s*(0(?:\.\d+)?|1(?:\.0+)?)/iu.exec(source);
  if (!fractionMatch) return null;
  return {
    withAuthorPercent: Math.round(Number(fractionMatch[1]) * 1000000) / 10000,
    withoutAuthorPercent: Math.round(Number(fractionMatch[2]) * 1000000) / 10000
  };
}

function parseAgentPaymentDatabaseRates(workbook, worksheet, headerRowIndex, headers) {
  const namedRates = {};
  AGENT_PAYMENT_RATE_DEFINITIONS.forEach((definition) => {
    const namedCell = getWorkbookNamedCell(workbook, definition.definedName);
    const percent = normalizeAgentPaymentWorkbookRate(namedCell?.value);
    if (percent !== null) namedRates[definition.key] = percent;
  });

  let formulaRates = null;
  if (Object.keys(namedRates).length < AGENT_PAYMENT_RATE_DEFINITIONS.length) {
    const agentAmountColumn = headers.indexOf("АгентСумма");
    const usedRange = worksheet?.["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"]) : null;
    if (agentAmountColumn >= 0 && usedRange) {
      for (let rowIndex = headerRowIndex + 1; rowIndex <= usedRange.e.r; rowIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: agentAmountColumn });
        formulaRates = parseAgentPaymentRatesFromFormula(worksheet[address]?.f);
        if (formulaRates) break;
      }
    }
  }

  return {
    agentPaymentRates: sanitizeAgentPaymentRates({
      ...(formulaRates || {}),
      ...namedRates
    })
  };
}

function parseWorkbookNamedRangeReference(reference) {
  const source = String(reference || "").trim().replace(/^=/, "");
  const separatorIndex = source.lastIndexOf("!");
  if (separatorIndex < 0) return null;
  let sheetName = source.slice(0, separatorIndex).trim();
  if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
    sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
  }
  const addresses = source.slice(separatorIndex + 1).split(":")
    .map((address) => address.replace(/\$/g, "").trim().toUpperCase());
  if (
    addresses.length > 2
    || !addresses.every((address) => /^[A-Z]{1,3}[1-9]\d*$/.test(address))
  ) {
    return null;
  }
  const rangeAddress = addresses.length === 2
    ? `${addresses[0]}:${addresses[1]}`
    : addresses[0];
  try {
    return {
      sheetName,
      rangeAddress,
      range: XLSX.utils.decode_range(rangeAddress)
    };
  } catch {
    return null;
  }
}

function getWorkbookNamedRangeValues(workbook, names) {
  const requestedNames = (Array.isArray(names) ? names : [names])
    .map((name) => String(name || "").trim().toLocaleLowerCase("ru-RU"))
    .filter(Boolean);
  const namedRange = (workbook.Workbook?.Names || []).find((item) => (
    requestedNames.includes(String(item?.Name || "").trim().toLocaleLowerCase("ru-RU"))
  ));
  const reference = parseWorkbookNamedRangeReference(namedRange?.Ref);
  const worksheet = reference && workbook.Sheets[reference.sheetName];
  if (!namedRange || !reference || !worksheet) return null;
  const values = [];
  const seen = new Set();
  for (let row = reference.range.s.r; row <= reference.range.e.r; row += 1) {
    for (let column = reference.range.s.c; column <= reference.range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const value = String(worksheet[address]?.v ?? "").trim();
      const normalized = value.toLocaleLowerCase("ru-RU");
      if (!value || seen.has(normalized)) continue;
      seen.add(normalized);
      values.push(value);
    }
  }
  return {
    name: String(namedRange.Name || "").trim(),
    sheetName: reference.sheetName,
    rangeAddress: reference.rangeAddress,
    values
  };
}

function getSettingsColumnValuesByHeader(workbook, header) {
  const worksheet = workbook.Sheets["Настройки"];
  if (!worksheet?.["!ref"]) return [];
  const usedRange = XLSX.utils.decode_range(worksheet["!ref"]);
  let headerCell = null;
  for (let row = usedRange.s.r; row <= usedRange.e.r && !headerCell; row += 1) {
    for (let column = usedRange.s.c; column <= usedRange.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (String(worksheet[address]?.v ?? "").trim() === header) {
        headerCell = { row, column };
        break;
      }
    }
  }
  if (!headerCell) return [];
  const values = [];
  const seen = new Set();
  for (let row = headerCell.row + 1; row <= usedRange.e.r; row += 1) {
    const address = XLSX.utils.encode_cell({ r: row, c: headerCell.column });
    const value = String(worksheet[address]?.v ?? "").trim();
    const normalized = value.toLocaleLowerCase("ru-RU");
    if (!value || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(value);
  }
  return values;
}

function normalizePaymentDatabaseRate(value, percent = false) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number)) return null;
  const normalized = percent && Math.abs(number) <= 1 ? number * 100 : number;
  return Math.round(Math.max(0, normalized) / 10) * 10;
}

function isPaymentDatabaseConstantMarker(value) {
  const marker = String(value || "").trim();
  return marker.length <= 255
    && /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/u.test(marker)
    && !/^[A-Z]{1,3}[1-9]\d*$/i.test(marker)
    && !/^R[1-9]\d*C[1-9]\d*$/i.test(marker)
    && !/^[RC]$/i.test(marker);
}

function parsePaymentDatabaseSettings(workbook, onProgress = () => {}) {
  if (!workbook.Sheets["Настройки"]) {
    throw new Error("В файле не найден лист «Настройки».");
  }
  onProgress({ progress: 65, message: "Чтение ставок оплаты с листа «Настройки»..." });
  const paymentRates = {};
  const paymentConstants = [];
  const usedMarkers = new Set();
  const knownMarkers = new Set(PAYMENT_DATABASE_CONSTANT_DEFINITIONS.flatMap((definition) => (
    [definition.marker, ...(definition.legacyNames || [])]
      .map((marker) => marker.toLocaleLowerCase("ru-RU"))
  )));
  PAYMENT_DATABASE_CONSTANT_DEFINITIONS.forEach((definition) => {
    const namedCell = getWorkbookNamedCell(
      workbook,
      [definition.marker, ...(definition.legacyNames || [])]
    );
    const value = normalizePaymentDatabaseRate(namedCell?.value, definition.percent);
    if (value === null) return;
    paymentRates[definition.key] = value;
    if (definition.key === "authorRate") paymentRates.defaultAuthorPercent = value;
    const normalizedMarker = definition.marker.toLocaleLowerCase("ru-RU");
    usedMarkers.add(normalizedMarker);
    paymentConstants.push({
      key: definition.key,
      marker: definition.marker,
      value,
      custom: false
    });
  });
  (workbook.Workbook?.Names || []).forEach((namedRange) => {
    const marker = String(namedRange?.Name || "").trim();
    const normalizedMarker = marker.toLocaleLowerCase("ru-RU");
    if (
      !isPaymentDatabaseConstantMarker(marker)
      || knownMarkers.has(normalizedMarker)
      || usedMarkers.has(normalizedMarker)
    ) {
      return;
    }
    const reference = parseWorkbookNamedCellReference(namedRange.Ref);
    const isLegacyConstantCell = reference?.sheetName === "Настройки"
      && reference.column === "A"
      && reference.row >= 7;
    const isManagedConstantCell = reference?.sheetName === "Настройки"
      && reference.column === "AY"
      && reference.row >= 2;
    if (!isLegacyConstantCell && !isManagedConstantCell) return;
    const value = normalizePaymentDatabaseRate(
      workbook.Sheets[reference.sheetName]?.[reference.cellAddress]?.v
    );
    if (value === null) return;
    usedMarkers.add(normalizedMarker);
    paymentConstants.push({
      key: `xlsbPaymentConstant-${marker}`,
      marker,
      value,
      custom: true
    });
  });
  return {
    paymentRates,
    paymentConstants,
    paymentSettingsSheetName: "Настройки"
  };
}

function parseProgramDictionaryDatabaseSettings(workbook, onProgress = () => {}) {
  if (!workbook.Sheets["Настройки"]) {
    throw new Error("В файле не найден лист «Настройки».");
  }
  onProgress({ progress: 66, message: "Чтение списков программы с листа «Настройки»..." });
  const programDictionaries = {};
  const programDictionarySources = {};
  Object.entries(PROGRAM_DATABASE_DICTIONARY_RANGES).forEach(([dictionaryKey, definition]) => {
    const namedRange = getWorkbookNamedRangeValues(workbook, definition.names);
    const values = namedRange?.values?.length
      ? namedRange.values
      : getSettingsColumnValuesByHeader(workbook, definition.header);
    programDictionaries[dictionaryKey] = values;
    programDictionarySources[dictionaryKey] = namedRange?.rangeAddress || definition.header;
  });
  return {
    programDictionaries,
    programDictionarySources,
    programDictionarySheetName: "Настройки"
  };
}

function normalizeProgramDatabaseListValue(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item ?? "").split(/\r?\n|;\s*/u))
    .map((item) => item.trim())
    .filter(Boolean))]
    .join("\n");
}

function normalizeProgramDatabaseValue(fieldName, value) {
  if (fieldName === "programOrderDate") return normalizeStudentDatabaseDate(value);
  if (PROGRAM_DATABASE_NUMBER_FIELDS.has(fieldName)) {
    if (value === "" || value === null || value === undefined) return "";
    const number = Number(String(value).replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(number) ? number : String(value).trim();
  }
  if (PROGRAM_DATABASE_LIST_FIELDS.has(fieldName)) {
    return normalizeProgramDatabaseListValue(value);
  }
  return String(value ?? "").trim();
}

function getProgramDatabaseCommentText(worksheet, rowIndex, columnIndex) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  const comments = Array.isArray(worksheet?.[address]?.c) ? worksheet[address].c : [];
  return comments
    .map((comment) => String(comment?.t ?? "").replace(/\r\n?/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

function parseProgramPaymentDatabaseSheet(workbook, onProgress = () => {}) {
  const worksheet = workbook.Sheets["Реестр программ"];
  if (!worksheet) throw new Error("В файле не найден лист «Реестр программ».");
  onProgress({ progress: 67, message: "Чтение характеристик и настроек программ..." });
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: true,
    UTC: true
  });
  const programHeaders = new Set(["Наименование программы", "Программа", "Наименование"]);
  const headerRowIndex = rows.findIndex((row) => (
    row.some((value) => programHeaders.has(String(value || "").trim()))
    && row.some((value) => String(value || "").trim() === "Автор")
  ));
  if (headerRowIndex < 0) {
    throw new Error("На листе «Реестр программ» не найдены колонки программы и автора.");
  }
  const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
  const programColumn = headers.findIndex((header) => programHeaders.has(header));
  const landingCodeColumn = headers.indexOf("Код лендинга");
  const mappedColumns = headers
    .map((header, index) => ({
      index,
      fieldName: PROGRAM_DATABASE_COLUMN_MAP[header] || ""
    }))
    .filter((item) => item.fieldName);
  const programPaymentSettings = rows.slice(headerRowIndex + 1)
    .map((row, offset) => {
      const xlsbProgramRow = headerRowIndex + offset + 2;
      const name = String(row[programColumn] ?? "").trim();
      const record = {
        name,
        xlsbProgramName: name,
        xlsbProgramRow,
        xlsbProgramLandingCode: landingCodeColumn >= 0
          ? String(row[landingCodeColumn] ?? "").trim()
          : ""
      };
      mappedColumns.forEach(({ index, fieldName }) => {
        const value = PROGRAM_DATABASE_COMMENT_FIELDS.has(fieldName)
          ? getProgramDatabaseCommentText(worksheet, xlsbProgramRow - 1, index)
          : row[index];
        record[fieldName] = normalizeProgramDatabaseValue(fieldName, value);
      });
      return record;
    })
    .filter((item) => item.name);
  return {
    programPaymentSettings,
    programPaymentSheetName: "Реестр программ",
    programPaymentSourceRows: Math.max(0, rows.length - headerRowIndex - 1)
  };
}

function buildTrainingPlanDatabaseRecordId(record, rowNumber) {
  const fingerprint = [
    record.code,
    record.programName,
    record.discipline,
    rowNumber
  ].map((value) => String(value ?? "").trim()).join(":");
  const hash = crypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 16);
  return `training-plan-db-${hash}`;
}

function normalizeTrainingPlanDatabaseValue(fieldName, value) {
  if (TRAINING_PLAN_DATABASE_NUMBER_FIELDS.has(fieldName)) {
    if (value === "" || value === null || value === undefined) return "";
    return normalizeStudentDatabaseNumber(value);
  }
  if (fieldName === "code") return String(value ?? "").trim().replace(/\.0+$/, "");
  return String(value ?? "").trim();
}

function parseTrainingPlanDatabaseSheet(workbook, onProgress = () => {}) {
  const worksheet = workbook.Sheets["Учебные планы"];
  if (!worksheet) throw new Error("В файле не найден лист «Учебные планы».");
  onProgress({ progress: 70, message: "Чтение листа «Учебные планы»..." });
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: true,
    UTC: true
  });
  const headerRowIndex = rows.findIndex((row) => (
    row.some((value) => String(value || "").trim() === "Наименование программы")
    && row.some((value) => ["Дисциплины", "Дисциплина"].includes(String(value || "").trim()))
  ));
  if (headerRowIndex < 0) {
    throw new Error("На листе «Учебные планы» не найдены колонки программы и дисциплины.");
  }
  const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
  const mappedColumns = headers
    .map((header, index) => ({ index, fieldName: TRAINING_PLAN_DATABASE_COLUMN_MAP[header] || "" }))
    .filter((column) => column.fieldName);
  const sourceRows = Math.max(0, rows.length - headerRowIndex - 1);
  const trainingPlans = rows.slice(headerRowIndex + 1)
    .map((row, offset) => {
      const record = {};
      mappedColumns.forEach(({ index, fieldName }) => {
        record[fieldName] = normalizeTrainingPlanDatabaseValue(fieldName, row[index]);
      });
      const rowNumber = headerRowIndex + offset + 2;
      record.id = buildTrainingPlanDatabaseRecordId(record, rowNumber);
      record.xlsbTrainingPlanRow = rowNumber;
      return record;
    })
    .filter((record) => record.programName);
  return {
    trainingPlans,
    trainingPlanSheetName: "Учебные планы",
    trainingPlanSourceRows: sourceRows,
    trainingPlanSkippedRows: Math.max(0, sourceRows - trainingPlans.length)
  };
}

function parseDirectExpenseDatabaseSheet(workbook, onProgress = () => {}) {
  const worksheet = workbook.Sheets["Прямые затраты"];
  if (!worksheet) throw new Error("В файле не найден лист «Прямые затраты».");
  onProgress({ progress: 74, message: "Чтение листа «Прямые затраты»..." });
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
        progress: 76 + Math.floor((processedRows / Math.max(1, sourceRowCount)) * 18),
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

function parseGeneralExpenseDatabaseSheet(workbook, onProgress = () => {}) {
  const worksheet = workbook.Sheets["Общие затраты"];
  if (!worksheet) throw new Error("В файле не найден лист «Общие затраты».");
  onProgress({ progress: 96, message: "Чтение листа «Общие затраты»..." });
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true, UTC: true });
  const headerRowIndex = rows.findIndex((row) => (
    row.some((value) => String(value || "").trim() === "Контрагент")
    && row.some((value) => String(value || "").trim() === "Вид работ")
    && row.some((value) => String(value || "").trim() === "Сумма")
  ));
  if (headerRowIndex < 0) {
    throw new Error("На листе «Общие затраты» не найдены колонки Контрагент, Вид работ и Сумма.");
  }
  const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
  const mappedColumns = headers
    .map((header, index) => ({ index, fieldName: GENERAL_EXPENSE_DATABASE_COLUMN_MAP[header] || "" }))
    .filter((column) => column.fieldName);
  const counterpartyColumn = headers.indexOf("Контрагент");
  const workTypeColumn = headers.indexOf("Вид работ");
  const amountColumn = headers.indexOf("Сумма");
  const generalExpenses = [];
  const detectedSections = new Set();
  let currentSection = "";
  const sourceRowCount = Math.max(0, rows.length - headerRowIndex - 1);
  const progressStep = Math.max(1, Math.floor(sourceRowCount / 50));
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const processedRows = rowIndex - headerRowIndex;
    if (processedRows === 1 || processedRows % progressStep === 0 || processedRows === sourceRowCount) {
      onProgress({
        progress: 96 + Math.floor((processedRows / Math.max(1, sourceRowCount)) * 2),
        message: `Обработка общих затрат: ${processedRows} из ${sourceRowCount}`,
        processedRows,
        totalRows: sourceRowCount
      });
    }
    const row = rows[rowIndex] || [];
    const section = normalizeGeneralExpenseDatabaseSection(row[counterpartyColumn]);
    if (section) {
      currentSection = section;
      detectedSections.add(section);
      continue;
    }
    const counterparty = String(row[counterpartyColumn] ?? "").trim();
    const workType = String(row[workTypeColumn] ?? "").trim();
    const amount = normalizeStudentDatabaseNumber(row[amountColumn]);
    if (!counterparty || !workType || amount === "" || !Number.isFinite(Number(amount))) continue;
    if (!currentSection) {
      throw new Error(`На листе «Общие затраты» строка ${rowIndex + 1} находится вне разделов «Физлица» и «Организации».`);
    }
    const expense = { section: currentSection };
    mappedColumns.forEach((column) => {
      const value = normalizeGeneralExpenseDatabaseValue(row[column.index], column.fieldName);
      if (value === "") return;
      expense[column.fieldName] = value;
    });
    expense.id = buildGeneralExpenseDatabaseRecordId(expense, rowIndex + 1);
    expense.counterparty = counterparty;
    expense.workType = workType;
    expense.amount = Number(amount);
    generalExpenses.push(expense);
  }
  const missingSections = Object.values(GENERAL_EXPENSE_DATABASE_SECTIONS)
    .filter((section) => !detectedSections.has(section));
  if (missingSections.length) {
    throw new Error(`На листе «Общие затраты» не найдены разделы: ${missingSections.join(", ")}.`);
  }
  return {
    generalExpenses,
    generalExpenseSheetName: "Общие затраты",
    generalExpenseSourceRows: sourceRowCount,
    generalExpenseSectionCounts: Object.fromEntries(Object.values(GENERAL_EXPENSE_DATABASE_SECTIONS)
      .map((section) => [section, generalExpenses.filter((expense) => expense.section === section).length]))
  };
}

function parseContractDatabaseSheet(
  workbook,
  onProgress = () => {},
  eventTemplates = CONTRACT_EVENT_IMPORT_TEMPLATES,
  eventKeyByLabel = CONTRACT_EVENT_IMPORT_KEY_BY_LABEL
) {
  const worksheet = workbook.Sheets["Реестр договоров"];
  if (!worksheet) throw new Error("В файле не найден лист «Реестр договоров».");
  onProgress({ progress: 94, message: "Чтение листа «Реестр договоров»..." });
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: true,
    UTC: true,
    blankrows: true
  });
  const headerRowIndex = rows.findIndex((row) => (
    row.some((value) => String(value || "").trim() === "ФИО")
    && row.some((value) => String(value || "").trim() === "Договор")
    && row.some((value) => String(value || "").trim() === "Вид договора")
  ));
  if (headerRowIndex < 0) {
    throw new Error("На листе «Реестр договоров» не найдены колонки ФИО, Договор и Вид договора.");
  }
  const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
  const mappedColumns = headers
    .map((header, index) => ({ index, fieldName: CONTRACT_DATABASE_COLUMN_MAP[header] || "" }))
    .filter((column) => column.fieldName);
  const nameColumn = headers.indexOf("ФИО");
  const sectionRanges = findContractDatabaseSectionRanges(rows, nameColumn, headerRowIndex);
  const contracts = [];
  const sourceRowCount = Math.max(0, rows.length - headerRowIndex - 1);
  const progressStep = Math.max(1, Math.floor(sourceRowCount / 40));
  let sectionRangeIndex = 0;
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const processedRows = rowIndex - headerRowIndex;
    if (processedRows === 1 || processedRows % progressStep === 0 || processedRows === sourceRowCount) {
      onProgress({
        progress: 94 + Math.floor((processedRows / Math.max(1, sourceRowCount)) * 2),
        message: `Обработка договоров: ${processedRows} из ${sourceRowCount}`,
        processedRows,
        totalRows: sourceRowCount
      });
    }
    const row = rows[rowIndex] || [];
    while (
      sectionRangeIndex + 1 < sectionRanges.length
      && rowIndex >= sectionRanges[sectionRangeIndex + 1].headingRowIndex
    ) {
      sectionRangeIndex += 1;
    }
    const sectionRange = sectionRanges[sectionRangeIndex];
    if (
      !sectionRange
      || rowIndex < sectionRange.firstDataRowIndex
      || rowIndex >= sectionRange.endRowIndex
    ) continue;
    const name = String(row[nameColumn] ?? "").trim();
    const hasSourceData = mappedColumns.some((column) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: column.index })];
      if (cell?.f || cell?.F) return false;
      return normalizeContractDatabaseValue(row[column.index], column.fieldName) !== "";
    });
    if (!hasSourceData) continue;
    const contract = { section: sectionRange.section };
    mappedColumns.forEach((column) => {
      const value = normalizeContractDatabaseValue(row[column.index], column.fieldName);
      if (value === "") return;
      contract[column.fieldName] = value;
    });
    Object.assign(contract, parseContractEventSettings(
      contract.additionalSettings,
      eventTemplates,
      eventKeyByLabel
    ));
    contract.id = buildContractDatabaseRecordId(contract, rowIndex + 1);
    contract.name = name;
    contract.status = sectionRange.section === CONTRACT_DATABASE_SECTIONS.active
      ? "Действует"
      : sectionRange.section === CONTRACT_DATABASE_SECTIONS.partners
        ? "Партнерская программа"
        : "Истек";
    contracts.push(contract);
  }
  return {
    contracts,
    contractSheetName: "Реестр договоров",
    contractSourceRows: sourceRowCount,
    contractSectionRows: Object.fromEntries(sectionRanges
      .map((range) => [range.section, range.headingRowIndex + 1])),
    contractSectionCounts: Object.fromEntries(Object.values(CONTRACT_DATABASE_SECTIONS)
      .map((section) => [section, contracts.filter((contract) => contract.section === section).length]))
  };
}

function normalizeInventoryDatabaseValue(value, fieldName) {
  if (fieldName === "date") return normalizeStudentDatabaseDate(value);
  if (fieldName === "amount") return normalizeStudentDatabaseNumber(value);
  if (fieldName === "uid") return String(value ?? "").trim().replace(/\.0+$/, "");
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return value;
}

function normalizeInventoryLookupValue(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function buildInventoryDatabaseRecordId(itemType) {
  const hash = crypto.createHash("sha1")
    .update(normalizeInventoryLookupValue(itemType))
    .digest("hex")
    .slice(0, 16);
  return `inventory-db-${hash}`;
}

function buildInventoryGeneratedExpenseId(unit) {
  const fingerprint = [
    unit.uid,
    unit.date,
    unit.itemType,
    unit.amount,
    unit.note,
    unit.sourceRow
  ].map((value) => String(value ?? "").trim()).join(":");
  const hash = crypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 16);
  return `direct-expense-inventory-${hash}`;
}

function parseInventoryDatabaseSheet(workbook, onProgress = () => {}) {
  const worksheet = workbook.Sheets["Запасы"];
  if (!worksheet) throw new Error("В файле не найден лист «Запасы».");
  onProgress({ progress: 66, message: "Чтение листа «Запасы»..." });
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true, UTC: true });
  const headerRowIndex = rows.findIndex((row) => (
    row.some((value) => String(value || "").trim() === "Вид ТМЦ")
    && row.some((value) => String(value || "").trim() === "Сумма")
    && row.some((value) => String(value || "").trim() === "uid")
  ));
  if (headerRowIndex < 0) {
    throw new Error("На листе «Запасы» не найдены колонки Вид ТМЦ, Сумма и uid.");
  }
  const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
  const mappedColumns = headers
    .map((header, index) => ({ index, fieldName: INVENTORY_DATABASE_COLUMN_MAP[header] || "" }))
    .filter((column) => column.fieldName);
  const itemTypeColumn = headers.indexOf("Вид ТМЦ");
  const inventoryUnits = [];
  const sourceRowCount = Math.max(0, rows.length - headerRowIndex - 1);
  const progressStep = Math.max(1, Math.floor(sourceRowCount / 100));
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const processedRows = rowIndex - headerRowIndex;
    if (processedRows === 1 || processedRows % progressStep === 0 || processedRows === sourceRowCount) {
      onProgress({
        progress: 67 + Math.floor((processedRows / Math.max(1, sourceRowCount)) * 5),
        message: `Обработка запасов: ${processedRows} из ${sourceRowCount}`,
        processedRows,
        totalRows: sourceRowCount
      });
    }
    const row = rows[rowIndex] || [];
    const itemType = String(row[itemTypeColumn] ?? "").trim();
    if (!itemType) continue;
    const unit = { sourceRow: rowIndex + 1 };
    mappedColumns.forEach((column) => {
      const value = normalizeInventoryDatabaseValue(row[column.index], column.fieldName);
      if (value === "") return;
      unit[column.fieldName] = value;
    });
    unit.itemType = itemType;
    unit.uid = String(unit.uid || "").trim();
    unit.amount = unit.amount === "" || unit.amount === undefined ? "" : Number(unit.amount);
    inventoryUnits.push(unit);
  }
  if (!inventoryUnits.length) {
    throw new Error("На листе «Запасы» не найдено ни одной позиции.");
  }

  const unitsByType = new Map();
  inventoryUnits.forEach((unit) => {
    const key = normalizeInventoryLookupValue(unit.itemType);
    if (!unitsByType.has(key)) unitsByType.set(key, []);
    unitsByType.get(key).push(unit);
  });
  const inventory = [...unitsByType.values()]
    .map((units) => {
      const availableUnits = units.filter((unit) => !unit.uid);
      const representativeUnits = availableUnits.length ? availableUnits : units;
      const representative = [...representativeUnits].reverse().find((unit) => (
        unit.date || unit.amount !== "" || unit.note
      )) || representativeUnits[representativeUnits.length - 1];
      const id = buildInventoryDatabaseRecordId(units[0].itemType);
      units.forEach((unit) => {
        unit.inventoryId = id;
      });
      return {
        id,
        date: representative?.date || "",
        itemType: units[0].itemType,
        amount: representative?.amount === "" || representative?.amount === undefined
          ? 0
          : Number(representative.amount),
        note: representative?.note || "",
        uid: "",
        balance: availableUnits.length
      };
    })
    .sort((left, right) => left.itemType.localeCompare(right.itemType, "ru", {
      numeric: true,
      sensitivity: "base"
    }));

  return {
    inventory,
    inventoryUnits,
    inventorySheetName: "Запасы",
    inventorySourceRows: sourceRowCount,
    inventorySkippedRows: Math.max(0, sourceRowCount - inventoryUnits.length),
    inventoryUnitCount: inventoryUnits.length,
    inventoryAvailableUnitCount: inventoryUnits.filter((unit) => !unit.uid).length,
    inventoryAllocatedUnitCount: inventoryUnits.filter((unit) => unit.uid).length
  };
}

function getInventoryExpenseGroupKey(uid, itemType) {
  return [
    String(uid || "").trim().replace(/\.0+$/, ""),
    normalizeInventoryLookupValue(itemType)
  ].join("|");
}

function getInventoryExpenseMatchScore(expense, unit) {
  let score = String(expense.inventoryLink || "").trim() ? 100 : 0;
  if (
    unit.amount !== ""
    && unit.amount !== undefined
    && expense.amount !== ""
    && expense.amount !== undefined
    && Number(unit.amount) === Number(expense.amount)
  ) {
    score += 10;
  }
  if (normalizeInventoryLookupValue(unit.note) === normalizeInventoryLookupValue(expense.note)) score += 5;
  if (unit.date && unit.date === expense.date) score += 1;
  return score;
}

function linkInventoryToDirectExpenses(inventory, inventoryUnits, directExpenses) {
  const inventoryById = new Map(inventory.map((item) => [String(item.id), item]));
  const expenses = directExpenses.map((expense) => ({ ...expense }));
  const expenseIndexesByGroup = new Map();
  expenses.forEach((expense, index) => {
    const key = getInventoryExpenseGroupKey(expense.uid, expense.type);
    if (!expenseIndexesByGroup.has(key)) expenseIndexesByGroup.set(key, []);
    expenseIndexesByGroup.get(key).push(index);
  });
  const usedExpenseIndexes = new Set();
  let inventoryMatchedExpenseCount = 0;
  let inventoryGeneratedExpenseCount = 0;

  inventoryUnits.filter((unit) => unit.uid).forEach((unit) => {
    const inventoryItem = inventoryById.get(String(unit.inventoryId));
    if (!inventoryItem) return;
    const groupKey = getInventoryExpenseGroupKey(unit.uid, unit.itemType);
    const candidateIndexes = (expenseIndexesByGroup.get(groupKey) || [])
      .filter((index) => !usedExpenseIndexes.has(index));
    const matchedIndex = candidateIndexes.reduce((bestIndex, index) => {
      if (bestIndex < 0) return index;
      return getInventoryExpenseMatchScore(expenses[index], unit)
        > getInventoryExpenseMatchScore(expenses[bestIndex], unit)
        ? index
        : bestIndex;
    }, -1);

    if (matchedIndex >= 0) {
      usedExpenseIndexes.add(matchedIndex);
      expenses[matchedIndex].type = inventoryItem.itemType;
      expenses[matchedIndex].inventoryId = inventoryItem.id;
      expenses[matchedIndex].inventoryLink = inventoryItem.itemType;
      inventoryMatchedExpenseCount += 1;
      return;
    }

    expenses.push({
      id: buildInventoryGeneratedExpenseId(unit),
      uid: unit.uid,
      date: unit.date || "",
      type: inventoryItem.itemType,
      amount: unit.amount === "" || unit.amount === undefined ? 0 : Number(unit.amount),
      note: unit.note || "",
      inventoryId: inventoryItem.id,
      inventoryLink: inventoryItem.itemType
    });
    inventoryGeneratedExpenseCount += 1;
  });

  const inventoryUnmatchedExpenseCount = expenses.filter((expense) => (
    String(expense.inventoryLink || "").trim()
    && !String(expense.inventoryId || "").trim()
    && inventory.some((item) => (
      normalizeInventoryLookupValue(item.itemType) === normalizeInventoryLookupValue(expense.type)
    ))
  )).length;

  return {
    directExpenses: expenses,
    inventoryLinkedExpenseCount: inventoryMatchedExpenseCount + inventoryGeneratedExpenseCount,
    inventoryMatchedExpenseCount,
    inventoryGeneratedExpenseCount,
    inventoryUnmatchedExpenseCount
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

function getStudentDatabaseRowHeight(worksheet, rowIndex) {
  const rowSettings = worksheet?.["!rows"]?.[rowIndex];
  return Number(rowSettings?.hpt || rowSettings?.hpx || 0);
}

function detectStudentDatabaseSections(worksheet, rows, headerRowIndex, uidColumn, nameColumn) {
  const candidates = [];
  let firstStudentRowIndex = -1;
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const uid = String(row[uidColumn] ?? "").trim().replace(/\.0+$/, "");
    const name = String(row[nameColumn] ?? "").trim();
    if (uid && name && firstStudentRowIndex < 0) firstStudentRowIndex = rowIndex;
    if (!uid && name) {
      candidates.push({
        rowIndex,
        title: name,
        height: getStudentDatabaseRowHeight(worksheet, rowIndex)
      });
    }
  }
  if (firstStudentRowIndex < 0) return [];

  const firstSection = candidates
    .filter((candidate) => (
      candidate.rowIndex < firstStudentRowIndex
      && candidate.height >= 17
    ))
    .at(-1);
  if (!firstSection) return [];

  const lastSection = candidates
    .filter((candidate) => (
      candidate.rowIndex >= firstSection.rowIndex
      && candidate.height >= 17
    ))
    .at(-1);
  if (!lastSection) return [];

  return candidates.filter((candidate) => (
    candidate.rowIndex >= firstSection.rowIndex
    && candidate.rowIndex <= lastSection.rowIndex
  ));
}

function parseStudentDatabaseWorkbook(bytes, onProgress = () => {}) {
  let workbook;
  onProgress({ progress: 0, message: "Чтение структуры XLSB..." });
  try {
    workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  } catch (error) {
    throw new Error(`Не удалось прочитать базу Excel: ${error.message}`);
  }
  const macroSettingsResult = parseStudentDatabaseMacroSettings(workbook);
  const studentEventImportTemplates = macroSettingsResult.macroSettings.studentEventTemplates.length
    ? macroSettingsResult.macroSettings.studentEventTemplates
    : STUDENT_EVENT_IMPORT_TEMPLATES;
  const contractEventImportTemplates = macroSettingsResult.macroSettings.contractEventTemplates.length
    ? macroSettingsResult.macroSettings.contractEventTemplates
    : CONTRACT_EVENT_IMPORT_TEMPLATES;
  const studentEventImportKeyByLabel = new Map([
    ...STUDENT_EVENT_IMPORT_KEY_BY_LABEL,
    ...studentEventImportTemplates.map((event) => [normalizeImportedStudentEventLabel(event.label), event.key])
  ]);
  const contractEventImportKeyByLabel = new Map([
    ...CONTRACT_EVENT_IMPORT_KEY_BY_LABEL,
    ...contractEventImportTemplates.map((event) => [normalizeImportedStudentEventLabel(event.label), event.key])
  ]);
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
  const studentSections = detectStudentDatabaseSections(
    worksheet,
    rows,
    headerRowIndex,
    uidColumn,
    nameColumn
  );
  let currentSectionIndex = -1;
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
    while (
      currentSectionIndex + 1 < studentSections.length
      && studentSections[currentSectionIndex + 1].rowIndex <= rowIndex
    ) {
      currentSectionIndex += 1;
    }
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
      Object.assign(student, parseStudentEventSettings(
        row[eventSettingsColumn],
        studentEventImportTemplates,
        studentEventImportKeyByLabel
      ));
    }
    const baseId = buildStudentDatabaseRecordId(uid, rowIndex + 1);
    const duplicateNumber = (usedIds.get(baseId) || 0) + 1;
    usedIds.set(baseId, duplicateNumber);
    student.id = duplicateNumber === 1 ? baseId : `${baseId}-${duplicateNumber}`;
    student.uid = uid;
    student.name = name;
    student.additionalStatus = studentSections[currentSectionIndex]?.title
      || DEFAULT_STUDENT_ADDITIONAL_STATUS;
    if (student.enrollmentDate) student.enrollmentOrderDate = student.enrollmentDate;
    if (student.expulsionDate) student.expulsionOrderDate = student.expulsionDate;
    students.push(student);
  }
  if (!students.length) throw new Error("На листе «База» не найдено ни одного слушателя с uid и ФИО.");
  const agentPaymentRatesResult = parseAgentPaymentDatabaseRates(
    workbook,
    worksheet,
    headerRowIndex,
    headers
  );
  const paymentSettingsResult = parsePaymentDatabaseSettings(workbook, onProgress);
  const programDictionaryResult = parseProgramDictionaryDatabaseSettings(workbook, onProgress);
  const programPaymentResult = parseProgramPaymentDatabaseSheet(workbook, onProgress);
  const trainingPlanResult = parseTrainingPlanDatabaseSheet(workbook, onProgress);
  const inventoryResult = parseInventoryDatabaseSheet(workbook, onProgress);
  const directExpenseResult = parseDirectExpenseDatabaseSheet(workbook, onProgress);
  const contractResult = parseContractDatabaseSheet(
    workbook,
    onProgress,
    contractEventImportTemplates,
    contractEventImportKeyByLabel
  );
  const generalExpenseResult = parseGeneralExpenseDatabaseSheet(workbook, onProgress);
  onProgress({ progress: 98, message: "Сопоставление запасов с расходами..." });
  const inventoryLinkResult = linkInventoryToDirectExpenses(
    inventoryResult.inventory,
    inventoryResult.inventoryUnits,
    directExpenseResult.directExpenses
  );
  onProgress({ progress: 99, message: "Привязка прямых затрат к слушателям..." });
  const {
    unlinkedDirectExpenses,
    linkedDirectExpenseCount,
    totalDirectExpenseCount
  } = attachDirectExpensesToStudents(students, inventoryLinkResult.directExpenses);
  onProgress({ progress: 100, message: "Обработка базы завершена." });
  return {
    students,
    sheetName: "База",
    studentSectionTitles: studentSections.map((section) => section.title),
    sourceRows: sourceRowCount,
    skippedRows: Math.max(0, sourceRowCount - students.length),
    ...agentPaymentRatesResult,
    ...paymentSettingsResult,
    ...programDictionaryResult,
    ...programPaymentResult,
    ...trainingPlanResult,
    ...directExpenseResult,
    ...generalExpenseResult,
    ...contractResult,
    ...macroSettingsResult,
    inventory: inventoryResult.inventory,
    inventorySheetName: inventoryResult.inventorySheetName,
    inventorySourceRows: inventoryResult.inventorySourceRows,
    inventorySkippedRows: inventoryResult.inventorySkippedRows,
    inventoryUnitCount: inventoryResult.inventoryUnitCount,
    inventoryAvailableUnitCount: inventoryResult.inventoryAvailableUnitCount,
    inventoryAllocatedUnitCount: inventoryResult.inventoryAllocatedUnitCount,
    inventoryLinkedExpenseCount: inventoryLinkResult.inventoryLinkedExpenseCount,
    inventoryMatchedExpenseCount: inventoryLinkResult.inventoryMatchedExpenseCount,
    inventoryGeneratedExpenseCount: inventoryLinkResult.inventoryGeneratedExpenseCount,
    inventoryUnmatchedExpenseCount: inventoryLinkResult.inventoryUnmatchedExpenseCount,
    directExpenses: unlinkedDirectExpenses,
    linkedDirectExpenseCount,
    totalDirectExpenseCount
  };
}

function normalizeStudentDatabaseSource(value) {
  const source = String(value || "webdav").trim().toLowerCase();
  if (!["webdav", "local"].includes(source)) {
    throw new Error("Указан неподдерживаемый источник базы слушателей.");
  }
  return source;
}

function getStudentDatabaseSourceSetting(databasePath) {
  const source = String(
    databasePath
    || serverSettings.studentDatabaseWebDavPath
    || DEFAULT_STUDENT_DATABASE_WEBDAV_PATH
  ).trim();
  if (!source) throw new Error("Не указан WebDAV-путь или ссылка на базу слушателей.");
  return source;
}

function resolveLocalStudentDatabaseFile(databasePath) {
  const source = getStudentDatabaseSourceSetting(databasePath);
  const configuredPath = normalizeYandexDiskResourceSetting(source);
  if (!configuredPath || /^https?:/i.test(configuredPath)) {
    throw new Error("Для работы с локального диска укажите WebDAV-путь к базе в настройках подключения.");
  }
  const localPath = resolveLocalDocumentsPath(
    configuredPath,
    "Не удалось определить локальный путь к базе слушателей."
  );
  if (path.extname(localPath).toLowerCase() !== ".xlsb") {
    throw new Error("Локальная база слушателей должна быть файлом XLSB.");
  }
  return localPath;
}

async function loadStudentDatabaseBytes(databasePath, onProgress = null, options = {}) {
  const source = getStudentDatabaseSourceSetting(databasePath);
  const sourceType = normalizeStudentDatabaseSource(options.source);
  if (sourceType === "local") {
    const localPath = resolveLocalStudentDatabaseFile(source);
    let fileStats;
    try {
      fileStats = await fs.stat(localPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Локальная база не найдена: ${localPath}`);
      }
      throw error;
    }
    if (!fileStats.isFile()) throw new Error(`Локальный путь не является файлом: ${localPath}`);
    if (!fileStats.size) throw new Error("Локальный файл базы пуст.");
    if (fileStats.size > MAX_STUDENT_DATABASE_BYTES) {
      throw new Error("Файл базы превышает допустимый размер 24 МБ.");
    }
    const bytes = await fs.readFile(localPath);
    onProgress?.({ receivedBytes: bytes.length, totalBytes: fileStats.size });
    return bytes;
  }
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

function countGeneralExpenseWorksheetRecords(worksheet) {
  if (!worksheet) return 0;
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true
  });
  let sectionFound = false;
  let count = 0;
  rows.forEach((row) => {
    if (normalizeGeneralExpenseDatabaseSection(row[0])) {
      sectionFound = true;
      return;
    }
    if (!sectionFound) return;
    const hasRecord = [row[0], row[2], row[4]]
      .some((value) => String(value ?? "").trim() !== "");
    if (hasRecord) count += 1;
  });
  return count;
}

function countContractWorksheetRecords(worksheet) {
  if (!worksheet) return 0;
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true
  });
  const headerRowIndex = rows.findIndex((row) => (
    row.some((value) => String(value || "").trim() === "ФИО")
    && row.some((value) => String(value || "").trim() === "Договор")
    && row.some((value) => String(value || "").trim() === "Вид договора")
  ));
  if (headerRowIndex < 0) return 0;
  const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
  const mappedColumns = headers
    .map((header, index) => ({ index, fieldName: CONTRACT_DATABASE_COLUMN_MAP[header] || "" }))
    .filter((column) => column.fieldName);
  const nameColumn = headers.indexOf("ФИО");
  const sectionRanges = findContractDatabaseSectionRanges(rows, nameColumn, headerRowIndex);
  let count = 0;
  sectionRanges.forEach((range) => {
    for (let rowIndex = range.firstDataRowIndex; rowIndex < range.endRowIndex; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const hasSourceData = mappedColumns.some((column) => {
        const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: column.index })];
        if (cell?.f || cell?.F) return false;
        return normalizeContractDatabaseValue(row[column.index], column.fieldName) !== "";
      });
      if (hasSourceData) count += 1;
    }
  });
  return count;
}

function inspectStudentDatabaseBinary(bytes) {
  const workbook = XLSX.read(bytes, { type: "buffer", bookVBA: true });
  const baseSheet = workbook.Sheets["База"];
  const directExpenseSheet = workbook.Sheets["Прямые затраты"];
  const generalExpenseSheet = workbook.Sheets["Общие затраты"];
  const contractSheet = workbook.Sheets["Реестр договоров"];
  if (!baseSheet) throw new Error("В файле не найден лист «База».");
  if (!directExpenseSheet) throw new Error("В файле не найден лист «Прямые затраты».");
  if (!generalExpenseSheet) throw new Error("В файле не найден лист «Общие затраты».");
  if (!contractSheet) throw new Error("В файле не найден лист «Реестр договоров».");
  return {
    hasVba: Boolean(workbook.vbaraw?.length),
    vbaBytes: Number(workbook.vbaraw?.length || 0),
    baseFormulaCount: countWorksheetFormulaCells(baseSheet),
    directExpenseFormulaCount: countWorksheetFormulaCells(directExpenseSheet),
    generalExpenseFormulaCount: countWorksheetFormulaCells(generalExpenseSheet),
    generalExpenseRecordCount: countGeneralExpenseWorksheetRecords(generalExpenseSheet),
    contractFormulaCount: countWorksheetFormulaCells(contractSheet),
    contractRecordCount: countContractWorksheetRecords(contractSheet)
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

async function runStudentApplicationsQuery(filters) {
  const pool = await getStudentApplicationsMySqlPool();
  if (!pool) throw new Error("Не настроено подключение к базе заявок.");
  const dateToExclusive = new Date(`${filters.dateTo}T00:00:00Z`);
  dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
  const parameterValues = [filters.dateFrom, dateToExclusive.toISOString().slice(0, 10)];
  let query = getStudentApplicationsSqlQuery();
  const programFilters = Array.isArray(filters.programs) ? filters.programs : [];
  if (programFilters.length) {
    const clauses = [];
    programFilters.forEach((program) => {
      if (program.productId && program.programName) {
        clauses.push("(source_product_id = ? OR `Программа` LIKE ?)");
        parameterValues.push(program.productId, `%${program.programName}%`);
      } else if (program.productId) {
        clauses.push("source_product_id = ?");
        parameterValues.push(program.productId);
      } else if (program.programName) {
        clauses.push("`Программа` LIKE ?");
        parameterValues.push(`%${program.programName}%`);
      }
    });
    if (clauses.length) query += ` AND (${clauses.join(" OR ")})`;
  }
  if (filters.onlyPaid) query += " AND source_is_paid = 1";
  query += " ORDER BY source_order_id DESC, source_line_item_id LIMIT 5000";
  try {
    const [databaseRows] = await pool.execute({ sql: query, timeout: 15000 }, parameterValues);
    const rows = (Array.isArray(databaseRows) ? databaseRows : []).map((row) => {
      const orderId = String(row.source_order_id ?? "").trim();
      const lineItemId = String(row.source_line_item_id ?? "").trim();
      const dateCreated = String(row.date_created ?? "").trim().replace(" ", "T");
      return {
        id: `${orderId}-${lineItemId}`,
        date: String(row["Дата"] ?? ""),
        dateCreated,
        name: String(row["ФИО"] ?? ""),
        order: String(row["Заказ (оплата)"] ?? ""),
        orderId,
        program: String(row["Программа"] ?? ""),
        productId: String(row.source_product_id ?? ""),
        phone: String(row["Телефон"] ?? ""),
        email: String(row.Email ?? ""),
        city: String(row["Город"] ?? ""),
        organization: String(row["Организация"] ?? ""),
        position: String(row["Должность"] ?? ""),
        source: String(row["Источник"] ?? ""),
        coupon: String(row.source_coupon ?? ""),
        note: String(row["Примечание"] ?? ""),
        paid: Number(row.source_is_paid || 0) === 1,
        paymentAmount: Number(row.source_payment_amount || 0) || 0
      };
    });
    return { rows, total: rows.length, truncated: rows.length >= 5000 };
  } catch (error) {
    if (isMySqlConnectivityError(error)) await closeStudentApplicationsMySqlStorage();
    if (["PROTOCOL_SEQUENCE_TIMEOUT", "ETIMEDOUT"].includes(String(error?.code || "").toUpperCase())) {
      throw new Error("SQL-запрос интернет-магазина выполняется дольше 15 секунд. Уточните период или проверьте индексы базы.");
    }
    throw error;
  }
}

function normalizeMailboxId(value, fallback = "mailbox") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalized || fallback;
}

function normalizeMailboxPort(value, fallback) {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function getStudentMailboxRoleLabel(login, fallback = "Почтовый ящик") {
  const normalizedLogin = String(login || "").trim().toLowerCase();
  if (normalizedLogin === DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN) {
    return "Документы слушателей и заявки InSales";
  }
  if (normalizedLogin === DEFAULT_WOOCOMMERCE_EMAIL_LOGIN) {
    return "Заявки WooCommerce";
  }
  return String(fallback || login || "Почтовый ящик").trim();
}

function normalizeStudentDocumentMailbox(value = {}, fallbackId = "mailbox") {
  const host = String(value.host || value.imapHost || "").trim().slice(0, 255);
  const smtpHost = String(
    value.smtpHost || host.replace(/^imap(?=\.)/i, "smtp") || ""
  ).trim().slice(0, 255);
  const login = String(value.login || "").trim().slice(0, 320);
  return {
    id: normalizeMailboxId(value.id, fallbackId),
    label: String(value.label || login || "Почтовый ящик").trim().slice(0, 160),
    host,
    port: normalizeMailboxPort(value.port || value.imapPort, 993),
    secure: value.secure !== false,
    smtpHost,
    smtpPort: normalizeMailboxPort(value.smtpPort, 465),
    smtpSecure: value.smtpSecure !== false,
    login,
    password: String(value.password || "").slice(0, 1024)
  };
}

function getStudentDocumentMailboxes({ includePrimary = true } = {}) {
  const result = [];
  if (includePrimary) {
    const primary = getStudentApplicationsEmailSettings();
    if (primary.login || primary.host) {
      result.push(normalizeStudentDocumentMailbox({
        id: "applications",
        label: getStudentMailboxRoleLabel(primary.login, "Основной почтовый ящик"),
        host: primary.host,
        port: primary.port,
        smtpHost: primary.smtpHost,
        smtpPort: primary.smtpPort,
        login: primary.login,
        password: primary.password
      }, "applications"));
    }
  }
  const seen = new Set(result.map((mailbox) => mailbox.id));
  (Array.isArray(serverSettings.studentDocumentMailboxes)
    ? serverSettings.studentDocumentMailboxes
    : []).forEach((value, index) => {
    const mailbox = normalizeStudentDocumentMailbox(value, `mailbox-${index + 1}`);
    mailbox.label = getStudentMailboxRoleLabel(mailbox.login, mailbox.label);
    let id = mailbox.id;
    let suffix = 2;
    while (seen.has(id)) id = `${mailbox.id}-${suffix++}`;
    seen.add(id);
    result.push({ ...mailbox, id });
  });
  return result;
}

function publicStudentDocumentMailboxes() {
  return getStudentDocumentMailboxes().map(({ password, ...mailbox }) => ({
    ...mailbox,
    hasPassword: Boolean(password)
  }));
}

function getStudentDocumentMailboxSettings(mailboxId) {
  const requestedId = normalizeMailboxId(mailboxId, "applications");
  const mailbox = getStudentDocumentMailboxes().find((item) => item.id === requestedId);
  if (!mailbox) throw new Error("Выбранный почтовый ящик не найден в настройках.");
  if (!mailbox.host || !mailbox.login || !mailbox.password) {
    throw new Error(`Почтовый ящик «${mailbox.label}» настроен не полностью.`);
  }
  return mailbox;
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
  const smtpHost = String(
    serverSettings.studentApplicationsEmailSmtpHost
      || process.env.STUDENT_APPLICATIONS_EMAIL_SMTP_HOST
      || host.replace(/^imap(?=\.)/i, "smtp")
      || ""
  ).trim();
  const smtpPort = Number(
    serverSettings.studentApplicationsEmailSmtpPort
      || process.env.STUDENT_APPLICATIONS_EMAIL_SMTP_PORT
      || 465
  );
  return {
    host,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 993,
    smtpHost,
    smtpPort: Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535 ? smtpPort : 465,
    login,
    password
  };
}

function hasStudentApplicationsEmailSettings() {
  return getStudentApplicationsMailboxes().length > 0;
}

function getStudentApplicationsMailboxes() {
  const seen = new Set();
  return getStudentDocumentMailboxes().filter((mailbox) => {
    if (!mailbox.host || !mailbox.login || !mailbox.password) return false;
    const key = [mailbox.host, mailbox.port, mailbox.login]
      .map((value) => String(value || "").trim().toLowerCase())
      .join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createSmtpResponseReader(socket) {
  let buffer = "";
  let pending = null;
  let closedError = null;

  const readResponse = () => {
    const lines = buffer.split("\r\n");
    if (lines.length < 2) return null;
    const firstMatch = /^(\d{3})([ -])/.exec(lines[0]);
    if (!firstMatch) throw new Error("SMTP-сервер вернул некорректный ответ.");
    const code = Number(firstMatch[1]);
    let lastLineIndex = firstMatch[2] === " " ? 0 : -1;
    if (lastLineIndex < 0) {
      for (let index = 1; index < lines.length - 1; index += 1) {
        if (lines[index].startsWith(`${firstMatch[1]} `)) {
          lastLineIndex = index;
          break;
        }
      }
    }
    if (lastLineIndex < 0) return null;
    const responseLines = lines.slice(0, lastLineIndex + 1);
    buffer = lines.slice(lastLineIndex + 1).join("\r\n");
    return {
      code,
      message: responseLines.join("\n")
    };
  };

  const checkPending = () => {
    if (!pending) return;
    let response;
    try {
      response = readResponse();
    } catch (error) {
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      current.reject(error);
      return;
    }
    if (!response) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.resolve(response);
  };

  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) {
      socket.destroy(new Error("Ответ SMTP-сервера превышает допустимый размер."));
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
    closedError ||= new Error("SMTP-сервер закрыл соединение.");
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.reject(closedError);
  });

  return {
    waitForResponse(timeout = 30000) {
      if (pending) return Promise.reject(new Error("Предыдущая команда SMTP ещё не завершена."));
      if (closedError) return Promise.reject(closedError);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending) return;
          pending = null;
          reject(new Error("SMTP-сервер не ответил вовремя."));
          socket.destroy();
        }, timeout);
        pending = { resolve, reject, timer };
        checkPending();
      });
    }
  };
}

function assertSmtpResponse(response, expectedCodes, action) {
  const codes = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
  if (codes.includes(response.code)) return response;
  throw new Error(`${action}: ${response.message || `код SMTP ${response.code}`}`);
}

async function runAuthenticatedSmtpSession(action) {
  const settings = getStudentApplicationsEmailSettings();
  if (!settings.smtpHost || !settings.login || !settings.password) {
    throw new Error("В админке не настроен SMTP для исходящей почты.");
  }
  const trustedCertificates = typeof tls.getCACertificates === "function"
    ? [
      ...tls.getCACertificates("default"),
      ...tls.getCACertificates("system")
    ]
    : [];
  const socket = tls.connect({
    host: settings.smtpHost,
    port: settings.smtpPort,
    servername: settings.smtpHost,
    rejectUnauthorized: true,
    ...(trustedCertificates.length ? { ca: trustedCertificates } : {})
  });
  const reader = createSmtpResponseReader(socket);
  const writeCommand = async (command, expectedCodes, actionLabel) => {
    socket.write(`${command}\r\n`);
    return assertSmtpResponse(await reader.waitForResponse(), expectedCodes, actionLabel);
  };
  try {
    assertSmtpResponse(await reader.waitForResponse(), 220, "Подключение к SMTP");
    await writeCommand("EHLO ais-dopobrazovanie.local", 250, "Инициализация SMTP");
    await writeCommand("AUTH LOGIN", 334, "Авторизация SMTP");
    await writeCommand(Buffer.from(settings.login, "utf8").toString("base64"), 334, "Передача логина SMTP");
    await writeCommand(Buffer.from(settings.password, "utf8").toString("base64"), 235, "Передача пароля SMTP");
    return await action({ settings, socket, reader, writeCommand });
  } finally {
    if (!socket.destroyed) {
      try {
        socket.write("QUIT\r\n");
      } catch {
        // The connection may already be closing after a server error.
      }
      socket.end();
    }
  }
}

function encodeEmailHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function normalizeEmailSubject(value) {
  const subject = String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(subject);
  if (characters.length <= MAX_EMAIL_SUBJECT_LENGTH) return subject;
  return `${characters.slice(0, MAX_EMAIL_SUBJECT_LENGTH - 3).join("").trimEnd()}...`;
}

function wrapEmailBase64(value) {
  return String(value || "").match(/.{1,76}/g)?.join("\r\n") || "";
}

function encodeEmailFileName(value) {
  return encodeURIComponent(String(value || "document"))
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function containsHtmlMarkup(value) {
  return /<\s*\/?\s*[a-z][a-z0-9:-]*(?:\s[^<>]*?)?\s*\/?\s*>/iu.test(String(value || ""));
}

function createEmailMessage({ from, to, subject, message, attachment }) {
  const domain = String(from).split("@")[1] || "localhost";
  const messageId = `${Date.now()}.${crypto.randomBytes(8).toString("hex")}@${domain}`;
  const bodyContentType = containsHtmlMarkup(message) ? "text/html" : "text/plain";
  const encodedBody = wrapEmailBase64(
    Buffer.from(String(message || "").replace(/\r\n|\r|\n/g, "\r\n"), "utf8").toString("base64")
  );
  const headers = [
    `From: ${encodeEmailHeader("Цифровизация Плюс")} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeEmailHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    "X-Mailer: AIS-Dopobrazovanie"
  ];
  if (!attachment) {
    return [
      ...headers,
      `Content-Type: ${bodyContentType}; charset=UTF-8`,
      "Content-Transfer-Encoding: base64",
      "",
      encodedBody
    ].join("\r\n");
  }

  const boundary = `ais-${crypto.randomBytes(18).toString("hex")}`;
  const fallbackFileName = attachment.fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_");
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: ${bodyContentType}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
    `--${boundary}`,
    `Content-Type: ${attachment.contentType}; name="${fallbackFileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeEmailFileName(attachment.fileName)}`,
    "",
    wrapEmailBase64(attachment.bytes.toString("base64")),
    `--${boundary}--`
  ].join("\r\n");
}

async function sendEmailThroughConfiguredMailbox({ to, subject, message, attachment }) {
  return runAuthenticatedSmtpSession(async ({ settings, socket, reader, writeCommand }) => {
    await writeCommand(`MAIL FROM:<${settings.login}>`, 250, "Адрес отправителя");
    await writeCommand(`RCPT TO:<${to}>`, [250, 251], "Адрес получателя");
    await writeCommand("DATA", 354, "Подготовка письма");
    socket.write(`${createEmailMessage({
      from: settings.login,
      to,
      subject,
      message,
      attachment
    })}\r\n.\r\n`);
    assertSmtpResponse(await reader.waitForResponse(60000), 250, "Отправка письма");
    return settings;
  });
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

async function connectStudentApplicationsImap(mailboxSettings = null) {
  const settings = mailboxSettings || getStudentApplicationsEmailSettings();
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
      // A tagged IMAP completion line is short and always arrives at the end
      // of the response. Inspect only the tail instead of converting a growing
      // multi-megabyte message to text again for every network chunk.
      const tailOffset = Math.max(0, buffer.length - 8192);
      const text = buffer.subarray(tailOffset).toString("latin1");
      const match = new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)(?: ([^\\r\\n]*))?\\r\\n`, "i").exec(text);
      if (!match) return null;
      return {
        end: tailOffset + match.index + match[0].length,
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
  let activeUid = "";
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
    const uid = /\bUID\s+(\d+)\b/i.exec(prefix)?.[1] || activeUid;
    if (uid) activeUid = uid;
    if (uid) entries.push({ uid, bytes: bytes.subarray(start, end) });
    cursor = end;
  }
  return entries;
}

function parseImapSExpression(source, startIndex = 0) {
  let index = startIndex;
  const skipWhitespace = () => {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  };
  const readValue = () => {
    skipWhitespace();
    if (source[index] === "(") {
      index += 1;
      const values = [];
      while (index < source.length) {
        skipWhitespace();
        if (source[index] === ")") {
          index += 1;
          return values;
        }
        values.push(readValue());
      }
      throw new Error("IMAP-сервер вернул незавершённую структуру письма.");
    }
    if (source[index] === '"') {
      index += 1;
      let value = "";
      while (index < source.length) {
        const character = source[index++];
        if (character === '"') return value;
        if (character === "\\" && index < source.length) value += source[index++];
        else value += character;
      }
      throw new Error("IMAP-сервер вернул незавершённую строку структуры письма.");
    }
    if (source[index] === "{") {
      const literalMatch = /^\{(\d+)\}\r\n/.exec(source.slice(index));
      if (!literalMatch) throw new Error("IMAP-сервер вернул повреждённый литерал структуры письма.");
      index += literalMatch[0].length;
      const length = Number(literalMatch[1]);
      const value = source.slice(index, index + length);
      index += length;
      return value;
    }
    const atomStart = index;
    while (index < source.length && !/[\s()]/.test(source[index])) index += 1;
    if (index === atomStart) throw new Error("IMAP-сервер вернул неизвестный элемент структуры письма.");
    const atom = source.slice(atomStart, index);
    return atom.toUpperCase() === "NIL" ? null : atom;
  };
  const value = readValue();
  return { value, index };
}

function imapParameterListToObject(value) {
  const parameters = {};
  if (!Array.isArray(value)) return parameters;
  for (let index = 0; index + 1 < value.length; index += 2) {
    const name = String(value[index] || "").trim().toLowerCase();
    if (name) parameters[name] = String(value[index + 1] || "");
  }
  return parameters;
}

function estimateDecodedMimeSize(size, transferEncoding) {
  const encodedSize = Math.max(0, Number(size) || 0);
  return String(transferEncoding || "").toLowerCase() === "base64"
    ? Math.floor(encodedSize * 3 / 4)
    : encodedSize;
}

function collectImapBodyStructureAttachments(structure, result = [], depth = 0) {
  if (!Array.isArray(structure) || depth > 20) return result;
  if (Array.isArray(structure[0])) {
    for (const part of structure) {
      if (!Array.isArray(part)) break;
      collectImapBodyStructureAttachments(part, result, depth + 1);
    }
    return result;
  }
  const primaryType = String(structure[0] || "application").toLowerCase();
  const subtype = String(structure[1] || "octet-stream").toLowerCase();
  const contentParameters = imapParameterListToObject(structure[2]);
  const transferEncoding = String(structure[5] || "").toLowerCase();
  const contentSize = Number(structure[6]) || 0;
  const dispositionIndex = primaryType === "text"
    ? 9
    : (primaryType === "message" && subtype === "rfc822" ? 11 : 8);
  const disposition = Array.isArray(structure[dispositionIndex]) ? structure[dispositionIndex] : [];
  const dispositionType = String(disposition[0] || "").toLowerCase();
  const dispositionParameters = imapParameterListToObject(disposition[1]);
  const fileName = decodeMimeParameter(
    dispositionParameters["filename*"]
      || dispositionParameters.filename
      || contentParameters["name*"]
      || contentParameters.name
      || ""
  );
  if (fileName || dispositionType === "attachment") {
    result.push({
      fileName: fileName || `Вложение-${result.length + 1}`,
      contentType: `${primaryType}/${subtype}`,
      size: estimateDecodedMimeSize(contentSize, transferEncoding)
    });
    return result;
  }
  if (primaryType === "message" && subtype === "rfc822" && Array.isArray(structure[8])) {
    collectImapBodyStructureAttachments(structure[8], result, depth + 1);
  }
  return result;
}

function parseImapBodyStructureAttachments(response) {
  const source = Buffer.from(response || "").toString("latin1");
  const attachmentsByUid = new Map();
  const fetchPattern = /\*\s+\d+\s+FETCH\s*/gi;
  let match;
  while ((match = fetchPattern.exec(source))) {
    let listStart = match.index + match[0].length;
    while (/\s/.test(source[listStart])) listStart += 1;
    if (source[listStart] !== "(") continue;
    let parsedExpression;
    try {
      parsedExpression = parseImapSExpression(source, listStart);
    } catch {
      continue;
    }
    const parsed = parsedExpression.value;
    if (!Array.isArray(parsed)) continue;
    let uid = "";
    let structure = null;
    for (let index = 0; index < parsed.length - 1; index += 1) {
      const name = String(parsed[index] || "").toUpperCase();
      if (name === "UID") uid = String(parsed[index + 1] || "");
      if (name === "BODYSTRUCTURE") structure = parsed[index + 1];
    }
    if (uid && structure) {
      attachmentsByUid.set(uid, collectImapBodyStructureAttachments(structure));
    }
    fetchPattern.lastIndex = Math.max(fetchPattern.lastIndex, parsedExpression.index);
  }
  return attachmentsByUid;
}

async function fetchImapAttachmentMetadata(client, uids, warnings) {
  const attachmentsByUid = new Map();
  const readResponse = (response) => {
    parseImapBodyStructureAttachments(response).forEach((attachments, uid) => {
      attachmentsByUid.set(uid, attachments);
    });
  };
  for (const batch of chunkValues(uids, 100)) {
    try {
      readResponse(await client.command(
        `UID FETCH ${batch.join(",")} (UID BODYSTRUCTURE)`,
        45000
      ));
    } catch {
      for (const uid of batch) {
        try {
          readResponse(await client.command(`UID FETCH ${uid} (UID BODYSTRUCTURE)`, 30000));
        } catch (error) {
          warnings.push(`Список вложений письма UID ${uid} не прочитан: ${error.message}`);
        }
      }
    }
  }
  return attachmentsByUid;
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
  // Full messages can contain large attachments. Fetch them one at a time so
  // the response reader never accumulates several multi-megabyte literals in
  // a single buffer (Timeweb closes the connection after an oversized batch).
  for (const uid of uids) {
    try {
      const response = await client.command(`UID FETCH ${uid} (UID BODY.PEEK[])`, 60000);
      readResponse(response);
    } catch (error) {
      warnings.push(`Письмо UID ${uid} пропущено: ${error.message}`);
    }
  }
  return messages;
}

async function fetchImapMessagePreviews(client, uids, warnings) {
  const previews = [];
  const attachmentsByUid = await fetchImapAttachmentMetadata(client, uids, warnings);
  for (const uid of uids) {
    try {
      const response = await client.command(
        `UID FETCH ${uid} (UID RFC822.SIZE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.131072>)`,
        45000
      );
      const literals = extractImapFetchLiterals(response)
        .filter((entry) => entry.uid === uid)
        .map((entry) => entry.bytes);
      if (!literals.length) {
        warnings.push(`Письмо UID ${uid} пропущено: IMAP-сервер не вернул заголовки.`);
        continue;
      }
      const message = parseStudentMailboxMessage(uid, Buffer.concat(literals));
      const completeAttachments = attachmentsByUid.get(uid);
      previews.push({
        ...message,
        attachments: (completeAttachments || message.attachments).map((attachment) => ({
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          bytes: Buffer.alloc(0),
          size: Math.max(0, Number(attachment.size) || attachment.bytes?.length || 0)
        }))
      });
    } catch (error) {
      warnings.push(`Письмо UID ${uid} пропущено: ${error.message}`);
    }
  }
  return previews;
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

function isStudentApplicationOrderSubject(value) {
  return /^Новый заказ\s*№\s*\d+/iu.test(String(value || "").trim());
}

function parseInSalesOrderEmail(rawMessage) {
  const { headers } = splitMimeEntity(rawMessage);
  const subject = decodeMimeHeader(headers.subject);
  if (!isStudentApplicationOrderSubject(subject)) return [];
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
  const receiptTotalAmount = totalAmount > 0 ? totalAmount : totalBaseAmount;
  const dateCreated = `${year}-${month}-${day}T${time}:00`;
  const messageId = String(headers["message-id"] || "").replace(/[<>\s]+/g, "").slice(0, 120);

  return products.map((product, index) => {
    const paymentAmount = Math.round((products.length === 1
      ? receiptTotalAmount
      : receiptTotalAmount * (product.baseAmount / Math.max(totalBaseAmount, 1))) * 100) / 100;
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
      coupon,
      note: [paymentMethod, paymentStatus, coupon].filter(Boolean).join("\n"),
      paid,
      orderAmount: paymentAmount,
      // InSales creates the receipt record independently of the payment-status
      // flag in the notification. The status is still preserved in `paid` and
      // `note`, while the full allocated order amount is imported into Finance.
      paymentAmount
    };
  });
}

function parseWooCommerceOrderEmail(rawMessage) {
  const { headers } = splitMimeEntity(rawMessage);
  const subject = decodeMimeHeader(headers.subject);
  if (!isStudentApplicationOrderSubject(subject)) return [];
  const mimeText = extractMimeText(rawMessage);
  const text = normalizeEmailOrderText(mimeText.plain || htmlToPlainText(mimeText.html));
  const orderMatch = /(?:Новый заказ\s*:\s*№|\[Заказ №)\s*(\d+)/iu.exec(text);
  if (!orderMatch) return [];
  const orderId = String(orderMatch[1] || "").trim();
  const dateMatch = new RegExp(
    `\\[Заказ №\\s*${orderId}\\]\\s*\\(\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s*\\)`,
    "iu"
  ).exec(text);
  if (!dateMatch) return [];
  const [, day, month, year] = dateMatch;
  const name = normalizeEmailCustomerName(
    /Получен заказ от покупателя\s+(.+?)\s*:/iu.exec(text)?.[1] || ""
  );
  const productBlock = /Товар\s*\n+Количество\s*\n+Цена\s*\n+([\s\S]*?)\n+Подытог\s*:/iu.exec(text)?.[1] || "";
  const productLines = productBlock.split("\n").map((line) => line.trim()).filter(Boolean);
  const products = [];
  for (let index = 0; index + 2 < productLines.length;) {
    const quantity = Number(String(productLines[index + 1] || "").replace(/\s+/g, ""));
    const price = parseEmailMoney(productLines[index + 2]);
    if (!Number.isFinite(quantity) || quantity < 1 || !/[₽руб]/iu.test(productLines[index + 2])) {
      index += 1;
      continue;
    }
    products.push({
      productId: "",
      program: productLines[index].replace(/\s+/g, " ").trim(),
      baseAmount: price * quantity
    });
    index += 3;
  }
  if (!products.length) return [];

  const addressBlock = /Платёжный адрес\s*\n+([\s\S]*?)(?:\n+Поздравляем|\n+Работать с заказами|$)/iu.exec(text)?.[1] || "";
  const addressLines = addressBlock.split("\n").map((line) => line.trim()).filter(Boolean);
  const emailIndex = addressLines.findIndex((line) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(line));
  const phoneIndex = addressLines.findIndex((line, index) => (
    index > 0 && index < (emailIndex >= 0 ? emailIndex : addressLines.length)
    && String(line).replace(/\D/g, "").length >= 7
  ));
  const detailsEnd = phoneIndex >= 0 ? phoneIndex : (emailIndex >= 0 ? emailIndex : addressLines.length);
  const addressDetails = addressLines.slice(1, detailsEnd);
  const email = emailIndex >= 0 ? addressLines[emailIndex] : "";
  const phone = phoneIndex >= 0 ? addressLines[phoneIndex] : "";
  const organization = addressDetails[0] || "";
  const position = addressDetails[1] || "";
  const source = addressDetails.length > 3 ? addressDetails[2] : "";
  const city = addressDetails.at(-1) || "";
  const totalAmount = parseEmailMoney(
    /Итого\s*:\s*\n+([0-9][0-9\s.,]*)\s*(?:₽|руб)/iu.exec(text)?.[1] || ""
  );
  const paid = /(?:статус оплаты|заказ)\s*:\s*[^\n]*оплачен/iu.test(text)
    && !/не\s+оплачен/iu.test(text);
  const headerDate = new Date(String(headers.date || ""));
  const dateCreated = Number.isNaN(headerDate.getTime())
    ? `${year}-${month}-${day}T00:00:00`
    : headerDate.toISOString();
  const time = Number.isNaN(headerDate.getTime())
    ? "00:00:00"
    : headerDate.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour12: false });
  const messageId = String(headers["message-id"] || "").replace(/[<>\s]+/g, "").slice(0, 120);
  return products.map((product, index) => ({
    id: `email-${orderId}-${index + 1}-${messageId || index + 1}`,
    sourceType: "email",
    date: `${day}.${month}.${year} ${time}`,
    dateCreated,
    name,
    order: orderId,
    orderId,
    program: product.program,
    productId: product.productId,
    phone,
    email,
    city,
    organization,
    position,
    source: source || "Электронная почта / WooCommerce",
    note: "Заявка получена из уведомления WooCommerce.",
    paid,
    paymentAmount: paid ? totalAmount : 0
  }));
}

function parseStudentApplicationOrderEmail(rawMessage) {
  return parseInSalesOrderEmail(rawMessage);
}

function normalizeStudentApplicationProgramMatchValue(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\[\s*\d+\s*\]\s*$/u, "")
    .replace(/^доступ\s+к\s+/u, "")
    .replace(/^он[\s-]*лайн\s+семинару?\s*:?\s*/u, "")
    .replace(/[«»"'`]+/gu, "")
    .replace(/[^a-zа-я0-9]+/gu, " ")
    .trim();
}

function studentEmailApplicationMatchesFilters(row, filters) {
  if (filters.onlyPaid && !row.paid) return false;
  const programFilters = Array.isArray(filters.programs) ? filters.programs : [];
  if (!programFilters.length) return true;
  return programFilters.some((program) => {
    const productId = String(program.productId || "").trim();
    const programName = String(program.programName || "").trim().toLocaleLowerCase("ru-RU");
    const matchesProduct = productId && String(row.productId || "").trim() === productId;
    const rowProgram = String(row.program || "").toLocaleLowerCase("ru-RU");
    const normalizedProgramName = normalizeStudentApplicationProgramMatchValue(programName);
    const normalizedRowProgram = normalizeStudentApplicationProgramMatchValue(rowProgram);
    const matchesProgram = programName && (
      rowProgram.includes(programName)
      || programName.includes(rowProgram.replace(/\s*\([^)]*\)\s*$/u, "").trim())
      || (normalizedProgramName && normalizedRowProgram && (
        normalizedRowProgram.includes(normalizedProgramName)
        || normalizedProgramName.includes(normalizedRowProgram)
      ))
    );
    return Boolean(matchesProduct || matchesProgram);
  });
}

async function runStudentApplicationsEmailQuery(filters, mailboxSettings = null) {
  const settings = mailboxSettings || getStudentApplicationsEmailSettings();
  const client = await connectStudentApplicationsImap(settings);
  const warnings = [];
  try {
    const beforeDate = addDaysToIsoDate(filters.dateTo, 1);
    const searchResponse = await client.command(
      `UID SEARCH SINCE ${formatImapDate(filters.dateFrom)} BEFORE ${formatImapDate(beforeDate)}`,
      45000
    );
    const allUids = parseImapSearchUids(searchResponse);
    const subjectUids = allUids.slice(-5000).reverse();
    const subjects = await fetchImapSubjects(client, subjectUids, warnings);
    const allOrderUids = subjectUids.filter((uid) => (
      isStudentApplicationOrderSubject(subjects.get(uid) || "")
    ));
    const orderUids = allOrderUids.slice(0, 1000);
    const messages = await fetchImapMessages(client, orderUids, warnings);
    const rows = [];
    for (const message of messages) {
      try {
        rows.push(...parseStudentApplicationOrderEmail(message.bytes)
          .filter((row) => studentEmailApplicationMatchesFilters(row, filters))
          .map((row) => ({
            ...row,
            sourceMailboxId: String(settings.id || "applications"),
            sourceMailbox: String(settings.label || settings.login || "")
          })));
      } catch (error) {
        warnings.push(`Письмо UID ${message.uid} пропущено: ${error.message}`);
      }
    }
    return {
      rows,
      total: rows.length,
      truncated: allUids.length > subjectUids.length || allOrderUids.length > orderUids.length,
      warnings
    };
  } finally {
    await client.close();
  }
}

async function testStudentApplicationsEmailConnection() {
  const client = await connectStudentApplicationsImap();
  await client.close();
  return runAuthenticatedSmtpSession(async ({ settings }) => settings);
}

function decodeMimeParameter(value) {
  const source = String(value || "").trim().replace(/^"|"$/g, "");
  const encoded = /^(?:utf-8|us-ascii)''(.+)$/i.exec(source)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { return encoded; }
  }
  return decodeMimeHeader(source);
}

function getMimeFileName(headers, contentType) {
  const disposition = parseMimeContentType(headers["content-disposition"] || "");
  return decodeMimeParameter(
    disposition.parameters["filename*"]
      || disposition.parameters.filename
      || contentType.parameters["name*"]
      || contentType.parameters.name
      || ""
  );
}

function collectEmailMessageContent(bytes, result = { plain: [], html: [], attachments: [] }, depth = 0) {
  if (depth > 12) return result;
  const { headers, body } = splitMimeEntity(bytes);
  const contentType = parseMimeContentType(headers["content-type"]);
  if (contentType.type.startsWith("multipart/") && contentType.parameters.boundary) {
    const delimiter = `--${contentType.parameters.boundary}`;
    const sections = body.toString("latin1").split(delimiter).slice(1);
    for (const sectionSource of sections) {
      if (/^--/.test(sectionSource)) break;
      const section = sectionSource.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      if (section.trim()) collectEmailMessageContent(Buffer.from(section, "latin1"), result, depth + 1);
    }
    return result;
  }
  if (contentType.type === "message/rfc822") {
    return collectEmailMessageContent(body, result, depth + 1);
  }
  const decoded = decodeMimeTransfer(body, headers["content-transfer-encoding"]);
  const fileName = getMimeFileName(headers, contentType);
  const dispositionType = parseMimeContentType(headers["content-disposition"] || "").type;
  if (fileName || dispositionType === "attachment") {
    if (decoded.length && result.attachments.length < 100) {
      result.attachments.push({
        fileName: fileName || `Вложение-${result.attachments.length + 1}`,
        contentType: contentType.type || "application/octet-stream",
        bytes: decoded
      });
    }
    return result;
  }
  if (contentType.type === "text/plain" || contentType.type === "text/html") {
    const text = decodeTextBytes(decoded, contentType.parameters.charset || "utf-8").replace(/\u0000/g, "").trim();
    if (text) result[contentType.type === "text/plain" ? "plain" : "html"].push(text);
  }
  return result;
}

function parseStudentMailboxMessage(uid, bytes) {
  const { headers } = splitMimeEntity(bytes);
  const content = collectEmailMessageContent(bytes);
  const plainText = content.plain.join("\n\n").trim()
    || htmlToPlainText(content.html.join("\n\n"));
  const date = new Date(String(headers.date || ""));
  const isoDate = Number.isNaN(date.getTime()) ? "" : date.toISOString();
  return {
    uid: String(uid || ""),
    subject: decodeMimeHeader(headers.subject) || "Без темы",
    from: decodeMimeHeader(headers.from),
    to: decodeMimeHeader(headers.to),
    cc: decodeMimeHeader(headers.cc),
    date: isoDate,
    messageId: String(headers["message-id"] || "").replace(/[<>\r\n]/g, "").slice(0, 240),
    text: normalizeEmailOrderText(plainText),
    attachments: content.attachments
  };
}

function parseStudentMailboxSearchBody(body = {}) {
  const mailboxId = normalizeMailboxId(body.mailboxId, "applications");
  const email = String(body.email || "").trim().slice(0, 320);
  const query = String(body.query || "").trim().slice(0, 300);
  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const defaultFromDate = new Date(today.getTime() - 180 * 86400000);
  const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dateFrom || ""))
    ? String(body.dateFrom)
    : defaultFromDate.toISOString().slice(0, 10);
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dateTo || ""))
    ? String(body.dateTo)
    : defaultTo;
  if (dateFrom > dateTo) throw new Error("Дата начала периода не может быть позже даты окончания.");
  if (!email && !query) throw new Error("Укажите email слушателя или текст для поиска писем.");
  return { mailboxId, email, query, dateFrom, dateTo };
}

async function queryStudentMailboxMessages(body) {
  const filters = parseStudentMailboxSearchBody(body);
  const settings = getStudentDocumentMailboxSettings(filters.mailboxId);
  const client = await connectStudentApplicationsImap(settings);
  const warnings = [];
  try {
    const criteria = [
      `SINCE ${formatImapDate(filters.dateFrom)}`,
      `BEFORE ${formatImapDate(addDaysToIsoDate(filters.dateTo, 1))}`
    ];
    if (filters.email) {
      const value = quoteImapValue(filters.email);
      criteria.push(`OR FROM ${value} OR TO ${value} CC ${value}`);
    }
    const response = await client.command(`UID SEARCH ${criteria.join(" ")}`, 45000);
    const allUids = parseImapSearchUids(response);
    const uids = allUids.slice(-100).reverse();
    const messages = await fetchImapMessagePreviews(client, uids, warnings);
    const queryKey = filters.query.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
    const rows = messages.filter((message) => {
      if (!queryKey) return true;
      return [message.subject, message.from, message.to, message.cc, message.text]
        .join("\n")
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е")
        .includes(queryKey);
    });
    const order = new Map(uids.map((uid, index) => [uid, index]));
    rows.sort((left, right) => (order.get(left.uid) ?? 9999) - (order.get(right.uid) ?? 9999));
    return {
      mailbox: { id: settings.id, label: settings.label, login: settings.login },
      messages: rows.map((message) => ({
        uid: message.uid,
        subject: message.subject,
        from: message.from,
        to: message.to,
        date: message.date,
        excerpt: message.text.slice(0, 500),
        attachmentCount: message.attachments.length,
        attachments: message.attachments.map((attachment, index) => ({
          name: safeStudentMailboxAttachmentName(attachment.fileName, `Вложение-${index + 1}`),
          size: Math.max(0, Number(attachment.size) || attachment.bytes.length),
          contentType: attachment.contentType
        }))
      })),
      total: allUids.length,
      truncated: allUids.length > uids.length,
      warnings
    };
  } finally {
    await client.close();
  }
}

function buildStudentMailboxTextFile(message) {
  return [
    `Тема: ${message.subject}`,
    `От: ${message.from}`,
    `Кому: ${message.to}`,
    message.cc ? `Копия: ${message.cc}` : "",
    message.date ? `Дата: ${new Date(message.date).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}` : "",
    message.messageId ? `Message-ID: ${message.messageId}` : "",
    "",
    message.text || "Текст письма отсутствует."
  ].filter((line, index) => line || index >= 6).join("\r\n");
}

function buildStudentMailboxFilePrefix(message) {
  const date = message.date ? message.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const subject = safeNamePart(String(message.subject || "Письмо").slice(0, 70), "Письмо");
  return `${date}_${subject}_UID-${message.uid}`;
}

function safeStudentMailboxAttachmentName(value, fallback = "Вложение") {
  try { return safeWebDavUploadFileName(value); } catch { return `${fallback}.bin`; }
}

const STUDENT_MAILBOX_IMAGE_EXTENSIONS = new Set([
  ".avif", ".bmp", ".dds", ".dib", ".dng", ".emf", ".exr", ".gif", ".hdr",
  ".heic", ".heif", ".icns", ".ico", ".jfif", ".jp2", ".j2k", ".jpe",
  ".jpeg", ".jpg", ".pbm", ".pcx", ".pgm", ".png", ".pnm", ".ppm", ".ras",
  ".sgi", ".svg", ".tga", ".tif", ".tiff", ".webp", ".wmf", ".xbm", ".xpm"
]);

function mailboxAttachmentFileNameWithJpgExtension(fileName) {
  const parsed = path.parse(String(fileName || "image"));
  return `${parsed.name || "image"}.jpg`;
}

function isStudentMailboxPdfAttachment(fileName, contentType, bytes) {
  return path.extname(String(fileName || "")).toLowerCase() === ".pdf"
    || String(contentType || "").split(";", 1)[0].trim().toLowerCase() === "application/pdf"
    || Buffer.from(bytes || "").subarray(0, 5).toString("ascii") === "%PDF-";
}

function isStudentMailboxPngAttachment(fileName, contentType, bytes) {
  const signature = Buffer.from(bytes || "").subarray(0, 8);
  return path.extname(String(fileName || "")).toLowerCase() === ".png"
    || String(contentType || "").split(";", 1)[0].trim().toLowerCase() === "image/png"
    || signature.equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
}

function isStudentMailboxJpegAttachment(fileName, contentType, bytes) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const signature = Buffer.from(bytes || "").subarray(0, 3);
  return [".jfif", ".jpe", ".jpeg", ".jpg"].includes(extension)
    || String(contentType || "").split(";", 1)[0].trim().toLowerCase() === "image/jpeg"
    || (signature.length === 3 && signature[0] === 0xFF && signature[1] === 0xD8 && signature[2] === 0xFF);
}

function isStudentMailboxImageAttachment(fileName, contentType) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const normalizedType = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  return normalizedType.startsWith("image/") || STUDENT_MAILBOX_IMAGE_EXTENSIONS.has(extension);
}

function parseMailboxImageConversionResponse(payload) {
  const base64 = String(payload?.base64 || "").replace(/\s+/g, "");
  if (!payload?.ok || !base64 || !/^[a-z0-9+/]+={0,2}$/i.test(base64)) {
    throw new Error(payload?.error || "Конвертер изображений вернул некорректный ответ.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > 24 * 1024 * 1024 || !bytes.subarray(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]))) {
    throw new Error("Конвертер изображений не сформировал корректный JPG-файл.");
  }
  return bytes;
}

async function convertStudentMailboxImageToJpeg(attachment) {
  const requestPayload = {
    fileName: attachment.fileName,
    mimeType: attachment.contentType,
    base64: attachment.bytes.toString("base64")
  };
  let responsePayload;
  let serviceError = null;
  if (!shouldUseOcrCli()) {
    try {
      const requestBody = Buffer.from(JSON.stringify(requestPayload), "utf8");
      const serviceUrl = String(process.env.OCR_SERVICE_URL || DEFAULT_OCR_SERVICE_URL)
        .trim().replace(/\/+$/g, "");
      const response = await requestBuffer(`${serviceUrl}/v1/convert-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": requestBody.length
        },
        body: requestBody,
        timeoutMs: 2 * 60 * 1000,
        maxResponseBytes: 36 * 1024 * 1024,
        errorPrefix: "Сервис преобразования изображений отклонил файл",
        timeoutError: "Сервис преобразования изображений не завершил обработку вовремя"
      });
      responsePayload = JSON.parse(response.toString("utf8"));
    } catch (error) {
      serviceError = error;
    }
  }
  if (!responsePayload) {
    try {
      responsePayload = await runOcrCli(
        ["--convert-image-stdin"],
        requestPayload,
        2 * 60 * 1000,
        36 * 1024 * 1024
      );
    } catch (cliError) {
      throw new Error([serviceError?.message, cliError.message].filter(Boolean).join("; "));
    }
  }
  return parseMailboxImageConversionResponse(responsePayload);
}

async function prepareStudentMailboxAttachmentForSave(attachment) {
  const fileName = safeStudentMailboxAttachmentName(attachment.fileName, "Вложение");
  const contentType = String(attachment.contentType || "application/octet-stream").trim();
  const bytes = Buffer.from(attachment.bytes || "");
  if (
    isStudentMailboxPdfAttachment(fileName, contentType, bytes)
    || isStudentMailboxPngAttachment(fileName, contentType, bytes)
    || !isStudentMailboxImageAttachment(fileName, contentType)
  ) {
    return { fileName, contentType, bytes, converted: false };
  }
  if (isStudentMailboxJpegAttachment(fileName, contentType, bytes)) {
    return {
      fileName: mailboxAttachmentFileNameWithJpgExtension(fileName),
      contentType: "image/jpeg",
      bytes,
      converted: path.extname(fileName).toLowerCase() !== ".jpg"
    };
  }
  const convertedBytes = await convertStudentMailboxImageToJpeg({ fileName, contentType, bytes });
  return {
    fileName: mailboxAttachmentFileNameWithJpgExtension(fileName),
    contentType: "image/jpeg",
    bytes: convertedBytes,
    converted: true
  };
}

function getStudentMailboxFileNameCandidate(fileName, attempt = 0) {
  const safeName = safeWebDavUploadFileName(fileName);
  if (!attempt) return safeName;
  const extension = path.extname(safeName);
  const baseName = path.basename(safeName, extension);
  const suffix = ` (${attempt + 1})`;
  const maxBaseLength = Math.max(1, 180 - extension.length - suffix.length);
  return safeWebDavUploadFileName(`${baseName.slice(0, maxBaseLength)}${suffix}${extension}`);
}

async function saveStudentMailboxDocument(folderSource, fileName, bytes, contentType) {
  const relativeFolder = normalizeSystemDocumentsRelativePath(folderSource);
  if (!relativeFolder) throw new Error("Не удалось определить папку документов слушателя.");
  const localDocuments = serverSettings.openDocumentsLocally !== false
    ? await getLocalSystemDocumentsAvailability()
    : { available: false };
  if (localDocuments.available) {
    const folderPath = resolveLocalDocumentsPath(relativeFolder, "Не удалось определить локальную папку документов.");
    await fs.mkdir(folderPath, { recursive: true });
    for (let attempt = 0; attempt < 10000; attempt += 1) {
      const candidateName = getStudentMailboxFileNameCandidate(fileName, attempt);
      const targetPath = path.resolve(folderPath, candidateName);
      const relativeTarget = path.relative(folderPath, targetPath);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        throw new Error("Недопустимое имя файла вложения.");
      }
      try {
        await fs.writeFile(targetPath, bytes, { flag: "wx" });
        return { storage: "local", name: candidateName, path: `${relativeFolder}/${candidateName}` };
      } catch (error) {
        if (error.code === "EEXIST") continue;
        throw error;
      }
    }
    throw new Error("Не удалось подобрать свободное имя файла вложения.");
  }
  const folderPath = normalizeWebDavPath(`${resolveYandexDiskBasePath(false)}/${relativeFolder}`);
  await ensureYandexDiskFolder(folderPath);
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const candidateName = getStudentMailboxFileNameCandidate(fileName, attempt);
    const targetPath = normalizeWebDavPath(`${folderPath}/${candidateName}`);
    const response = await requestYandexWebDav("PUT", targetPath, {
      acceptedStatuses: [200, 201, 204, 412],
      headers: { "If-None-Match": "*" },
      body: bytes,
      contentType: contentType || getWebDavBrowserContentType(candidateName)
    });
    if (response.statusCode === 412) continue;
    return { storage: "webdav", name: candidateName, path: `${relativeFolder}/${candidateName}` };
  }
  throw new Error("Не удалось подобрать свободное имя файла вложения.");
}

async function importStudentMailboxMessages(body, authUser, req) {
  const mailboxId = normalizeMailboxId(body.mailboxId, "applications");
  const settings = getStudentDocumentMailboxSettings(mailboxId);
  const uids = [...new Set((Array.isArray(body.uids) ? body.uids : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d+$/.test(value)))].slice(0, 20);
  if (!uids.length) throw new Error("Выберите хотя бы одно письмо.");
  const folder = String(body.folder || "").trim();
  const isContract = String(body.entityType || "").trim().toLowerCase() === "contract";
  if (!folder) throw new Error(`Не указана папка документов ${isContract ? "сотрудника" : "слушателя"}.`);
  const client = await connectStudentApplicationsImap(settings);
  const warnings = [];
  let messages;
  try {
    messages = await fetchImapMessages(client, uids, warnings);
  } finally {
    await client.close();
  }
  const files = [];
  let convertedImages = 0;
  let totalBytes = 0;
  for (const source of messages) {
    const message = parseStudentMailboxMessage(source.uid, source.bytes);
    const prefix = buildStudentMailboxFilePrefix(message);
    const textBytes = Buffer.from(buildStudentMailboxTextFile(message), "utf8");
    totalBytes += textBytes.length;
    if (totalBytes > 100 * 1024 * 1024) throw new Error("Общий размер выбранных писем превышает 100 МБ.");
    const textName = `${prefix}.txt`;
    const textTarget = await saveStudentMailboxDocument(folder, textName, textBytes, "text/plain; charset=utf-8");
    files.push({ name: textTarget.name || textName, size: textBytes.length, type: "text", ...textTarget });
    for (let index = 0; index < message.attachments.length; index += 1) {
      const attachment = message.attachments[index];
      if (!attachment.bytes.length) continue;
      if (attachment.bytes.length > 24 * 1024 * 1024) {
        warnings.push(`Вложение «${attachment.fileName}» пропущено: размер превышает 24 МБ.`);
        continue;
      }
      let preparedAttachment;
      try {
        preparedAttachment = await prepareStudentMailboxAttachmentForSave(attachment);
      } catch (error) {
        throw new Error(`Не удалось преобразовать вложение «${attachment.fileName}» в JPG: ${error.message}`);
      }
      totalBytes += preparedAttachment.bytes.length;
      if (totalBytes > 100 * 1024 * 1024) throw new Error("Общий размер выбранных писем превышает 100 МБ.");
      const target = await saveStudentMailboxDocument(
        folder,
        preparedAttachment.fileName,
        preparedAttachment.bytes,
        preparedAttachment.contentType
      );
      if (preparedAttachment.converted) convertedImages += 1;
      files.push({
        name: target.name || preparedAttachment.fileName,
        size: preparedAttachment.bytes.length,
        type: "attachment",
        converted: preparedAttachment.converted,
        ...target
      });
    }
  }
  await safelyAppendAuditEntry({
    action: "Загружены документы из электронной почты",
    area: isContract ? "Документы сотрудника" : "Документы слушателя",
    entityType: isContract ? "contracts" : "students",
    entityId: auditText(body.studentId, 240),
    entityLabel: auditText(body.studentName, 500),
    field: "documents",
    after: `${messages.length} писем, ${files.length} файлов`,
    details: `Ящик: ${settings.login}; папка: ${folder}`,
    source: "imap"
  }, authUser, req);
  return {
    mailbox: { id: settings.id, label: settings.label },
    messages: messages.length,
    files,
    convertedImages,
    warnings
  };
}

async function handleStudentMailboxMessagesQuery(req, res) {
  try {
    sendJson(res, 200, await queryStudentMailboxMessages(await readJsonBody(req)));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentMailboxMessagesImport(req, res, authUser) {
  try {
    sendJson(res, 201, await importStudentMailboxMessages(await readJsonBody(req), authUser, req));
  } catch (error) {
    sendError(res, 400, error.message);
  }
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
  const programs = (Array.isArray(body.programs) ? body.programs : [])
    .slice(0, 100)
    .map((program) => ({
      programName: String(program?.programName || "").trim().slice(0, 500),
      productId: String(program?.productId || "").trim().slice(0, 80)
    }))
    .filter((program) => program.programName || program.productId);
  const legacyProgram = {
    programName: String(body.programName || "").trim().slice(0, 500),
    productId: String(body.productId || "").trim().slice(0, 80)
  };
  if (!programs.length && (legacyProgram.programName || legacyProgram.productId)) {
    programs.push(legacyProgram);
  }
  return {
    dateFrom,
    dateTo,
    programName: programs.length === 1 ? programs[0].programName : "",
    productId: programs.length === 1 ? programs[0].productId : "",
    programs,
    onlyPaid: Boolean(body.onlyPaid)
  };
}

function mergeStudentApplicationRows(rows) {
  const rowsByKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const orderId = String(row.orderId || "").trim();
    const programKey = normalizeStudentApplicationProgramMatchValue(row.program);
    const sourceType = String(row.sourceType || "mysql").trim().toLowerCase();
    const key = orderId && programKey
      ? `${sourceType}\u0000order\u0000${orderId}\u0000${programKey}`
      : `${sourceType}\u0000${orderId}\u0000${row.productId || ""}\u0000${row.id || ""}`;
    const current = rowsByKey.get(key);
    if (!current || Number(row.paymentAmount || 0) > Number(current.paymentAmount || 0)) {
      rowsByKey.set(key, row);
    }
  });
  return [...rowsByKey.values()].sort((left, right) => (
    String(right.dateCreated || "").localeCompare(String(left.dateCreated || ""))
    || String(right.id || "").localeCompare(String(left.id || ""))
  ));
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
    const applicationMailboxes = getStudentApplicationsMailboxes();
    applicationMailboxes.forEach((mailbox) => {
      sources.push({
        label: `Почта ${mailbox.login}`,
        promise: runStudentApplicationsEmailQuery(filters, mailbox)
      });
    });
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

    const uniqueRows = mergeStudentApplicationRows(rows);
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

function sanitizePaymentDatabaseConstants(values) {
  if (!Array.isArray(values)) return [];
  if (values.length > MAX_PAYMENT_DATABASE_CONSTANTS) {
    throw new Error(`Число констант оплаты превышает допустимый предел ${MAX_PAYMENT_DATABASE_CONSTANTS}.`);
  }
  const usedMarkers = new Set();
  return values.map((setting) => {
    const requestedKey = String(setting?.key || "").trim();
    const requestedMarker = String(setting?.marker || setting?.label || "").trim();
    const normalizedMarker = requestedMarker.toLocaleLowerCase("ru-RU");
    const definition = PAYMENT_DATABASE_CONSTANT_DEFINITIONS.find((item) => (
      item.key === requestedKey
      || item.marker.toLocaleLowerCase("ru-RU") === normalizedMarker
      || (item.legacyNames || []).some((name) => name.toLocaleLowerCase("ru-RU") === normalizedMarker)
    ));
    const marker = definition?.marker || requestedMarker;
    if (!isPaymentDatabaseConstantMarker(marker)) {
      throw new Error(`Некорректное имя константы оплаты для Excel: ${marker || "без имени"}.`);
    }
    const markerKey = marker.toLocaleLowerCase("ru-RU");
    if (usedMarkers.has(markerKey)) return null;
    const value = Number(String(setting?.value ?? "").replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Некорректное значение константы оплаты «${marker}».`);
    }
    usedMarkers.add(markerKey);
    return {
      key: definition?.key || requestedKey || `xlsbPaymentConstant-${marker}`,
      marker,
      value: Math.round(value / 10) * 10,
      custom: !definition,
      legacyNames: definition?.legacyNames || [],
      legacyRow: definition?.legacyRow || 0,
      percent: Boolean(definition?.percent)
    };
  }).filter(Boolean);
}

function sanitizeAgentPaymentRates(value) {
  if (value !== undefined && value !== null && (
    typeof value !== "object" || Array.isArray(value)
  )) {
    throw new Error("Некорректные настройки ставок агентских выплат.");
  }
  const source = value || {};
  const readPercent = (fieldName, fallback, label) => {
    if (source[fieldName] === undefined || source[fieldName] === null || source[fieldName] === "") {
      return fallback;
    }
    const percent = Number(String(source[fieldName]).replace(",", ".").trim());
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(`Некорректная ставка агентских выплат «${label}».`);
    }
    return Math.round(percent * 10000) / 10000;
  };
  return {
    withAuthorPercent: readPercent(
      "withAuthorPercent",
      DEFAULT_AGENT_PAYMENT_RATES.withAuthorPercent,
      "для программы с автором"
    ),
    withoutAuthorPercent: readPercent(
      "withoutAuthorPercent",
      DEFAULT_AGENT_PAYMENT_RATES.withoutAuthorPercent,
      "для программы без автора"
    )
  };
}

function sanitizeProgramPromoMessage(value, label) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "");
  if (text.length > MAX_PROGRAM_PROMO_MESSAGE_LENGTH) {
    throw new Error(
      `${label} превышает допустимый размер ${MAX_PROGRAM_PROMO_MESSAGE_LENGTH} символов.`
    );
  }
  return text;
}

function sanitizeStudentDatabaseExportPrograms(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Некорректный список программ для синхронизации.");
  if (value.length > MAX_STUDENT_DATABASE_EXPORT_PROGRAMS) {
    throw new Error(`Число программ превышает допустимый предел ${MAX_STUDENT_DATABASE_EXPORT_PROGRAMS}.`);
  }
  return value
    .filter((program) => program && typeof program === "object" && !Array.isArray(program))
    .map((program, index) => {
      const name = String(program.name || "").trim().slice(0, 1000);
      const xlsbProgramName = String(program.xlsbProgramName || name).trim().slice(0, 1000);
      const landingCode = String(program.landingCode || "").trim().slice(0, 300);
      const xlsbProgramLandingCode = String(
        Object.prototype.hasOwnProperty.call(program, "xlsbProgramLandingCode")
          ? program.xlsbProgramLandingCode
          : landingCode
      ).trim().slice(0, 300);
      const xlsbProgramRow = Math.max(0, Math.trunc(Number(program.xlsbProgramRow) || 0));
      const promoMessage1 = sanitizeProgramPromoMessage(
        program.promoMessage1,
        `Промосообщение 1 программы ${name || index + 1}`
      );
      const promoMessage2 = sanitizeProgramPromoMessage(
        program.promoMessage2,
        `Промосообщение 2 программы ${name || index + 1}`
      );
      const emailMessageTemplate = sanitizeProgramPromoMessage(
        program.emailMessageTemplate,
        `Почтовое сообщение программы ${name || index + 1}`
      );
      const sourceRowKnown = xlsbProgramRow > 0;
      return {
        name,
        landingCode,
        xlsbProgramName,
        xlsbProgramLandingCode,
        xlsbProgramRow,
        promoMessage1Provided: Object.prototype.hasOwnProperty.call(program, "promoMessage1Provided")
          ? program.promoMessage1Provided === true
          : sourceRowKnown || Boolean(promoMessage1.trim()),
        promoMessage2Provided: Object.prototype.hasOwnProperty.call(program, "promoMessage2Provided")
          ? program.promoMessage2Provided === true
          : sourceRowKnown || Boolean(promoMessage2.trim()),
        emailMessageTemplateProvided: Object.prototype.hasOwnProperty.call(program, "emailMessageTemplateProvided")
          ? program.emailMessageTemplateProvided === true
          : sourceRowKnown || Boolean(emailMessageTemplate.trim()),
        promoMessage1,
        promoMessage2,
        emailMessageTemplate
      };
    })
    .filter((program) => program.name || program.xlsbProgramName);
}

function sanitizeMacroSettingsEventTemplates(value, withConditions = false) {
  if (!Array.isArray(value)) return [];
  if (value.length > 300) throw new Error("В настройках слишком много событий.");
  const usedKeys = new Set();
  return value.map((item) => {
    const label = String(item?.label || "")
      .replace(/[;\r\n\u000b]+/gu, " ")
      .trim()
      .slice(0, 500);
    if (!label) return null;
    let key = String(item?.key || buildMacroSettingEventKey(label)).trim().replace(/[^A-Za-z0-9_-]/gu, "");
    if (!key) key = buildMacroSettingEventKey(label);
    if (usedKeys.has(key)) return null;
    usedKeys.add(key);
    const result = { key, label };
    if (withConditions) {
      result.includeTypes = [...new Set((item?.includeTypes || [])
        .map(normalizeMacroSettingEventType)
        .filter(Boolean))];
      result.excludeTypes = [...new Set((item?.excludeTypes || [])
        .map(normalizeMacroSettingEventType)
        .filter(Boolean))];
    }
    return result;
  }).filter(Boolean);
}

function sanitizeStudentDatabaseMacroSettingsExport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { provided: false };
  }
  const connection = parseSharedRecordLocksMySqlConnectionString(
    getStudentApplicationsMySqlConnectionString()
  );
  const requestedQuery = String(value.applicationsSqlQuery || "").trim();
  const applicationsSqlQuery = getStudentApplicationsSqlQuery()
    || (requestedQuery ? normalizeStudentApplicationsSqlQuery(requestedQuery) : "");
  return {
    provided: true,
    studentEventTemplates: sanitizeMacroSettingsEventTemplates(value.studentEventTemplates, true),
    contractEventTemplates: sanitizeMacroSettingsEventTemplates(value.contractEventTemplates),
    applicationsSqlQuery: compactSqlQueryForMacroSettings(applicationsSqlQuery),
    applicationsMysqlHost: String(connection.server || connection.host || "").trim(),
    applicationsMysqlDatabase: String(connection.database || connection.initialcatalog || "").trim(),
    applicationsMysqlUser: String(connection.uid || connection.user || connection.userid || "").trim(),
    applicationsMysqlPassword: String(connection.pwd || connection.password || "")
  };
}

function sanitizeStudentDatabaseExportPayload(body) {
  if (!Array.isArray(body.students) || !body.students.length) {
    throw new Error("В облачной базе нет слушателей для синхронизации.");
  }
  if (body.students.length > MAX_STUDENT_DATABASE_EXPORT_STUDENTS) {
    throw new Error(`Число слушателей превышает допустимый предел ${MAX_STUDENT_DATABASE_EXPORT_STUDENTS}.`);
  }
  if (!Array.isArray(body.contracts)) {
    throw new Error("Не передан реестр договоров.");
  }
  if (body.contracts.length > MAX_STUDENT_DATABASE_EXPORT_CONTRACTS) {
    throw new Error(`Число договоров превышает допустимый предел ${MAX_STUDENT_DATABASE_EXPORT_CONTRACTS}.`);
  }
  if (!Array.isArray(body.directExpenses)) {
    throw new Error("Не передан список прямых затрат.");
  }
  if (body.directExpenses.length > MAX_STUDENT_DATABASE_EXPORT_EXPENSES) {
    throw new Error(`Число прямых затрат превышает допустимый предел ${MAX_STUDENT_DATABASE_EXPORT_EXPENSES}.`);
  }
  if (!Array.isArray(body.generalExpenses)) {
    throw new Error("Не передан список общих затрат.");
  }
  if (body.generalExpenses.length > MAX_STUDENT_DATABASE_EXPORT_EXPENSES) {
    throw new Error(`Число общих затрат превышает допустимый предел ${MAX_STUDENT_DATABASE_EXPORT_EXPENSES}.`);
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
  const contracts = body.contracts
    .filter((contract) => contract && typeof contract === "object" && !Array.isArray(contract))
    .map((contract) => {
      const section = normalizeContractDatabaseSection(contract.section || contract.status)
        || CONTRACT_DATABASE_SECTIONS.active;
      return {
        ...contract,
        section,
        status: section === CONTRACT_DATABASE_SECTIONS.active
          ? "Действует"
          : section === CONTRACT_DATABASE_SECTIONS.partners
            ? "Партнерская программа"
            : "Истек"
      };
    });
  const directExpenses = body.directExpenses
    .filter((expense) => expense && typeof expense === "object" && !Array.isArray(expense))
    .map((expense) => ({ ...expense }));
  const generalExpenses = body.generalExpenses
    .filter((expense) => expense && typeof expense === "object" && !Array.isArray(expense))
    .map((expense) => ({
      ...expense,
      section: normalizeGeneralExpenseDatabaseSection(expense.section)
        || GENERAL_EXPENSE_DATABASE_SECTIONS.organizations
    }));
  const programsProvided = Array.isArray(body.programs);
  const programs = sanitizeStudentDatabaseExportPrograms(body.programs);
  const macroSettings = sanitizeStudentDatabaseMacroSettingsExport(body.macroSettings);
  return {
    students,
    contracts,
    directExpenses,
    generalExpenses,
    programs,
    programPromoMessagesProvided: programsProvided,
    paymentConstants: sanitizePaymentDatabaseConstants(body.paymentConstants),
    paymentConstantsProvided: Array.isArray(body.paymentConstants),
    agentPaymentRates: sanitizeAgentPaymentRates(body.agentPaymentRates),
    macroSettings,
    defaultStudentAdditionalStatus: DEFAULT_STUDENT_ADDITIONAL_STATUS,
    studentColumnMap: {
      ...STUDENT_DATABASE_COLUMN_MAP,
      "ДопНастрСлушат": "__eventSettings"
    },
    studentDateFields: [...STUDENT_DATABASE_DATE_FIELDS],
    studentNumberFields: [...STUDENT_DATABASE_NUMBER_FIELDS],
    directExpenseColumnMap: DIRECT_EXPENSE_DATABASE_COLUMN_MAP,
    generalExpenseColumnMap: GENERAL_EXPENSE_DATABASE_COLUMN_MAP,
    generalExpenseSections: GENERAL_EXPENSE_DATABASE_SECTIONS,
    contractColumnMap: {
      ...CONTRACT_DATABASE_COLUMN_MAP,
      "ДопНастрКонтр": "__contractEventSettings"
    },
    contractSections: CONTRACT_DATABASE_SECTIONS,
    contractDateFields: [...CONTRACT_DATABASE_DATE_FIELDS],
    contractNumberFields: [...CONTRACT_DATABASE_NUMBER_FIELDS],
    studentEventTemplates: macroSettings.studentEventTemplates?.length
      ? macroSettings.studentEventTemplates
      : STUDENT_EVENT_IMPORT_TEMPLATES,
    contractEventTemplates: macroSettings.contractEventTemplates?.length
      ? macroSettings.contractEventTemplates
      : CONTRACT_EVENT_IMPORT_TEMPLATES
  };
}

async function safelyRemoveStudentDatabaseExportDirectory(directoryPath) {
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedPath = path.resolve(directoryPath);
  const relativePath = path.relative(tempRoot, resolvedPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return;
  await fs.rm(resolvedPath, { recursive: true, force: true });
}

function buildStudentDatabaseBackupFileName(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `АИС Допобразование_${parts.year}-${parts.month}-${parts.day} ${parts.hour}-${parts.minute}-${parts.second}.xlsb`;
}

function resolveYandexStudentDatabaseFile(databasePath) {
  const source = getStudentDatabaseSourceSetting(databasePath);
  const parsed = parseHttpResourceUrl(source);
  if (parsed && !isYandexWebDavHost(parsed.hostname)) {
    throw new Error("Для синхронизации через WebDAV укажите путь к XLSB на Яндекс-Диске, а не публичную ссылку.");
  }
  const remotePath = resolveConfiguredYandexWebDavPath(source);
  if (path.posix.extname(remotePath).toLowerCase() !== ".xlsb") {
    throw new Error("Путь базы на Яндекс-Диске должен вести к файлу XLSB.");
  }
  return remotePath;
}

async function saveStudentDatabaseSyncResult(
  databasePath,
  sourceType,
  sourceBytes,
  outputBytes,
  onProgress = () => {}
) {
  const backupFileName = buildStudentDatabaseBackupFileName();
  if (sourceType === "local") {
    const targetPath = resolveLocalStudentDatabaseFile(databasePath);
    const backupFolder = path.join(path.dirname(targetPath), "_Резерв");
    const backupPath = path.join(backupFolder, backupFileName);
    onProgress({ progress: 96, stage: "backup", message: "Создание локальной резервной копии XLSB..." });
    await fs.mkdir(backupFolder, { recursive: true });
    await fs.writeFile(backupPath, sourceBytes, { flag: "wx" });
    onProgress({ progress: 98, stage: "save", message: "Обновление локальной базы XLSB..." });
    try {
      await fs.writeFile(targetPath, outputBytes);
    } catch (error) {
      throw new Error(`Резервная копия создана: ${backupPath}. Не удалось обновить исходную базу: ${error.message}`);
    }
    return {
      source: sourceType,
      targetPath,
      backupPath
    };
  }

  const targetPath = resolveYandexStudentDatabaseFile(databasePath);
  const backupFolder = normalizeWebDavPath(`${path.posix.dirname(targetPath)}/_Резерв`);
  const backupPath = normalizeWebDavPath(`${backupFolder}/${backupFileName}`);
  onProgress({ progress: 96, stage: "backup", message: "Создание резервной копии XLSB на Яндекс-Диске..." });
  await ensureYandexDiskFolder(backupFolder);
  await requestYandexWebDav("PUT", backupPath, {
    acceptedStatuses: [200, 201, 204],
    body: sourceBytes,
    contentType: "application/vnd.ms-excel.sheet.binary.macroEnabled.12"
  });
  onProgress({ progress: 98, stage: "save", message: "Обновление базы XLSB на Яндекс-Диске..." });
  try {
    await requestYandexWebDav("PUT", targetPath, {
      acceptedStatuses: [200, 201, 204],
      body: outputBytes,
      contentType: "application/vnd.ms-excel.sheet.binary.macroEnabled.12"
    });
  } catch (error) {
    throw new Error(`Резервная копия создана: ${backupPath}. Не удалось обновить исходную базу: ${error.message}`);
  }
  return {
    source: sourceType,
    targetPath: targetPath.replace(/^\/+/, ""),
    backupPath: backupPath.replace(/^\/+/, "")
  };
}

function formatImportBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function parseStudentDatabaseInWorker(bytes, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(SERVER_CODE_ROOT, "student-import-worker.js"), {
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

async function applyImportedStudentDatabaseMacroSettings(result) {
  const imported = result?.macroSettings;
  if (!imported?.provided) return;
  const patch = {};
  if (String(imported.applicationsSqlQuery || "").trim()) {
    patch.studentApplicationsSqlQuery = normalizeStudentApplicationsSqlQuery(
      imported.applicationsSqlQuery
    );
  }
  if (!process.env.STUDENT_APPLICATIONS_MYSQL_CONNECTION_STRING) {
    const currentConnection = parseSharedRecordLocksMySqlConnectionString(
      getStudentApplicationsMySqlConnectionString()
    );
    const host = String(imported.applicationsMysqlHost || currentConnection.server || currentConnection.host || "").trim();
    const database = String(imported.applicationsMysqlDatabase || currentConnection.database || currentConnection.initialcatalog || "").trim();
    const user = String(imported.applicationsMysqlUser || currentConnection.uid || currentConnection.user || currentConnection.userid || "").trim();
    const password = String(
      result?.macroSettingsSecret?.applicationsMysqlPassword
      || currentConnection.pwd
      || currentConnection.password
      || ""
    );
    if (host && database && user && password) {
      patch.studentApplicationsMySqlConnectionString = buildStudentApplicationsMySqlConnectionString({
        driver: currentConnection.driver || "MySQL ODBC 9.4 Unicode Driver",
        host,
        port: Number(currentConnection.port) || 3306,
        database,
        user,
        password
      });
    }
  }
  if (Object.keys(patch).length) await saveServerSettings(patch);
  result.macroSettings = {
    ...imported,
    ...publicStudentApplicationsMySqlSettings()
  };
}

function buildStudentDatabaseImportResult(result, source = "webdav") {
  const { macroSettingsSecret, ...publicResult } = result;
  return {
    ...publicResult,
    count: result.students.length,
    contractCount: result.contracts.length,
    directExpenseCount: result.directExpenses.length,
    generalExpenseCount: result.generalExpenses.length,
    linkedDirectExpenseCount: result.linkedDirectExpenseCount,
    totalDirectExpenseCount: result.totalDirectExpenseCount,
    sourceName: "АИС Допобразование.xlsb",
    source: normalizeStudentDatabaseSource(source),
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

async function runStudentImportJob(job, databasePath, source = "webdav") {
  try {
    const sourceType = normalizeStudentDatabaseSource(source);
    const isLocal = sourceType === "local";
    const transferStage = isLocal ? "read" : "download";
    updateStudentImportJob(job, {
      stage: transferStage,
      message: isLocal ? "Чтение базы с локального диска..." : "Получение файла через WebDAV...",
      progress: 0
    });
    const bytes = await loadStudentDatabaseBytes(databasePath, ({ receivedBytes, totalBytes }) => {
      const downloadPercent = totalBytes > 0
        ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100))
        : 0;
      updateStudentImportJob(job, {
        stage: transferStage,
        progress: totalBytes > 0 ? downloadPercent / 2 : job.progress,
        message: totalBytes > 0
          ? `${isLocal ? "Чтение" : "Скачивание"} файла: ${downloadPercent}% (${formatImportBytes(receivedBytes)} из ${formatImportBytes(totalBytes)})`
          : `${isLocal ? "Прочитано" : "Скачано"} ${formatImportBytes(receivedBytes)}`
      });
    }, { source: sourceType });
    updateStudentImportJob(job, {
      stage: "parse",
      progress: 50,
      message: `Файл ${isLocal ? "прочитан" : "загружен"} (${formatImportBytes(bytes.length)}). Чтение XLSB...`
    });
    const result = await parseStudentDatabaseInWorker(bytes, (parseProgress) => {
      const value = Math.max(0, Math.min(100, Number(parseProgress.progress) || 0));
      updateStudentImportJob(job, {
        stage: "parse",
        progress: 50 + value * 0.49,
        message: parseProgress.message || "Обработка данных Excel..."
      });
    });
    await applyImportedStudentDatabaseMacroSettings(result);
    job.result = buildStudentDatabaseImportResult(result, sourceType);
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

function resolveLocalTemplatePathFromWebDavSource(templateUrl) {
  const source = String(templateUrl || "").trim();
  const parsed = parseHttpResourceUrl(source);
  const host = parsed?.hostname.toLowerCase() || "";
  if (parsed && !isYandexWebDavHost(host)) return "";
  const rootSource = String(serverSettings.localDocumentsRoot || DEFAULT_LOCAL_DOCUMENTS_ROOT).trim();
  const pathApi = getRuntimeFileSystemPathApi(rootSource);
  if (!pathApi) throw new Error("Укажите абсолютный путь к локальной папке документов.");
  const targetParts = normalizeWebDavPath(resolveConfiguredYandexWebDavPath(source)).split("/").filter(Boolean);
  const baseParts = normalizeWebDavPath(
    serverSettings.yandexDiskBasePath || DEFAULT_YANDEX_DISK_BASE_PATH
  ).split("/").filter(Boolean);
  const mappedPrefix = serverSettings.localDocumentsRootIsSystemParent
    ? baseParts.slice(0, -1)
    : [];
  const matchesPrefix = mappedPrefix.every((part, index) => (
    String(targetParts[index] || "").toLocaleLowerCase("ru-RU") === part.toLocaleLowerCase("ru-RU")
  ));
  if (!matchesPrefix) {
    throw new Error("WebDAV-путь шаблона находится за пределами локальной папки документов.");
  }
  const relativeParts = targetParts.slice(mappedPrefix.length);
  if (!relativeParts.length || relativeParts.some((part) => /[<>:"|?*\u0000-\u001f]/u.test(part))) {
    throw new Error("WebDAV-путь шаблона содержит недопустимые сегменты.");
  }
  const rootPath = pathApi.resolve(rootSource);
  const fullPath = pathApi.resolve(rootPath, ...relativeParts);
  const pathFromRoot = pathApi.relative(rootPath, fullPath);
  if (pathFromRoot.startsWith("..") || pathApi.isAbsolute(pathFromRoot)) {
    throw new Error("Локальный шаблон находится за пределами папки документов.");
  }
  return fullPath;
}

async function loadTemplateBytesForRequest(body) {
  const templateUrl = String(body?.templateUrl || "").trim();
  const templatePath = String(body?.templatePath || "").trim();
  if (!body?.preferLocalTemplate) return loadTemplateBytes(templateUrl, templatePath);
  const errors = [];
  if (templateUrl) {
    try {
      const localTemplatePath = resolveLocalTemplatePathFromWebDavSource(templateUrl);
      if (localTemplatePath) return await loadLocalTemplateBytes(localTemplatePath);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (templatePath) {
    try {
      return await loadLocalTemplateBytes(templatePath);
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.filter(Boolean).join(" ") || "Не удалось найти шаблон документа на локальном диске.");
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
  const customProperties = parseCustomDocumentProperties(entries);
  const assistantEmailProperties = parseAssistantEmailProperties(customProperties);
  const formulaProperties = getDocumentFormulaPropertiesFromEntries(entries, customProperties);
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
    customProperties: customProperties
      .filter((property) => (
        !isAssistantOptionPropertyName(property.name)
        && !isAssistantReservePropertyName(property.name)
      ))
      .map((property) => ({
        name: property.name,
        value: property.value
      }))
      .concat(assistantEmailProperties.map((property) => ({
        name: property.name,
        value: property.value,
        source: property.source
      }))),
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
    const templateBytes = await loadTemplateBytesForRequest(body);
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
    const source = await useWebDavWhenLocalDocumentsUnavailable(
      normalizeStudentDatabaseSource(body.source)
    );
    const bytes = await loadStudentDatabaseBytes(body.databasePath, null, { source });
    const result = await parseStudentDatabaseInWorker(bytes);
    await applyImportedStudentDatabaseMacroSettings(result);
    sendJson(res, 200, buildStudentDatabaseImportResult(result, source));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function buildStudentDatabaseExport(body, onProgress = () => {}) {
  let tempDirectory = "";
  try {
    const sourceType = await useWebDavWhenLocalDocumentsUnavailable(
      normalizeStudentDatabaseSource(body.source)
    );
    const isLocal = sourceType === "local";
    onProgress({ progress: 1, stage: "prepare", message: "Подготовка данных веб-базы..." });
    const payload = sanitizeStudentDatabaseExportPayload(body);
    onProgress({
      progress: 2,
      stage: isLocal ? "read" : "download",
      message: isLocal ? "Чтение исходного XLSB с локального диска..." : "Получение исходного XLSB через WebDAV..."
    });
    const sourceBytes = await loadStudentDatabaseBytes(body.databasePath, ({ receivedBytes, totalBytes }) => {
      const downloadPercent = totalBytes > 0
        ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100))
        : 0;
      onProgress({
        progress: totalBytes > 0 ? 2 + downloadPercent * 0.13 : 2,
        stage: isLocal ? "read" : "download",
        message: totalBytes > 0
          ? `${isLocal ? "Чтение" : "Скачивание"} исходной базы: ${downloadPercent}%`
          : `${isLocal ? "Прочитано" : "Скачано"} ${formatImportBytes(receivedBytes)}`
      });
    }, { source: sourceType });
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
    const scriptResult = await runStudentDatabaseSyncScript(inputPath, outputPath, payloadPath, (scriptProgress) => {
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
    const generalExpenseFormulaLoss = (
      sourceInspection.generalExpenseFormulaCount - outputInspection.generalExpenseFormulaCount
    );
    const contractFormulaLoss = sourceInspection.contractFormulaCount - outputInspection.contractFormulaCount;
    const removedGeneralExpenseRows = Math.max(
      0,
      sourceInspection.generalExpenseRecordCount - outputInspection.generalExpenseRecordCount
    );
    const generalExpenseFormulaLossLimit = 5 + removedGeneralExpenseRows;
    const removedContractRows = Math.max(
      0,
      sourceInspection.contractRecordCount - outputInspection.contractRecordCount
    );
    const contractFormulaLossLimit = 5 + removedContractRows * 15;
    if (
      baseFormulaLoss > 5
      || directExpenseFormulaLoss > 5
      || generalExpenseFormulaLoss > generalExpenseFormulaLossLimit
      || contractFormulaLoss > contractFormulaLossLimit
    ) {
      throw new Error(
        "Проверка сформированной книги не пройдена: потеряно слишком много формул "
        + `(База: ${sourceInspection.baseFormulaCount} → ${outputInspection.baseFormulaCount}; `
        + `Прямые затраты: ${sourceInspection.directExpenseFormulaCount} → ${outputInspection.directExpenseFormulaCount}; `
        + `Общие затраты: ${sourceInspection.generalExpenseFormulaCount} → ${outputInspection.generalExpenseFormulaCount}; `
        + `Реестр договоров: ${sourceInspection.contractFormulaCount} → ${outputInspection.contractFormulaCount}).`
      );
    }
    const downloadOnly = body.downloadOnly === true;
    const savedResult = downloadOnly
      ? {
          source: sourceType,
          fileName: buildStudentDatabaseBackupFileName(),
          outputBytes
        }
      : await saveStudentDatabaseSyncResult(
          body.databasePath,
          sourceType,
          sourceBytes,
          outputBytes,
          onProgress
        );
    onProgress({
      progress: 99,
      stage: "complete",
      message: downloadOnly
        ? "База XLSB сформирована и готова к скачиванию."
        : "База XLSB обновлена, резервная копия сохранена."
    });
    await safelyRemoveStudentDatabaseExportDirectory(tempDirectory);
    tempDirectory = "";
    return {
      ...savedResult,
      studentCount: payload.students.length,
      contractCount: payload.contracts.length,
      directExpenseCount: payload.directExpenses.length,
      generalExpenseCount: payload.generalExpenses.length,
      programCount: Number(scriptResult.programs || 0),
      programPromoMessageCount: Number(scriptResult.programPromoMessages || 0),
      programEmailMessageCount: Number(scriptResult.programEmailMessages || 0),
      programPromoSkippedCount: Number(scriptResult.programPromoSkipped || 0)
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
    if (body.downloadOnly === true && Buffer.isBuffer(result.outputBytes)) {
      sendFile(
        res,
        200,
        result.outputBytes,
        result.fileName || buildStudentDatabaseBackupFileName(),
        "application/vnd.ms-excel.sheet.binary.macroEnabled.12"
      );
      return;
    }
    sendJson(res, 200, result);
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

function normalizeStudentExportJobMessage(message, operation) {
  const source = String(message || "");
  if (operation !== "export") return source;
  return source
    .replace(/Синхронизация/gu, "Экспорт")
    .replace(/синхронизации/gu, "экспорта")
    .replace(/синхронизацию/gu, "экспорт")
    .replace(/синхронизацией/gu, "экспортом")
    .replace(/синхронизация/gu, "экспорт")
    .replace(/синхронизировать/gu, "экспортировать");
}

function publicStudentExportJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    error: job.error || "",
    operation: job.operation,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString()
  };
}

async function runStudentExportJob(job, body) {
  try {
    const result = await buildStudentDatabaseExport(body, (progress) => {
      updateStudentExportJob(job, {
        ...progress,
        message: normalizeStudentExportJobMessage(progress?.message, job.operation)
      });
    });
    if (Buffer.isBuffer(result.outputBytes)) {
      job.downloadBytes = result.outputBytes;
      job.downloadFileName = result.fileName || buildStudentDatabaseBackupFileName();
      const { outputBytes, ...publicResult } = result;
      job.result = {
        ...publicResult,
        fileName: job.downloadFileName,
        downloadReady: true
      };
    } else {
      job.result = result;
    }
    updateStudentExportJob(job, {
      status: "completed",
      stage: "complete",
      progress: 100,
      message: `Готово: ${job.result.studentCount} слушателей, ${job.result.directExpenseCount} прямых и ${job.result.generalExpenseCount} общих затрат, ${job.result.programPromoMessageCount || 0} промосообщений и ${job.result.programEmailMessageCount || 0} почтовых сообщений программ`
    });
  } catch (error) {
    const errorMessage = normalizeStudentExportJobMessage(
      error instanceof Error ? error.message : String(error),
      job.operation
    );
    updateStudentExportJob(job, {
      status: "failed",
      stage: "error",
      error: errorMessage,
      message: errorMessage
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
      operation: body.downloadOnly === true ? "export" : "sync",
      status: "running",
      stage: "prepare",
      message: body.downloadOnly === true ? "Подготовка экспорта..." : "Подготовка синхронизации...",
      progress: 0,
      error: "",
      result: null,
      downloadBytes: null,
      downloadFileName: "",
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
    sendError(res, 404, "Задача синхронизации или экспорта не найдена либо срок её хранения истёк.");
    return;
  }
  sendJson(res, 200, publicStudentExportJob(job));
}

function handleStudentDatabaseExportResult(res, requestUrl) {
  const job = getStudentExportJob(requestUrl);
  if (!job) {
    sendError(res, 404, "Задача синхронизации или экспорта не найдена либо срок её хранения истёк.");
    return;
  }
  if (job.status === "failed") {
    sendError(
      res,
      400,
      job.error || (job.operation === "export"
        ? "Экспорт завершился с ошибкой."
        : "Синхронизация завершилась с ошибкой.")
    );
    return;
  }
  if (job.status !== "completed" || !job.result) {
    sendError(
      res,
      409,
      job.operation === "export" ? "Экспорт ещё не завершён." : "Синхронизация ещё не завершена."
    );
    return;
  }
  sendJson(res, 200, job.result);
}

function handleStudentDatabaseExportDownload(res, requestUrl) {
  const job = getStudentExportJob(requestUrl);
  if (!job) {
    sendError(res, 404, "Задача экспорта не найдена или срок ее хранения истек.");
    return;
  }
  if (job.status === "failed") {
    sendError(res, 400, job.error || "Экспорт завершился с ошибкой.");
    return;
  }
  if (job.status !== "completed" || !Buffer.isBuffer(job.downloadBytes)) {
    sendError(res, 409, "Файл экспорта еще не сформирован.");
    return;
  }
  sendFile(
    res,
    200,
    job.downloadBytes,
    job.downloadFileName || buildStudentDatabaseBackupFileName(),
    "application/vnd.ms-excel.sheet.binary.macroEnabled.12"
  );
}

async function handleStudentDatabaseImportStart(req, res) {
  try {
    const body = await readJsonBody(req);
    const source = await useWebDavWhenLocalDocumentsUnavailable(
      normalizeStudentDatabaseSource(body.source)
    );
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
      source,
      createdAt: now,
      updatedAt: now
    };
    studentImportJobs.set(job.id, job);
    setImmediate(() => runStudentImportJob(job, databasePath, source));
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

function normalizeDocumentServiceUrl(value, fallback, label) {
  const source = String(value || fallback || "").trim();
  let result;
  try {
    result = new URL(source);
  } catch {
    throw new Error(`${label}: укажите корректный адрес HTTP или HTTPS.`);
  }
  if (!["http:", "https:"].includes(result.protocol)) {
    throw new Error(`${label}: поддерживаются только адреса HTTP и HTTPS.`);
  }
  result.hash = "";
  result.search = "";
  result.pathname = result.pathname.replace(/\/+$/u, "");
  return result;
}

function getOnlyOfficeConverterSettings() {
  const converterUrl = normalizeDocumentServiceUrl(
    process.env.ONLYOFFICE_CONVERTER_URL || serverSettings.documentConverterUrl,
    DEFAULT_DOCUMENT_CONVERTER_URL,
    "Адрес ONLYOFFICE"
  );
  const sourceUrl = normalizeDocumentServiceUrl(
    process.env.ONLYOFFICE_SOURCE_URL || serverSettings.documentConverterSourceUrl,
    DEFAULT_DOCUMENT_CONVERTER_SOURCE_URL,
    "Адрес приложения для ONLYOFFICE"
  );
  const jwtSecret = String(
    process.env.ONLYOFFICE_JWT_SECRET || serverSettings.documentConverterJwtSecret || ""
  ).trim();
  if (!jwtSecret) {
    throw new Error("Для конвертера ONLYOFFICE не настроен JWT-секрет.");
  }
  return { converterUrl, sourceUrl, jwtSecret };
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signOnlyOfficeJwt(payload, secret) {
  const encodedHeader = encodeJwtPart({ alg: "HS256", typ: "JWT" });
  const encodedPayload = encodeJwtPart(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function pruneDocumentConversionSources(now = Date.now()) {
  for (const [token, source] of documentConversionSources) {
    if (source.expiresAt <= now) documentConversionSources.delete(token);
  }
}

function registerDocumentConversionSource(bytes) {
  pruneDocumentConversionSources();
  const token = crypto.randomBytes(24).toString("base64url");
  documentConversionSources.set(token, {
    bytes,
    expiresAt: Date.now() + DOCUMENT_CONVERSION_SOURCE_TTL_MS
  });
  return token;
}

function buildDocumentConversionSourceUrl(baseUrl, token) {
  const result = new URL(baseUrl);
  result.pathname = `${result.pathname.replace(/\/+$/u, "")}/api/document-conversion/source/${token}`;
  return result.toString();
}

function onlyOfficeConversionError(code) {
  const messages = new Map([
    [-1, "неизвестная ошибка"],
    [-2, "истекло время конвертации"],
    [-3, "ошибка конвертации документа"],
    [-4, "не удалось скачать исходный документ"],
    [-5, "некорректный пароль документа"],
    [-6, "ошибка базы данных конвертера"],
    [-7, "ошибка входных данных"],
    [-8, "недействительный JWT-токен"]
  ]);
  return messages.get(Number(code)) || `код ошибки ${code}`;
}

async function requestOnlyOfficeConversion(payload, converterUrl, jwtSecret) {
  const endpoint = new URL(converterUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/u, "")}/converter`;
  endpoint.searchParams.set("shardkey", payload.key);
  const bodyToken = signOnlyOfficeJwt(payload, jwtSecret);
  const headerToken = signOnlyOfficeJwt({ payload }, jwtSecret);
  const requestBody = Buffer.from(JSON.stringify({ ...payload, token: bodyToken }), "utf8");
  const deadline = Date.now() + 2 * 60 * 1000;
  do {
    const responseBytes = await requestBuffer(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${headerToken}`,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": requestBody.length
      },
      body: requestBody,
      maxResponseBytes: 1024 * 1024,
      timeoutMs: 30000,
      errorPrefix: "ONLYOFFICE отклонил запрос конвертации",
      timeoutError: "ONLYOFFICE не ответил на запрос конвертации."
    });
    let response;
    try {
      response = JSON.parse(responseBytes.toString("utf8"));
    } catch {
      throw new Error("ONLYOFFICE вернул некорректный ответ.");
    }
    if (response.error !== undefined) {
      throw new Error(`ONLYOFFICE: ${onlyOfficeConversionError(response.error)}.`);
    }
    if (response.endConvert && response.fileUrl) return response.fileUrl;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error("ONLYOFFICE не завершил преобразование в PDF за 2 минуты.");
}

async function convertDocxBytesToPdf(docxBytes) {
  const { converterUrl, sourceUrl, jwtSecret } = getOnlyOfficeConverterSettings();
  const sourceToken = registerDocumentConversionSource(docxBytes);
  const key = crypto
    .createHash("sha256")
    .update(docxBytes)
    .update(sourceToken)
    .digest("hex")
    .slice(0, 32);
  const payload = {
    async: true,
    filetype: "docx",
    key,
    outputtype: "pdf",
    title: "document.docx",
    url: buildDocumentConversionSourceUrl(sourceUrl, sourceToken)
  };
  try {
    const pdfUrl = await requestOnlyOfficeConversion(payload, converterUrl, jwtSecret);
    const pdfBytes = await requestBuffer(pdfUrl, {
      maxResponseBytes: MAX_DOCX_BYTES,
      timeoutMs: 60000,
      errorPrefix: "Не удалось скачать PDF из ONLYOFFICE",
      timeoutError: "Истекло время скачивания PDF из ONLYOFFICE."
    });
    if (!pdfBytes.length || pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("ONLYOFFICE не создал корректный PDF-файл.");
    }
    return pdfBytes;
  } finally {
    documentConversionSources.delete(sourceToken);
  }
}

async function removeBlankInteriorPdfPages(pdfBytes) {
  const document = await PDF_LIB.PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
    updateMetadata: false
  });
  const pages = document.getPages();
  const visibleResourceNames = ["Font", "XObject", "Pattern", "Shading"];
  const blankPageIndexes = [];
  for (let index = 1; index < pages.length - 1; index += 1) {
    const resources = pages[index].node.Resources();
    const hasVisibleResources = Boolean(resources) && visibleResourceNames.some((name) => (
      Boolean(resources.get(PDF_LIB.PDFName.of(name)))
    ));
    if (!hasVisibleResources) blankPageIndexes.push(index);
  }
  if (!blankPageIndexes.length) return pdfBytes;
  blankPageIndexes.reverse().forEach((index) => document.removePage(index));
  return Buffer.from(await document.save({
    addDefaultPage: false,
    useObjectStreams: false,
    updateFieldAppearances: false
  }));
}

function handleDocumentConversionSource(req, res, requestUrl) {
  pruneDocumentConversionSources();
  const prefix = "/api/document-conversion/source/";
  const token = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
  const source = documentConversionSources.get(token);
  if (!source || !token || token.includes("/")) {
    sendError(res, 404, "Временный документ не найден или срок ссылки истёк.");
    return;
  }
  const headers = {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Length": source.bytes.length,
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff"
  };
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : source.bytes);
}

async function handleContractDocument(req, res) {
  try {
    const body = await readJsonBody(req);
    let templateBytes;
    try {
      templateBytes = await loadTemplateBytesForRequest(body);
    } catch (primaryTemplateError) {
      if (!String(body.fallbackTemplatePath || "").trim()) throw primaryTemplateError;
      templateBytes = await loadTemplateBytes("", body.fallbackTemplatePath);
    }
    const inputFieldValues = body.fieldValues || {};
    const fieldValues = body.useCustomDocumentProperties
      ? applyCustomDocumentPropertyFormulas(templateBytes, inputFieldValues, body.sourceValues || {})
      : inputFieldValues;
    const propertyUpdateNames = new Set(Object.keys(inputFieldValues || {}));
    const sourceValues = body.sourceValues || {};
    const documentIdentity = [body.templateUrl, body.templatePath, body.fileName]
      .map((value) => String(value || "").toLocaleLowerCase("ru-RU"))
      .join("\n");
    const omitDocumentPhoto = String(body.documentKind || "").trim() === "employeeAct"
      || documentIdentity.includes("акт оказанных услуг");
    const photo = omitDocumentPhoto ? null : await loadContractPhoto({
      ...fieldValues,
      "Фото": sourceValues["Фото"] || fieldValues["Фото"] || "",
      photo: sourceValues.photo || fieldValues.photo || "",
      photoPath: sourceValues.photoPath || fieldValues.photoPath || ""
    });
    const hasQrCodeField = Object.prototype.hasOwnProperty.call(fieldValues, "QRкод");
    const qrCode = hasQrCodeField
      ? createDocumentQrCodeImage(fieldValues["QRкод"] || sourceValues["QRкод"] || "")
      : null;
    const outputFieldValues = { ...fieldValues, "Фото": "" };
    if (hasQrCodeField) outputFieldValues["QRкод"] = "";
    if (!photo) outputFieldValues["ПутьСохр"] = "";
    const imageValues = { "Фото": photo };
    if (hasQrCodeField) imageValues["QRкод"] = qrCode;
    const docxResult = fillDocxMarkers(
      templateBytes,
      outputFieldValues,
      imageValues,
      propertyUpdateNames
    );
    const requestedOutputFormat = normalizeGeneratedDocumentFormat(body.outputFormat);
    let outputFormat = requestedOutputFormat;
    let result = docxResult;
    const extraHeaders = {};
    if (requestedOutputFormat === "pdf") {
      try {
        result = await convertDocxBytesToPdf(docxResult);
        if (documentIdentity.includes("диплом о переподготовке")) {
          result = await removeBlankInteriorPdfPages(result);
        }
      } catch (conversionError) {
        outputFormat = "docx";
        result = docxResult;
        extraHeaders["X-Document-Conversion-Fallback"] = "true";
        extraHeaders["X-Document-Conversion-Error"] = encodeURIComponent(
          String(conversionError?.message || "PDF-конвертер недоступен").slice(0, 500)
        );
      }
    }
    const outputFileName = safeDocumentFileName(body.fileName || "документ", outputFormat);
    extraHeaders["X-Generated-Document-Format"] = outputFormat;
    extraHeaders["X-Generated-Document-File-Name"] = encodeURIComponent(outputFileName);
    if (body.autoSaveLocal || body.promptLocalSave) {
      try {
        const localSaveResult = body.autoSaveLocal
          ? await saveStudentDocumentLocally(result, outputFileName, body)
          : await promptAndSaveStudentDocumentLocally(
              result,
              outputFileName,
              body,
              outputFormat
            );
        if (localSaveResult.cancelled) {
          extraHeaders["X-Local-Document-Cancelled"] = "true";
        } else {
          extraHeaders["X-Local-Document-Saved"] = "true";
          extraHeaders["X-Local-Document-Path"] = encodeURIComponent(localSaveResult.path);
        }
      } catch (saveError) {
        extraHeaders["X-Local-Document-Saved"] = "false";
        extraHeaders["X-Local-Document-Error"] = encodeURIComponent(saveError.message);
      }
    }
    if (body.saveToYandexDisk) {
      try {
        const uploadedPath = await uploadStudentDocumentToYandexDisk(
          result,
          outputFileName,
          { ...body, outputFormat }
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
      outputFileName,
      generatedDocumentContentType(outputFormat),
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
  return /^(?:Слушатели|Сотрудники)\/[^/]+\/Документы\/[^/]+\.(?:png|jpe?g|webp|gif)$/iu.test(relativePath)
    ? relativePath
    : "";
}

async function deleteManagedStudentPhoto(photoPath) {
  const relativePath = managedStudentPhotoRelativePath(photoPath);
  if (!relativePath) return false;
  if (serverSettings.openDocumentsLocally !== false) {
    const localDocuments = await getLocalSystemDocumentsAvailability();
    if (localDocuments.available) {
      const localPath = resolveLocalDocumentsPath(relativePath, "Не удалось определить путь к фотографии.");
      try {
        await fs.unlink(localPath);
        return true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return false;
      }
    }
  }
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
    const entityType = String(body.entityType || "").trim().toLowerCase() === "contract"
      ? "contract"
      : "student";
    const personName = String(
      body.employeeName || body.contractName || body.studentName || body.studentFio
      || body.fio || body.fullName || body.name || ""
    ).trim();
    const compactName = buildStudentCompactName(personName);
    if (!compactName) {
      throw new Error(entityType === "contract"
        ? "Сначала укажите ФИО сотрудника."
        : "Сначала укажите ФИО слушателя.");
    }
    const relativeRoot = entityType === "contract" ? "Сотрудники" : "Слушатели";
    const relativeFolder = `${relativeRoot}/${compactName}/Документы`;
    const relativePath = `${relativeFolder}/${compactName}.${ext}`;
    const localDocuments = serverSettings.openDocumentsLocally !== false
      ? await getLocalSystemDocumentsAvailability()
      : { available: false };
    if (localDocuments.available) {
      const targetPath = resolveLocalDocumentsPath(relativePath, "Не удалось определить путь к фотографии.");
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, bytes);
    } else {
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
    }
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
    const relativePath = normalizeSystemDocumentsRelativePath(sourcePath);
    const localDocuments = serverSettings.openDocumentsLocally !== false
      ? await getLocalSystemDocumentsAvailability()
      : { available: false };
    let bytes = null;
    if (relativePath && localDocuments.available) {
      const localPath = resolveLocalDocumentsPath(sourcePath, "Не удалось определить путь к фотографии.");
      const stats = await fs.stat(localPath);
      if (stats.isFile() && stats.size > 0 && stats.size <= MAX_STUDENT_PHOTO_BYTES) {
        bytes = await fs.readFile(localPath);
      }
    } else {
      bytes = await loadSystemDocumentFromYandexDisk(sourcePath);
    }
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

async function publicSystemDocumentSettings(includeAdminSettings = false) {
  const localDocuments = await getLocalSystemDocumentsAvailability();
  const settings = {
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
    openDocumentsLocally: serverSettings.openDocumentsLocally !== false,
    localDocumentsAvailable: Boolean(localDocuments.available),
    login: String(serverSettings.yandexDiskLogin || process.env.YANDEX_DISK_LOGIN || "").trim(),
    hasPassword: Boolean(
      serverSettings.yandexDiskPassword || process.env.YANDEX_DISK_PASSWORD
    ),
    autoSave: Boolean(serverSettings.yandexDiskAutoSave),
    emailHost: String(serverSettings.studentApplicationsEmailHost || "").trim(),
    emailPort: Number(serverSettings.studentApplicationsEmailPort || 993),
    emailSmtpHost: String(
      serverSettings.studentApplicationsEmailSmtpHost
        || String(serverSettings.studentApplicationsEmailHost || "").replace(/^imap(?=\.)/i, "smtp")
    ).trim(),
    emailSmtpPort: Number(serverSettings.studentApplicationsEmailSmtpPort || 465),
    emailLogin: String(serverSettings.studentApplicationsEmailLogin || "").trim(),
    emailHasPassword: Boolean(
      serverSettings.studentApplicationsEmailPassword
        || process.env.STUDENT_APPLICATIONS_EMAIL_PASSWORD
    ),
    documentMailboxes: publicStudentDocumentMailboxes(),
    applicationsOrderAdminUrlTemplate: normalizeStudentApplicationsOrderAdminUrlTemplate(
      serverSettings.studentApplicationsOrderAdminUrlTemplate
    )
  };
  if (includeAdminSettings) Object.assign(
    settings,
    publicStudentApplicationsMySqlSettings(),
    publicSharedRecordLocksMySqlSettings()
  );
  return settings;
}

async function handleSystemDocumentSettings(req, res, authUser) {
  const includeAdminSettings = authUser?.role === "admin";
  if (req.method === "GET") {
    sendJson(res, 200, await publicSystemDocumentSettings(includeAdminSettings));
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
    const normalizedLocalDocumentsRoot = normalizeAbsoluteFileSystemPath(localDocumentsRoot);
    if (!normalizedLocalDocumentsRoot) {
      throw new Error("Укажите абсолютный путь к локальной папке документов.");
    }
    const login = String(body.login || "").trim();
    const password = String(body.password || "");
    const emailHost = String(body.emailHost || "").trim();
    const emailPort = Number(body.emailPort || 993);
    const emailSmtpHost = String(
      body.emailSmtpHost || emailHost.replace(/^imap(?=\.)/i, "smtp")
    ).trim();
    const emailSmtpPort = Number(body.emailSmtpPort || 465);
    const emailLogin = String(
      body.emailLogin || DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN
    ).trim();
    const emailPassword = String(body.emailPassword || "");
    const currentDocumentMailboxes = new Map(
      (Array.isArray(serverSettings.studentDocumentMailboxes)
        ? serverSettings.studentDocumentMailboxes
        : []).map((mailbox, index) => {
        const normalized = normalizeStudentDocumentMailbox(mailbox, `mailbox-${index + 1}`);
        return [normalized.id, normalized];
      })
    );
    const documentMailboxesProvided = Array.isArray(body.documentMailboxes);
    const documentMailboxes = (documentMailboxesProvided
      ? body.documentMailboxes.slice(0, 20).map((mailbox, index) => {
        const normalized = normalizeStudentDocumentMailbox(mailbox, `mailbox-${index + 1}`);
        const existing = currentDocumentMailboxes.get(normalized.id);
        normalized.password = mailbox?.clearPassword
          ? ""
          : String(mailbox?.password || existing?.password || "");
        if (!normalized.host) throw new Error(`Укажите IMAP-сервер для ящика «${normalized.label}».`);
        if (!normalized.smtpHost) throw new Error(`Укажите SMTP-сервер для ящика «${normalized.label}».`);
        if (!normalized.login) throw new Error(`Укажите логин для ящика «${normalized.label}».`);
        return normalized;
      })
      : [...currentDocumentMailboxes.values()]);
    const documentMailboxIds = new Set();
    documentMailboxes.forEach((mailbox) => {
      if (documentMailboxIds.has(mailbox.id)) throw new Error("Идентификаторы почтовых ящиков не должны повторяться.");
      documentMailboxIds.add(mailbox.id);
    });
    const applicationsMysqlManagedByEnvironment = Boolean(
      process.env.STUDENT_APPLICATIONS_MYSQL_CONNECTION_STRING
    );
    const currentApplicationsConnection = parseSharedRecordLocksMySqlConnectionString(
      getStudentApplicationsMySqlConnectionString()
    );
    const applicationsMysqlDriver = String(
      body.applicationsMysqlDriver || currentApplicationsConnection.driver || "MySQL ODBC 9.4 Unicode Driver"
    ).trim();
    const applicationsMysqlHost = String(body.applicationsMysqlHost || "").trim();
    const applicationsMysqlPort = Number(body.applicationsMysqlPort || 3306);
    const applicationsMysqlDatabase = String(body.applicationsMysqlDatabase || "").trim();
    const applicationsMysqlUser = String(body.applicationsMysqlUser || "").trim();
    const applicationsMysqlPassword = String(
      body.applicationsMysqlPassword
        || currentApplicationsConnection.pwd
        || currentApplicationsConnection.password
        || ""
    );
    const applicationsSqlQuery = normalizeStudentApplicationsSqlQuery(
      body.applicationsSqlQuery || getStudentApplicationsSqlQuery()
    );
    const applicationsOrderAdminUrlTemplate = normalizeStudentApplicationsOrderAdminUrlTemplate(
      body.applicationsOrderAdminUrlTemplate || serverSettings.studentApplicationsOrderAdminUrlTemplate
    );
    if (!applicationsMysqlManagedByEnvironment) {
      if (!applicationsMysqlDriver || /[;{}]/u.test(applicationsMysqlDriver)) {
        throw new Error("Укажите корректный драйвер ODBC интернет-магазина.");
      }
      if (!applicationsMysqlHost || applicationsMysqlHost.length > 255 || !/^[A-Za-z0-9.-]+$/u.test(applicationsMysqlHost)) {
        throw new Error("Укажите корректный сервер MySQL интернет-магазина.");
      }
      if (!Number.isInteger(applicationsMysqlPort) || applicationsMysqlPort < 1 || applicationsMysqlPort > 65535) {
        throw new Error("Укажите корректный порт MySQL интернет-магазина.");
      }
      if (!applicationsMysqlDatabase || applicationsMysqlDatabase.length > 128 || /[;{}]/u.test(applicationsMysqlDatabase)) {
        throw new Error("Укажите корректное имя базы интернет-магазина.");
      }
      if (!applicationsMysqlUser || applicationsMysqlUser.length > 128 || /[;{}]/u.test(applicationsMysqlUser)) {
        throw new Error("Укажите корректного пользователя базы интернет-магазина.");
      }
      if (!applicationsMysqlPassword || /[{}]/u.test(applicationsMysqlPassword)) {
        throw new Error("Введите пароль базы интернет-магазина без фигурных скобок.");
      }
    }
    const mysqlUseApplicationsConnection = body.mysqlUseApplicationsConnection !== false;
    const mysqlHost = String(body.mysqlHost || "").trim();
    const mysqlPort = Number(body.mysqlPort || 3306);
    const mysqlDatabase = String(body.mysqlDatabase || "").trim();
    const mysqlUser = String(body.mysqlUser || "").trim();
    const mysqlPassword = String(body.mysqlPassword || "");
    if (!Number.isInteger(emailPort) || emailPort < 1 || emailPort > 65535) {
      throw new Error("Укажите корректный порт IMAP.");
    }
    if (emailLogin.toLowerCase() !== DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN) {
      throw new Error(`Для сбора заявок используется ящик ${DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN}.`);
    }
    if (!emailSmtpHost) throw new Error("Укажите SMTP-сервер.");
    if (!Number.isInteger(emailSmtpPort) || emailSmtpPort < 1 || emailSmtpPort > 65535) {
      throw new Error("Укажите корректный порт SMTP.");
    }
    if (!mysqlUseApplicationsConnection) {
      if (!mysqlHost || mysqlHost.length > 255 || !/^[A-Za-z0-9.-]+$/.test(mysqlHost)) {
        throw new Error("Укажите корректный сервер MySQL.");
      }
      if (!Number.isInteger(mysqlPort) || mysqlPort < 1 || mysqlPort > 65535) {
        throw new Error("Укажите корректный порт MySQL.");
      }
      if (!mysqlDatabase || mysqlDatabase.length > 128 || /[;{}]/.test(mysqlDatabase)) {
        throw new Error("Укажите корректное имя базы MySQL.");
      }
      if (!mysqlUser || mysqlUser.length > 128 || /[;{}]/.test(mysqlUser)) {
        throw new Error("Укажите корректного пользователя MySQL.");
      }
      if (!mysqlPassword && !String(serverSettings.sharedRecordLocksMySqlPassword || "")) {
        throw new Error("Введите пароль MySQL для отдельного подключения блокировок.");
      }
      if (mysqlPassword.includes("}")) {
        throw new Error("Пароль MySQL не должен содержать символ «}».");
      }
    }
    const patch = {
      studentDatabaseWebDavPath: databasePath,
      yandexDiskBasePath: basePath.replace(/^\/+/, ""),
      localDocumentsRoot: normalizedLocalDocumentsRoot,
      localDocumentsRootIsSystemParent: Boolean(body.localDocumentsRootIsSystemParent),
      openDocumentsLocally: body.openDocumentsLocally !== false,
      yandexDiskLogin: login,
      yandexDiskAutoSave: Boolean(body.autoSave),
      studentApplicationsEmailHost: emailHost,
      studentApplicationsEmailPort: emailPort,
      studentApplicationsEmailSecure: true,
      studentApplicationsEmailSmtpHost: emailSmtpHost,
      studentApplicationsEmailSmtpPort: emailSmtpPort,
      studentApplicationsEmailSmtpSecure: true,
      studentApplicationsEmailLogin: emailLogin,
      studentApplicationsSqlQuery: applicationsSqlQuery,
      studentApplicationsOrderAdminUrlTemplate: applicationsOrderAdminUrlTemplate,
      sharedRecordLocksMySqlUseApplicationsConnection: mysqlUseApplicationsConnection
    };
    if (!applicationsMysqlManagedByEnvironment) {
      patch.studentApplicationsMySqlConnectionString = buildStudentApplicationsMySqlConnectionString({
        driver: applicationsMysqlDriver,
        host: applicationsMysqlHost,
        port: applicationsMysqlPort,
        database: applicationsMysqlDatabase,
        user: applicationsMysqlUser,
        password: applicationsMysqlPassword
      });
    }
    if (documentMailboxesProvided) patch.studentDocumentMailboxes = documentMailboxes;
    if (!mysqlUseApplicationsConnection) {
      Object.assign(patch, {
        sharedRecordLocksMySqlConnectionString: "",
        sharedRecordLocksMySqlHost: mysqlHost,
        sharedRecordLocksMySqlPort: mysqlPort,
        sharedRecordLocksMySqlDatabase: mysqlDatabase,
        sharedRecordLocksMySqlUser: mysqlUser
      });
      if (mysqlPassword) patch.sharedRecordLocksMySqlPassword = mysqlPassword;
      if (body.clearMysqlPassword) patch.sharedRecordLocksMySqlPassword = "";
    }
    if (password) patch.yandexDiskPassword = password;
    if (body.clearPassword) patch.yandexDiskPassword = "";
    if (emailPassword) patch.studentApplicationsEmailPassword = emailPassword;
    if (body.clearEmailPassword) patch.studentApplicationsEmailPassword = "";
    await saveServerSettings(patch);
    sendJson(res, 200, await publicSystemDocumentSettings(includeAdminSettings));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleSharedRecordLocksMySqlConnectionTest(req, res) {
  try {
    sharedStateMySqlUnavailableUntil = 0;
    if (sharedStateOfflineSyncPromise) {
      await sharedStateOfflineSyncPromise.catch(() => {});
    }
    let pool = await getSharedRecordLocksMySqlPool();
    if (!pool) throw new Error("Подключение MySQL для блокировок не настроено.");
    let rows;
    try {
      [rows] = await pool.query("SELECT DATABASE() AS databaseName, VERSION() AS version");
    } catch (error) {
      if (!isMySqlConnectivityError(error)) throw error;
      await closeSharedRecordLocksStorage();
      sharedStateMySqlUnavailableUntil = 0;
      pool = await getSharedRecordLocksMySqlPool();
      if (!pool) throw error;
      [rows] = await pool.query("SELECT DATABASE() AS databaseName, VERSION() AS version");
    }
    const syncResult = await flushSharedApplicationStateOfflineQueue({ force: true });
    const state = await ensureSharedApplicationStateMySqlDocument(pool);
    const pending = await readSharedApplicationStatePendingDocument();
    const settings = publicSharedRecordLocksMySqlSettings();
    const flushed = Math.max(0, Number(syncResult?.flushed) || 0);
    const pendingCount = pending.operations.length;
    const syncBlockedReason = String(syncResult?.syncBlockedReason || "");
    const message = pendingCount
      ? "Подключение MySQL работает. Общая база доступна, оставшиеся изменения будут выгружены автоматически."
      : flushed
        ? `Подключение MySQL работает. Общая база синхронизирована, выгружено изменений: ${flushed}.`
        : "Подключение MySQL работает. Общая база данных и таблица блокировок доступны.";
    sendJson(res, 200, {
      ok: true,
      source: "mysql",
      database: String(rows[0]?.databaseName || settings.mysqlDatabase || ""),
      version: String(rows[0]?.version || "").slice(0, 80),
      stateRevision: state.document?.revision || 0,
      flushed,
      pendingCount,
      syncPending: pendingCount > 0,
      syncBlockedReason,
      syncBlockedLock: syncResult?.syncBlockedLock || null,
      message
    });
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
      smtpHost: settings.smtpHost,
      message: "Подключение к почтовому ящику по IMAP и SMTP работает."
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentApplicationsMySqlConnectionTest(req, res) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await runStudentApplicationsQuery({
      dateFrom: today,
      dateTo: today,
      programName: "",
      productId: "",
      onlyPaid: false
    });
    const settings = publicStudentApplicationsMySqlSettings();
    sendJson(res, 200, {
      ok: true,
      database: settings.applicationsMysqlDatabase,
      rows: Number(result?.total || 0),
      message: "Подключение к базе интернет-магазина и SQL-запрос работают."
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleStudentDocumentMailboxConnectionTest(req, res) {
  try {
    const body = await readJsonBody(req);
    const settings = getStudentDocumentMailboxSettings(body.mailboxId);
    const client = await connectStudentApplicationsImap(settings);
    await client.close();
    sendJson(res, 200, {
      ok: true,
      mailboxId: settings.id,
      login: settings.login,
      message: `Подключение к ящику «${settings.label}» по IMAP работает.`
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleServerEmail(req, res, authUser) {
  let auditContext = {};
  let auditRecipient = "";
  let auditSubject = "";
  let auditAttachmentName = "";
  const writeEmailAudit = async (action, details, source = "smtp") => {
    const studentId = auditText(auditContext.studentId, 240);
    const studentName = auditText(auditContext.studentName, 500);
    const contractId = auditText(auditContext.contractId, 240);
    const contractName = auditText(auditContext.contractName, 500);
    const requestedEntityType = auditText(auditContext.entityType, 40);
    const entityType = ["students", "contracts"].includes(requestedEntityType)
      ? requestedEntityType
      : (contractId ? "contracts" : (studentId ? "students" : "email"));
    const entityId = auditText(
      auditContext.entityId || (entityType === "contracts" ? contractId : studentId),
      240
    );
    const entityLabel = auditText(
      auditContext.entityName || (entityType === "contracts" ? contractName : studentName),
      500
    );
    await safelyAppendAuditEntry({
      action,
      area: "Электронная почта",
      entityType,
      entityId,
      entityLabel: entityLabel || auditRecipient,
      field: "email",
      after: auditRecipient,
      details,
      source
    }, authUser, req);
  };
  try {
    if (String(req.headers["x-requested-with"] || "") !== "AIS-Web") {
      sendError(res, 403, "Запрос отправки письма отклонён сервером.");
      return;
    }
    const remoteAddress = String(req.socket.remoteAddress || "unknown");
    const now = Date.now();
    const recentAttempts = (serverEmailRateLimits.get(remoteAddress) || [])
      .filter((timestamp) => timestamp > now - 60 * 1000);
    if (recentAttempts.length >= 20) {
      sendError(res, 429, "Слишком много писем. Повторите отправку через минуту.");
      return;
    }
    recentAttempts.push(now);
    serverEmailRateLimits.set(remoteAddress, recentAttempts);

    const body = await readJsonBody(req);
    auditContext = body.auditContext && typeof body.auditContext === "object"
      ? body.auditContext
      : {};
    const to = String(body.to || "").trim();
    const subject = normalizeEmailSubject(body.subject);
    const message = String(body.message || "").trim();
    auditRecipient = to;
    auditSubject = subject;
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(to) || /[\r\n]/u.test(to)) {
      throw new Error("Некорректный адрес получателя.");
    }
    if (!subject || Array.from(subject).length > MAX_EMAIL_SUBJECT_LENGTH) {
      throw new Error("Некорректная тема письма.");
    }
    if (!message || Buffer.byteLength(message, "utf8") > 100000) {
      throw new Error("Некорректный текст письма.");
    }
    let attachment = null;
    if (body.attachment !== undefined && body.attachment !== null) {
      const fileName = String(body.attachment.fileName || "").trim();
      const contentType = String(body.attachment.contentType || "").trim().toLowerCase();
      const base64 = String(body.attachment.base64 || "").replace(/\s+/g, "");
      const allowedAttachments = new Map([
        ["application/pdf", ".pdf"],
        ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"]
      ]);
      const requiredExtension = allowedAttachments.get(contentType);
      if (!fileName || fileName.length > 180 || /[\r\n\\/:*?"<>|]/u.test(fileName)) {
        throw new Error("Некорректное имя вложения.");
      }
      if (!requiredExtension || path.extname(fileName).toLowerCase() !== requiredExtension) {
        throw new Error("Недопустимый формат вложения.");
      }
      if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(base64)) {
        throw new Error("Некорректные данные вложения.");
      }
      const bytes = Buffer.from(base64, "base64");
      if (!bytes.length || bytes.length > MAX_DOCX_BYTES) {
        throw new Error("Вложение пустое или превышает допустимый размер.");
      }
      if (
        (requiredExtension === ".pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
        || (requiredExtension === ".docx" && bytes.subarray(0, 2).toString("ascii") !== "PK")
      ) {
        throw new Error("Содержимое вложения не соответствует указанному формату.");
      }
      attachment = { fileName, contentType, bytes };
      auditAttachmentName = fileName;
    }
    const settings = await sendEmailThroughConfiguredMailbox({ to, subject, message, attachment });
    const messageType = auditText(auditContext.messageType, 240) || "Письмо";
    const recipientMode = auditContext.recipientMode === "system"
      ? "системный ящик"
      : (auditContext.recipientMode === "employee" ? "сотрудник" : "слушатель");
    await writeEmailAudit(
      "Отправлено письмо",
      [
        `Тип: ${messageType}`,
        `Получатель: ${auditRecipient} (${recipientMode})`,
        `Тема: ${auditSubject}`,
        auditAttachmentName ? `Вложение: ${auditAttachmentName}` : "Без вложения",
        `Отправитель: ${settings.login}`
      ].join("; ")
    );
    sendJson(res, 200, {
      ok: true,
      from: settings.login
    });
  } catch (error) {
    console.warn(`Не удалось отправить письмо через настроенный ящик: ${error.message}`);
    await writeEmailAudit(
      "Ошибка отправки письма",
      [
        auditContext.messageType ? `Тип: ${auditText(auditContext.messageType, 240)}` : "Тип: письмо",
        auditRecipient ? `Получатель: ${auditRecipient}` : "Получатель не определён",
        auditSubject ? `Тема: ${auditSubject}` : "Тема не определена",
        auditAttachmentName ? `Вложение: ${auditAttachmentName}` : "Без вложения",
        `Ошибка: ${auditText(error.message, 1000)}`
      ].join("; ")
    );
    sendError(res, 502, error.message);
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
    const headers = {
      ...CORS_HEADERS,
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    };
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
    const headers = requestUrl.pathname.startsWith("/api/students/recognize-documents/")
      ? { ...CORS_HEADERS, "Access-Control-Allow-Headers": "Content-Type, X-Requested-With" }
      : CORS_HEADERS;
    res.writeHead(204, headers);
    res.end();
    return;
  }
  if (requestUrl.pathname.startsWith("/api/auth/")) {
    try {
      if (req.method === "POST" && requestUrl.pathname === "/api/auth/login") {
        await handleAuthLogin(req, res);
        return;
      }
      const authUser = await getRequestAuthUser(req);
      if (req.method === "GET" && requestUrl.pathname === "/api/auth/me") {
        await handleAuthMe(req, res, authUser);
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/api/auth/logout") {
        await handleAuthLogout(req, res);
        return;
      }
      if (!authUser) {
        sendError(res, 401, "Требуется вход в систему.");
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/api/auth/profile") {
        await handleAuthProfile(req, res, authUser);
        return;
      }
      if (req.method === "POST" && requestUrl.pathname === "/api/auth/password") {
        await handleAuthPassword(req, res, authUser);
        return;
      }
      sendError(res, 405, "Method not allowed");
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      storage: "mysql",
      sharedStateStorage: "mysql",
      offlineQueueStorage: "local",
      sharedStatePollIntervalMs: 1000
    });
    return;
  }
  if (
    ["GET", "HEAD"].includes(req.method)
    && requestUrl.pathname.startsWith("/api/document-conversion/source/")
  ) {
    handleDocumentConversionSource(req, res, requestUrl);
    return;
  }
  const authUser = await getRequestAuthUser(req);
  const protectedRequest = requestUrl.pathname.startsWith("/api/")
    || requestUrl.pathname.startsWith("/data/")
    || requestUrl.pathname === "/send-mail.php";
  if (protectedRequest && !authUser) {
    sendError(res, 401, "Требуется вход в систему.");
    return;
  }
  try {
    if (await handleAuditRequest(req, res, authUser, requestUrl)) return;
  } catch (error) {
    sendError(res, 400, error.message);
    return;
  }
  if (requestUrl.pathname === "/api/admin/users") {
    try {
      await handleAdminUsers(req, res, authUser);
    } catch (error) {
      sendError(res, 400, error.message);
    }
    return;
  }
  const adminOnlyRequest = (
    (req.method === "POST" && requestUrl.pathname === "/api/settings/system-documents")
    || [
      "/api/yandex-disk/test",
      "/api/student-applications-email/test",
      "/api/student-applications-mysql/test",
      "/api/student-document-mailboxes/test",
      "/api/mysql-locks/test"
    ].includes(requestUrl.pathname)
    || requestUrl.pathname === "/api/students/export-database"
    || requestUrl.pathname.startsWith("/api/students/export-database/")
  );
  if (adminOnlyRequest && authUser?.role !== "admin") {
    sendError(res, 403, "Раздел доступен только администратору.");
    return;
  }
  if (requestUrl.pathname === "/api/shared-state/locks") {
    await handleSharedRecordLocks(req, res, authUser, requestUrl);
    return;
  }
  if (requestUrl.pathname === "/api/shared-state") {
    await handleSharedApplicationState(req, res, authUser, requestUrl);
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
    await handleSystemDocumentSettings(req, res, authUser);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/local-documents/open-folder") {
    await handleOpenLocalDocumentsFolder(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/local-documents/open-resource") {
    await handleOpenLocalDocumentResource(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/local-documents/resolve-file") {
    await handleResolveLocalDocumentFile(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/local-documents/reveal-file") {
    await handleRevealLocalDocumentFile(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/documents/template-reveal-local") {
    await handleRevealLocalDocumentTemplate(req, res);
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
  if (req.method === "POST" && requestUrl.pathname === "/api/student-applications-mysql/test") {
    await handleStudentApplicationsMySqlConnectionTest(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/student-document-mailboxes/test") {
    await handleStudentDocumentMailboxConnectionTest(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/mysql-locks/test") {
    await handleSharedRecordLocksMySqlConnectionTest(req, res);
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
  if (req.method === "POST" && requestUrl.pathname === "/api/students/mailbox-documents/query") {
    await handleStudentMailboxMessagesQuery(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/mailbox-documents/import") {
    await handleStudentMailboxMessagesImport(req, res, authUser);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/webdav-documents/list") {
    await handleStudentWebDavDocumentsList(req, res);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/students/webdav-documents/file") {
    await handleStudentWebDavDocumentFile(req, res, requestUrl);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/students/webdav-documents/preview") {
    await handleStudentWebDavDocumentPreview(req, res, requestUrl);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/webdav-documents/upload") {
    await handleStudentWebDavDocumentUpload(req, res);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/ocr/health") {
    await handleOcrHealth(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/recognize-documents/files") {
    await handleStudentDocumentRecognitionFiles(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/recognize-documents/start") {
    await handleStudentDocumentRecognitionStart(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/recognize-documents/direct") {
    await handleStudentDocumentRecognitionDirect(req, res);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/students/recognize-documents/status") {
    handleStudentDocumentRecognitionStatus(req, res, requestUrl);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/students/recognize-documents/result") {
    handleStudentDocumentRecognitionResult(req, res, requestUrl);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/students/recognize-documents/page") {
    await handleStudentDocumentRecognitionPage(req, res);
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
  if (req.method === "GET" && requestUrl.pathname === "/api/students/export-database/download") {
    handleStudentDatabaseExportDownload(res, requestUrl);
    return;
  }
  if (req.method === "POST" && req.url === "/api/students/export-database") {
    await handleStudentDatabaseExport(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/issued-documents/frdo-export") {
    await handleFrdoExport(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/contracts/student-document") {
    await handleContractDocument(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/send-mail.php") {
    await handleServerEmail(req, res, authUser);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }
  sendError(res, 405, "Method not allowed");
}

if (isMainThread && require.main === module) {
  ensureStorage()
    .then(() => {
      startSharedApplicationStateMirror();
      http.createServer((req, res) => {
        route(req, res).catch((error) => sendError(res, 500, error.message));
      }).listen(PORT, HOST, () => {
        console.log(`АИС Допобразование Web: http://${HOST}:${PORT}`);
        console.log(`Фото: ${PHOTO_ROOT}`);
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  ensureStorage,
  closeSharedRecordLocksStorage,
  closeStudentApplicationsMySqlStorage,
  optimizeStudentApplicationsSqlQuery,
  runStudentApplicationsQuery,
  parseStudentDatabaseWorkbook,
  sanitizeStudentDatabaseExportPayload,
  sanitizeFrdoExportPayload,
  buildFrdoExportWorkbook,
  inspectStudentDatabaseBinary,
  collectEmailMessageContent,
  parseStudentApplicationOrderEmail,
  mergeStudentApplicationRows,
  parseImapBodyStructureAttachments,
  parseStudentMailboxMessage,
  prepareStudentMailboxAttachmentForSave,
  getStudentMailboxFileNameCandidate,
  publicStudentDocumentMailboxes,
  queryStudentMailboxMessages,
  applyCustomDocumentPropertyFormulas,
  convertDocxBytesToPdf,
  createDocumentQrCodeImage,
  removeBlankInteriorPdfPages,
  evaluateDocumentFormula,
  extractWebDavBrowserPreviewText,
  fillDocxMarkers,
  getWebDavBrowserIconKind,
  getWebDavBrowserPreviewKind,
  handleDocumentConversionSource,
  readDocxZipEntries,
  route
};
