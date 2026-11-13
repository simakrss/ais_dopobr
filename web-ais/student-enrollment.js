"use strict";
const crypto = require("node:crypto");
const feedbackHistory = require("./student-feedback-history.js");
const text = value => String(value ?? "").trim();
const identity = value => text(value).normalize("NFKC").toLocaleLowerCase("ru-RU");
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const FIELDS = Object.freeze([
  ["name", "ФИО", "text"], ["phone", "Телефон", "tel"],
  ["birthDate", "Дата рождения", "date"], ["gender", "Пол", "select", ["Женский", "Мужской"]],
  ["citizenship", "Гражданство", "text"], ["registrationAddress", "Адрес регистрации", "textarea"],
  ["mailingAddress", "Почтовый адрес проживания с индексом", "textarea"],
  ["workPlace", "Место работы (если не работаете — «Не работаю»)", "text"],
  ["position", "Должность (если не работаете — «Не работаю»)", "text"],
  ["passportType", "Вид документа, удостоверяющего личность", "text"],
  ["passportNumber", "Серия и номер документа", "text"], ["passportDate", "Дата выдачи", "date"],
  ["passportIssuer", "Кем выдан", "textarea"], ["snils", "СНИЛС (для граждан РФ)", "text"],
  ["educationLevel", "Уровень образования", "text"],
  ["enrollmentEducationMode", "Подтверждение образования", "select", ["Диплом с приложением", "Справка с места учёбы"]],
  ["enrollmentNameChanged", "ФИО в документе об образовании отличается от паспорта", "checkbox"],
  ["educationDocumentSurname", "Фамилия в документе об образовании", "text"]
]);
const DOCS = Object.freeze({ passport: "Паспорт: основная страница", registration: "Паспорт: регистрация",
  snils: "СНИЛС", diploma: "Диплом об образовании", supplement: "Приложение к диплому",
  study: "Справка с места учёбы", nameChange: "Документ о перемене ФИО" });
