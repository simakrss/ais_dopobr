(() => {
  "use strict";
  const api = window.AIS_AUTH_API, root = document.getElementById("app");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const money = value => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(value || 0);
  let state, tab = "main", busy = false, dirty = false;
  const url = (action = "", id = state?.record.id) => `api/student-portal${action}?id=${encodeURIComponent(id || "")}`;
  async function request(action, body) {
    return api.request(url(action), body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  function message(value, error = false) {
    const element = root.querySelector("[data-message]");
    if (element) { element.textContent = value; element.classList.toggle("is-error", error); element.hidden = !value; }
  }
  function setBusy(value, label = "") {
    busy = value;
    root.querySelectorAll("button, input, select, textarea").forEach(element => { element.disabled = value; });
    const progress = root.querySelector("[data-progress]");
    if (progress) { progress.hidden = !value; progress.querySelector("span").textContent = label; }
    availability();
  }
  function availability() {
    const button = root.querySelector("[data-submit]");
    if (button) button.disabled = busy || dirty || state.missing.length > 0 || Boolean(state.record.enrollmentSubmittedAt);
    const hint = root.querySelector("[data-submit-hint]");
    if (hint) hint.textContent = dirty ? "Сохраните изменённые данные перед отправкой." : state.record.enrollmentSubmittedAt
      ? "Документы отправлены на проверку. После изменения данных или файлов отправьте комплект повторно."
      : state.missing.length ? `Нужно заполнить или приложить: ${state.missing.join("; ")}.` : "Данные и документы готовы к отправке в учебный центр.";
  }
  function field(item) {
    const value = state.record[item.key], attributes = `name="${esc(item.key)}" ${item.required ? "required" : ""} maxlength="2000"`;
    if (item.type === "checkbox") return `<label class="student-portal-check"><input type="checkbox" name="${esc(item.key)}" ${value === true ? "checked" : ""}> ${esc(item.label)}</label>`;
    let control;
    if (item.type === "select") control = `<select ${attributes}><option value="">Выберите значение</option>${item.options.map(option => `<option ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}</select>`;
    else if (item.type === "textarea") control = `<textarea ${attributes} rows="3">${esc(value)}</textarea>`;
    else control = `<input ${attributes} type="${item.type}" value="${esc(value)}">`;
    return `<label><span>${esc(item.label)}${item.required ? ' <b aria-label="обязательно">*</b>' : ""}</span>${control}</label>`;
  }
  function render() {
    dirty = false;
    root.innerHTML = `<main class="student-portal"><header><div><small>Учебный центр «Цифровизация Плюс»</small><h1>Кабинет слушателя</h1><p>${esc(state.user.name)} · ${esc(state.user.email)}</p></div><button type="button" data-logout>Выйти</button></header>
      <section class="panel"><label>Программа обучения<select data-application aria-label="Программа обучения">${state.applications.map(row => `<option value="${esc(row.id)}" ${row.id === state.record.id ? "selected" : ""}>${esc(row.program)} · ${esc(row.status)}</option>`).join("")}</select></label>
      <nav aria-label="Разделы кабинета">${[["main", "Основное"], ["documents", "Документы"], ["finances", "Финансы"]].map(([key, label]) => `<button type="button" data-tab="${key}" aria-pressed="${tab === key}">${label}</button>`).join("")}</nav>
      <div data-message role="alert" hidden></div><div data-progress role="status" hidden><progress aria-label="Выполняется операция"></progress><span></span></div>
      <section data-panel="main" ${tab !== "main" ? "hidden" : ""}><p>Заполните обязательные поля, отмеченные *. Если не работаете, укажите «Не работаю».</p><form data-profile novalidate><div class="student-portal-fields">${state.fields.map(field).join("")}</div><button class="primary-button" type="submit">Сохранить данные</button></form></section>
      <section data-panel="documents" ${tab !== "documents" ? "hidden" : ""}><p>PDF, JPEG или PNG, до 20 МБ на файл. Файлы сохраняются в Вашей папке на Яндекс Диске. При повторной загрузке используется новый файл этого вида. <a href="https://zifra-plus.ru/edu_info/" target="_blank" rel="noopener noreferrer">Перечень документов ↗</a></p>
      <ul class="student-portal-documents">${state.requirements.map(doc => { const file = state.documents.find(item => item.kind === doc.key); return `<li><div><strong>${esc(doc.label)}</strong><small>${doc.required ? "Обязательно" : "При необходимости"}</small>${file ? `<span>✓ Загружен · ${esc(new Date(file.uploadedAt).toLocaleString("ru-RU"))}</span>` : "<span>Файл не загружен</span>"}</div><div class="student-portal-file-actions">${file ? `<button type="button" data-view="${esc(file.id)}">Просмотр</button><button type="button" data-download="${esc(file.id)}">Скачать</button>` : ""}<label class="student-portal-upload">${file ? "Заменить файл" : "Прикрепить файл"}<input aria-label="${esc(doc.label)}" type="file" accept="application/pdf,image/jpeg,image/png" data-upload="${doc.key}"></label></div></li>`; }).join("")}</ul></section>
      <section data-panel="finances" ${tab !== "finances" ? "hidden" : ""}><h2>Оплата обучения</h2><dl class="student-portal-finances"><div><dt>Стоимость обучения по договору</dt><dd>${money(state.finances.total)}</dd></div><div><dt>Оплачено</dt><dd>${money(state.finances.paid)}</dd></div>${state.finances.debt > 0 ? `<div><dt>Остаток долга</dt><dd>${money(state.finances.debt)}</dd></div>` : '<div><dt>Задолженность</dt><dd>Нет</dd></div>'}${state.finances.overpaid > 0 ? `<div><dt>Переплата</dt><dd>${money(state.finances.overpaid)}</dd></div>` : ""}</dl><h3>Ваши оплаты</h3>${state.finances.payments.length ? `<table class="data-table"><thead><tr><th>Дата</th><th>Сумма</th></tr></thead><tbody>${state.finances.payments.map(payment => `<tr><td>${esc(payment.date ? new Date(payment.date).toLocaleDateString("ru-RU") : "Дата не указана")}</td><td>${money(payment.amount)}</td></tr>`).join("")}</tbody></table>` : '<p>Оплаты пока не отражены.</p>'}<p>Данные по выбранной заявке. Если платёж пока не отображается, обратитесь в учебный центр.</p></section>
      <footer><p data-submit-hint role="status"></p><button class="primary-button" type="button" data-submit>Отправить на проверку</button></footer></section></main>`;
    root.querySelector("[data-profile]").addEventListener("input", () => { dirty = true; availability(); });
    root.querySelector("[data-profile]").addEventListener("submit", event => { event.preventDefault(); run("Сохранение данных…", async () => { state = await request("/profile", profile()); render(); message("Данные сохранены."); }); });
    root.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => {
      tab = button.dataset.tab;
      root.querySelectorAll("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
      root.querySelectorAll("[data-tab]").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.tab === tab)));
    }));
    root.querySelector("[data-application]").addEventListener("change", event => { const id = event.target.value; run("Загрузка заявки…", async () => { if (dirty) await request("/profile", profile()); state = await api.request(url("", id)); render(); }); });
    root.querySelectorAll("[data-upload]").forEach(input => input.addEventListener("change", () => upload(input)));
    root.querySelectorAll("[data-view], [data-download]").forEach(button => button.addEventListener("click", () => openFile(button.dataset.view || button.dataset.download, Boolean(button.dataset.view))));
    root.querySelector("[data-submit]").addEventListener("click", () => run("Проверка документов на Яндекс Диске…", async () => { state = await request("/submit", {}); render(); message("Комплект отправлен на проверку в учебный центр."); }));
    root.querySelector("[data-logout]").addEventListener("click", () => run("Выход…", async () => {
      if (dirty) await request("/profile", profile());
      await api.request("api/auth/logout", { method: "POST" }); api.redirectToLogin();
    }));
    availability();
  }
  function profile() {
    const form = root.querySelector("[data-profile]");
    return Object.fromEntries(state.fields.map(item => [item.key, item.type === "checkbox" ? form.elements[item.key].checked : form.elements[item.key].value]));
  }
  async function run(label, operation) {
    if (busy) return;
    setBusy(true, label); message("");
    try { await operation(); } catch (error) { message(error.message || "Не удалось выполнить операцию.", true); }
    finally { setBusy(false); }
  }
  async function upload(input) {
    const file = input.files[0]; if (!file) return;
    await run("Загрузка документа на Яндекс Диск…", async () => {
      if (file.size > 20 * 1024 * 1024) throw Error("Максимальный размер — 20 МБ.");
      const savedProfile = profile();
      if (dirty) state = await request("/profile", savedProfile);
      const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(Error("Не удалось прочитать файл.")); reader.readAsDataURL(file); });
      state = await request("/upload", { kind: input.dataset.upload, base64 }); render(); message("Файл сохранён на Яндекс Диске.");
    });
    input.value = "";
  }
  async function openFile(id, preview) {
    await run("Получение документа…", async () => {
      const response = await fetch(api.appUrl(`${url("/file")}&file=${encodeURIComponent(id)}`), { credentials: "same-origin" });
      if (!response.ok) throw Error("Файл недоступен. Повторите позже.");
      const blob = await response.blob(), objectUrl = URL.createObjectURL(blob);
      const name = state.documents.find(file => file.id === id)?.name || "Документ";
      if (!preview) {
        const link = document.createElement("a"); link.href = objectUrl; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000); return;
      }
      const dialog = document.createElement("dialog"); dialog.className = "student-portal-preview";
      dialog.innerHTML = `<header><strong>${esc(name)}</strong><button type="button" aria-label="Закрыть просмотр">×</button></header>${blob.type.startsWith("image/") ? '<img alt="Загруженный документ">' : '<iframe title="Просмотр документа"></iframe>'}<a download="${esc(name)}">Скачать файл</a>`;
      dialog.querySelector("img,iframe").src = objectUrl; dialog.querySelector("a").href = objectUrl;
      dialog.querySelector("button").onclick = () => dialog.close();
      dialog.addEventListener("close", () => { URL.revokeObjectURL(objectUrl); dialog.remove(); }, { once: true });
      document.body.append(dialog); dialog.showModal();
    });
  }
  window.addEventListener("beforeunload", event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } });
  root.innerHTML = '<main class="student-portal"><p role="status">Загрузка кабинета слушателя…</p><progress></progress></main>';
  api.request(url()).then(result => { state = result; render(); }).catch(error => {
    root.innerHTML = `<main class="student-portal"><p role="alert">${esc(error.message)}</p><button type="button">Повторить</button></main>`;
    root.querySelector("button").onclick = () => location.reload();
  });
})();
