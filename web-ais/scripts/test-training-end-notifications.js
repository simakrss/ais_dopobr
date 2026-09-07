"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";

const {
  getMoscowCalendarDate,
  getCalendarDateInTimeZone,
  parseTrainingEndNotificationDate,
  normalizeTrainingEndNotificationRecipients,
  withoutTrainingEndNotificationSharedMeta,
  withoutTrainingEndNotificationMetaPatch,
  withoutTrainingEndNotificationSharedStateResult,
  getTrainingEndNotificationCandidates,
  buildTrainingEndNotificationDeliveryPlan,
  getTrainingEndNotificationConfiguration,
  getTrainingEndNotificationSchedule,
  buildTrainingEndNotificationMessage,
  buildTrainingEndStudentNotificationMessage,
  createEmailMessage
} = require("../app-server.js");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8").replace(/\r\n/g, "\n");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.deepEqual(getMoscowCalendarDate("2026-08-21T21:30:00.000Z"), {
  key: "2026-08-22",
  utcDay: Date.UTC(2026, 7, 22)
});
assert.equal(parseTrainingEndNotificationDate("27.08.2026"), Date.UTC(2026, 7, 27));
assert.equal(parseTrainingEndNotificationDate("2026-08-27"), Date.UTC(2026, 7, 27));
assert.equal(parseTrainingEndNotificationDate("31.02.2026"), null);

assert.deepEqual(getCalendarDateInTimeZone("2026-08-24T04:15:00.000Z", "Asia/Yekaterinburg"), {
  key: "2026-08-24",
  utcDay: Date.UTC(2026, 7, 24),
  weekday: 1,
  minutesOfDay: 9 * 60 + 15,
  timeZone: "Asia/Yekaterinburg"
});

assert.deepEqual(getTrainingEndNotificationConfiguration({
  enabled: true,
  days: 7,
  time: "10:30",
  timeZone: "Asia/Yekaterinburg",
  frequency: "weekdays",
  programTypes: ["КПК", "ДОП", "ППП"],
  recipients: ["manager@example.ru", "admin@example.ru"]
}), {
  enabled: true,
  days: 7,
  time: "10:30",
  timeZone: "Asia/Yekaterinburg",
  frequency: "weekdays",
  programTypes: ["КПК", "ДОП", "ППП"],
  recipients: ["manager@example.ru", "admin@example.ru"]
});
assert.deepEqual(
  normalizeTrainingEndNotificationRecipients([
    " Manager@Example.ru ",
    "manager@example.ru",
    "ADMIN@example.ru"
  ]),
  ["manager@example.ru", "admin@example.ru"]
);
assert.throws(
  () => normalizeTrainingEndNotificationRecipients(["incorrect-email"]),
  /корректный email/u
);
assert.throws(
  () => normalizeTrainingEndNotificationRecipients([`${"a".repeat(150)}@example.ru`]),
  /160 символов/u
);
assert.throws(
  () => normalizeTrainingEndNotificationRecipients(
    Array.from({ length: 51 }, (_, index) => `user${index}@example.ru`)
  ),
  /не более 50/u
);
assert.deepEqual(
  withoutTrainingEndNotificationSharedMeta({
    meta: {
      ordinary: "visible",
      trainingEndNotificationRecipients: ["private@example.ru"],
      trainingEndNotificationDays: 5
    },
    collections: { students: [] }
  }),
  {
    meta: { ordinary: "visible" },
    collections: { students: [] }
  }
);
assert.deepEqual(
  withoutTrainingEndNotificationMetaPatch({
    patch: {
      meta: {
        ordinary: "saved",
        trainingEndNotificationRecipients: ["private@example.ru"]
      }
    }
  }),
  {
    patch: {
      meta: { ordinary: "saved" }
    }
  }
);
assert.deepEqual(
  withoutTrainingEndNotificationSharedStateResult({
    revision: 12,
    data: {
      meta: {
        ordinary: "visible",
        trainingEndNotificationRecipients: ["private@example.ru"]
      }
    },
    document: {
      data: {
        meta: {
          ordinary: "nested",
          trainingEndNotificationStatus: { status: "failed", lastError: "private" }
        }
      }
    }
  }),
  {
    revision: 12,
    data: { meta: { ordinary: "visible" } },
    document: { data: { meta: { ordinary: "nested" } } }
  }
);
assert.deepEqual(
  withoutTrainingEndNotificationMetaPatch({
    baseRevision: 0,
    data: {
      meta: {
        ordinary: "created",
        trainingEndNotificationRecipients: ["private@example.ru"],
        trainingEndNotificationTime: "09:00"
      },
      collections: { students: [] }
    }
  }),
  {
    baseRevision: 0,
    data: {
      meta: { ordinary: "created" },
      collections: { students: [] }
    }
  }
);

