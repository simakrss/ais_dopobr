"use strict";
// Explicit, repeatable migration. Only existing accounts are linked. Neither
// provisioning nor any mail API is called, and passwords never leave AIS here.
const fs = require("node:fs"), path = require("node:path"), enrollment = require("../student-enrollment.js");
const norm = value => String(value || "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
function plan(data) {
  const students = data.collections.students || [], byId = new Map(students.map(row => [row.id, row])), groups = new Map(), ownersByEmail = new Map();
  for (const row of students) {
    if (row.studentPortalEnabled && !row.studentPortalBlocked && (row.studentPortalAccountId || row.id) === row.id) {
      const email = norm(row.email); if (!ownersByEmail.has(email)) ownersByEmail.set(email, new Set()); ownersByEmail.get(email).add(row.id);
    }
    if (!row.studentPortalEnabled || row.studentPortalBlocked || !["КПК", "ППП", "ДОП"].includes(row.educationType)) continue;
    const id = row.studentPortalAccountId || row.id; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(row);
  }
  const candidates = [], skipped = [], labels = new Map();
  for (const [id, records] of groups) {
    const owner = byId.get(id), email = norm(owner?.email), label = { accountId: id, name: owner?.name || records[0].name, email };
    labels.set(id, label);
    let reason = !owner?.studentPortalEnabled || owner.studentPortalBlocked || !owner.studentPortalCredentialSalt || !enrollment.portalLogin(owner) ? "cabinet_unavailable"
      : !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email) ? "invalid_email"
      : ownersByEmail.get(email)?.size !== 1 ? "ambiguous_student_email" : "";
    if (reason) { skipped.push({ ...label, status: "skipped", reason }); continue; }
    candidates.push({ accountId: id, email, login: enrollment.portalLogin(owner), credentialVersion: enrollment.fingerprint(owner),
      names: [...new Set([owner.name, ...records.map(row => row.name)].map(value => String(value || "").trim()).filter(Boolean))].sort().slice(0, 30),
      orderIds: [...new Set(records.flatMap(row => [row.sourceOrderId, row.orderNo]).map(value => String(value || "").trim()).filter(value => /^[1-9]\d{0,15}$/u.test(value)))].sort().slice(0, 100) });
  }
  return { candidates: candidates.sort((a, b) => a.accountId.localeCompare(b.accountId)), skipped, labels };
}
const REASONS = {
  cabinet_unavailable: "Кабинет недоступен", invalid_email: "Нет корректного email", ambiguous_student_email: "Один email у разных кабинетов АИС",
  shop_account_missing: "Нет существующего аккаунта магазина", duplicate_shop_email: "Несколько аккаунтов магазина с одним email",
  privileged_shop_account: "Учётная запись магазина имеет служебные права", different_student_binding: "Магазин связан с другим кабинетом",
  login_in_use: "Логин занят другим покупателем", different_shop_binding: "Кабинет или логин связан с другим покупателем",
  identity_unconfirmed: "Не подтверждено совпадение ФИО или принадлежность заказа", changed_since_preview: "Данные магазина изменились после проверки",
  student_changed: "Данные АИС изменились после проверки"
};
async function run({ readState, call, apply = false, progress = () => {} }) {
  const initial = plan(await readState()), results = [...initial.skipped];
  for (let start = 0; start < initial.candidates.length; start += 25) {
    const batch = initial.candidates.slice(start, start + 25);
    let response = await call({ accounts: batch, apply: false });
    if (!response.ok || !Array.isArray(response.results) || response.results.length !== batch.length) throw Error("Не получен полный план магазина.");
    let batchResults = response.results;
    if (apply) {
      const current = new Map(plan(await readState()).candidates.map(item => [item.accountId, item])), toApply = [];
      batchResults = response.results.map(item => {
        if (item.status !== "ready") return item;
        const candidate = batch.find(row => row.accountId === item.accountId);
        if (JSON.stringify(candidate) !== JSON.stringify(current.get(item.accountId))) return { accountId: item.accountId, status: "skipped", reason: "student_changed" };
        toApply.push({ ...candidate, proof: item.proof }); return item;
      });
      if (toApply.length) {
        response = await call({ accounts: toApply, apply: true });
        if (!response.ok || response.mailSent !== false || response.passwordsChanged !== false || !Array.isArray(response.results) || response.results.length !== toApply.length) throw Error("Не подтверждено связывание без писем и изменения паролей.");
        const applied = new Map(response.results.map(item => [item.accountId, item]));
        batchResults = batchResults.map(item => applied.get(item.accountId) || item);
      }
    }
    results.push(...batchResults.map(({ proof, ...item }) => ({ ...initial.labels.get(item.accountId), ...item })));
    progress({ checked: Math.min(start + 25, initial.candidates.length), total: initial.candidates.length, linked: results.filter(row => row.status === "linked").length });
  }
  return { apply, checkedAt: new Date().toISOString(), totals: results.reduce((counts, row) => { const key = row.reason || row.status; counts[key] = (counts[key] || 0) + 1; return counts; }, {}), results };
}
async function main() {
  const server = require("../app-server.js"), generator = require("../program-site-generator.js"), apply = process.argv.includes("--apply");
  try {
    await server.ensureStorage();
    const keys = await generator.readKeys(path.resolve(__dirname, "../storage")), client = generator.createClient(keys);
    const report = await run({ apply, readState: async () => {
      const shared = await server.readSharedApplicationStateDocument({ allowCache: false, skipOfflineSync: true });
      if (shared.offline || shared.syncPending) throw Error("Общая база недоступна."); return shared.document.data;
    }, call: payload => client("shop", "/student-accounts-existing", payload), progress: update => console.log(JSON.stringify(update)) });
    const directory = path.resolve(__dirname, "../.runtime/student-shop-existing"); fs.mkdirSync(directory, { recursive: true });
    const base = path.join(directory, `${apply ? "applied" : "preview"}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    fs.writeFileSync(base + ".json", JSON.stringify(report, null, 2), { mode: 0o600 });
    const cell = value => '"' + String(value ?? "").replaceAll('"', '""') + '"';
    const rows = [["ФИО", "Email", "Результат", "Причина", "Аккаунт магазина", "Кабинет АИС"], ...report.results.map(row => [row.name, row.email,
      ({ linked: "Связан", ready: "Готов к связыванию", unchanged: "Уже связан", skipped: "Пропущен" })[row.status] || row.status,
      REASONS[row.reason] || row.reason || "", row.shopUserId || "", row.accountId])];
    fs.writeFileSync(base + ".csv", "\uFEFF" + rows.map(row => row.map(cell).join(";")).join("\r\n"), { mode: 0o600 });
    console.log(JSON.stringify({ apply, totals: report.totals, report: base + ".csv" }));
  } finally { await server.closeSharedRecordLocksStorage(); await server.closeStudentApplicationsMySqlStorage(); }
}
module.exports = { plan, run };
if (require.main === module) main().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
