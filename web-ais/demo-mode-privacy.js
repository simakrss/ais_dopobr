"use strict";

const crypto = require("node:crypto");

const DEMO_MODE_MASK_TEXT = "Данные скрыты";
const DEMO_MODE_EPHEMERAL_ID_SECRET = crypto.randomBytes(32);

const DEMO_MODE_PHOTO_KEYS = new Set([
  "photo",
  "photodata",
  "photopath",
  "photourl",
  "avatar",
  "avatarurl",
  "image",
  "imageurl"
]);

const DEMO_MODE_PERSON_COLLECTIONS = new Set([
  "students",
  "contracts",
  "users",
  "webinars"
]);

const DEMO_MODE_PERSON_SAFE_FIELDS = new Set([
  "id",
  "uid",
  "recordid",
  "status",
  "additionalstatus",
  "program",
  "programid",
  "programtype",
  "studyform",
  "educationtype",
  "hours",
  "group",
  "applicationdate",
  "startdate",
  "enddate",
  "trainingstartdate",
  "trainingenddate",
  "extendedtrainingenddate",
  "paymentstatus",
  "payment",
  "paidamount",
  "balance",
  "amount",
  "cost",
  "contractamount",
  "monthlyamount",
  "agentamount",
  "expensetotal",
  "discount",
  "discountunit",
  "rate",
  "active",
  "isactive",
  "type",
  "contracttype",
  "employmenttype",
  "role",
  "createdat",
  "updatedat",
  "sortorder",
  "extendedenddate",
  "enrollmentdate",
  "expulsiondate",
  "deliverydate",
  "frdodate",
  "fundingsource",
  "finalgrade",
  "internship",
  "reviewpublished",
  "accountingrecorded"
]);

const DEMO_MODE_COLLECTION_SAFE_FIELDS = new Map([
  ["programs", new Set([
    "id", "name", "shortname", "status", "price", "oldprice", "type", "hours", "duration",
    "landingcode", "promosite", "studyform", "qualification", "activityscope", "fgos",
    "fgoscompetency", "professionalstandard", "professionalstandardfunctions", "frdoprofessionalarea",
    "economicactivity", "minimumeducationlevel", "groupindex", "xlsbprogramname", "xlsbprogramrow",
    "xlsbprogramlandingcode", "defaultauthorpaymentpercent"
  ])],
  ["trainingPlans", new Set([
    "id", "code", "programid", "programname", "discipline", "totalhours", "theoryhours",
    "practicehours", "attestation", "xlsbtrainingplanrow"
  ])],
  ["directExpenses", new Set([
    "id", "uid", "date", "type", "amount", "act", "actstatus", "inventoryid", "inventorylink"
  ])],
  ["generalExpenses", new Set([
    "id", "section", "date", "worktype", "amount", "paid", "accountingclosed", "bkexpenseno", "otherexpenses"
  ])],
  ["inventory", new Set(["id", "uid", "date", "itemtype", "amount", "balance"])],
  ["audit", new Set()],
  ["recycleBin", new Set()]
]);

const DEMO_MODE_SAFE_DICTIONARIES = new Set([
  "citizenships",
  "contractTypes",
  "documentTypes",
  "economicActivities",
  "educationDocumentTypes",
  "educationLevels",
  "educationRegistrationTypeCodes",
  "employmentCategories",
  "expenseTypes",
  "frdoProfessionalAreas",
  "fundingSources",
  "inventoryTypes",
  "minimumEducationLevels",
  "ovzStatuses",
  "programStatuses",
  "roles",
  "statuses",
  "studentAdditionalStatuses",
  "studyForms",
  "trainingPlanAttestationTypes"
]);

const DEMO_MODE_SAFE_META_FIELDS = new Set([
  "appName",
  "organization",
  "extractedAt",
  "programRegistryVersion",
  "programPaymentRegistryVersion"
]);