assert.equal(getTrainingEndNotificationSchedule("2026-08-24T06:29:00.000Z", {
  time: "09:30",
  timeZone: "Europe/Moscow",
  frequency: "daily"
}).due, false);
assert.equal(getTrainingEndNotificationSchedule("2026-08-24T06:30:00.000Z", {
  time: "09:30",
  timeZone: "Europe/Moscow",
  frequency: "daily"
}).due, true);
assert.deepEqual(getTrainingEndNotificationSchedule("2026-08-23T09:00:00.000Z", {
  time: "09:00",
  timeZone: "Europe/Moscow",
  frequency: "weekdays"
}), {
  due: false,
  reason: "non-working-day",
  periodKey: "2026-08-23",
  calendarDate: "2026-08-23",
  utcDay: Date.UTC(2026, 7, 23),
  weekday: 0,
  time: "09:00",
  timeZone: "Europe/Moscow",
  frequency: "weekdays"
});
assert.equal(getTrainingEndNotificationSchedule("2026-08-26T09:00:00.000Z", {
  time: "09:00",
  timeZone: "Europe/Moscow",
  frequency: "weekly"
}).periodKey, "2026-08-24");

const notificationPrograms = [
  { id: "program-ppp", name: "Программа ППП", type: "ППП" },
  { id: "program-dop", name: "Программа ДОП", type: "ДОП" },
  { id: "program-pro", name: "Программа ПРО", type: "ПРО" }
];

const candidates = getTrainingEndNotificationCandidates([
  {
    id: "student-kpk-direct",
    uid: "1162",
    name: "Иванова Анна Ивановна",
    status: "Учится",
    educationType: "КПК",
    program: "Программа КПК",
    email: "student@example.ru",
    finalGrade: "",
    endDate: "2026-08-26",
    responsible: "manager"
  },
  {
    id: "student-ppp-from-program",
    uid: "1163",
    name: "Петров Петр Петрович",
    status: " Учится ",
    program: "Программа ППП",
    email: " PETR@Example.ru ",
    finalGrade: " ",
    endDate: "2026-08-22"
  },
  {
    id: "student-dop-extended",
    name: "Сидорова Ольга Сергеевна",
    status: "Учится",
    program: "Программа ДОП",
    email: "incorrect-email",
    finalGrade: "",
    endDate: "2026-09-01",
    extendedEndDate: "25.08.2026"
  },
  {
    id: "student-exact-boundary",
    name: "Граница пять дней",
    status: "Учится",
    educationType: "КПК",
    finalGrade: "",
    endDate: "2026-08-27"
  },
  {
    id: "student-overdue",
    name: "Просроченный слушатель",
    status: "Учится",
    educationType: "КПК",
    finalGrade: "",
    endDate: "2026-08-21"
  },
  {
    id: "student-with-grade",
    name: "Слушатель с оценкой",
    status: "Учится",
    educationType: "ППП",
    finalGrade: "Отлично",
    endDate: "2026-08-24"
  },
  {
    id: "student-pro",
    name: "Слушатель ПРО",
    status: "Учится",
    program: "Программа ПРО",
    finalGrade: "",
    endDate: "2026-08-24"
  },
  {
    id: "student-unknown-program",
    name: "Неизвестная программа",
    status: "Учится",
    program: "Программа без типа",
    finalGrade: "",
    endDate: "2026-08-24"
  },
  {
    id: "student-expelled",
    name: "Отчисленный слушатель",
    status: "Отчислен",
    educationType: "ДОП",
    finalGrade: "",
    endDate: "2026-08-24"
  },
  {
    id: "student-extended-outside-window",
    name: "Продлённый слушатель",
    status: "Учится",
    educationType: "КПК",
    finalGrade: "",
    endDate: "2026-08-24",
    extendedEndDate: "2026-08-28"
  }
], {
  today: "2026-08-22T08:00:00.000Z",
  days: 5,
  programs: notificationPrograms,
  programTypes: ["КПК", "ДОП", "ППП"]
});

