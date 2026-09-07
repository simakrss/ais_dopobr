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
  getTrainingEndNotificationConfiguration,
  getTrainingEndNotificationSchedule,
  buildTrainingEndNotificationMessage,
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
    finalGrade: " ",
    endDate: "2026-08-22"
  },
  {
    id: "student-dop-extended",
    name: "Сидорова Ольга Сергеевна",
    status: "Учится",
    program: "Программа ДОП",
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
assert.equal(candidates[1].endDate, "25.08.2026");

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
assert.match(appSource, /Уведомлять за \(дней\)/u);
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
assert.match(serverSource, /if \(sentRecipients\.has\(recipient\)\) continue;/u);
assert.match(serverSource, /if \(error\?\.deliveryUnknown === true\)[\s\S]*?checkpointTrainingEndNotificationRun/u);
assert.match(serverSource, /result_json = VALUES\(result_json\)/u);
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
  /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 170px\), 1fr\)\)/u
);
assert.match(
  stylesSource,
  /\.training-end-notification-settings-fields :is\(input, select, textarea\)[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/u
);
const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authSource)?.[1] || "";
assert.ok(authBuild, "Не найден идентификатор клиентской сборки.");
assert.match(indexSource, new RegExp(`(?:styles\\.css|auth-bootstrap\\.js)\\?v=${authBuild}`, "u"));

console.log("training end notification tests: OK");
