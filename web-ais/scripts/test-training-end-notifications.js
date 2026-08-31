"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";

const {
  getMoscowCalendarDate,
  getCalendarDateInTimeZone,
  parseTrainingEndNotificationDate,
  getTrainingEndNotificationCandidates,
  getTrainingEndNotificationConfiguration,
  getTrainingEndNotificationSchedule,
  buildTrainingEndNotificationMessage
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
  frequency: "weekdays"
}), {
  enabled: true,
  days: 7,
  time: "10:30",
  timeZone: "Asia/Yekaterinburg",
  frequency: "weekdays",
  recipient: "mail@edu-plus.ru"
});

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

const candidates = getTrainingEndNotificationCandidates([
  {
    id: "student-1",
    uid: "1162",
    name: "Иванова Анна Ивановна",
    status: "Учится",
    program: "Программа 1",
    endDate: "2026-08-27",
    responsible: "manager"
  },
  {
    id: "student-2",
    uid: "1163",
    name: "Петров Петр Петрович",
    status: " Учится ",
    program: "Программа 2",
    endDate: "2026-08-23",
    extendedEndDate: "28.08.2026"
  },
  {
    id: "student-3",
    name: "Сидорова Ольга",
    status: "Отчислен",
    endDate: "2026-08-24"
  },
  {
    id: "student-4",
    name: "Будущий слушатель",
    status: "Учится",
    endDate: "2026-08-28"
  },
  {
    id: "student-5",
    name: "Завершивший слушатель",
    status: "Учится",
    endDate: "2026-08-21"
  }
], {
  today: "2026-08-22T08:00:00.000Z",
  days: 5
});

assert.deepEqual(candidates.map((student) => student.id), ["student-5", "student-1"]);
assert.equal(candidates[0].daysRemaining, -1);
assert.equal(candidates[1].daysRemaining, 5);

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
assert.match(message, /Просрочено 1 дн\./u);
assert.match(message, /Ближайшие окончания: 2\. Просроченные: 1\./u);
assert.match(message, /Тест &lt;script&gt;/u);
assert.doesNotMatch(message, /<script>/u);

assert.match(appSource, /name="trainingEndNotificationsEnabled"/u);
assert.match(appSource, /name="trainingEndNotificationDays"/u);
assert.match(appSource, /Уведомлять за \(дней\)/u);
assert.match(appSource, /name="trainingEndNotificationTime"/u);
assert.match(appSource, /name="trainingEndNotificationTimeZone"/u);
assert.match(appSource, /name="trainingEndNotificationFrequency"/u);
assert.match(appSource, /Еженедельно, по понедельникам/u);
assert.match(appSource, /\/api\/training-end-notifications\/check/u);
assert.match(appSource, /\/api\/admin\/training-end-notifications\/run/u);
assert.match(appSource, /TRAINING_END_NOTIFICATION_CHECK_INTERVAL_MS/u);
assert.match(serverSource, /const TRAINING_END_NOTIFICATION_CHECK_INTERVAL_MS = 60 \* 1000;/u);
assert.match(serverSource, /getTrainingEndNotificationSchedule/u);
assert.match(serverSource, /DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN = "mail@edu-plus\.ru"/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_scheduled_job_runs/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_scheduled_job_settings/u);
assert.match(serverSource, /sharedRecordLocksMySqlPool = null;\n  scheduledJobRunsTableInitialization = null;/u);
assert.match(serverSource, /status === "completed"/u);
assert.match(serverSource, /Некорректный запрос проверки сроков обучения/u);
assert.match(serverSource, /startTrainingEndNotificationScheduler\(\)/u);
assert.match(stylesSource, /\.admin-training-end-notification/u);
assert.match(
  stylesSource,
  /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 170px\), 1fr\)\)/u
);
assert.match(
  stylesSource,
  /\.admin-training-end-notification-fields :is\(input, select\)[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/u
);
const authBuild = /const AUTH_BUILD = "([^"]+)"/u.exec(authSource)?.[1] || "";
assert.ok(authBuild, "Не найден идентификатор клиентской сборки.");
assert.match(indexSource, new RegExp(`(?:styles\\.css|auth-bootstrap\\.js)\\?v=${authBuild}`, "u"));

console.log("training end notification tests: OK");
