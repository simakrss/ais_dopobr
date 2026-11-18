const assert = require("node:assert/strict");

const {
  buildStudentDatabaseRecordEventDifferenceSummary,
  buildStudentDatabaseSynchronizedChanges,
  hashStudentDatabaseCriticalIdentity,
  hashStudentDatabaseCriticalSnapshot,
  resolveStudentDatabaseFieldLevelMerge,
  resolveStudentDatabaseReconciliationAfterDirectionError
} = require("../app-server.js");

function assertSummaryShape(result, expectedCount) {
  assert.ok(result && typeof result === "object" && !Array.isArray(result));
  assert.equal(typeof result.before, "string");
  assert.equal(typeof result.after, "string");
  assert.equal(typeof result.summary, "string");
  assert.equal(result.differenceCount, expectedCount);
  assert.ok(Array.isArray(result.differences));
  assert.equal(result.differences.length, expectedCount);
  result.differences.forEach((difference) => {
    assert.ok(difference && typeof difference === "object" && !Array.isArray(difference));
    assert.equal(typeof difference.kind, "string");
    assert.equal(typeof difference.label, "string");
    assert.equal(typeof difference.before, "string");
    assert.equal(typeof difference.after, "string");
  });
}

function summaryDisplayValues(result) {
  return [
    result.before,
    result.after,
    result.summary,
    ...(result.differences || []).flatMap((difference) => [
      difference.label,
      difference.before,
      difference.after
    ])
  ].map((value) => String(value || ""));
}

