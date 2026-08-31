"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const {
  buildEmployeeAuthDirectory,
  publicAuthEmployee,
  synchronizeAuthUsersWithEmployees
} = require(path.join(ROOT, "app-server.js"));

const active = {
  id: "employee-active",
  name: "Иванов Иван Иванович",
  login: "teacher.one",
  password: "new-password",
  section: "ДЕЙСТВУЮЩИЕ ДОГОВОРА",
  contractNo: "20",
  contractDate: "31.08.2026",
  email: "teacher@example.test",
  phone: "+7 900 000-00-01"
};
const oldDuplicate = {
  ...active,
  id: "employee-old",
  password: "old-password",
  section: "ИСТЕКШИЕ ДОГОВОРА",
  contractNo: "10",
  contractDate: "01.01.2024"
};
const partner = {
  id: "employee-partner",
  name: "Петров Пётр Петрович",
  login: "partner.one",
  password: "partner-password",
  section: "ПАРТНЕРСКАЯ ПРОГРАММА"
};
const partnerWithYo = {
  ...partner,
  id: "employee-partner-yo",
  login: "partner.yo",
  section: "ПАРТНЁРСКАЯ ПРОГРАММА"
};
const expired = {
  id: "employee-expired",
  name: "Сидоров Сидор Сидорович",
  login: "expired.one",
  password: "expired-password",
  section: "ИСТЕКШИЕ ДОГОВОРА"
};

const directory = buildEmployeeAuthDirectory([
  oldDuplicate,
  active,
  partner,
  expired,
  { id: "incomplete", name: "Без реквизитов" }
]);
assert.equal(directory.employees.length, 3, "повторные договоры должны объединяться по логину");
assert.equal(directory.duplicatesCollapsed, 1);
assert.equal(directory.skipped, 1);
assert.equal(directory.employees.find((row) => row.login === active.login)?.id, active.id,
  "действующая карточка должна быть канонической");
assert.equal(publicAuthEmployee(directory.employees[0]).password, undefined,
  "открытый пароль нельзя возвращать в браузер");
assert.equal(buildEmployeeAuthDirectory([
  { ...partnerWithYo, section: "ИСТЕКШИЕ ДОГОВОРА", contractDate: "31.08.2026" },
  { ...partnerWithYo, id: "employee-partner-yo-active", contractDate: "01.01.2024" }
]).employees[0]?.id, "employee-partner-yo-active",
"вариант «партнёр» с ё должен получать приоритет над истёкшей карточкой");

