"use strict";
const crypto = require("node:crypto"), fs = require("node:fs/promises"), path = require("node:path");
const ENDPOINT = "https://xn--b1am4ae.xn--p1ai/api/ais-email-export.php";
function deriveKey(shopKey) {
  if (!/^[a-f0-9]{64}$/.test(shopKey || "")) throw new Error("Не настроен ключ защищённого чтения анкет ВИТУ.");
  // Domain-separated, read-only key: possession does not grant shop/relay access.
  return crypto.createHmac("sha256", shopKey).update("ais-vitu-email-export-v1").digest("hex");
}
async function read(storageRoot, options = {}) {
  let key;
  try { key = deriveKey(JSON.parse(await fs.readFile(path.join(storageRoot, "program-site-keys.json"), "utf8")).shop); }
  catch { throw new Error("Не настроен ключ защищённого чтения анкет ВИТУ на этом сервере АИС."); }
  let response;
  try {
    response = await (options.fetch || fetch)(ENDPOINT, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: {"Content-Type": "application/json", "X-AIS-Vitu-Key": key}, body: JSON.stringify({version: 1})
    });
  } catch { throw new Error("Сайт виту.рф не ответил на защищённый запрос. Повторите сбор позже; компьютер Server и туннель не требуются."); }
  if (response.status === 401 || response.status === 403) throw new Error("Сайт виту.рф отклонил ключ доступа АИС. Проверьте подключение служебного модуля обмена.");
  if (!response.ok) throw new Error(response.status === 413 ? "В анкетах ВИТУ превышен предел выгрузки. Требуется расширить лимит сборщика." : `Источник анкет виту.рф временно недоступен (HTTP ${response.status}). Повторите сбор позже.`);
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error("Сайт виту.рф вернул слишком большой список адресов.");
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Сайт виту.рф вернул некорректный ответ источника анкет."); }
  if (response.headers.get("X-AIS-Vitu-Protocol") !== "1" || result?.ok !== true || result?.version !== 1 || !Array.isArray(result.records) || result.records.length > 100000 || result.count !== result.records.length) {
    throw new Error("Сайт виту.рф не подтвердил полный список адресов.");
  }
  return result;
}
module.exports = {ENDPOINT, deriveKey, read};