assert.deepEqual(candidates.map((student) => student.id), [
  "student-ppp-from-program",
  "student-dop-extended",
  "student-kpk-direct"
]);
assert.deepEqual(candidates.map((student) => student.daysRemaining), [0, 3, 4]);
assert.deepEqual(candidates.map((student) => student.email), [
  "petr@example.ru",
  "",
  "student@example.ru"
]);
assert.equal(candidates[1].endDate, "25.08.2026");

const deliveryPlan = buildTrainingEndNotificationDeliveryPlan(candidates);
assert.equal(deliveryPlan.mode, "student");
assert.equal(deliveryPlan.missingEmailCount, 1);
assert.deepEqual(
  deliveryPlan.deliveries.map((delivery) => delivery.recipient),
  ["petr@example.ru", "student@example.ru"]
);
assert.deepEqual(
  deliveryPlan.deliveries.map((delivery) => delivery.candidates.map((student) => student.id)),
  [["student-ppp-from-program"], ["student-kpk-direct"]]
);
assert.match(deliveryPlan.deliveries[0].deliveryKey, /^student:[a-f0-9]{64}$/u);

const sharedRecipientCandidates = [
  { id: "first", uid: "1", name: "Первый Слушатель", email: "same@example.ru", program: "Курс 1", endDate: "2026-08-24" },
  { id: "second", uid: "2", name: "Второй Слушатель", email: "SAME@example.ru", program: "Курс 2", endDate: "2026-08-25" }
];
const sharedRecipientPlan = buildTrainingEndNotificationDeliveryPlan(sharedRecipientCandidates);
assert.equal(sharedRecipientPlan.deliveries.length, 2);
assert.deepEqual(
  sharedRecipientPlan.deliveries.map((delivery) => delivery.candidates.map((student) => student.id)),
  [["first"], ["second"]],
  "Один общий email не должен объединять программы разных слушателей"
);
assert.deepEqual(
  buildTrainingEndNotificationDeliveryPlan([...sharedRecipientCandidates].reverse())
    .deliveries.map((delivery) => delivery.deliveryKey).sort(),
  sharedRecipientPlan.deliveries.map((delivery) => delivery.deliveryKey).sort(),
  "Ключ доставки должен оставаться стабильным при изменении порядка записей"
);

const sameStudentCandidates = [
  { id: "course-one", name: "Один Слушатель", email: "student@example.ru", program: "Курс 1", endDate: "2026-08-24" },
  { id: "course-two", name: "  один   слушатель ", email: "STUDENT@example.ru", program: "Курс 2", endDate: "2026-08-25" }
];
const sameStudentPlan = buildTrainingEndNotificationDeliveryPlan(sameStudentCandidates);
assert.equal(sameStudentPlan.deliveries.length, 1);
assert.deepEqual(
  sameStudentPlan.deliveries[0].candidates.map((student) => student.id),
  ["course-one", "course-two"],
  "Программы одного слушателя должны оставаться в одном письме"
);
assert.equal(
  buildTrainingEndNotificationDeliveryPlan([sameStudentCandidates[0]]).deliveries[0].deliveryKey,
  sameStudentPlan.deliveries[0].deliveryKey,
  "Ключ слушателя не должен меняться при изменении состава его программ во время повтора"
);

const systemTestPlan = buildTrainingEndNotificationDeliveryPlan(candidates, {
  testMode: true,
  testRecipients: ["mail@edu-plus.ru"]
});
assert.equal(systemTestPlan.mode, "test");
assert.equal(systemTestPlan.deliveries.length, 1);
assert.equal(systemTestPlan.deliveries[0].recipient, "mail@edu-plus.ru");
assert.equal(systemTestPlan.deliveries[0].candidates.length, candidates.length);
assert.match(systemTestPlan.deliveries[0].deliveryKey, /^test:[a-f0-9]{64}$/u);
assert.equal(
  buildTrainingEndNotificationDeliveryPlan([], {
    testMode: true,
    testRecipients: ["mail@edu-plus.ru"]
  }).deliveries.length,
  1,
  "Тест системного ящика должен работать даже при отсутствии подходящих слушателей"
);
assert.deepEqual(
  buildTrainingEndNotificationDeliveryPlan([
    { id: "without-email", email: "" },
    { id: "invalid-email", email: "invalid" }
  ]),
  { mode: "student", missingEmailCount: 2, deliveries: [] }
);

