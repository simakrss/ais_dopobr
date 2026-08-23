"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.AIS_SHARED_STATE_LOCAL_ONLY = "1";

const {
  sanitizePartnerRegistrationPayload,
  createPartnerRegistrationSpamChallenge,
  issuePartnerRegistrationSpamChallenge,
  consumePartnerRegistrationSpamChallenge,
  partnerRegistrationTokenHash,
  partnerRegistrationHashesEqual,
  normalizePartnerRegistrationLoginBase,
  createPartnerRegistrationCredentials,
  buildPartnerRegistrationEmployeeNote,
  buildPartnerRegistrationEmployee,
  getPartnerRegistrationPublicBaseUrl,
  buildPartnerProfile
} = require("../app-server.js");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8");
const authSource = fs.readFileSync(path.join(root, "auth-bootstrap.js"), "utf8");
const partnerSource = fs.readFileSync(path.join(root, "partner-app.js"), "utf8");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

const payload = sanitizePartnerRegistrationPayload({
  name: "  Иванов Иван Иванович  ",
  email: "PARTNER@EXAMPLE.RU",
  phone: "+7 999 000-00-00",
  residence: "Омск",
  directions: ["Проведение вебинаров и других мероприятий на актуальные темы"],
  otherDirection: "",
  additionalInfo: "Доцент",
  personalDataConsent: true,
  website: ""
});
assert.equal(payload.name, "Иванов Иван Иванович");
assert.equal(payload.email, "partner@example.ru");
assert.equal(payload.residence, "Омск");
assert.deepEqual(payload.directions, ["Проведение вебинаров и других мероприятий на актуальные темы"]);
assert.throws(
  () => sanitizePartnerRegistrationPayload({ ...payload, directions: [], personalDataConsent: true }),
  /направление сотрудничества/u
);
assert.throws(
  () => sanitizePartnerRegistrationPayload({ ...payload, personalDataConsent: false }),
  /согласие/u
);
assert.throws(
  () => sanitizePartnerRegistrationPayload({ ...payload, website: "spam" }),
  /отклонена/u
);

const challengeRequest = {
  headers: { "x-ais-client-ip": "203.0.113.10" },
  socket: { remoteAddress: "127.0.0.1" }
};
const challengeCreatedAt = Date.parse("2026-08-23T08:00:00.000Z");
const challengeRecord = createPartnerRegistrationSpamChallenge("client-hash", challengeCreatedAt);
assert.match(challengeRecord.id, /^[A-Za-z0-9_-]{24}$/u);
assert.match(challengeRecord.question, /^Сколько будет \d+ [−+] \d+\?$/u);
assert.equal(challengeRecord.expiresAt - challengeRecord.issuedAt, 15 * 60 * 1000);

function solveSpamChallenge(question) {
  const match = String(question).match(/(\d+) ([−+]) (\d+)/u);
  assert.ok(match, `Не удалось разобрать пример: ${question}`);
  return String(match[2] === "−" ? Number(match[1]) - Number(match[3]) : Number(match[1]) + Number(match[3]));
}

const issuedChallenge = issuePartnerRegistrationSpamChallenge(challengeRequest, challengeCreatedAt);
const issuedAnswer = solveSpamChallenge(issuedChallenge.question);
assert.throws(
  () => consumePartnerRegistrationSpamChallenge(challengeRequest, {
    antiSpamChallengeId: issuedChallenge.challengeId,
    antiSpamAnswer: issuedAnswer
  }, challengeCreatedAt + 1000),
  /Подождите несколько секунд/u
);
assert.match(
  consumePartnerRegistrationSpamChallenge(challengeRequest, {
    antiSpamChallengeId: issuedChallenge.challengeId,
    antiSpamAnswer: issuedAnswer
  }, challengeCreatedAt + 2000),
  /^[a-f0-9]{64}$/u
);
assert.throws(
  () => consumePartnerRegistrationSpamChallenge(challengeRequest, {
    antiSpamChallengeId: issuedChallenge.challengeId,
    antiSpamAnswer: issuedAnswer
  }, challengeCreatedAt + 3000),
  /устарела/u
);

const tokenHash = partnerRegistrationTokenHash("a".repeat(43));
assert.match(tokenHash, /^[a-f0-9]{64}$/u);
assert.equal(partnerRegistrationHashesEqual(tokenHash, tokenHash), true);
assert.equal(partnerRegistrationHashesEqual(tokenHash, partnerRegistrationTokenHash("b".repeat(43))), false);