function russianCitizen(record) { return /^(?:рф|россия|российская федерация|гражданин рф|643)$/iu.test(text(record.citizenship)); }
const professional = record => !["ДОП", "ПРО"].includes(text(record.educationType));
const portalLogin = record => text(record.studentPortalLogin || record.login);
const portalPassword = record => text(record.studentPortalPassword || record.password);
function documentFolder(record) {
  if (record.studentPortalDocumentsFolder) return record.studentPortalDocumentsFolder;
  let source = text(record.photoPath).replace(/\\/g, "/").replace(/^[a-z]:\/+/i, "");
  const parent = /^\[-1\](?:\/+|$)/u.test(source);
  source = source.replace(/^\[-1\]\/+/u, "");
  const marker = "аис допобразование/", index = source.toLocaleLowerCase("ru-RU").indexOf(marker);
  if (index >= 0) source = source.slice(index + marker.length);
  const parts = source.split("/").map(text).filter(Boolean);
  if (/\.[a-z0-9]{2,5}$/i.test(parts.at(-1) || "")) parts.pop();
  return parts.length > 1 && !parts.some(part => [".", ".."].includes(part))
    ? `${parent ? "[-1]/" : ""}${parts.join("/")}` : `Слушатели/${record.id}/Документы`;
}
const PROFILE_LISTS = {
  citizenship: ["citizenships", ["Россия"]],
  passportType: ["documentTypes", ["Паспорт гражданина РФ", "Иностранный паспорт", "Вид на жительство", "Свидетельство о рождении"]],
  educationLevel: ["educationLevels", ["СПО", "Бакалавр", "Специалист", "Магистр", "Аттестат"]],
  workPlace: ["workPlaces", ["Не работаю"]], position: ["positions", ["Не работаю"]], passportIssuer: ["passportIssuers", []]
};
// Match the student card's getLookupOptions: dictionary + saved field values,
// sorted in Russian. Only these lookup strings cross the portal boundary.
function profileDictionaries(data) {
  const result = { ...data.dictionaries }, students = data.collections.students || [];
  for (const [key, [dictionary, defaults]] of Object.entries(PROFILE_LISTS)) {
    const values = [...(result[dictionary] || []), ...defaults, ...students.map(row => row[key])];
    if (key === "passportIssuer") values.push(...students.map(row => row.customerPassportIssuer), ...(data.collections.contracts || []).map(row => row.identityIssuer));
    result[dictionary] = [...new Set(values.filter(value => typeof value === "string" && value.trim()).map(value =>
      key === "citizenship" && russianCitizen({ citizenship: value }) ? "Россия" : text(value)))].sort((a, b) => a.localeCompare(b, "ru"));
  }
  return result;
}
function nameChanged(record) {
  return record.enrollmentNameChanged === true || Boolean(text(record.educationDocumentSurname)
    && identity(record.educationDocumentSurname) !== identity(record.name).split(/\s+/)[0]);
}
function requiredField(record, key, type) {
  return type !== "checkbox" && (key !== "snils" || russianCitizen(record))
    && (key !== "educationDocumentSurname" || nameChanged(record));
}
function profileFields(record, dictionaries = {}) {
  const fields = professional(record) ? FIELDS : FIELDS.filter(([key]) => !["snils", "educationLevel", "enrollmentEducationMode", "educationDocumentSurname", "enrollmentNameChanged", "workPlace", "position"].includes(key));
  return fields.map(item => {
    const [key, label] = item, list = PROFILE_LISTS[key];
    if (!list) return item;
    const options = [...new Set([...(dictionaries[list[0]] || []), ...list[1], text(record[key])].filter(value => typeof value === "string" && value.trim()).map(value =>
      key === "citizenship" && russianCitizen({ citizenship: value }) ? "Россия" : text(value)))].sort((a, b) => a.localeCompare(b, "ru"));
    return [key, label, key === "educationLevel" ? "select" : "combo", options];
  });
}
function sdoAvailable(record) {
  const key = Object.hasOwn(record, "event_portalCredentialsSent_state") ? "portalCredentialsSent" : "portalAccessSent";
  const state = text(record[`event_${key}_state`]).toLowerCase();
  const deleted = text(record.eventDeleted).split(/[,;\s]+/);
  return !deleted.includes(key) && !["unchecked", "none", "false", "0"].includes(state)
    && (["checked", "dated"].includes(state) || Boolean(record[`event_${key}_date`])) && Boolean(text(record.login));
}
function documentRequirements(record) {
  const keys = ["passport", "registration"];
  if (!professional(record)) return keys.map(key => ({ key, label: DOCS[key], required: true }));
  if (russianCitizen(record)) keys.push("snils");
  keys.push(...(record.enrollmentEducationMode === "Справка с места учёбы" ? ["study"] : ["diploma", "supplement"]));
  if (nameChanged(record)) keys.push("nameChange");
  return Object.entries(DOCS).map(([key, label]) => ({ key, label, required: keys.includes(key) }));
}
function missingRequirements(record) {
  const missing = profileFields(record).filter(([key, , type]) => requiredField(record, key, type))
    .filter(([key]) => !text(record[key])).map(([, label]) => label);
  if (text(record.phone) && record.phone.replace(/\D/g, "").length < 10) missing.push("Корректный телефон");
  if (professional(record) && russianCitizen(record) && text(record.snils) && record.snils.replace(/\D/g, "").length !== 11) missing.push("СНИЛС: 11 цифр");
  if (russianCitizen(record) && text(record.mailingAddress) && !/\b\d{6}\b/.test(record.mailingAddress)) missing.push("Почтовый индекс: 6 цифр");
  for (const key of ["birthDate", "passportDate"]) if (text(record[key])) {
    const value = record[key], date = new Date(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value || +date > Date.now()) missing.push(key === "birthDate" ? "Корректная дата рождения" : "Корректная дата выдачи");
  }
  for (const doc of documentRequirements(record)) if (doc.required && !(record.enrollmentDocuments || []).some(file => file.kind === doc.key)) missing.push(doc.label);
  return missing;
}
function sanitizeProfile(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) fail("Некорректные данные профиля.");
  const result = {};
  for (const [key, , type, options] of FIELDS) {
    if (!Object.hasOwn(values, key)) continue;
    if (type === "checkbox") { result[key] = values[key] === true; continue; }
    if (typeof values[key] !== "string" || values[key].length > 2000) fail("Недопустимое значение поля.");
    result[key] = text(values[key]);
    if (options && result[key] && !options.includes(result[key])) fail("Выберите значение из списка.");
  }
  return result;
}
function credentials(email, reserved) {
  const base = identity(email).split("@")[0].replace(/[^\p{L}\p{N}._+-]/gu, "_").slice(0, 56) || "student";
  let login = base;
  for (let suffix = 2; reserved.has(identity(login)); suffix++) login = `${base}.${suffix}`;
  return { login, password: String(crypto.randomInt(1000000)).padStart(6, "0") };
}
function matchProgram(row, programs) {
  const matches = programs.filter(program => [program.productId, program.siteSync?.product?.id, program.sitePublication?.product?.id,
    ...(program.siteVariants || []).map(variant => variant.productId)].some(id => text(id) && text(id) === text(row.productId)));
  return matches.length === 1 && ["КПК", "ППП", "ДОП"].includes(matches[0].type) ? matches[0] : null;
}
// Private random salt prevents the public session version from being a six-digit-password oracle.
const fingerprint = record => crypto.createHmac("sha256", record.studentPortalCredentialSalt || "disabled")
  .update(`${record.id}\0${portalLogin(record)}\0${portalPassword(record)}`).digest("hex");
function publicUser(record) { return { id: `student:${record.id}`, studentId: record.id, login: portalLogin(record), name: record.name,
  role: "student", status: "active", email: record.email, authSource: "student", studentCredentialVersion: fingerprint(record) }; }