const ambiguousShortNamePrograms = [
  { name: "Общий курс (72 ч)", shortName: "Общий курс", type: "КПК", hours: 72 },
  { name: "Общий курс (144 ч)", shortName: "Общий курс", type: "ДОП", hours: 144 }
];
const ambiguousShortNameCandidates = getTrainingEndNotificationCandidates([
  {
    id: "ambiguous-without-type",
    name: "Неоднозначный тип",
    status: "Учится",
    program: "Общий курс",
    finalGrade: "",
    endDate: "2026-08-24"
  },
  {
    id: "ambiguous-with-direct-type",
    name: "Тип указан в карточке",
    status: "Учится",
    program: "Общий курс",
    educationType: "ДОП",
    finalGrade: "",
    endDate: "2026-08-24"
  }
], {
  today: "2026-08-22T08:00:00.000Z",
  days: 5,
  programs: ambiguousShortNamePrograms,
  programTypes: ["КПК", "ДОП", "ППП"]
});
assert.deepEqual(
  ambiguousShortNameCandidates.map((student) => student.id),
  ["ambiguous-with-direct-type"]
);
assert.deepEqual(
  getTrainingEndNotificationCandidates([{
    id: "blank-extension-fallback",
    name: "Пробельная дата продления",
    status: "Учится",
    educationType: "КПК",
    finalGrade: "",
    endDate: "2026-08-24",
    extendedEndDate: "   "
  }], {
    today: "2026-08-22T08:00:00.000Z",
    days: 5
  }).map((student) => student.id),
  ["blank-extension-fallback"]
);

const message = buildTrainingEndNotificationMessage([
  ...candidates,
  {
    name: "Тест <script>",
    uid: "42&7",
    program: "Курс > проверка",
    endDate: "2026-08-26",
    daysRemaining: 4,
    responsible: "admin"
  }
], { days: 5 });
assert.match(message, /ближайшие 5 дн\./u);
assert.match(message, /Иванова Анна Ивановна/u);
assert.doesNotMatch(message, /Просрочено/u);
assert.match(message, /Тест &lt;script&gt;/u);
assert.doesNotMatch(message, /<script>/u);

const testMessage = buildTrainingEndNotificationMessage(candidates, {
  days: 5,
  testMode: true
});
assert.match(testMessage, /Тестовая отправка/u);
assert.match(testMessage, /Письма слушателям не отправлялись/u);

const studentMessage = buildTrainingEndStudentNotificationMessage(
  deliveryPlan.deliveries[0].candidates
);
assert.match(studentMessage, /Программа ППП/u);
assert.doesNotMatch(studentMessage, /Программа КПК/u);
assert.doesNotMatch(studentMessage, /Иванова Анна Ивановна/u);
assert.match(studentMessage, /Оценка итоговой аттестации пока не заполнена/u);

const stableEmailOptions = {
  from: "mail@edu-plus.ru",
  to: "manager@example.ru",
  subject: "Проверка уведомления",
  message: "Сводка",
  idempotencyKey: "training-end-notification:2026-08-22:manager@example.ru"
};
const stableMessageId = /^Message-ID: <([^>]+)>$/mu.exec(
  createEmailMessage(stableEmailOptions)
)?.[1];
assert.ok(stableMessageId, "Не сформирован устойчивый Message-ID уведомления.");
assert.equal(
  /^Message-ID: <([^>]+)>$/mu.exec(createEmailMessage(stableEmailOptions))?.[1],
  stableMessageId
);
assert.notEqual(
  /^Message-ID: <([^>]+)>$/mu.exec(createEmailMessage({
    ...stableEmailOptions,
    idempotencyKey: `${stableEmailOptions.idempotencyKey}:other`
  }))?.[1],
  stableMessageId
);

