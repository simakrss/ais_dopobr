"use strict";
const crypto = require("node:crypto");
const text = value => String(value ?? "").trim();
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const cents = value => Math.round(Number(value) * 100);
function rootFolder(record, documentFolder) {
  const folder = documentFolder(record).replace(/\/+$/u, "").replace(/\/Документы$/iu, "");
  if (!folder || !folder.includes("/")) fail("Не настроена личная папка слушателя.", 409);
  return folder;
}
function createService({ deps, context, mutate, portal, documentFolder, finances, validateUpload }) {
  async function photo(user, id, body) {
    const { record } = await context(user, id);
    const file = validateUpload({ ...body, kind: "passport" });
    if (file.extension === "pdf" || file.bytes.length > 16 * 1024 * 1024) fail("Выберите фотографию JPEG или PNG размером до 16 МБ.");
    const folder = documentFolder(record), name = `Фото-${crypto.randomUUID()}.${file.extension}`;
    await deps.upload(folder, name, file.bytes, file.contentType);
    const updated = await mutate(id, user, item => ({ ...item, studentPortalDocumentsFolder: documentFolder(item),
      photoPath: deps.photoPath ? deps.photoPath(folder, name) : `${folder}/${name}`, photoData: "", photoUrl: "" }));
    await deps.audit("Слушатель загрузил фотографию", updated, user);
    return portal(user, id);
  }
  async function staffRecord(actor, id) {
    if (!["admin", "manager"].includes(actor?.role)) fail("Операция доступна сотруднику учебного центра.", 403);
    deps.assertWritable?.();
    const current = await deps.readState(), record = current.data.collections.students.find(row => row.id === id);
    if (!record) fail("Слушатель не найден.", 404);
    return record;
  }
  async function awardUpload(actor, id, body) {
    const record = await staffRecord(actor, id);
    const kind = body.kind === "layout" ? "layout" : "scan";
    let file;
    if (kind === "layout" && body.format === "docx") {
      if (typeof body.base64 !== "string" || body.base64.length > 28 * 1024 * 1024) fail("Слишком большой файл.");
      const bytes = Buffer.from(body.base64, "base64");
      if (bytes.subarray(0, 2).toString() !== "PK") fail("Некорректный DOCX.");
      file = { bytes: await deps.toPdf(bytes), extension: "pdf", contentType: "application/pdf" };
    } else file = validateUpload({ ...body, kind: "passport" });
    const folder = await awardRoot(record), fileId = crypto.randomUUID();
    const program = text(record.program).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 75);
    const name = `${kind === "layout" ? "Макет" : "Документ об образовании"} — ${program || "Программа"} — ${fileId}.${file.extension}`;
    await deps.upload(folder, name, file.bytes, file.contentType);
    const entry = { id: fileId, kind, name, folder, size: file.bytes.length, uploadedAt: new Date().toISOString() };
    const updated = await mutate(id, actor, item => ({ ...item, educationDocumentFiles: [
      ...(item.educationDocumentFiles || []).filter(value => kind !== "layout" || value.kind !== "layout"), entry] }));
    await deps.audit(kind === "layout" ? "Сохранён макет документа в кабинете слушателя" : "Загружен скан выданного документа об образовании", updated, actor);
    return { ok: true, files: updated.educationDocumentFiles };
  }
  function publicAwards(records) {
    return { programs: records.map(record => ({ id: record.id, program: record.program, educationType: record.educationType,
      number: text(record.diplomaBlankNo), debt: finances(record).debt,
      files: (record.educationDocumentFiles || []).map(({ id, kind, name, size, uploadedAt, unassigned }) => ({ id, kind, name, size, uploadedAt, unassigned: Boolean(unassigned) })) })) };
  }
  async function awardRoot(record, current = null) {
    current ||= await deps.readState();
    const owner = current.data.collections.students.find(item => item.id === (record.studentPortalAccountId || record.id));
    return rootFolder(owner || record, documentFolder);
  }
  async function discover(records) {
    const result = records.map(item => ({ ...item, educationDocumentFiles: [...(item.educationDocumentFiles || [])] }));
    if (!deps.listRoot) return result;
    const current = await deps.readState(), checked = new Set();
    for (const record of result) {
      const folder = await awardRoot(record, current); if (checked.has(folder)) continue; checked.add(folder);
      const account = record.studentPortalAccountId || record.id;
      // Legacy folders sometimes share abbreviated names. Never infer ownership if
      // another account points to the same folder; explicitly uploaded files still work.
      if (current.data.collections.students.some(item => (item.studentPortalAccountId || item.id) !== account && rootFolder(item, documentFolder) === folder)) continue;
      let entries;
      try { entries = await deps.listRoot(folder); } catch { continue; }
      for (const file of entries) {
        if (!/\.(?:pdf|png|jpe?g|docx)$/iu.test(file.name) || !/(?:диплом|удостоверен|сертификат|документ об образовании|макет)/iu.test(file.name)) continue;
        if (result.some(item => item.educationDocumentFiles.some(entry => entry.folder === folder && entry.name === file.name))) continue;
        if (/^(?:Макет|Документ об образовании) — .+ — [a-f0-9-]{36}\./iu.test(file.name)) continue;
        const matches = result.filter(item => [item.diplomaBlankNo, item.registrationNo, item.diplomaRegistrationNo].some(number =>
          text(number).length >= 3 && new RegExp(`(?:^|[^\\p{L}\\p{N}])${text(number).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}\\p{N}])`, "iu").test(file.name)));
        const target = matches.length === 1 ? matches[0] : null;
        const entry = { id: `disk-${crypto.createHash("sha256").update(`${folder}/${file.name}`).digest("hex")}`, kind: /макет|\.docx$/iu.test(file.name) ? "layout" : "scan",
          name: file.name, folder, size: file.size, uploadedAt: file.modifiedAt, unassigned: !target };
        // Keep unassigned documents in the shared person folder; do not pretend to
        // know which of several programs an old filename belongs to.
        (target || record).educationDocumentFiles.push(entry);
      }
    }
    return result;
  }
  async function awards(user, id) { return publicAwards(await discover((await context(user, id)).records)); }
  async function staffAwards(actor, id) { return publicAwards(await discover([await staffRecord(actor, id)])); }
  async function awardFile(user, id, fileId, staff = false) {
    let records = staff ? [await staffRecord(user, id)] : (await context(user, id)).records;
    if (String(fileId || "").startsWith("disk-")) records = await discover(records);
    const record = records.find(item => item.id === id), entry = record?.educationDocumentFiles?.find(item => item.id === fileId);
    if (!entry || /[\\/]/u.test(entry.name)) fail("Документ не найден.", 404);
    // The location comes exclusively from the saved, staff-owned attachment metadata.
    const file = await deps.download(entry.folder, entry.name);
    if (/\.docx$/iu.test(entry.name)) return { body: await deps.toPdf(file.body), contentType: "application/pdf", name: entry.name.replace(/\.docx$/iu, ".pdf") };
    return { ...file, name: entry.name };
  }
  async function settlePayment(orderId) {
    if (!/^[1-9]\d{0,15}$/u.test(text(orderId))) fail("Некорректный номер платежа.");
    const payment = await deps.paymentShop("/student-payment-status", { orderId: text(orderId) });
    if (!payment.studentId || !payment.intentKey) fail("Платёж не относится к кабинету слушателя.", 409);
    return deps.lock(`student-payment:${payment.studentId}`, async () => {
      const current = await deps.readState(), record = current.data.collections.students.find(row => row.id === payment.studentId);
      if (!record) fail("Не найдена заявка платежа.", 409);
      if ((record.portalPaymentReceipts || []).some(item => item.orderId === text(orderId))) return { ok: true, paid: true, duplicate: true };
      const intent = (record.portalPaymentIntents || []).find(item => item.key === payment.intentKey);
      if (!intent || cents(intent.amount) !== cents(payment.amount) || payment.currency !== "RUB") fail("Параметры платежа не совпали с заявкой.", 409);
      if (!payment.paid) {
        if (["cancelled", "refunded"].includes(payment.status)) await mutate(record.id, deps.systemUser, item => ({ ...item,
          portalPaymentIntents: (item.portalPaymentIntents || []).map(value => value.key === intent.key ? { ...value, status: payment.status } : value) }));
        return { ok: true, paid: false, status: payment.status };
      }
      if (!payment.transactionId || !payment.yookassa) fail("ЮKassa ещё не подтвердила платёж.", 409);
      const date = text(payment.paidAt).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) fail("Не подтверждена дата оплаты.", 409);
      let duplicate = false;
      const updated = await mutate(record.id, deps.systemUser, item => {
        if ((item.portalPaymentReceipts || []).some(entry => entry.orderId === text(orderId))) { duplicate = true; return item; }
        const slot = Array.from({ length: 8 }, (_, index) => index + 1).find(index =>
          !text(item[`payment${index}Amount`]) && !text(item[`payment${index}Date`]) && !text(item[`payment${index}Note`])) || 0;
        const receipt = { orderId: text(orderId), transactionId: payment.transactionId, amount: Number(payment.amount), date, slot };
        const result = { ...item, portalPaymentReceipts: [...(item.portalPaymentReceipts || []), receipt],
          portalPaymentIntents: (item.portalPaymentIntents || []).map(value => value.key === intent.key ? { ...value, status: "paid" } : value) };
        if (slot) Object.assign(result, { [`payment${slot}Amount`]: receipt.amount, [`payment${slot}Date`]: date,
          [`payment${slot}Note`]: `ЮKassa · заказ ${orderId} · ${payment.transactionId}` });
        const totals = finances(result); result.paidAmount = totals.paid; result.balance = Math.round((totals.total - totals.paid) * 100) / 100;
        return result;
      });
      if (!duplicate) await deps.audit("Оплата задолженности через ЮKassa привязана к слушателю", updated, deps.systemUser, `Заказ ${orderId}; сумма ${payment.amount} ₽`);
      return { ok: true, paid: true };
    });
  }
  async function payment(user, id) {
    await context(user, id);
    // Reconcile previous payments before computing the current debt; network failures
    // must never cause a second payment to be offered for an unverified old attempt.
    const previous = (await context(user, id)).record.portalPaymentIntents || [];
    for (const intent of previous.filter(item => item.orderId && item.status === "pending")) await settlePayment(intent.orderId);
    return deps.lock(`student-payment:${id}`, async () => {
      const { record } = await context(user, id), amount = finances(record).debt;
      if (amount <= 0) return { ok: true, paid: true, message: "Задолженности нет." };
      for (const previous of (record.portalPaymentIntents || []).filter(item => item.orderId && item.status === "pending" && cents(item.amount) !== cents(amount))) {
        const cancelled = await deps.paymentShop("/student-payment-cancel", { orderId: previous.orderId, intentKey: previous.key });
        if (!cancelled.cancelled) fail("Предыдущий платёж ещё обрабатывается. Нажмите «Проверить оплату» и повторите позже.", 409);
        await mutate(id, user, item => ({ ...item, portalPaymentIntents: (item.portalPaymentIntents || []).map(value => value.key === previous.key ? { ...value, status: "cancelled" } : value) }));
      }
      let intent = (record.portalPaymentIntents || []).find(item => item.status === "pending" && cents(item.amount) === cents(amount));
      if (!intent) {
        intent = { key: crypto.randomUUID(), amount, status: "pending", createdAt: Date.now() };
        await mutate(id, user, item => ({ ...item, portalPaymentIntents: [...(item.portalPaymentIntents || []), intent] }));
      }
      const result = await deps.paymentShop("/student-payment", { intentKey: intent.key, studentId: id, amount: amount.toFixed(2),
        email: record.email, name: record.name, phone: record.phone, program: record.program, productId: record.productId || "" });
      const target = new URL(result.url);
      if (target.origin !== "https://zifra-plus.ru" || target.username || target.password || !/^\d+$/u.test(text(result.orderId))) fail("Магазин вернул некорректную ссылку оплаты.", 502);
      await mutate(id, user, item => ({ ...item, portalPaymentIntents: (item.portalPaymentIntents || []).map(value =>
        value.key === intent.key ? { ...value, orderId: text(result.orderId) } : value) }));
      return { ok: true, url: target.href, amount, orderId: text(result.orderId) };
    });
  }
  async function paymentStatus(user, id) {
    const { record } = await context(user, id);
    for (const intent of (record.portalPaymentIntents || []).filter(item => item.orderId && item.status === "pending")) await settlePayment(intent.orderId);
    return portal(user, id);
  }
  return { photo, awardUpload, awards, staffAwards, awardFile, payment, paymentStatus, settlePayment };
}
module.exports = { createService, rootFolder };
