"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";

const {
  getMoscowCalendarDate,
  parseTrainingEndNotificationDate,
  getTrainingEndNotificationCandidates,
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

assert.deepEqual(candidates.map((student) => student.id), ["student-1"]);
assert.equal(candidates[0].daysRemaining, 5);

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
assert.match(message, /Тест &lt;script&gt;/u);
assert.doesNotMatch(message, /<script>/u);

assert.match(appSource, /version: "1\.7\.214"/u);
assert.match(appSource, /name="trainingEndNotificationsEnabled"/u);
assert.match(appSource, /name="trainingEndNotificationDays"/u);
assert.match(appSource, /Уведомлять за \(дней\)/u);
assert.match(appSource, /\/api\/training-end-notifications\/check/u);
assert.match(appSource, /\/api\/admin\/training-end-notifications\/run/u);
assert.match(appSource, /TRAINING_END_NOTIFICATION_CHECK_INTERVAL_MS/u);
assert.match(serverSource, /DEFAULT_STUDENT_APPLICATIONS_EMAIL_LOGIN = "mail@edu-plus\.ru"/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_scheduled_job_runs/u);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS ais_scheduled_job_settings/u);
assert.match(serverSource, /sharedRecordLocksMySqlPool = null;\n  scheduledJobRunsTableInitialization = null;/u);
assert.match(serverSource, /status === "completed"/u);
assert.match(serverSource, /Некорректный запрос проверки сроков обучения/u);
assert.match(serverSource, /startTrainingEndNotificationScheduler\(\)/u);
assert.match(stylesSource, /\.admin-training-end-notification/u);
assert.match(authSource, /20260822-training-end-notifications-v1/u);
assert.match(indexSource, /20260822-training-end-notifications-v1/u);

console.log("training end notification tests: OK");
