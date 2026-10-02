"use strict";

// Ephemeral, user-scoped progress only: no program data, URLs or results stored.
function createProgressStore({now = Date.now, ttlMs = 30 * 60 * 1000, limit = 200} = {}) {
  const entries = new Map();
  const invalid = (message, statusCode) => { throw Object.assign(new Error(message), {statusCode}); };
  const validate = id => {
    if (typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) invalid("Недопустимый идентификатор процесса.", 400);
  };
  const prune = () => { for (const [id, item] of entries) if (now() - item.updatedAt > ttlMs) entries.delete(id); };
  return {
    start(owner, id) {
      validate(id); prune();
      if (!owner) invalid("Требуется авторизация.", 401);
      if (entries.has(id)) invalid("Запрос уже выполнялся. Повторите подготовку из карточки.", 409);
      if (entries.size >= limit) invalid("Слишком много процессов. Повторите через несколько минут.", 429);
      const item = {owner: String(owner), status: "running", label: "Проверка параметров программы", startedAt: now(), updatedAt: now()};
      entries.set(id, item);
      return {
        label() { return item.label; },
        report(label) { if (item.status === "running") { item.label = String(label).slice(0, 200); item.updatedAt = now(); } },
        finish(status) { item.status = status === "completed" ? "completed" : "failed"; item.updatedAt = now(); }
      };
    },
    read(owner, id) {
      validate(id); prune();
      const item = entries.get(id);
      if (!item || !owner || item.owner !== String(owner)) return {status: "waiting"};
      return {status: item.status, label: item.label, elapsedMs: Math.max(0, now() - item.startedAt)};
    }
  };
}
module.exports = {createProgressStore};