const hashPassword = (password) => `test-hash:${password}`;
const verifyPassword = (password, hash) => hash === hashPassword(password);
const first = synchronizeAuthUsersWithEmployees([], [oldDuplicate, active, partner, expired], {
  now: "2026-08-31T12:00:00.000Z",
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
assert.equal(first.stats.created, 3);
assert.equal(first.users.find((user) => user.employeeId === active.id)?.role, "manager");
assert.equal(first.users.find((user) => user.employeeId === active.id)?.status, "active");
assert.equal(first.users.find((user) => user.employeeId === partner.id)?.role, "partner");
assert.equal(first.users.find((user) => user.employeeId === partner.id)?.status, "active");
assert.equal(first.users.find((user) => user.employeeId === expired.id)?.status, "blocked");

const second = synchronizeAuthUsersWithEmployees(first.users, [oldDuplicate, active, partner, expired], {
  now: "2026-08-31T12:05:00.000Z",
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
assert.equal(second.changed, false, "повторная синхронизация должна быть идемпотентной");
assert.equal(second.stats.unchanged, 3);

const movedToPartner = synchronizeAuthUsersWithEmployees(first.users, [
  { ...active, section: "ПАРТНЕРСКАЯ ПРОГРАММА" },
  partner,
  expired
], {
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
assert.equal(movedToPartner.users.find((user) => user.employeeId === active.id)?.role, "partner",
  "автоматическая роль должна учитывать текущий раздел карточки");
const roleOverriddenUsers = first.users.map((user) => user.employeeId === active.id
  ? { ...user, role: "manager", employeeRoleOverride: "manager" }
  : user);
const explicitManager = synchronizeAuthUsersWithEmployees(roleOverriddenUsers, [
  { ...active, section: "ПАРТНЕРСКАЯ ПРОГРАММА" },
  partner,
  expired
], {
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
assert.equal(explicitManager.users.find((user) => user.employeeId === active.id)?.role, "manager",
  "явно выбранная администратором роль должна сохраняться");
const linkedAdmin = synchronizeAuthUsersWithEmployees(first.users.map((user) => user.employeeId === active.id
  ? { ...user, role: "admin", employeeRoleOverride: "admin" }
  : user), [active, partner, expired], {
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
assert.equal(linkedAdmin.users.find((user) => user.employeeId === active.id)?.role, "manager",
  "автоматически связанная запись не должна получать права администратора");

const oldLoginEmployee = { ...active, login: "old.login" };
const linkedOldLogin = synchronizeAuthUsersWithEmployees([], [oldLoginEmployee], {
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
}).users[0];
const manualTakenLogin = {
  id: "manual-taken-login",
  login: "taken.login",
  name: "Ручная запись",
  role: "manager",
  status: "active",
  passwordHash: hashPassword("manual-password")
};
const loginCollision = synchronizeAuthUsersWithEmployees(
  [manualTakenLogin, linkedOldLogin],
  [{ ...active, login: "taken.login" }],
  { secret: "unit-test-secret", hashPassword, verifyPassword }
);
assert.equal(loginCollision.stats.conflicts, 1);
assert.equal(new Set(loginCollision.users.map((user) => user.login)).size, loginCollision.users.length,
  "смена логина сотрудника не должна создавать дубликат ручной учётной записи");
assert.equal(loginCollision.users.find((user) => user.employeeId === active.id)?.status, "blocked",
  "связанная запись должна блокироваться до устранения конфликта логинов");

const expiredFirst = synchronizeAuthUsersWithEmployees([], [{ ...active, section: "ИСТЕКШИЕ ДОГОВОРА" }], {
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
const reactivated = synchronizeAuthUsersWithEmployees(expiredFirst.users, [active], {
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
assert.equal(reactivated.users[0].role, "manager");
assert.equal(reactivated.users[0].status, "active",
  "после появления действующего договора автоматически заблокированная запись должна активироваться");

const missingCard = synchronizeAuthUsersWithEmployees(
  synchronizeAuthUsersWithEmployees([], [active], {
    secret: "unit-test-secret", hashPassword, verifyPassword
  }).users,
  [],
  { secret: "unit-test-secret", hashPassword, verifyPassword }
);
assert.equal(missingCard.changed, true);
assert.equal(missingCard.stats.blockedMissing, 1);
assert.equal(missingCard.users[0].status, "blocked",
  "исчезновение карточки или реквизитов должно блокировать связанную запись");
const missingAgain = synchronizeAuthUsersWithEmployees(missingCard.users, [], {
  secret: "unit-test-secret", hashPassword, verifyPassword
});
assert.equal(missingAgain.changed, false, "повторная блокировка отсутствующей карточки должна быть идемпотентной");

const renamed = { ...active, name: "Иванов Иван Петрович", password: "rotated-password" };
const third = synchronizeAuthUsersWithEmployees(second.users, [renamed, partner, expired], {
  now: "2026-08-31T12:10:00.000Z",
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
const renamedUser = third.users.find((user) => user.employeeId === active.id);
assert.equal(renamedUser.name, renamed.name, "ФИО должно обновляться из карточки сотрудника");
assert.equal(renamedUser.passwordHash, hashPassword(renamed.password),
  "пароль пользователя должен обновляться из реквизитов СДО");

const legacyManager = {
  id: "legacy-manager",
  login: active.login,
  name: "Старое имя",
  role: "manager",
  status: "active",
  passwordHash: hashPassword("legacy-password"),
  email: "",
  phone: ""
};
const migrated = synchronizeAuthUsersWithEmployees([legacyManager], [active], {
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
assert.equal(migrated.users.length, 1);
assert.equal(migrated.users[0].employeeId, active.id);
assert.equal(migrated.users[0].name, active.name);
assert.equal(migrated.users[0].passwordHash, hashPassword(active.password));

const manualAdmin = {
  id: "admin",
  login: active.login,
  name: "Администратор",
  role: "admin",
  status: "active",
  passwordHash: hashPassword("admin-password")
};
const collision = synchronizeAuthUsersWithEmployees([manualAdmin], [active], {
  secret: "unit-test-secret",
  hashPassword,
  verifyPassword
});
assert.equal(collision.stats.conflicts, 1, "ручной администратор не должен перепривязываться по логину");
assert.deepEqual(collision.users, [manualAdmin]);

const frontend = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
assert.match(frontend, /name="employeeId"/u);
assert.match(frontend, /ФИО, логин и пароль автоматически берутся/u);
assert.match(frontend, /Берётся из карточки сотрудника и не показывается/u);
assert.match(frontend, /employeeId \? \{\} : \{/u,
  "для связанной записи клиент не должен отправлять ФИО, логин или пароль");

const nodeServer = fs.readFileSync(path.join(ROOT, "app-server.js"), "utf8");
assert.match(nodeServer, /if \(index >= 0\) \{[\s\S]{0,220}Неверный логин или пароль/u,
  "ошибка пароля сохранённой записи не должна переходить в partner fallback");
assert.match(nodeServer, /findLinkedUserForEmployee[\s\S]{0,1800}if \(linkedEmployeeUser\)[\s\S]{0,220}503/u,
  "ошибка синхронизации после смены логина не должна обходить блокировку связанной записи");
assert.match(nodeServer, /if \(findLinkedUserForEmployee\(employee\)\)[\s\S]{0,220}401/u,
  "partner fallback разрешён только для ещё не связанной карточки сотрудника");
assert.match(nodeServer, /flushSharedApplicationStateOfflineQueue\(\)[\s\S]{0,500}readSharedApplicationStatePendingDocument/u,
  "проверка реквизитов должна учитывать ожидающие изменения общей базы");
assert.match(nodeServer, /if \(pending\.operations\.length\) return readPendingContracts\(\)/u,
  "при ожидающих изменениях реквизиты должны читаться из актуального локального снимка");
assert.match(nodeServer, /catch \(error\) \{\s*offlineSyncError = error;[\s\S]{0,700}pending\.operations\.length[\s\S]{0,120}if \(offlineSyncError\) throw offlineSyncError/u,
  "при сбое выгрузки pending-очереди нужно использовать её актуальный снимок, а без pending закрывать вход");
assert.match(nodeServer, /hasCollectionMarker[\s\S]{0,220}отсутствует раздел сотрудников/u,
  "отсутствующий раздел сотрудников нельзя принимать за пустой список");
assert.match(nodeServer, /async function handleAuthPassword[\s\S]{0,420}if \(user\.employeeId\)/u,
  "связанный пользователь не должен менять пароль отдельно от СДО");
assert.doesNotMatch(
  nodeServer.match(/async function proxyOnlyOfficeWebSocket[\s\S]{0,600}/u)?.[0] || "",
  /user\.employeeId/u,
  "проверка пароля не должна попадать в прокси OnlyOffice"
);
const phpGateway = fs.readFileSync(path.join(ROOT, "gateway.php"), "utf8");
assert.match(phpGateway, /\$user === null && \$storedMatch === null && !\$directorySynchronized/u,
  "PHP-шлюз не должен обходить заблокированную запись через partner fallback");
assert.match(phpGateway, /\$linkedEmployeeUser !== null[\s\S]{0,220}gateway_fail\(503/u,
  "PHP-шлюз должен закрывать вход при ошибке синхронизации уже связанной карточки");
assert.match(phpGateway, /\$linkedEmployeeUser === null\) \{[\s\S]{0,120}ais_auth_login_partner/u,
  "PHP partner fallback разрешён только для ещё не связанной карточки сотрудника");
assert.match(phpGateway, /\$metaBefore = gateway_shared_state_meta[\s\S]{0,220}Общая база АИС ещё не создана/u,
  "PHP-шлюз не должен принимать немигрированную базу за пустой список сотрудников");
assert.doesNotMatch(frontend, /employee\.password/u,
  "открытый пароль сотрудника не должен использоваться в интерфейсе");

console.log("Employee auth users: OK");