function assertNoTechnicalEventPayload(values, context) {
  const text = (Array.isArray(values) ? values : [values]).join("\n");
  assert.doesNotMatch(text, /(?:eventOrder|eventCustomKeys|eventDeleted|event_[A-Za-z0-9_-]+|imported_)/u, context);
  assert.doesNotMatch(text, /\[\s*\{\s*["']?(?:label|state|date)["']?\s*:/u, context);
  assert.doesNotMatch(text, /["'](?:label|state|date)["']\s*:/u, context);
}

function hasKind(result, pattern) {
  return result.differences.some((difference) => pattern.test(String(difference.kind || "")));
}

const stateAndDate = buildStudentDatabaseRecordEventDifferenceSummary(
  [{ label: "Получен подписанный договор", state: "", date: "" }],
  [{ label: "Получен подписанный договор", state: "1", date: "2026-08-29" }]
);
assertSummaryShape(stateAndDate, 1);
assert.ok(
  hasKind(stateAndDate, /(?:chang|updat|state|date|измен|статус|дат)/iu),
  "Изменение статуса и даты должно иметь понятный тип."
);
assert.match(stateAndDate.differences[0].before, /не\s+выполнен/iu);
assert.match(stateAndDate.differences[0].after, /выполнен/iu);
assert.match(stateAndDate.differences[0].after, /29\.08\.2026/u);
assert.doesNotMatch(stateAndDate.differences[0].after, /2026-08-29/u);
assertNoTechnicalEventPayload(
  summaryDisplayValues(stateAndDate),
  "Сводка статуса и даты не должна содержать технические поля."
);

const added = buildStudentDatabaseRecordEventDifferenceSummary(
  [],
  [{ label: "Документы для обучения получены", state: "1", date: "2026-08-28" }]
);
assertSummaryShape(added, 1);
assert.ok(hasKind(added, /(?:add|добав)/iu), "Добавленное событие должно иметь тип added.");
assert.match(added.differences[0].after, /Документы для обучения получены/u);
assert.match(added.differences[0].after, /28\.08\.2026/u);

const removed = buildStudentDatabaseRecordEventDifferenceSummary(
  [{ label: "Доступ к порталу отправлен", state: "1", date: "2026-08-27" }],
  []
);
assertSummaryShape(removed, 1);
assert.ok(
  hasKind(removed, /(?:remov|delet|удал)/iu),
  "Удалённое событие должно иметь понятный тип."
);
assert.match(removed.differences[0].before, /Доступ к порталу отправлен/u);
assert.match(removed.differences[0].before, /27\.08\.2026/u);

const renamed = buildStudentDatabaseRecordEventDifferenceSummary(
  [{ label: "Исходное название", state: "1", date: "2026-08-26" }],
  [{ label: "Понятное новое название", state: "1", date: "2026-08-26" }]
);
assertSummaryShape(renamed, 1);
assert.ok(
  hasKind(renamed, /(?:renam|переимен)/iu),
  "Переименование события должно быть отдельным семантическим изменением."
);
assert.match(renamed.differences[0].before, /Исходное название/u);
assert.match(renamed.differences[0].after, /Понятное новое название/u);

const reordered = buildStudentDatabaseRecordEventDifferenceSummary(
  [
    { label: "Первое событие", state: "1", date: "2026-08-24" },
    { label: "Второе событие", state: "", date: "" }
  ],
  [
    { label: "Второе событие", state: "", date: "" },
    { label: "Первое событие", state: "1", date: "2026-08-24" }
  ]
);
assertSummaryShape(reordered, reordered.differenceCount);
assert.ok(reordered.differenceCount >= 1, "Перестановка событий должна давать хотя бы одно описание изменения.");
assert.ok(
  hasKind(reordered, /(?:order|reorder|поряд)/iu),
  "Изменение порядка событий должно быть видно отдельно."
);
assert.match(reordered.summary, /поряд/iu);
assertNoTechnicalEventPayload(
  summaryDisplayValues(reordered),
  "Порядок событий должен описываться названиями, а не служебными ключами."
);

const longWordpressNotice = "Привет! Обновление плагинов на вашем сайте (https://edu-plus.ru) не удалось. Проверьте сейчас свой сайт. Вполне возможно, что всё работает. Если он предложит обновиться, сделайте это. Следующие плагины не удалось обновить. Если в обновлении произошла фатальная ошибка, будет восстановлена ранее установленная версия. - Admin Menu Editor Pro (от версии 2.14 до 2.34): http://adminmenueditor.com/ Эти плагины не требуют обновления: - All in One SEO (от версии 5.0.1 до 5.0.1.1): https://wordpress.org/plugins/all-in-one-seo-pack/ - WP-PageNavi (от версии 3.0.0 до 3.0.1): https://wordpress.org/plugins/wp-pagenavi/ Для управления плагинами вашего сайта, посетите страницу плагинов: https://edu-plus.ru/wp-admin/plugins.php Если вы столкнётесь с проблемами и вам понадобится поддержка, вам помогут волонтёры на форумах WordPress.org. https://ru.wordpress.org/support/forums/ Команда WordPress";
const longTextResult = buildStudentDatabaseRecordEventDifferenceSummary(
  [],
  [{ label: longWordpressNotice, state: "1", date: "2026-08-29" }]
);
assertSummaryShape(longTextResult, 1);
const longTextDisplayValues = summaryDisplayValues(longTextResult);
longTextDisplayValues.forEach((value) => {
  assert.ok(value.length < 500, "Длинный текст письма не должен повторяться в сводке.");
  assert.ok(!value.includes(longWordpressNotice), "В сводку нельзя включать всё письмо WordPress.");
});
assert.ok(
  longTextDisplayValues.some((value) => /\(\d+\s*(?:зн\.?|знак|символ)/iu.test(value)),
  "В короткой метке нужно указать число знаков."
);
assert.ok(
  longTextDisplayValues.some((value) => /длинн|текст|содержан/iu.test(value)),
  "Метка должна пояснять, что вместо названия события получен длинный текст."
);
assert.ok(
  !longTextDisplayValues.some((value) => value.includes("Команда WordPress")),
  "Хвост служебного письма не должен попадать в краткую сводку."
);
assertNoTechnicalEventPayload(
  longTextDisplayValues,
  "Даже для длинного текста сводка должна оставаться человекочитаемой."
);

const studentBefore = {
  id: "student-event-diff-1",
  uid: "91001",
  name: "Тестова Мария Ивановна",
  applicationDate: "2026-08-20",
  program: "Тестовая программа",
  status: "Обучается",
  eventOrder: "imported_notice",
  eventCustomKeys: "imported_notice",
  event_imported_notice_label: "Документы отправлены",
  event_imported_notice_state: "unchecked",
  event_imported_notice_date: ""
};
const studentAfter = {
  ...studentBefore,
  event_imported_notice_label: "Документы получены",
  event_imported_notice_state: "dated",
  event_imported_notice_date: "2026-08-29"
};
const emptyCollections = {
  contracts: [],
  directExpenses: [],
  generalExpenses: [],
  inventoryRows: [],
  programs: [],
  trainingPlans: []
};
const synchronized = buildStudentDatabaseSynchronizedChanges(
  { ...emptyCollections, students: [studentBefore] },
  { ...emptyCollections, students: [studentAfter] }
);
assert.equal(synchronized.totalCount, 1, "Три технических поля события должны дать одно реальное изменение.");
assert.equal(synchronized.rows.length, 1);
assert.equal(synchronized.rows[0].field, "События карточки");
assert.match(synchronized.rows[0].before, /Документы отправлены/u);
assert.match(synchronized.rows[0].after, /Документы получены/u);
assert.match(synchronized.rows[0].after, /29\.08\.2026/u);
assertNoTechnicalEventPayload(
  [
    synchronized.rows[0].field,
    synchronized.rows[0].before,
    synchronized.rows[0].after
  ],
  "Протокол синхронизации не должен показывать служебную структуру событий."
);

const mergeBaselineData = {
  ...emptyCollections,
  students: [{
    id: "student-event-field-merge-1",
    uid: "91002",
    name: "Событиева Анна Петровна",
    applicationDate: "2026-08-20",
    program: "Тестовая программа",
    status: "Обучается",
    additionalStatus: "обучается",
    eventOrder: "imported_signed",
    eventCustomKeys: "imported_signed",
    event_imported_signed_label: "Получен подписанный договор",
    event_imported_signed_state: "unchecked",
    event_imported_signed_date: ""
  }]
};
const mergeWebData = structuredClone(mergeBaselineData);
mergeWebData.students[0].event_imported_signed_state = "dated";
mergeWebData.students[0].event_imported_signed_date = "2026-08-29";
const mergeExcelData = structuredClone(mergeBaselineData);
mergeExcelData.students[0].additionalStatus = "на продлении";
const mergeBaseline = {
  version: 2,
  sourceHash: "1".repeat(64),
  sourceIdentity: "2".repeat(64),
  webRevision: 7,
  synchronizedAt: "2026-08-29T08:00:00.000Z",
  criticalHash: hashStudentDatabaseCriticalSnapshot(mergeBaselineData),
  criticalIdentityHash: hashStudentDatabaseCriticalIdentity(mergeBaselineData)
};
const mergeAuditRows = [{
  createdAt: "2026-08-29T09:00:00.000Z",
  action: "Автоматически отмечено событие",
  entityType: "students",
  entityId: "student-event-field-merge-1",
  entityLabel: "Событиева Анна Петровна",
  source: "web",
  changes: [{
    field: "cardEventState",
    label: "Событие: Получен подписанный договор",
    before: "Не выполнено",
    after: "Выполнено · 29.08.2026"
  }]
}];

function assertAutomaticEventFieldMerge(result, context) {
  assert.ok(result, `${context}: по-полевое слияние не должно возвращать null.`);
  assert.notEqual(result.completeReconciliation, true, `${context}: полное сравнение всех данных не требуется.`);
  assert.deepEqual(result.conflicts, [], `${context}: изменялись разные данные, поэтому конфликта нет.`);
  const mergedStudent = result.collections?.students?.[0] || result.students?.[0];
  assert.ok(mergedStudent, `${context}: в результате нет слушателя.`);
  assert.equal(mergedStudent.additionalStatus, "на продлении");
  assert.equal(mergedStudent.event_imported_signed_state, "dated");
  assert.equal(mergedStudent.event_imported_signed_date, "2026-08-29");
  const changes = Array.isArray(result.changes) ? result.changes : [];
  const eventChanges = changes.filter((change) => change.field === "События карточки");
  assert.equal(eventChanges.length, 1, `${context}: статус и дата должны быть одной понятной строкой.`);
  assert.match(eventChanges[0].before, /не\s+выполнен/iu);
  assert.match(eventChanges[0].after, /выполнен/iu);
  assert.match(eventChanges[0].after, /29\.08\.2026/u);
  assert.ok(changes.some((change) => (
    change.field === "Доп. статус"
    && change.action === "Excel → Web"
  )), `${context}: обычное изменение XLSB должно слиться вместе с Web-событием.`);
  assertNoTechnicalEventPayload(
    changes.flatMap((change) => [change.field, change.before, change.after]),
    `${context}: протокол слияния не должен содержать event_*, imported_ или JSON.`
  );
}

const directEventFieldMerge = resolveStudentDatabaseFieldLevelMerge({
  webData: mergeWebData,
  excelData: mergeExcelData,
  baseline: mergeBaseline,
  auditRows: mergeAuditRows
});
assertAutomaticEventFieldMerge(directEventFieldMerge, "Прямое слияние");

const routedEventFieldMerge = resolveStudentDatabaseReconciliationAfterDirectionError({
  errorCode: "STUDENT_DATABASE_DUAL_CRITICAL_CHANGE",
  webData: mergeWebData,
  excelData: mergeExcelData,
  baseline: mergeBaseline,
  auditRows: mergeAuditRows
});
assertAutomaticEventFieldMerge(routedEventFieldMerge, "Слияние после ошибки направления");

const legacyLongEventBaselineData = structuredClone(mergeBaselineData);
legacyLongEventBaselineData.students[0].eventOrder = "imported_signed,imported_other";
legacyLongEventBaselineData.students[0].eventCustomKeys = "imported_signed,imported_other";
legacyLongEventBaselineData.students[0].event_imported_signed_label = longWordpressNotice;
legacyLongEventBaselineData.students[0].event_imported_other_label = "Другое выполненное событие";
legacyLongEventBaselineData.students[0].event_imported_other_state = "dated";
legacyLongEventBaselineData.students[0].event_imported_other_date = "2026-08-29";
const legacyLongEventWebData = structuredClone(legacyLongEventBaselineData);
legacyLongEventWebData.students[0].event_imported_signed_state = "dated";
legacyLongEventWebData.students[0].event_imported_signed_date = "2026-08-29";
const legacyLongEventExcelData = structuredClone(legacyLongEventBaselineData);
legacyLongEventExcelData.students[0].additionalStatus = "на продлении";
const legacyLongEventBaseline = {
  ...mergeBaseline,
  criticalHash: hashStudentDatabaseCriticalSnapshot(legacyLongEventBaselineData),
  criticalIdentityHash: hashStudentDatabaseCriticalIdentity(legacyLongEventBaselineData)
};
const legacyLongEventMerge = resolveStudentDatabaseFieldLevelMerge({
  webData: legacyLongEventWebData,
  excelData: legacyLongEventExcelData,
  baseline: legacyLongEventBaseline,
  auditRows: [{
    ...mergeAuditRows[0],
    label: undefined,
    changes: [{
      ...mergeAuditRows[0].changes[0],
      label: `Событие: ${longWordpressNotice}`.slice(0, 240)
    }]
  }]
});
assertAutomaticEventFieldMerge(
  legacyLongEventMerge,
  "Слияние старого события с обрезанным длинным названием"
);

console.log("Проверка понятной сводки событий синхронизации пройдена.");
