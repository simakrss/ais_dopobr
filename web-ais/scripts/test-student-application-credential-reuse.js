"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const helperStart = appSource.indexOf("  function hasReusableStudentPersonalValue");
const helperEnd = appSource.indexOf("  function getStudentApplicationRepeatComment", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Не найден блок повторного использования данных заявки");

function parseStudentApplicationSortDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/u.exec(text);
  if (ru) {
    return Date.UTC(
      Number(ru[3]),
      Number(ru[2]) - 1,
      Number(ru[1]),
      Number(ru[4] || 0),
      Number(ru[5] || 0),
      Number(ru[6] || 0)
    );
  }
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizeStudentApplicationPersonName(value) {
  return String(value || "")
    .replace(/\u00a0/gu, " ")
    .replace(/[.,;:()[\]{}"'«»]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е");
}

function buildHelpers(students, orderedMatchIds) {
  const state = { data: { collections: { students } } };
  const getStudentApplicationPreviousMatches = () => orderedMatchIds.map((id) => ({ id }));
  return new Function(
    "state",
    "getStudentApplicationPreviousMatches",
    "parseStudentApplicationSortDate",
    "normalizeStudentApplicationPersonName",
    "STUDENT_APPLICATION_REUSABLE_DOCUMENT_FIELDS",
    "STUDENT_APPLICATION_REUSABLE_SDO_FIELDS",
    "STUDENT_APPLICATION_REUSABLE_PERSONAL_FIELDS",
    `${appSource.slice(helperStart, helperEnd)}
     return { getLatestStudentApplicationCredentialSource, reuseExistingStudentPersonalData };`
  )(
    state,
    getStudentApplicationPreviousMatches,
    parseStudentApplicationSortDate,
    normalizeStudentApplicationPersonName,
    ["passportSeries"],
    ["login", "password", "portalAccess", "portalNotes"],
    ["telegram"]
  );
}

const previousStudents = [
  {
    id: "new-password-only",
    uid: "104",
    applicationDate: "27.08.2026",
    email: "student@example.test",
    password: "new-password-only",
    portalAccess: "newest portal setting"
  },
  {
    id: "new-login-only",
    uid: "103",
    applicationDate: "26.08.2026",
    email: "student@example.test",
    login: "new-login-only"
  },
  {
    id: "fresh-complete",
    uid: "102",
    applicationDate: "25.08.2026",
    email: "student@example.test",
    login: "fresh.login",
    password: "fresh-password"
  },
  {
    id: "old-complete",
    uid: "101",
    applicationDate: "01.08.2026",
    email: "student@example.test",
    login: "old.login",
    password: "old-password"
  }
];
const orderedIds = previousStudents.map((student) => student.id);
const helpers = buildHelpers(previousStudents, orderedIds);
const reused = helpers.reuseExistingStudentPersonalData(
  { id: "imported", name: "Иванов Иван Иванович" },
  { name: "Иванов Иван Иванович", email: "student@example.test" },
  {},
  "another-program"
);
assert.equal(reused.login, "fresh.login", "Нужен логин из самой свежей заявки с полной парой");
assert.equal(reused.password, "fresh-password", "Пароль должен браться из той же заявки, что и логин");
assert.equal(reused.portalAccess, "newest portal setting", "Остальные SDO-поля сохраняют прежний независимый fallback");

const sameDayHelpers = buildHelpers([
  {
    id: "same-day-later",
    uid: "201",
    applicationDate: "2026-08-27",
    sourceApplicationCreatedAt: "2026-08-27T15:40:00+03:00",
    email: "same-day@example.test",
    login: "later.login",
    password: "later-password"
  },
  {
    id: "same-day-earlier",
    uid: "202",
    applicationDate: "2026-08-27",
    sourceApplicationCreatedAt: "2026-08-27T09:10:00+03:00",
    email: "same-day@example.test",
    login: "earlier.login",
    password: "earlier-password"
  }
], ["same-day-earlier", "same-day-later"]);
const sameDay = sameDayHelpers.reuseExistingStudentPersonalData({}, { email: "same-day@example.test" }, {});
assert.equal(sameDay.login, "later.login", "В пределах дня нужен точный timestamp самой свежей заявки");
assert.equal(sameDay.password, "later-password");

const legacySameDayHelpers = buildHelpers([
  {
    id: "order-new",
    uid: "301",
    applicationDate: "2026-08-20",
    sourceOrderId: "1002",
    email: "legacy@example.test",
    login: "order.new",
    password: "order-new-pass"
  },
  {
    id: "order-old",
    uid: "302",
    applicationDate: "2026-08-20",
    sourceOrderId: "1001",
    email: "legacy@example.test",
    login: "order.old",
    password: "order-old-pass"
  }
], ["order-old", "order-new"]);
const legacySameDay = legacySameDayHelpers.reuseExistingStudentPersonalData({}, { email: "legacy@example.test" }, {});
assert.equal(legacySameDay.login, "order.new", "Для старых заявок одного дня используется более новый номер заказа");
assert.equal(legacySameDay.password, "order-new-pass");

const unknownSameDayOrderHelpers = buildHelpers([
  { id: "first-match", uid: "401", applicationDate: "2026-08-19", email: "ordered@example.test", login: "first.match", password: "first-pass" },
  { id: "second-match", uid: "999", applicationDate: "2026-08-19", email: "ordered@example.test", login: "second.match", password: "second-pass" }
], ["first-match", "second-match"]);
const unknownSameDayOrder = unknownSameDayOrderHelpers.reuseExistingStudentPersonalData({}, { email: "ordered@example.test" }, {});
assert.equal(unknownSameDayOrder.login, "first.match", "Без времени и номера заказа нельзя угадывать свежесть по uid");
assert.equal(unknownSameDayOrder.password, "first-pass");

const partialOnlyHelpers = buildHelpers([
  { id: "login-only", uid: "2", applicationDate: "2026-08-27", email: "partial@example.test", login: "partial.login", password: "   " },
  { id: "password-only", uid: "1", applicationDate: "2026-08-26", email: "partial@example.test", login: " ", password: "partial-password" }
], ["login-only", "password-only"]);
const partialOnly = partialOnlyHelpers.reuseExistingStudentPersonalData({}, { email: "partial@example.test" }, {});
assert.equal(partialOnly.login, undefined, "Нельзя переносить логин без пароля");
assert.equal(partialOnly.password, undefined, "Нельзя переносить пароль без логина");

const homonymHelpers = buildHelpers([
  {
    id: "newer-homonym",
    name: "Иванов Иван Иванович",
    applicationDate: "2026-08-27",
    email: "other@example.test",
    phone: "+7 900 000-00-02",
    login: "wrong.person",
    password: "wrong-password"
  },
  {
    id: "older-same-person",
    name: "Иванов Иван Иванович",
    applicationDate: "2026-08-20",
    email: "student@example.test",
    phone: "+7 900 000-00-01",
    login: "right.person",
    password: "right-password"
  }
], ["newer-homonym", "older-same-person"]);
const homonym = homonymHelpers.reuseExistingStudentPersonalData({}, {
  name: "Иванов Иван Иванович",
  email: "student@example.test",
  phone: "+7 900 000-00-01"
}, {});
assert.equal(homonym.login, "right.person", "Нельзя брать реквизиты более свежего однофамильца");
assert.equal(homonym.password, "right-password");

const ambiguousNameHelpers = buildHelpers([
  { id: "name-a", name: "Петров Пётр", applicationDate: "2026-08-27", email: "a@example.test", login: "a", password: "a-pass" },
  { id: "name-b", name: "Петров Пётр", applicationDate: "2026-08-20", email: "b@example.test", login: "b", password: "b-pass" }
], ["name-a", "name-b"]);
const ambiguousName = ambiguousNameHelpers.reuseExistingStudentPersonalData({}, { name: "Петров Петр" }, {});
assert.equal(ambiguousName.login, undefined, "При неоднозначном совпадении только по ФИО логин переносить нельзя");
assert.equal(ambiguousName.password, undefined, "При неоднозначном совпадении только по ФИО пароль переносить нельзя");

const conflictingContactsHelpers = buildHelpers([
  { id: "contact-a", name: "Сидоров Сидор", applicationDate: "2026-08-27", email: "shared@example.test", phone: "+7 900 000-00-01", login: "a", password: "a-pass" },
  { id: "contact-b", name: "Сидоров Сидор", applicationDate: "2026-08-20", email: "shared@example.test", phone: "+7 900 000-00-02", login: "b", password: "b-pass" }
], ["contact-a", "contact-b"]);
const conflictingContacts = conflictingContactsHelpers.reuseExistingStudentPersonalData({}, { name: "Сидоров Сидор" }, {});
assert.equal(conflictingContacts.login, undefined, "Общий email не устраняет конфликт разных телефонов однофамильцев");
assert.equal(conflictingContacts.password, undefined);

const conflictingEmailsHelpers = buildHelpers([
  { id: "email-a", name: "Смирнов Семён", applicationDate: "2026-08-27", email: "a@example.test", phone: "+7 900 000-00-03", login: "a", password: "a-pass" },
  { id: "email-b", name: "Смирнов Семён", applicationDate: "2026-08-20", email: "b@example.test", phone: "+7 900 000-00-03", login: "b", password: "b-pass" }
], ["email-a", "email-b"]);
const conflictingEmails = conflictingEmailsHelpers.reuseExistingStudentPersonalData({}, { name: "Смирнов Семен" }, {});
assert.equal(conflictingEmails.login, undefined, "Общий телефон не устраняет конфликт разных email однофамильцев");
assert.equal(conflictingEmails.password, undefined);

assert.match(
  appSource,
  /sourceApplicationCreatedAt:\s*String\(row\.dateCreated \|\| ""\)\.trim\(\)/u,
  "Импорт должен сохранять точное время заявки для последующего выбора реквизитов"
);

console.log("student application credential reuse tests: OK");
