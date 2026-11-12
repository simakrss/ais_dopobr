(() => {
  "use strict";
  const api = window.AIS_AUTH_API, root = document.getElementById("app");
  const previewStudentId = String(window.AIS_STUDENT_PORTAL_PREVIEW_ID || "");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const money = value => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(value || 0);
  const sections = [
    { id: "dashboard", label: "Рабочий стол", icon: "dashboard" },
    { id: "main", label: "Основное", icon: "profile" },
    { id: "documents", label: "Документы", icon: "folder" },
    { id: "finances", label: "Финансы", icon: "payments" }
  ];
  const mobileMenu = window.matchMedia("(max-width: 820px)");
  let state, tab = "dashboard", busy = false, dirty = false, sidebarOpen = false;
  document.body.classList.add("partner-portal-body", "student-portal-body");
  function icon(name) {
    const paths = {
      dashboard: '<path d="M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z"/>',
      profile: '<path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/>',
      folder: '<path d="M3 7.5h7l2 2h9v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Zm0 0V6a2 2 0 0 1 2-2h5l2 2h5"/>',
      payments: '<path d="M3 7h18M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 9h4m4 0h2M7 16h2"/>',
      external: '<path d="M14 4h6v6m0-6-9 9M19 13v6H5V5h6"/>',
      logout: '<path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5m5-4 4-4-4-4m4 4H9"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>'
    };
    return `<svg class="partner-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.profile}</svg>`;
  }
  function shellSidebar() {
    const initials = String(state.user.name || "С").split(/\s+/u).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("ru-RU");
    const exit = previewStudentId ? "Закрыть кабинет" : "Выйти";
    return `<aside class="partner-sidebar" id="student-sidebar" aria-label="Навигация кабинета слушателя">
      <div class="partner-brand"><div class="partner-brand-mark">Ц+</div><div><strong>Цифровизация Плюс</strong><span>Кабинет слушателя</span></div><button class="partner-sidebar-close" data-sidebar-close type="button" aria-label="Закрыть меню">${icon("close")}</button></div>
      <nav class="partner-nav" aria-label="Разделы кабинета">${sections.map(item => `<button class="partner-nav-item ${tab === item.id ? "is-active" : ""}" type="button" data-tab="${item.id}" aria-pressed="${tab === item.id}" ${tab === item.id ? 'aria-current="page"' : ""}>${icon(item.icon)}<span>${item.label}</span></button>`).join("")}</nav>
      <div class="student-sidebar-sdo">${state.sdoAvailable ? `<a class="partner-nav-item" data-sdo href="${esc(api.appUrl(url("/sdo-open")))}" target="_blank" rel="noopener noreferrer">${icon("external")}<span>Открыть СДО</span></a>` : `<span class="student-sidebar-sdo-label">${icon("external")} Система обучения</span><p>Вход в СДО откроется после отправки данных для доступа учебным центром.</p>`}</div>
      <div class="partner-sidebar-user"><span class="partner-avatar">${esc(initials)}</span><div><strong title="${esc(state.user.name)}">${esc(state.user.name)}</strong><small title="${esc(state.user.email)}">${esc(state.user.email)}</small></div><button type="button" data-logout aria-label="${exit}" title="${exit}">${icon("logout")}</button></div>
      </aside><button class="partner-sidebar-backdrop" data-sidebar-close type="button" aria-label="Закрыть меню" tabindex="-1" hidden></button>`;
  }
  function shellHeader() {
    return `<header class="partner-topbar"><button class="partner-menu-button" type="button" data-sidebar-open aria-label="Открыть меню" aria-controls="student-sidebar" aria-expanded="false">${icon("menu")}</button>
      <div><span>Кабинет слушателя</span><h1 data-section-title tabindex="-1">${sections.find(item => item.id === tab).label}</h1></div>
      <div class="partner-account"><button class="partner-topbar-profile" id="student-account-trigger" type="button" data-account-toggle aria-haspopup="menu" aria-expanded="false" aria-controls="student-account-menu" aria-label="Меню слушателя: ${esc(state.user.name)}">${icon("profile")}<span>${esc(state.user.name)}</span></button>
      <div class="partner-account-menu" id="student-account-menu" role="menu" aria-labelledby="student-account-trigger" hidden><button type="button" role="menuitem" data-go="main">${icon("profile")}<span>Профиль</span></button><button type="button" role="menuitem" data-logout>${icon("logout")}<span>${previewStudentId ? "Закрыть кабинет" : "Выйти"}</span></button></div></div></header>`;
  }
  function dashboard() {
    const required = state.requirements.filter(doc => doc.required);
    const uploaded = required.filter(doc => state.documents.some(file => file.kind === doc.key)).length;
    return `<section data-panel="dashboard" ${tab !== "dashboard" ? "hidden" : ""} aria-label="Рабочий стол слушателя"><div class="student-dashboard-welcome"><h2>Здравствуйте, ${esc(state.user.name)}!</h2><p>Здесь можно заполнить личные данные, передать документы в учебный центр и проверить оплату обучения.</p></div>
      <div class="student-dashboard-cards"><button type="button" class="student-summary-card" data-go="documents">${icon("folder")}<span>Обязательные документы</span><strong>${uploaded} из ${required.length}</strong><small>Загружено · перейти к документам</small></button><button type="button" class="student-summary-card" data-go="finances">${icon("payments")}<span>Оплачено</span><strong>${money(state.finances.paid)}</strong><small>Посмотреть поступления</small></button><button type="button" class="student-summary-card" data-go="finances">${icon("payments")}<span>${state.finances.overpaid > 0 ? "Переплата" : "Осталось оплатить"}</span><strong>${money(state.finances.overpaid > 0 ? state.finances.overpaid : state.finances.debt)}</strong><small>${state.finances.debt > 0 ? "По выбранной программе" : "Задолженности нет"}</small></button></div>
      <div class="student-dashboard-actions"><button type="button" class="primary-button" data-go="main">Заполнить личные данные</button><button type="button" data-go="documents">Перейти к документам</button></div></section>`;
  }
  function accountMenu(open, restoreFocus = false) {
    const menu = root.querySelector("#student-account-menu"), trigger = root.querySelector("[data-account-toggle]");
    if (!menu || !trigger) return;
    menu.hidden = !open; trigger.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("button")?.focus({ preventScroll: true });
    else if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  function setSidebar(open, restoreFocus = true) {
    const sidebar = root.querySelector("#student-sidebar"), workspace = root.querySelector(".partner-workspace");
    if (!sidebar || !workspace) return;
    sidebarOpen = Boolean(open && mobileMenu.matches);
    sidebar.classList.toggle("is-open", sidebarOpen);
    sidebar.inert = mobileMenu.matches && !sidebarOpen;
    workspace.inert = sidebarOpen;
    const backdrop = root.querySelector(".partner-sidebar-backdrop");
    backdrop.hidden = !sidebarOpen; backdrop.classList.toggle("is-visible", sidebarOpen);
    root.querySelector("[data-sidebar-open]").setAttribute("aria-expanded", String(sidebarOpen));
    document.body.classList.toggle("student-menu-open", sidebarOpen);
    if (sidebarOpen) { accountMenu(false); sidebar.querySelector('[aria-current="page"]')?.focus({ preventScroll: true }); }
    else if (restoreFocus && mobileMenu.matches) root.querySelector("[data-sidebar-open]").focus({ preventScroll: true });
  }
  function switchSection(id) {
    if (busy || !sections.some(item => item.id === id)) return;
    tab = id;
    root.querySelectorAll("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
    root.querySelectorAll("[data-tab]").forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    const title = root.querySelector("[data-section-title]");
    title.textContent = sections.find(item => item.id === tab).label;
    root.querySelector("[data-enrollment-footer]").hidden = tab === "finances";
    setSidebar(false, false); accountMenu(false); window.scrollTo(0, 0); title.focus({ preventScroll: true });
  }
  const url = (action = "", id = state?.record.id) => previewStudentId
    ? `api/students/portal-preview${action}?studentId=${encodeURIComponent(previewStudentId)}&id=${encodeURIComponent(id || "")}`
    : `api/student-portal${action}?id=${encodeURIComponent(id || "")}`;
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
    if (hint) hint.textContent = dirty ? "Сохраните изменённые данные перед отправкой." : state.record.enrollmentReviewStatus === "Приняты"
      ? "Документы приняты учебным центром. Если измените данные или файлы, отправьте комплект повторно."
      : state.record.enrollmentSubmittedAt
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
    root.innerHTML = `<div class="partner-shell student-shell">${shellSidebar()}<div class="partner-workspace">${shellHeader()}<main class="partner-content student-portal">
      ${previewStudentId ? '<p class="student-portal-staff-notice" role="status">Кабинет открыт от имени слушателя. Вы продолжаете работать как сотрудник; действия записываются в журнал под вашей учётной записью.</p>' : ""}
      <section class="partner-panel student-program-panel" aria-label="Выбор программы"><label>Программа обучения<select data-application aria-label="Программа обучения">${state.applications.map(row => `<option value="${esc(row.id)}" ${row.id === state.record.id ? "selected" : ""}>${esc(row.program)} · ${esc(row.status)}</option>`).join("")}</select></label><p class="student-program-name">${esc(state.record.program)}</p><span class="student-program-status">${esc(state.record.status)}</span></section>
      <div data-message role="alert" hidden></div><div data-progress role="status" hidden><progress aria-label="Выполняется операция"></progress><span></span></div>
      <section class="partner-panel student-section-panel">
      <aside class="student-portal-review" data-review-status="${esc(state.record.enrollmentReviewStatus || "Заполняется")}" aria-label="Результат проверки документов"><div><strong>Документы: ${esc(state.record.enrollmentReviewStatus || "Заполняется")}</strong><button type="button" data-review-refresh>Обновить статус</button></div>${state.record.enrollmentReviewComment ? `<p class="muted">${["Приняты", "На доработке"].includes(state.record.enrollmentReviewStatus) ? "Комментарий учебного центра" : "Предыдущий комментарий учебного центра"}${state.record.enrollmentReviewedAt ? ` · ${esc(new Date(state.record.enrollmentReviewedAt).toLocaleString("ru-RU"))}` : ""}</p><p class="student-portal-review-comment">${esc(state.record.enrollmentReviewComment)}</p>` : ""}${state.record.enrollmentReviewStatus === "На доработке" ? "<p>Исправьте замечания, сохраните данные и нажмите «Отправить на проверку» повторно.</p>" : ""}</aside>
      ${dashboard()}
      <section data-panel="main" ${tab !== "main" ? "hidden" : ""} aria-label="Личные данные"><h2>Личные данные</h2><p>Заполните обязательные поля, отмеченные *. Если не работаете, укажите «Не работаю».</p><form data-profile novalidate><div class="student-portal-fields">${state.fields.map(field).join("")}</div><button class="primary-button" type="submit">Сохранить данные</button></form></section>
      <section data-panel="documents" ${tab !== "documents" ? "hidden" : ""} aria-label="Документы для зачисления"><h2>Документы для зачисления</h2><p>PDF, JPEG или PNG, до 20 МБ на файл. Файлы сохраняются в Вашей папке на Яндекс Диске. При повторной загрузке используется новый файл этого вида. <a href="https://zifra-plus.ru/edu_info/" target="_blank" rel="noopener noreferrer">Перечень документов ↗</a></p>
      <ul class="student-portal-documents">${state.requirements.map(doc => { const file = state.documents.find(item => item.kind === doc.key); return `<li><div><strong>${esc(doc.label)}</strong><small>${doc.required ? "Обязательно" : "При необходимости"}</small>${file ? `<span>✓ Загружен · ${esc(new Date(file.uploadedAt).toLocaleString("ru-RU"))}</span>` : "<span>Файл не загружен</span>"}</div><div class="student-portal-file-actions">${file ? `<button type="button" data-view="${esc(file.id)}">Просмотр</button><button type="button" data-download="${esc(file.id)}">Скачать</button>` : ""}<label class="student-portal-upload">${file ? "Заменить файл" : "Прикрепить файл"}<input aria-label="${esc(doc.label)}" type="file" accept="application/pdf,image/jpeg,image/png" data-upload="${doc.key}"></label></div></li>`; }).join("")}</ul></section>
      <section data-panel="finances" ${tab !== "finances" ? "hidden" : ""}><h2>Оплата обучения</h2><dl class="student-portal-finances"><div><dt>Стоимость обучения по договору</dt><dd>${money(state.finances.total)}</dd></div><div><dt>Оплачено</dt><dd>${money(state.finances.paid)}</dd></div>${state.finances.debt > 0 ? `<div><dt>Остаток долга</dt><dd>${money(state.finances.debt)}</dd></div>` : '<div><dt>Задолженность</dt><dd>Нет</dd></div>'}${state.finances.overpaid > 0 ? `<div><dt>Переплата</dt><dd>${money(state.finances.overpaid)}</dd></div>` : ""}</dl><h3>Ваши оплаты</h3>${state.finances.payments.length ? `<table class="data-table"><thead><tr><th>Дата</th><th>Сумма</th></tr></thead><tbody>${state.finances.payments.map(payment => `<tr><td>${esc(payment.date ? new Date(payment.date).toLocaleDateString("ru-RU") : "Дата не указана")}</td><td>${money(payment.amount)}</td></tr>`).join("")}</tbody></table>` : '<p>Оплаты пока не отражены.</p>'}<p>Данные по выбранной заявке. Если платёж пока не отображается, обратитесь в учебный центр.</p></section>
      <footer data-enrollment-footer ${tab === "finances" ? "hidden" : ""}><p data-submit-hint role="status"></p><button class="primary-button" type="button" data-submit>Отправить на проверку</button></footer></section></main><footer class="partner-footer">ООО «Цифровизация Плюс» · Кабинет слушателя</footer></div></div>`;
    root.querySelector("[data-profile]").addEventListener("input", () => { dirty = true; availability(); });
    root.querySelector("[data-profile]").addEventListener("submit", event => { event.preventDefault(); run("Сохранение данных…", async () => { state = await request("/profile", profile()); render(); message("Данные сохранены."); }); });
    root.querySelectorAll("[data-tab], [data-go]").forEach(button => button.addEventListener("click", () => switchSection(button.dataset.tab || button.dataset.go)));
    root.querySelector("[data-sidebar-open]").onclick = () => setSidebar(true);
    root.querySelectorAll("[data-sidebar-close]").forEach(button => { button.onclick = () => setSidebar(false); });
    root.querySelector("[data-account-toggle]").onclick = () => accountMenu(root.querySelector("#student-account-menu").hidden);
    root.querySelector("[data-account-toggle]").oncontextmenu = event => { event.preventDefault(); if (!busy) accountMenu(true); };
    root.querySelector("[data-application]").addEventListener("change", event => { const id = event.target.value; run("Загрузка заявки…", async () => { if (dirty) await request("/profile", profile()); state = await api.request(url("", id)); render(); }); });
    root.querySelectorAll("[data-upload]").forEach(input => input.addEventListener("change", () => upload(input)));
    root.querySelectorAll("[data-view], [data-download]").forEach(button => button.addEventListener("click", () => openFile(button.dataset.view || button.dataset.download, Boolean(button.dataset.view))));
    root.querySelector("[data-submit]").addEventListener("click", () => run("Проверка документов на Яндекс Диске…", async () => { state = await request("/submit", {}); render(); message("Комплект отправлен на проверку в учебный центр."); }));
    root.querySelector("[data-review-refresh]").addEventListener("click", () => {
      if (dirty) { message("Сначала сохраните изменённые данные.", true); return; }
      run("Обновление статуса проверки…", async () => { state = await request(""); render(); });
    });
    root.querySelectorAll("[data-logout]").forEach(button => button.addEventListener("click", () => run("Выход…", async () => {
      if (dirty) await request("/profile", profile());
      if (previewStudentId) { dirty = false; busy = false; window.close(); if (!window.closed) window.location.assign(api.appUrl("")); return; }
      await api.request("api/auth/logout", { method: "POST" }); api.redirectToLogin();
    })));
    setSidebar(false, false); availability();
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
  document.addEventListener("click", event => { if (!event.target.closest(".partner-account")) accountMenu(false); });
  root.addEventListener("focusout", event => {
    if (event.target.closest("#student-account-menu") && !event.relatedTarget?.closest(".partner-account")) accountMenu(false);
  });
  document.addEventListener("keydown", event => {
    const menu = root.querySelector("#student-account-menu");
    if (event.key === "Escape") {
      if (sidebarOpen) { event.preventDefault(); setSidebar(false); }
      else if (menu && !menu.hidden) { event.preventDefault(); accountMenu(false, true); }
      return;
    }
    if (sidebarOpen && event.key === "Tab") {
      const items = [...root.querySelectorAll("#student-sidebar button:not(:disabled), #student-sidebar a[href]")].filter(item => item.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    } else if (menu && !menu.hidden && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const items = [...menu.querySelectorAll("button:not(:disabled)")], index = items.indexOf(document.activeElement);
      if (!items.length) return;
      event.preventDefault();
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length].focus();
    }
  });
  mobileMenu.addEventListener("change", () => setSidebar(false));
  window.addEventListener("beforeunload", event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } });
  root.innerHTML = '<main class="partner-boot"><div class="partner-brand-mark">Ц+</div><strong role="status">Загрузка кабинета слушателя…</strong><span class="auth-spinner"></span></main>';
  api.request(url()).then(result => { state = result; render(); }).catch(error => {
    root.innerHTML = `<main class="partner-boot"><div class="partner-brand-mark">Ц+</div><p role="alert">${esc(error.message)}</p><button class="partner-primary-button" type="button">Повторить</button></main>`;
    root.querySelector("button").onclick = () => location.reload();
  });
})();