const DEMO_MODE_SENSITIVE_FIELD = /(?:^|_)(?:fullname|fio|firstname|lastname|middlename|patronymic|nameenglish|student_name|employee_name|person_name|customer_name|payer_name|recipient_name|representative_name|agent_name|manager_name|entitylabel|student|employee|person|phone|mobile|telephone|email|mail|contact|telegram|whatsapp|messenger|max|passport|identity|snils|inn|address|residence|birth|birthday|diploma|certificate|educationdocument|education_document|documentnumber|documentseries|registrationnumber|registration_number|issuedby|issuer|issueplace|login|password|credential|portalcredential|customer|payer|recipient|representative|agentname|manager|managername|teacher|author|developer|user|owner|createdby|updatedby|deletedby|workplace|position|organization|counterparty|supplier|contractor|bank|account|bik|kpp|ogrn|comment|note|details|message|review|event|history|conflict|recognition|recommendation|chair|chairman|commission|commission_member\d*|commissionmember\d*|secretary|before|after|changes|oldvalue|newvalue|valuehistory)(?:$|_)/i;

const DEMO_MODE_NAME_FIELD = /^(?:name|fullname|fio|studentname|employeename|customername|payername|recipientname|representativename)$/i;
const DEMO_MODE_PERSONNEL_FIELD = /(?:fullname|fio|manager|teacher|author|developer|commission|secretary|chair|counterparty|customer|payer|recipient|representative|employee|student)/i;
const DEMO_MODE_ORGANIZATION_NAME_MARKER = /^(?:ООО|АО|ПАО|ЗАО|ОАО|ИП|АНО|НКО|ФГБОУ|ФГАОУ|ФГКОУ|ГБОУ|МБОУ|ЧОУ)(?:\s|$)/iu;
const DEMO_MODE_STRUCTURAL_FIELDS = new Set([
  "id",
  "uid",
  "recordid",
  "programid",
  "studentid",
  "contractid",
  "employeeid",
  "expenseid",
  "parentid",
  "sourceid",
  "linkedid",
  "inventoryid",
  "inventorylink"
]);

function normalizeDemoModeKey(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isDemoModePhotoKey(key) {
  return /фото/iu.test(String(key || ""))
    || DEMO_MODE_PHOTO_KEYS.has(normalizeDemoModeKey(key).replaceAll("_", ""));
}

function isDemoModeSensitiveField(key) {
  if (/(?:фио|фамил|имя|отчеств|телефон|мобильн|почт|мессендж|телеграм|ватсап|паспорт|снилс|инн|адрес|рождени|диплом|удостоверени|документ.*образован|логин|парол|банк|сч[её]т|коммент|примечани)/iu.test(String(key || ""))) {
    return true;
  }
  const normalized = normalizeDemoModeKey(key);
  return Boolean(normalized && DEMO_MODE_SENSITIVE_FIELD.test(`_${normalized}_`));
}

function isDemoModePersonOperationalField(key) {
  const normalized = normalizeDemoModeKey(key).replaceAll("_", "");
  return DEMO_MODE_PERSON_SAFE_FIELDS.has(normalized);
}

function maskDemoModeValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return [];
  if (typeof value === "object") return {};
  if (typeof value === "boolean") return false;
  if (typeof value === "string" && value.trim() === "") return value;
  return DEMO_MODE_MASK_TEXT;
}

function looksLikeDemoModePersonName(value) {
  const source = String(value || "").trim().replace(/\s+/gu, " ");
  if (!source || source.length > 240 || DEMO_MODE_ORGANIZATION_NAME_MARKER.test(source)) return false;
  const parts = source.split(" ");
  if (parts.length < 2 || parts.length > 5) return false;
  return parts.every((part) => (
    /^\p{Lu}[\p{L}'’ʼ-]+$/u.test(part)
    || /^(?:\p{Lu}\.){1,3}$/u.test(part)
    || /^\p{Lu}\.?$/u.test(part)
  ));
}

function collectDemoModePersonNames(data) {
  const values = new Set();
  const visit = (value, context = {}) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, context));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = normalizeDemoModeKey(key).replaceAll("_", "");
      if (
        typeof nested === "string"
        && nested.trim().length >= 5
        && looksLikeDemoModePersonName(nested)
        && (
          (context.personCollection && DEMO_MODE_NAME_FIELD.test(normalizedKey))
          || context.personNameValue
          || DEMO_MODE_PERSONNEL_FIELD.test(normalizedKey)
        )
      ) {
        values.add(nested.trim());
      }
      visit(nested, {
        ...context,
        personNameValue: DEMO_MODE_PERSONNEL_FIELD.test(normalizedKey)
      });
    }
  };
  const collections = data?.collections && typeof data.collections === "object"
    ? data.collections
    : {};
  for (const [collection, rows] of Object.entries(collections)) {
    visit(rows, { personCollection: DEMO_MODE_PERSON_COLLECTIONS.has(collection) });
  }
  return values;
}