assert.equal(normalizePartnerRegistrationLoginBase("Test.User@example.ru"), "test.user");
const credentials = createPartnerRegistrationCredentials(
  "test.user@example.ru",
  new Set(["test.user", "test.user.2"])
);
assert.equal(credentials.login, "test.user.3");
assert.match(credentials.password, /^\d{6}$/u);

const registration = {
  id: "registration-id",
  createdAt: "2026-08-23T08:00:00.000Z",
  data: payload
};
const employee = buildPartnerRegistrationEmployee(
  registration,
  credentials,
  "https://edu-plus.ru/lms/"
);
assert.equal(employee.id, "partner-registration-registration-id");
assert.equal(employee.section, "ПАРТНЕРСКАЯ ПРОГРАММА");
assert.equal(employee.partnerProfileRequired, true);
assert.equal(employee.login, "test.user.3");
assert.match(employee.portalCredentials, /личному кабинету партнёра/u);
assert.match(employee.portalCredentials, /test\.user\.3/u);
assert.equal(employee.note, buildPartnerRegistrationEmployeeNote(payload));
assert.match(employee.note, /^Анкета партнёра\n\nНаправления сотрудничества:/u);
assert.match(employee.note, /• Вебинары и мероприятия: Проведение вебинаров/u);
assert.match(employee.note, /\n\nО себе:\nДополнительные сведения: Доцент$/u);
const completeRegistrationNote = buildPartnerRegistrationEmployeeNote({
  directions: [
    "Привлечение слушателей на курсы через социальные сети, знакомых, коллег",
    "Разработка авторских курсов повышения квалификации/профессиональной переподготовки"
  ],
  otherDirection: "Совместные конференции",
  additionalInfo: "Кандидат наук, преподаватель"
});
assert.match(completeRegistrationNote, /• Рекомендация программ:/u);
assert.match(completeRegistrationNote, /• Авторские курсы:/u);
assert.match(completeRegistrationNote, /• Другое направление: Совместные конференции/u);
assert.match(completeRegistrationNote, /Дополнительные сведения: Кандидат наук, преподаватель$/u);
assert.equal(buildPartnerProfile(employee).onboardingRequired, true);
assert.equal(
  buildPartnerProfile(employee).tabs.main.find((field) => field.key === "city")?.value,
  "Омск"
);

assert.equal(
  getPartnerRegistrationPublicBaseUrl({
    headers: {
      host: "edu-plus.ru",
      referer: "https://edu-plus.ru/lms/?partner-registration=1",
      "x-ais-public-app-url": "https://edu-plus.ru/lms/"
    }
  }),
  "https://edu-plus.ru/lms/"
);

assert.match(serverSource, /PARTNER_REGISTRATION_TTL_MS = 24 \* 60 \* 60 \* 1000/u);
assert.match(serverSource, /PARTNER_REGISTRATION_CHALLENGE_TTL_MS = 15 \* 60 \* 1000/u);
assert.match(serverSource, /PARTNER_REGISTRATION_CHALLENGE_MIN_AGE_MS = 2 \* 1000/u);
assert.match(serverSource, /"shared-state-backups",\s*"private",\s*"partner-registrations\.json"/u);
assert.match(serverSource, /tokenHash: partnerRegistrationTokenHash|tokenHash,/u);
assert.match(serverSource, /\/api\/auth\/partner-registration\/confirm/u);
assert.match(serverSource, /\/api\/auth\/partner-registration\/challenge/u);
assert.match(serverSource, /sendEmailThroughConfiguredMailbox\(\{[\s\S]{0,800}Подтверждение регистрации/u);
assert.match(gatewaySource, /x-ais-public-app-url/u);
assert.match(gatewaySource, /\/api\/auth\/partner-registration\/challenge/u);
assert.match(gatewaySource, /\/api\/auth\/partner-registration\/confirm/u);
assert.match(authSource, /Партнёрская программа учебного центра/u);
assert.match(authSource, /data-partner-registration-form/u);
assert.match(authSource, /data-partner-spam-challenge/u);
assert.match(authSource, /antiSpamChallengeId/u);
assert.match(authSource, /antiSpamAnswer/u);
assert.match(authSource, /confirmPartnerRegistration/u);
assert.match(partnerSource, /completeOnboarding/u);
assert.match(partnerSource, /Сохранить и продолжить/u);
assert.match(stylesSource, /\.partner-registration-card/u);
assert.match(stylesSource, /\.partner-registration-antispam/u);
assert.match(stylesSource, /\.partner-onboarding-notice/u);

console.log("partner registration tests: OK");