const escapeHtml = value => text(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function welcomeMessage(record, { repeat = false } = {}) {
  return `<p>Добрый день, ${escapeHtml(record.name)}!</p>${repeat ? `<p>Направляем данные для доступа в личный кабинет по программе «${escapeHtml(record.program)}» и инструкцию по заполнению данных.</p>` : `<p>Получена оплата по программе «${escapeHtml(record.program)}». Ваша заявка импортирована со статусом «На зачисление».</p>`}
<p>Для оформления на обучение войдите в <a href="https://edu-plus.ru/lms/">личный кабинет</a>.</p>
<p>Логин: <strong>${escapeHtml(portalLogin(record))}</strong><br>Пароль: <strong>${escapeHtml(portalPassword(record))}</strong></p>
<ol><li>На вкладке «Основное» заполните личные, паспортные данные, адрес регистрации и почтовый адрес с индексом.${professional(record) ? ' Укажите сведения об образовании, месте работы и должности. Если не работаете, укажите «Не работаю».' : ''} Сохраните данные.</li>
<li>На вкладке «Документы» ${professional(record) ? "прикрепите сканы паспорта с регистрацией, СНИЛС (для граждан РФ), диплома с приложением либо справки с места учёбы. Если ФИО в документе об образовании отличается от паспорта, приложите документ о перемене ФИО." : "прикрепите скан паспорта с регистрацией. Для ДОП диплом и СНИЛС не требуются. Укажите почтовый адрес фактического проживания с индексом."} <a href="https://zifra-plus.ru/edu_info/">Перечень документов</a>.</li>
<li>После заполнения всех обязательных полей и загрузки документов станет активна кнопка <strong>«Отправить на проверку»</strong>. Нажмите её для передачи комплекта в учебный центр.</li></ol>
<p>Загруженные файлы автоматически сохраняются в Вашей папке на Яндекс Диске и отображаются в кабинете. На вкладке «Финансы» можно посмотреть свои оплаты и остаток долга. Не передавайте пароль другим людям.</p><p>Учебный центр «Цифровизация Плюс»<br>mail@edu-plus.ru</p>`;
}
function validateUpload(body) {
  if (!Object.hasOwn(DOCS, body.kind)) fail("Выберите вид документа.");
  if (typeof body.base64 !== "string" || body.base64.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) fail("Максимальный размер файла — 20 МБ.");
  const bytes = Buffer.from(body.base64, "base64");
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) fail("Максимальный размер файла — 20 МБ.");
  const extension = bytes.subarray(0, 5).toString() === "%PDF-" ? "pdf"
    : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "jpg" : "";
  if (!extension) fail("Прикрепите PDF, JPEG или PNG.");
  return { bytes, extension, contentType: extension === "pdf" ? "application/pdf" : `image/${extension === "jpg" ? "jpeg" : extension}` };
}
function finances(record) {
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const round = value => Math.round(value * 100) / 100;
  const payments = Array.from({ length: 8 }, (_, index) => ({
    date: text(record[`payment${index + 1}Date`]), amount: number(record[`payment${index + 1}Amount`])
  })).concat((record.portalPaymentReceipts || []).filter(payment => payment.slot === 0).map(payment => ({ date: payment.date, amount: number(payment.amount) }))).filter(payment => payment.amount !== 0);
  const total = round(number(record.contractAmount));
  const paid = round(payments.reduce((sum, payment) => sum + payment.amount, 0));
  return { total, paid, debt: Math.max(0, round(total - paid)), overpaid: Math.max(0, round(paid - total)), payments };
}
// Group only matching identities with no contradictory passport or date of birth.
// SDO credentials are never changed by the migration: portal credentials are separate.
function planExistingAccounts(data, reserved) {
  const students = data.collections.students || [], groups = new Map(), updates = [];
  for (const row of students) {
    const email = identity(row.email), name = identity(row.name).replace(/\s+/gu, " ");
    const key = email && name ? `${email}\0${name}` : `id:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    const ambiguous = ["birthDate", "passportNumber"].some(key => new Set(group.map(row => identity(row[key]).replace(/\s/g, "")).filter(Boolean)).size > 1);
    for (const rows of ambiguous ? group.map(row => [row]) : [group]) {
      const existing = rows.filter(row => row.studentPortalEnabled && !row.studentPortalBlocked && row.studentPortalCredentialSalt
        && (!row.studentPortalAccountId || row.studentPortalAccountId === row.id));
      // Multiple pre-existing accounts are preserved; never silently merge their permissions.
      let owner = existing.length === 1 ? existing[0] : null;
      for (const row of rows) {
        if (row.studentPortalEnabled || row.studentPortalBlocked) continue;
        const access = owner ? { login: portalLogin(owner), password: portalPassword(owner) }
          : credentials(text(row.email) || `student.${text(row.uid) || text(row.id)}`, reserved);
        reserved.add(identity(access.login));
        const updated = { ...row, studentPortalEnabled: true, studentPortalAccountId: owner?.id || row.id,
          studentPortalLogin: access.login, studentPortalPassword: access.password,
          studentPortalCredentialSalt: crypto.randomBytes(32).toString("hex"),
          studentPortalCreatedAt: new Date().toISOString(),
          studentPortalDocumentsFolder: documentFolder(row) };
        updates.push(updated);
        if (!owner && existing.length <= 1) owner = updated;
      }
    }
  }
  return updates;
}
function createService(deps) {
  async function mutate(id, user, change) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await deps.readState();
      const record = (current.data.collections.students || []).find(row => row.id === id);
      if (!record) fail("Заявка не найдена.", 404);
      if (user?.role === "student") {
        const owner = current.data.collections.students.find(row => row.id === user.studentId);
        if (!owner?.studentPortalEnabled || owner.studentPortalBlocked || !owner.studentPortalCredentialSalt
          || fingerprint(owner) !== user.studentCredentialVersion || !record.studentPortalEnabled || record.studentPortalBlocked
          || (record.studentPortalAccountId || record.id) !== owner.id) fail("Доступ к заявке закрыт.", 403);
      }
      const updated = await change(structuredClone(record));
      const result = await deps.save(current.revision, [updated], user);
      if (result.conflict) continue;
      if (result.locked) fail("Карточка редактируется сотрудником. Повторите позже.", 423);
      if (result.offline || result.syncPending) fail("Общая база недоступна. Повторите позже.", 503);
      return updated;
    }
    fail("Данные изменились. Обновите кабинет.", 409);
  }
  async function context(user, id = "") {
    if (user?.role !== "student" || !user.studentId) fail("Требуется вход слушателя.", 403);
    const current = await deps.readState();
    const students = current.data.collections.students || [];
    const owner = students.find(row => row.id === user.studentId && row.studentPortalEnabled === true && !row.studentPortalBlocked);
    if (!owner?.studentPortalCredentialSalt || identity(portalLogin(owner)) !== identity(user.login) || fingerprint(owner) !== user.studentCredentialVersion) fail("Сессия устарела. Войдите повторно.", 401);
    const records = students.filter(row => row.studentPortalEnabled === true && !row.studentPortalBlocked && (row.studentPortalAccountId || row.id) === owner.id);
    const record = id ? records.find(row => row.id === id) : records[0];
    if (!record) fail("Заявка не найдена.", 404);
    return { owner, record, records, dictionaries: profileDictionaries(current.data) };
  }
  async function staffSession(actor, studentId, applicationId = "") {
    if (!["admin", "manager"].includes(actor?.role)) fail("Кабинет слушателя может открыть только сотрудник учебного центра.", 403);
    const current = await deps.readState(), students = current.data.collections.students || [];
    const record = students.find(row => row.id === studentId);
    if (!record) fail("Слушатель не найден.", 404);
    if (!record.studentPortalEnabled || record.studentPortalBlocked) fail("Личный кабинет слушателя недоступен.", 409);
    const owner = students.find(row => row.id === (record.studentPortalAccountId || record.id));
    if (!owner?.studentPortalEnabled || owner.studentPortalBlocked || !owner.studentPortalCredentialSalt) fail("Личный кабинет слушателя недоступен.", 409);
    const id = applicationId || record.id;
    if (!students.some(row => row.id === id && row.studentPortalEnabled && !row.studentPortalBlocked && (row.studentPortalAccountId || row.id) === owner.id)) fail("Заявка не относится к этому кабинету.", 403);
    // Request-scoped identity only. Never replace the staff member's login or cookie.
    return { user: { ...publicUser(owner), actingStaff: actor }, id, record };
  }
  function view({ owner, record, records, dictionaries }) {
    return { user: { name: owner.name, login: portalLogin(owner), email: owner.email }, sdoAvailable: sdoAvailable(record), feedbackRecipient: deps.feedbackRecipient || "",
      applications: records.map(row => ({ id: row.id, program: row.program, status: row.status })),
      photoAvailable: Boolean(record.photoData || /\.(?:png|jpe?g|webp|gif)$/iu.test(text(record.photoPath))),
      record: { id: record.id, email: record.email, program: record.program, status: record.status,
        ...Object.fromEntries(FIELDS.map(([key]) => [key, record[key] ?? ""])),
        citizenship: russianCitizen(record) ? "Россия" : text(record.citizenship),
        enrollmentNameChanged: nameChanged(record),
        enrollmentSubmittedAt: record.enrollmentSubmittedAt || "",
        enrollmentReviewStatus: record.enrollmentReviewStatus || "Заполняется",
        enrollmentReviewComment: record.enrollmentReviewComment || "",
        enrollmentReviewedAt: record.enrollmentReviewedAt || "" },
      fields: profileFields(record, dictionaries).map(([key, label, type, options]) => ({ key, label, type, options,
        required: requiredField(record, key, type), ...(key === "educationDocumentSurname" ? { dependsOn: "enrollmentNameChanged" } : {}) })),
      requirements: documentRequirements(record), missing: missingRequirements(record), finances: finances(record),
      documents: (record.enrollmentDocuments || []).map(({ id, kind, name, size, uploadedAt }) => ({ id, kind, name, size, uploadedAt })) };
  }
  async function authenticate(login, password, clientKey) {
    await deps.loginLimit(identity(login), clientKey);
    const current = await deps.readState();
    const records = (current.data.collections.students || []).filter(row => row.studentPortalEnabled === true && row.studentPortalCredentialSalt && !row.studentPortalBlocked
      && (!row.studentPortalAccountId || row.studentPortalAccountId === row.id) && identity(portalLogin(row)) === identity(login));
    if (records.length !== 1) return null;
    const expected = Buffer.from(portalPassword(records[0])), actual = Buffer.from(String(password || ""));
    if (!expected.length || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    await deps.loginSuccess(identity(login), clientKey);
    return publicUser(records[0]);
  }
  async function provisionOrder(orderId, { sendWelcome = true, prepareFolders = true } = {}) {
    if (!/^[1-9]\d{0,15}$/.test(text(orderId))) fail("Некорректный номер заказа.");
    return deps.lock("student-enrollment-provision", async () => {
      const rows = await deps.queryOrder(orderId);
      if (!rows.length) fail("Оплаченный заказ пока не появился в базе магазина. Проверка будет повторена.", 503);
      const imported = [], skipped = [];
      for (const row of rows) {
        if (!row.paid || Number(row.paymentAmount) <= 0 || text(row.orderId) !== text(orderId)) continue;
        if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text(row.email)) || !text(row.name)) { skipped.push(row.id); continue; }
        let record, resolved = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const current = await deps.readState(), data = current.data, students = data.collections.students || [];
          const program = matchProgram(row, data.collections.programs || []);
          if (!program) { skipped.push(row.id); resolved = true; break; }
          const sourceKey = `mysql:${row.orderId}:${row.id}`;
          const prior = students.find(item => item.sourceApplicationKey === sourceKey
            || (text(item.sourceOrderId) === text(row.orderId) && text(item.sourceProductId) === text(row.productId)));
          if (prior?.studentPortalEnabled) { record = prior; resolved = true; break; }
          if (prior && prior.status !== "На зачисление") { skipped.push(row.id); resolved = true; break; }
          const owner = students.find(item => item.studentPortalEnabled && !item.studentPortalBlocked
            && (!item.studentPortalAccountId || item.studentPortalAccountId === item.id)
            && identity(item.email) === identity(row.email) && identity(item.name) === identity(row.name));
          const reserved = await deps.reservedLogins(data);
          const access = owner ? { login: portalLogin(owner), password: portalPassword(owner) } : credentials(row.email, reserved);
          const id = prior?.id || `student-${crypto.randomUUID()}`;
          const uid = String(Math.max(0, ...students.map(item => Number(item.uid) || 0)) + 1);
          const registryPrice = Number(program.price) || Number(row.paymentAmount);
          const installment = /(?:rass|расс)\s*(25|50)/iu.test(text(row.coupon));
          const contractAmount = installment || !text(row.coupon) ? registryPrice : Math.min(registryPrice, Number(row.paymentAmount));
          record = { id, uid, name: text(row.name), email: text(row.email), phone: text(row.phone),
            status: "На зачисление", program: program.name, educationType: program.type, hours: program.hours || "",
            studyForm: program.studyForm || "", workPlace: text(row.organization), position: text(row.position),
            source: text(row.source) || "zifra-plus.ru", sourceOrderId: text(row.orderId), sourceProductId: text(row.productId),
            sourceApplicationKey: sourceKey, sourceApplicationCreatedAt: text(row.dateCreated), orderNo: text(row.orderId),
            applicationDate: text(row.dateCreated).slice(0, 10), contractAmount,
            discount: registryPrice > 0 ? Math.round((registryPrice - contractAmount) / registryPrice * 10000) / 100 : 0,
            discountUnit: "percent", fundingSource: "Собственные средства",
            payment1Date: new Date().toISOString().slice(0, 10), payment1Amount: Number(row.paymentAmount),
            payment1Note: `Оплата на zifra-plus.ru, заказ №${row.orderId}`, coupon: text(row.coupon), directExpenses: [],
            ...prior, login: prior?.login || access.login, password: prior?.password || access.password,
            studentPortalLogin: access.login, studentPortalPassword: access.password,
            photoPath: prior?.photoPath || `Слушатели/${id}/Документы`, studentPortalEnabled: true,
            studentPortalAccountId: owner?.id || id, studentPortalCredentialSalt: crypto.randomBytes(32).toString("hex"),
            enrollmentDocuments: prior?.enrollmentDocuments || [], enrollmentMailStatus: "pending", citizenship: prior?.citizenship || "Российская Федерация", passportType: prior?.passportType || "Паспорт РФ" };
          const saved = await deps.save(current.revision, [record], deps.systemUser);
          if (saved.conflict) { record = null; continue; }
          if (saved.offline || saved.syncPending || saved.locked) fail("Не удалось сохранить заявку в общей базе.", 503);
          await deps.audit("Автоматически импортирована оплаченная заявка", record, deps.systemUser);
          resolved = true;
          break;
        }
        if (!resolved) fail("Общая база занята. Импорт будет повторён.", 503);
        if (!record) continue;
        if (prepareFolders) await deps.ensureFolder(documentFolder(record));
        if (sendWelcome && ["pending", "failed"].includes(record.enrollmentMailStatus)) {
          await mutate(record.id, deps.systemUser, item => ({ ...item, enrollmentMailStatus: "sending", enrollmentMailAttemptAt: new Date().toISOString() }));
          try {
            await deps.sendMail({ to: record.email, subject: `Документы для зачисления: ${record.program}`, message: welcomeMessage(record), idempotencyKey: `student-enrollment:${record.id}` });
          } catch (error) {
            await mutate(record.id, deps.systemUser, item => ({ ...item, enrollmentMailStatus: error.deliveryUnknown ? "unknown" : "failed" }));
            await deps.audit(error.deliveryUnknown ? "Результат отправки инструкции неизвестен" : "Не отправлена инструкция слушателю", record, deps.systemUser);
            throw error;
          }
          await mutate(record.id, deps.systemUser, item => ({ ...item, enrollmentMailStatus: "sent", enrollmentMailSentAt: new Date().toISOString() }));
          await deps.audit("Отправлено письмо-инструкция в кабинет слушателя", record, deps.systemUser);
        }
        imported.push(record.id);
      }
      return { ok: true, imported: imported.length, skipped: skipped.length };
    });
  }
  async function cabinetAccessEmail(actor, id) {
    const session = await staffSession(actor, id);
    const { owner, record } = await context(session.user, session.id);
    const email = text(record.email);
    if (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/u.test(email)) fail("Укажите и сохраните корректный Email в карточке слушателя.");
    if (!portalLogin(owner) || !portalPassword(owner)) fail("В кабинете слушателя не заполнены логин или пароль.", 409);
    const subject = "Доступ в личный кабинет слушателя — Цифровизация Плюс";
    const message = welcomeMessage({ ...record, studentPortalLogin: portalLogin(owner), studentPortalPassword: portalPassword(owner) }, { repeat: true });
    const revision = crypto.createHash("sha256").update(JSON.stringify([record.id, owner.id, email, subject, message, fingerprint(owner)])).digest("hex");
    return { record, owner, preview: { ok: true, email, subject, message, revision, name: record.name, program: record.program } };
  }
  async function previewCabinetAccessEmail(actor, id) {
    return (await cabinetAccessEmail(actor, id)).preview;
  }
  async function sendCabinetAccessEmail(actor, id, body = {}) {
    await deps.assertWritable?.();
    const requestId = text(body.requestId).toLowerCase();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(requestId)) fail("Обновите предпросмотр письма.");
    const session = await staffSession(actor, id);
    return deps.lock(`cabinet-access-email:${session.user.studentId}`, async () => {
      const { record, owner, preview } = await cabinetAccessEmail(actor, id);
      if (body.revision !== preview.revision) fail("Данные слушателя или доступа изменились. Обновите предпросмотр письма.", 409);
      const subject = body.subject === undefined ? preview.subject : body.subject;
      const message = body.message === undefined ? preview.message : body.message;
      if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || /[\u0000-\u001f\u007f]/u.test(subject)) fail("Укажите тему письма: от 1 до 200 символов, без переноса строк.");
      if (typeof message !== "string" || !message.replace(/<[^>]*>/gu, "").replace(/&(?:nbsp|#160|#x0*a0);/giu, " ").trim()
        || Buffer.byteLength(message, "utf8") > 100000) fail("Заполните текст письма. Максимальный размер — 100 КБ.");
      // Bind retries to the exact edited content; keep compatibility with earlier unedited requests.
      const messageHash = subject === preview.subject && message === preview.message ? preview.revision
        : crypto.createHash("sha256").update(JSON.stringify([preview.revision, subject, message])).digest("hex");
      // Separate namespace; persist only a hash and delivery state, never credentials or message text.
      const ledger = `cabinet-access:${owner.id}`, history = await deps.readFeedbackState(ledger, requestId), previous = history.request;
      const success = { ok: true, email: preview.email, message: `Письмо отправлено на ${preview.email}.` };
      if (previous) {
        if (previous.messageHash !== messageHash) fail("Данные письма изменились. Откройте новый предпросмотр.", 409);
        if (previous.status === "sent") return success;
        if (["pending", "unknown"].includes(previous.status)) fail("Результат отправки неизвестен. Проверьте журнал и папку «Отправленные» перед повторной отправкой.", 409);
      }
      if (Date.now() - Number(history.lastAttemptAt || 0) < 30000) fail("Повторную отправку можно выполнить через 30 секунд.", 429);
      const entry = { requestId, messageHash, status: "pending", createdAt: Date.now() };
      await deps.saveFeedbackState(ledger, entry);
      try {
        await deps.sendMail({ to: preview.email, subject, message, idempotencyKey: `cabinet-access:${owner.id}:${requestId}` });
      } catch (error) {
        await deps.saveFeedbackState(ledger, { ...entry, status: error.deliveryUnknown ? "unknown" : "failed" });
        await deps.audit(error.deliveryUnknown ? "Повторная отправка доступа в кабинет не подтверждена" : "Ошибка повторной отправки доступа в кабинет", record, actor, `Получатель: ${preview.email}`);
        if (error.deliveryUnknown) fail("Результат отправки неизвестен. Проверьте журнал и папку «Отправленные» перед повторной отправкой.", 409);
        fail("Не удалось отправить письмо. Повторите отправку позже.", 503);
      }
      await deps.audit("Повторно отправлено письмо с доступом к личному кабинету", record, actor, `Получатель: ${preview.email}; тема: ${subject}`);
      try { await deps.saveFeedbackState(ledger, { ...entry, status: "sent" }); }
      catch { fail("Почтовый сервер принял письмо, но сохранить подтверждение не удалось. Проверьте журнал перед повторной отправкой.", 503); }
      return success;
    });
  }
  async function orderEmailAccess(orderId, recipient) {
    if (!/^[1-9]\d{0,15}$/u.test(text(orderId)) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(text(recipient))) fail("Некорректные параметры письма заказа.");
    const rows = await deps.queryOrder(orderId), before = await deps.readState();
    const eligible = rows.filter(row => row.paid && Number(row.paymentAmount) > 0 && text(row.orderId) === text(orderId)
      && identity(row.email) === identity(recipient) && matchProgram(row, before.data.collections.programs || []));
    if (!eligible.length) return { ok: true, accounts: [] };
    // Preparing a store email must not send any message itself. The existing
    // paid-order job remains responsible for the separate enrollment instruction.
    const existing = before.data.collections.students || [];
    const needsProvisioning = eligible.some(row => !existing.some(item => item.studentPortalEnabled && (item.sourceApplicationKey === `mysql:${row.orderId}:${row.id}`
      || (text(item.sourceOrderId) === text(row.orderId) && text(item.sourceProductId) === text(row.productId)))));
    if (needsProvisioning) await provisionOrder(orderId, { sendWelcome: false, prepareFolders: false });
    const current = await deps.readState(), students = current.data.collections.students || [], accounts = new Map();
    for (const row of eligible) {
      const record = students.find(item => item.sourceApplicationKey === `mysql:${row.orderId}:${row.id}`
        || (text(item.sourceOrderId) === text(row.orderId) && text(item.sourceProductId) === text(row.productId)));
      const owner = record && students.find(item => item.id === (record.studentPortalAccountId || record.id));
      if (!record?.studentPortalEnabled || record.studentPortalBlocked || !owner?.studentPortalEnabled || owner.studentPortalBlocked
        || identity(record.email) !== identity(recipient) || identity(owner.email) !== identity(recipient)
        || !portalLogin(owner) || !portalPassword(owner) || !owner.studentPortalCredentialSalt) continue;
      if (!accounts.has(owner.id)) accounts.set(owner.id, { login: portalLogin(owner), password: portalPassword(owner), programs: [] });
      const account = accounts.get(owner.id); if (!account.programs.includes(record.program)) account.programs.push(record.program);
    }
    return { ok: true, accounts: [...accounts.values()] };
  }
  async function portal(user, id) { return view(await context(user, id)); }
  async function provisionExisting({ apply = false, onProgress = () => {} } = {}) {
    if (apply) await deps.assertWritable?.();
    return deps.lock("student-enrollment-provision", async () => {
      let created = 0, conflicts = 0;
      while (true) {
        const current = await deps.readState();
        const planned = planExistingAccounts(current.data, await deps.reservedLogins(current.data));
        if (!apply || !planned.length) return { total: current.data.collections.students.length, created, remaining: planned.length,
          accounts: current.data.collections.students.filter(row => row.studentPortalEnabled && (row.studentPortalAccountId || row.id) === row.id).length };
        const batch = planned.slice(0, 50);
        const result = await deps.save(current.revision, batch, deps.systemUser);
        if (result.conflict) { if (++conflicts > 10) fail("Данные часто изменяются. Повторите создание оставшихся кабинетов.", 409); continue; }
        if (result.locked || result.offline || result.syncPending) fail("Общая база занята или недоступна. Уже созданные кабинеты сохранены, повторите позже.", 503);
        conflicts = 0; created += batch.length;
        for (const record of batch) await deps.audit("Создан кабинет имеющегося слушателя (без отправки письма)", record, deps.systemUser);
        onProgress({ created, remaining: planned.length - batch.length });
      }
    });
  }
  async function sdo(user, id) {
    const { record } = await context(user, id);
    if (!sdoAvailable(record)) fail("Доступ в СДО откроется после отправки данных для доступа учебным центром.", 403);
    return deps.sdoTicket(record);
  }
  async function update(user, id, values) {
    const { record, dictionaries } = await context(user, id);
    const clean = sanitizeProfile(values);
    if (clean.citizenship && russianCitizen(clean)) clean.citizenship = "Россия";
    for (const [key, , type, options] of profileFields(record, dictionaries)) {
      if (type === "select" && clean[key] && !options.includes(clean[key])) fail("Выберите значение из списка.");
    }
    const updated = await mutate(id, user, item => {
      const next = { ...item, ...clean };
      if (professional(next) && (clean.enrollmentNameChanged === false || (!nameChanged(item) && clean.enrollmentNameChanged !== true && !Object.hasOwn(clean, "educationDocumentSurname")))) {
        next.educationDocumentSurname = text(next.name).split(/\s+/)[0];
      }
      return { ...next, enrollmentSubmittedAt: "", enrollmentSubmissionId: "",
        enrollmentReviewStatus: item.enrollmentReviewStatus === "На доработке" ? "На доработке" : "Заполняется" };
    });
    await deps.audit("Слушатель заполнил данные для зачисления", updated, user);
    return portal(user, id);
  }
  async function upload(user, id, body) {
    const { record } = await context(user, id);
    const file = validateUpload(body), fileId = crypto.randomUUID();
    const name = `${DOCS[body.kind]}-${fileId}.${file.extension}`;
    if (!documentRequirements(record).some(doc => doc.key === body.kind)) fail("Этот документ не требуется для выбранной программы.");
    await deps.upload(documentFolder(record), name, file.bytes, file.contentType);
    const uploaded = { id: fileId, kind: body.kind, name, size: file.bytes.length, uploadedAt: new Date().toISOString() };
    const updated = await mutate(id, user, item => ({ ...item, enrollmentSubmittedAt: "", enrollmentSubmissionId: "",
      enrollmentReviewStatus: item.enrollmentReviewStatus === "На доработке" ? "На доработке" : "Заполняется",
      enrollmentDocuments: [...(item.enrollmentDocuments || []).filter(entry => entry.kind !== body.kind), uploaded] }));
    await deps.audit("Слушатель загрузил документ для зачисления", updated, user);
    return portal(user, id);
  }
  async function file(user, id, fileId) {
    const { record } = await context(user, id);
    const entry = (record.enrollmentDocuments || []).find(item => item.id === fileId);
    if (!entry || /[\\/]/.test(entry.name)) fail("Документ не найден.", 404);
    return { ...await deps.download(documentFolder(record), entry.name), name: entry.name };
  }
  async function submit(user, id) {
    const { record } = await context(user, id);
    for (const entry of record.enrollmentDocuments || []) if (!await deps.fileExists(documentFolder(record), entry.name)) fail("Один из файлов недоступен на Яндекс Диске. Загрузите его повторно.", 409);
    const updated = await mutate(id, user, item => {
      if (item.enrollmentReviewStatus === "Приняты") fail("Документы уже приняты учебным центром.", 409);
      const missing = missingRequirements(item);
      if (missing.length) fail(`Заполните и приложите: ${missing.join("; ")}`);
      return { ...item, enrollmentSubmittedAt: item.enrollmentSubmittedAt || new Date().toISOString(),
        enrollmentSubmissionId: item.enrollmentSubmissionId || crypto.randomUUID(), enrollmentReviewStatus: "На проверке" };
    });
    await deps.audit("Документы для зачисления отправлены на проверку", updated, user);
    return portal(user, id);
  }
  async function review(actor, id, body = {}) {
    if (!["admin", "manager"].includes(actor?.role)) fail("Проверка документов доступна сотрудникам учебного центра.", 403);
    if (!["accept", "return"].includes(body.decision)) fail("Выберите решение по документам.");
    const comment = text(body.comment);
    if (comment.length > 4000) fail("Комментарий должен содержать не более 4000 символов.");
    if (body.decision === "return" && !comment) fail("Укажите, что слушателю нужно исправить.");
    const updated = await mutate(id, actor, item => {
      if (item.enrollmentReviewStatus !== "На проверке" || !item.enrollmentSubmittedAt
        || !body.submissionId || body.submissionId !== (item.enrollmentSubmissionId || item.enrollmentSubmittedAt)) {
        fail("Комплект документов изменился или уже проверен. Обновите список и проверьте его повторно.", 409);
      }
      return { ...item, enrollmentReviewStatus: body.decision === "accept" ? "Приняты" : "На доработке",
        enrollmentReviewComment: comment, enrollmentReviewedAt: new Date().toISOString(),
        enrollmentReviewedBy: text(actor.name || actor.login), enrollmentReviewedById: text(actor.id),
        enrollmentReviewedSubmissionAt: item.enrollmentSubmittedAt,
        enrollmentSubmittedAt: body.decision === "accept" ? item.enrollmentSubmittedAt : "",
        enrollmentSubmissionId: body.decision === "accept" ? item.enrollmentSubmissionId || "" : "" };
    });
    await deps.audit(body.decision === "accept" ? "Приняты документы для зачисления" : "Документы для зачисления возвращены на доработку", updated, actor);
    return Object.fromEntries(["id", "enrollmentReviewStatus", "enrollmentReviewComment", "enrollmentReviewedAt", "enrollmentReviewedBy",
      "enrollmentReviewedById", "enrollmentReviewedSubmissionAt", "enrollmentSubmittedAt", "enrollmentSubmissionId"].map(key => [key, updated[key]]));
  }
  async function feedback(user, id, body = {}) {
    if (user?.role !== "student" || !user.studentId) fail("Требуется вход слушателя.", 403);
    const subject = text(body.subject).replace(/[\r\n\u0000-\u001f]+/gu, " ").trim();
    const message = text(body.message).replace(/\r\n?/gu, "\n");
    const requestId = text(body.requestId).toLowerCase();
    if (subject.length < 3 || subject.length > 180) fail("Тема должна содержать от 3 до 180 символов.");
    if (message.length < 10 || message.length > 10000) fail("Сообщение должно содержать от 10 до 10000 символов.");
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(requestId)) fail("Обновите форму сообщения и повторите отправку.");
    return deps.lock(`student-feedback:${user.studentId}`, async () => {
      const { owner, record } = await context(user, id);
      const center = body.fromCenter === true;
      if (center && !["admin", "manager"].includes(user.actingStaff?.role)) fail("Ответ учебного центра может отправить только сотрудник.", 403);
      const existing = body.threadId ? await deps.feedbackHistory.all(owner.id, record.id) : [];
      const parent = body.threadId ? existing.filter(item => item.threadId === body.threadId && item.status === "sent").at(-1) : null;
      if (body.threadId && !parent) fail("Переписка не найдена.", 404);
      if (!deps.feedbackRecipient) fail("Адрес учебного центра не настроен. Обратитесь к администратору.", 503);
      const messageHash = crypto.createHash("sha256").update(JSON.stringify([record.id, subject, message, ...(center || body.threadId ? [center, body.threadId || ""] : [])])).digest("hex");
      const history = await deps.readFeedbackState(owner.id, requestId);
      const previous = history.request;
      const success = { ok: true, message: center ? "Ответ отправлен слушателю и сохранён в переписке." : "Сообщение отправлено в учебный центр." };
      if (previous) {
        if (previous.messageHash !== messageHash) fail("Это сообщение уже было изменено. Отправьте его как новое обращение.", 409);
        if (previous.status === "sent") return success;
        if (["pending", "unknown"].includes(previous.status)) fail("Письмо уже передано на отправку, но результат пока не подтверждён. Не отправляйте его повторно; уточните получение в учебном центре.", 409);
      }
      if (Date.now() - Number(history.lastAttemptAt || 0) < 30000) fail("Следующее сообщение можно отправить через 30 секунд.", 429);
      const email = text(record.email || owner.email);
      if (center && !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/u.test(email)) fail("У слушателя не указан корректный email.");
      const entry = { requestId, messageHash, status: "pending", createdAt: Date.now(), applicationId: record.id,
        subject, message, direction: center ? "center" : "student", threadId: parent?.threadId || requestId,
        messageId: feedbackHistory.messageId(owner.id, requestId) };
      await deps.saveFeedbackState(owner.id, entry);
      const escape = value => text(value).replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
      const replyTo = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/u.test(email) ? email : "";
      const lines = ["Сообщение из кабинета слушателя Цифровизации Плюс", "", `Слушатель: ${record.name || owner.name}`,
        `Программа: ${record.program || "не указана"}`, `Заявка: ${record.id}`, `Email: ${email || "не указан"}`,
        `Телефон: ${record.phone || "не указан"}`, ...(user.actingStaff ? [`Отправил сотрудник: ${user.actingStaff.name || user.actingStaff.login}`] : []), "", message];
      try {
        await deps.sendMail({ to: center ? email : deps.feedbackRecipient, replyTo: center ? deps.feedbackRecipient : replyTo, subject: `${center ? "Учебный центр" : "Слушатель"}: ${subject}`,
          messageId: entry.messageId, inReplyTo: parent?.messageId || "",
          message: `<div style="white-space: pre-wrap; font-family: sans-serif">${escape(center ? message : lines.join("\n"))}</div>`,
          idempotencyKey: `student-feedback:${owner.id}:${requestId}`, requestDeliveryAndReadReceipts: false });
      } catch (error) {
        await deps.saveFeedbackState(owner.id, { ...entry, status: error.deliveryUnknown ? "unknown" : "failed" });
        if (error.deliveryUnknown) fail("Почтовый сервер не подтвердил приём письма. Не отправляйте его повторно; уточните получение в учебном центре.", 409);
        fail("Не удалось отправить сообщение. Текст сохранён в форме; повторите отправку позже.", 503);
      }
      try { await deps.saveFeedbackState(owner.id, { ...entry, status: "sent" }); }
      catch { fail("Почтовый сервер принял письмо, но сохранить подтверждение не удалось. Не отправляйте сообщение повторно.", 503); }
      await deps.audit(center ? "Отправлен ответ учебного центра слушателю" : "Отправлена обратная связь из кабинета слушателя", record, user, `Получатель: ${center ? email : deps.feedbackRecipient}; тема: ${subject}`);
      return success;
    });
  }
  async function correspondence(user, id, sync = false) {
    const { owner, record } = await context(user, id);
    return sync ? deps.lock(`student-correspondence:${owner.id}`, () => deps.feedbackHistory.sync(owner.id, record))
      : deps.feedbackHistory.history(owner.id, record.id);
  }
  return { authenticate, context, portal, update, upload, file, submit, provisionOrder, provisionExisting, sdo, staffSession, review, feedback, correspondence,
    orderEmailAccess, previewCabinetAccessEmail, sendCabinetAccessEmail,
    ...require("./student-cabinet.js").createService({ deps, context, mutate, portal, documentFolder, finances, validateUpload }) };
}
module.exports = { FIELDS, DOCS, credentials, matchProgram, documentRequirements, missingRequirements, sanitizeProfile,
  fingerprint, publicUser, welcomeMessage, validateUpload, finances, createService, planExistingAccounts, sdoAvailable, portalLogin, documentFolder };