function buildDemoModeKnownNamePattern(knownNames) {
  const escaped = [...knownNames]
    .filter((value) => value && value !== DEMO_MODE_MASK_TEXT)
    .sort((left, right) => right.length - left.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return null;
  try {
    return new RegExp(escaped.join("|"), "giu");
  } catch {
    return null;
  }
}

function sanitizeDemoModeString(value, knownNamePattern) {
  let result = String(value);
  if (!result || result === DEMO_MODE_MASK_TEXT) return result;
  if (knownNamePattern) result = result.replace(knownNamePattern, DEMO_MODE_MASK_TEXT);
  return result
    .replace(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[A-Za-zА-Яа-яЁё]{2,}/gu, DEMO_MODE_MASK_TEXT)
    .replace(/https?:\/\/(?:t\.me|telegram\.me|max\.ru|wa\.me|api\.whatsapp\.com)\/[^\s"'<>]+/giu, DEMO_MODE_MASK_TEXT)
    .replace(/(?:\+7|8)[\s()\-]*\d{3}[\s()\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/gu, DEMO_MODE_MASK_TEXT)
    .replace(/\b\d{3}-?\d{3}-?\d{3}[\s-]?\d{2}\b/gu, DEMO_MODE_MASK_TEXT)
    .replace(/\b\d{2}[\s-]?\d{2}[\s-]?\d{6}\b/gu, DEMO_MODE_MASK_TEXT)
    .replace(/\b(?:\d{10}|\d{12})\b/gu, DEMO_MODE_MASK_TEXT);
}

function demoModeOpaqueId(value, idSecret = DEMO_MODE_EPHEMERAL_ID_SECRET) {
  const source = String(value ?? "").trim();
  if (!source) return value;
  return `demo-id-${crypto
    .createHmac("sha256", idSecret || DEMO_MODE_EPHEMERAL_ID_SECRET)
    .update(source, "utf8")
    .digest("base64url")
    .slice(0, 24)}`;
}

function demoModePhotoToken(collection, recordId, idSecret = DEMO_MODE_EPHEMERAL_ID_SECRET) {
  return crypto
    .createHmac("sha256", idSecret || DEMO_MODE_EPHEMERAL_ID_SECRET)
    .update(`${String(collection || "")}\0${String(recordId || "")}`, "utf8")
    .digest("base64url")
    .slice(0, 24);
}

function sanitizeDemoSharedState(source, options = {}) {
  if (!source || typeof source !== "object") return source;
  const idSecret = options.idSecret || DEMO_MODE_EPHEMERAL_ID_SECRET;
  const knownNames = collectDemoModePersonNames(source);
  const knownNamePattern = buildDemoModeKnownNamePattern(knownNames);

  const visit = (value, context = {}) => {
    if (Array.isArray(value)) return value.map((item) => visit(item, context));
    if (!value || typeof value !== "object") {
      if (context.structuralField) return demoModeOpaqueId(value, idSecret);
      return typeof value === "string"
        ? sanitizeDemoModeString(value, knownNamePattern)
        : value;
    }
    if (context.root) {
      const rootResult = {};
      if (Object.prototype.hasOwnProperty.call(value, "collections")) {
        rootResult.collections = visit(value.collections, { atCollectionsRoot: true });
      }
      if (Object.prototype.hasOwnProperty.call(value, "dictionaries")) {
        rootResult.dictionaries = visit(value.dictionaries, { atDictionariesRoot: true });
      }
      if (Object.prototype.hasOwnProperty.call(value, "meta")) {
        const sourceMeta = value.meta && typeof value.meta === "object" ? value.meta : {};
        rootResult.meta = Object.fromEntries(
          Object.entries(sourceMeta)
            .filter(([metaKey]) => DEMO_MODE_SAFE_META_FIELDS.has(metaKey))
            .map(([metaKey, metaValue]) => [metaKey, visit(metaValue, {})])
        );
      }
      return rootResult;
    }
    if (context.atCollectionsRoot) {
      return Object.fromEntries(Object.entries(value).map(([collection, rows]) => [
        collection,
        ["audit", "recycleBin"].includes(collection)
          ? []
          : visit(rows, {
              collection,
              personCollection: DEMO_MODE_PERSON_COLLECTIONS.has(collection),
              safeFields: DEMO_MODE_COLLECTION_SAFE_FIELDS.get(collection) || null
            })
      ]));
    }
    if (context.atDictionariesRoot) {
      return Object.fromEntries(Object.entries(value).map(([dictionary, rows]) => [
        dictionary,
        DEMO_MODE_SAFE_DICTIONARIES.has(dictionary)
          ? visit(rows, { dictionary })
          : (Array.isArray(rows) ? [] : {})
      ]));
    }
    const result = {};
    const personRecordId = context.personCollection
      ? String(value.id || value.uid || "").trim()
      : "";
    const personPhotoAvailable = Boolean(
      personRecordId
      && (value.photoPath || value.photoUrl || value.photoData || value.photo)
    );
    const recycleCollection = context.collection === "recycleBin"
      ? String(value.collection || "")
      : "";
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = normalizeDemoModeKey(key).replaceAll("_", "");
      const nextContext = {
        ...context,
        structuralField: DEMO_MODE_STRUCTURAL_FIELDS.has(normalizedKey)
      };
      if (isDemoModePhotoKey(key)) {
        result[key] = personRecordId ? "" : nested;
        continue;
      }
      if (key === "record" && DEMO_MODE_PERSON_COLLECTIONS.has(recycleCollection)) {
        result[key] = visit(nested, {
          collection: recycleCollection,
          personCollection: true
        });
        continue;
      }
      if (key === "label" && DEMO_MODE_PERSON_COLLECTIONS.has(recycleCollection)) {
        result[key] = maskDemoModeValue(nested);
        continue;
      }
      const sensitiveField = isDemoModeSensitiveField(key);
      const personFieldIsPrivate = nextContext.personCollection
        && !isDemoModePersonOperationalField(key);
      const collectionFieldIsPrivate = !nextContext.personCollection
        && nextContext.collection
        && (!nextContext.safeFields || !nextContext.safeFields.has(normalizedKey));
      if (sensitiveField || personFieldIsPrivate || collectionFieldIsPrivate) {
        result[key] = maskDemoModeValue(nested);
        continue;
      }
      result[key] = visit(nested, nextContext);
    }
    if (personRecordId) {
      result.photoPath = personPhotoAvailable
        ? `demo-photo:${context.collection}:${demoModePhotoToken(context.collection, personRecordId, idSecret)}`
        : "";
      if (Object.prototype.hasOwnProperty.call(value, "photoUrl")) result.photoUrl = "";
      if (Object.prototype.hasOwnProperty.call(value, "photoData")) result.photoData = "";
    }
    return result;
  };

  const sanitized = visit(source, { root: true });
  sanitized.meta = sanitized.meta && typeof sanitized.meta === "object" ? sanitized.meta : {};
  sanitized.meta.databaseDemoMode = true;
  return sanitized;
}

function redactDemoAuthUser(user) {
  if (!user || typeof user !== "object") return user;
  return {
    id: "demo-user",
    login: "demo",
    name: user.role === "admin" ? "Демо-администратор" : "Демо-пользователь",
    role: String(user.role || "manager"),
    status: String(user.status || "active"),
    email: "",
    phone: "",
    employeeId: "",
    createdAt: "",
    updatedAt: "",
    lastLoginAt: ""
  };
}

function sanitizeDemoSharedStateMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return metadata;
  return {
    exists: metadata.exists !== false,
    revision: Math.max(0, Number(metadata.revision) || 0),
    updatedAt: String(metadata.updatedAt || ""),
    updatedBy: metadata.updatedBy ? DEMO_MODE_MASK_TEXT : "",
    version: Math.max(0, Number(metadata.version) || 0),
    versionTag: String(metadata.versionTag || ""),
    source: "demo",
    offline: Boolean(metadata.offline),
    writable: false,
    pendingCount: 0,
    syncPending: false,
    syncBlockedReason: "",
    syncBlockedLock: null,
    warning: metadata.warning ? "Служебное предупреждение скрыто в деморежиме." : ""
  };
}

module.exports = {
  DEMO_MODE_MASK_TEXT,
  isDemoModePhotoKey,
  isDemoModePersonOperationalField,
  isDemoModeSensitiveField,
  demoModeOpaqueId,
  demoModePhotoToken,
  sanitizeDemoSharedState,
  sanitizeDemoSharedStateMetadata,
  redactDemoAuthUser
};