assert.match(appSource, /name="trainingEndNotificationsEnabled"/u);
assert.match(appSource, /name="trainingEndNotificationDays"/u);
assert.match(appSource, /Уведомлять за/u);
assert.match(appSource, /name="trainingEndNotificationTime"/u);
assert.match(appSource, /name="trainingEndNotificationTimeZone"/u);
assert.match(appSource, /name="trainingEndNotificationFrequency"/u);
assert.match(appSource, /Еженедельно, по понедельникам/u);
assert.match(appSource, /notificationSettings:\s*"Уведомления"/u);
assert.match(appSource, /data-action="save-training-end-notification-settings"/u);
assert.doesNotMatch(appSource, /class="admin-training-end-notification(?:\s|")/u);
assert.match(appSource, /\/api\/training-end-notifications\/check/u);
assert.match(appSource, /\/api\/admin\/training-end-notifications\/run/u);
assert.match(appSource, /\/api\/admin\/training-end-notifications\/settings/u);
assert.match(appSource, /TRAINING_END_NOTIFICATION_CHECK_INTERVAL_MS/u);
assert.match(serverSource, /const TRAINING_END_NOTIFICATION_CHECK_INTERVAL_MS = 60 \* 1000;/u);
assert.match(serverSource, /getTrainingEndNotificationSchedule/u);
assert.match(serverSource, /programTypes/u);
assert.match(serverSource, /recipients/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_scheduled_job_runs/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_scheduled_job_settings/u);
assert.match(serverSource, /sharedRecordLocksMySqlPool = null;\n  scheduledJobRunsTableInitialization = null;/u);
assert.match(serverSource, /status === "completed"/u);
assert.match(serverSource, /checkpointTrainingEndNotificationRun/u);
assert.match(serverSource, /if \(sentDeliveryKeys\.has\(delivery\.deliveryKey\)\) continue;/u);
assert.match(serverSource, /if \(error\?\.deliveryUnknown === true\)[\s\S]*?checkpointTrainingEndNotificationRun/u);
assert.match(serverSource, /result_json = VALUES\(result_json\)/u);
assert.match(serverSource, /testRecipients: testMode \? \[systemMailbox\] : \[\]/u);
assert.match(serverSource, /testMode: true,\n\s+source: "admin"/u);
assert.match(serverSource, /email: normalizeTrainingEndNotificationStudentEmail\(student\?\.email\)/u);
assert.match(serverSource, /SELECT status,[\s\S]*?result_json[\s\S]*?FROM ais_scheduled_job_runs/u);
assert.match(appSource, /String\(status\.outcome \|\| ""\) === "test-sent"/u);
assert.doesNotMatch(
  serverSource,
  /for \(const recipient of configuration\.recipients\)/u,
  "Плановая рассылка не должна использовать системный список получателей"
);
assert.match(appSource, /TRAINING_END_NOTIFICATION_SERVER_META_KEYS/u);
assert.match(appSource, /if \(!isAdminUser\(\)\) return;\n    try \{\n      const response = await fetch\(photoApiUrl\("\/api\/training-end-notifications\/check"\)/u);
assert.match(serverSource, /"\/api\/training-end-notifications\/check",\n      "\/api\/admin\/training-end-notifications\/run"/u);
assert.match(appSource, /function withTrainingEndNotificationServerMeta/u);
assert.match(
  appSource,
  /ensureDataShape\(withTrainingEndNotificationServerMeta\(payload\.data\)\)/u
);
assert.match(appSource, /const confirmedData = withTrainingEndNotificationServerMeta\(payload\.data\);/u);
assert.match(appSource, /applyResponse: false/u);
assert.match(serverSource, /Некорректный запрос проверки сроков обучения/u);
assert.match(serverSource, /startTrainingEndNotificationScheduler\(\)/u);
const notificationSettingsRoute = serverSource.indexOf("/api/admin/training-end-notifications/settings");
assert.notEqual(notificationSettingsRoute, -1, "Не найден endpoint настроек уведомлений.");
const notificationSettingsRouteSource = serverSource.slice(
  Math.max(0, notificationSettingsRoute - 400),
  notificationSettingsRoute + 500
);
assert.match(notificationSettingsRouteSource, /GET/u);
assert.match(notificationSettingsRouteSource, /POST/u);
assert.match(stylesSource, /\.training-end-notification-settings/u);
assert.match(
  stylesSource,
  /\.training-end-notification-settings-fields \{[\s\S]*?display: flex;[\s\S]*?justify-content: flex-start;/u
);
assert.match(
  stylesSource,
  /\.training-end-notification-time-controls \{[\s\S]*?grid-template-columns: 108px 190px;/u
);
assert.doesNotMatch(appSource, /name="trainingEndNotificationRecipients"/u);
assert.match(appSource, /Получатель — слушатель/u);
assert.match(appSource, /Адрес берётся из поля «Email» карточки слушателя/u);
assert.match(appSource, /Отправить тест/u);
const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authSource)?.[1] || "";
assert.ok(authBuild, "Не найден идентификатор клиентской сборки.");
assert.match(indexSource, new RegExp(`(?:styles\\.css|auth-bootstrap\\.js)\\?v=${authBuild}`, "u"));

console.log("training end notification tests: OK");
