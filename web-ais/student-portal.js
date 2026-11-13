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
    { id: "finances", label: "Финансы", icon: "payments" },
    { id: "awards", label: "Документ об образовании", icon: "folder" },
    { id: "feedback", label: "Обратная связь", icon: "mail" }
  ];
  const feedbackDrafts = new Map();
  const layoutRemarksDrafts = new Map();
  const correspondence = new Map();
  const historyRequests = new Set();
  const mobileMenu = window.matchMedia("(max-width: 820px)");
  let state, tab = new URLSearchParams(location.search).has("student-payment") ? "finances" : "dashboard", busy = false, dirty = false, sidebarOpen = false;
  document.body.classList.add("partner-portal-body", "student-portal-body");
  function icon(name) {
    const paths = {
      dashboard: '<path d="M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z"/>',
      profile: '<path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/>',
      folder: '<path d="M3 7.5h7l2 2h9v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Zm0 0V6a2 2 0 0 1 2-2h5l2 2h5"/>',
      payments: '<path d="M3 7h18M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 9h4m4 0h2M7 16h2"/>',
      mail: '<path d="M3 6h18v12H3V6Zm0 1 9 7 9-7"/>',
      external: '<path d="M14 4h6v6m0-6-9 9M19 13v6H5V5h6"/>',
      download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',
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
  function feedbackDraft() {
    if (!feedbackDrafts.has(state.record.id)) feedbackDrafts.set(state.record.id, { subject: "", message: "", requestId: "", status: "", error: "" });
    return feedbackDrafts.get(state.record.id);
  }
  function feedbackRequestId() {
    // getRandomValues also works when the local cabinet is opened over a LAN HTTP address.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function feedbackPanel() {
    const draft = feedbackDraft(), email = state.record.email || state.user.email;
    return `<section data-panel="feedback" ${tab !== "feedback" ? "hidden" : ""} aria-label="Обратная связь"><h2>Обратная связь</h2>
      <div class="partner-feedback-layout"><article class="partner-panel partner-feedback-info">${icon("mail")}<h3>Напишите нам</h3><p>Задайте вопрос об обучении, документах, оплате или доступе в СДО. ${email ? "Ответ появится в истории переписки и поступит на email из вашей карточки." : "Укажите в сообщении контакты для ответа."}</p><dl><dt>Получатель</dt><dd>${esc(state.feedbackRecipient || "Учебный центр «Цифровизация Плюс»")}</dd><dt>Ваш email</dt><dd>${esc(email || "не указан")}</dd><dt>Программа</dt><dd>${esc(state.record.program)}</dd></dl></article>
      <form class="partner-panel partner-feedback-form" data-feedback-form><label><span>Тема</span><input name="subject" type="text" minlength="3" maxlength="180" required value="${esc(draft.subject)}" placeholder="Кратко опишите вопрос"></label><label><span>Сообщение</span><textarea name="message" rows="9" minlength="10" maxlength="10000" required placeholder="Введите сообщение">${esc(draft.message)}</textarea></label>
      <p class="partner-form-message ${draft.error ? "is-error" : "is-success"}" data-feedback-result role="${draft.error ? "alert" : "status"}" ${draft.status || draft.error ? "" : "hidden"}>${esc(draft.error || draft.status)}</p>
      <p data-feedback-thread ${draft.threadId ? "" : "hidden"}>Ответ в выбранной переписке. <button type="button" data-feedback-new>Новое обращение</button></p>
      <button class="primary-button" type="submit">${icon("mail")}<span data-feedback-send-label>Отправить сообщение</span></button>${previewStudentId ? '<button type="submit" name="fromCenter" value="true">Ответить от учебного центра</button>' : ""}</form></div>
      <div class="student-history-heading"><h3>История переписки</h3><button type="button" data-feedback-refresh>Обновить переписку</button></div><p data-history-status role="status"></p><div data-feedback-history></div></section>`;
  }
  function drawHistory(id = state.record.id) {
    if (id !== state.record.id) return;
    const host = root.querySelector("[data-feedback-history]"), history = correspondence.get(id);
    if (!host || !history) return;
    const groups = new Map();
    for (const item of history.messages || []) { if (!groups.has(item.threadId)) groups.set(item.threadId, []); groups.get(item.threadId).push(item); }
    host.innerHTML = [...groups.entries()].reverse().map(([threadId, items]) => `<article class="student-correspondence-thread"><h4>${esc(items[0].subject)}</h4>${items.map(item => `<section class="student-correspondence-message ${item.direction === "center" ? "from-center" : "from-student"}"><header><strong>${item.direction === "center" ? "Учебный центр" : "Слушатель"}</strong><time>${esc(new Date(item.createdAt).toLocaleString("ru-RU"))}</time><small>${esc(({ sent: "Отправлено", pending: "Ожидается подтверждение отправки", unknown: "Отправка не подтверждена", failed: "Не отправлено" })[item.status] || item.status)}</small></header><p>${esc(item.message)}</p></section>`).join("")}<button type="button" data-thread-reply="${esc(threadId)}">Ответить</button></article>`).join("") || "<p>Отправленных сообщений пока нет.</p>";
    host.querySelectorAll("[data-thread-reply]").forEach(button => { button.onclick = () => {
      const draft = feedbackDraft(), thread = groups.get(button.dataset.threadReply);
      draft.threadId = button.dataset.threadReply; draft.subject = thread[0].subject.replace(/^(?:Re:\s*)+/iu, ""); draft.requestId = "";
      root.querySelector("[data-feedback-form]").elements.subject.value = draft.subject;
      root.querySelector("[data-feedback-thread]").hidden = false;
      root.querySelector("[data-feedback-form]").elements.message.focus();
    }; });
  }
  async function loadHistory(sync = false) {
    const id = state.record.id, status = root.querySelector("[data-history-status]"), button = root.querySelector("[data-feedback-refresh]");
    if (historyRequests.has(id)) return; historyRequests.add(id);
    button.disabled = true; status.textContent = sync ? "Проверяем ответы учебного центра…" : "Загрузка переписки…";
    try {
      const result = await api.request(url(sync ? "/feedback-sync" : "/feedback", id), sync ? { method: "POST" } : {});
      correspondence.set(id, result); drawHistory(id);
      if (state.record.id === id) status.textContent = result.warning || "Переписка обновлена.";
    } catch (error) { if (state.record.id === id) status.textContent = error.message || "Не удалось обновить переписку. Сохранённые сообщения показаны ниже."; }
    finally {
      historyRequests.delete(id); button.disabled = busy;
      if (!sync && state.record.id === id && tab === "feedback") void loadHistory(true);
    }
  }
  let awardsRequest = 0;
  async function loadAwards() {
    const host = root.querySelector("[data-awards-list]"), id = state.record.id, sequence = ++awardsRequest;
    host.textContent = "Загрузка документов…";
    try {
      const result = await request("/awards"); if (id !== state.record.id || !host.isConnected || sequence !== awardsRequest) return;
      host.innerHTML = result.programs.map(program => `<article class="student-award-program"><h3>${esc(program.program)}</h3>
        ${program.number ? `<p>Номер бланка: ${esc(program.number)}</p>` : ""}
        ${program.debt > 0 ? '<p class="student-debt-note">Документ об образовании будет выдан после полного погашения задолженности.</p>' : ""}
        ${program.layoutApproved ? `<p class="student-layout-approved" role="status">✓ Макет согласован${program.layoutApprovedAt ? ` · ${esc(new Date(program.layoutApprovedAt).toLocaleDateString("ru-RU"))}` : ""}</p>` : ""}
        ${program.layoutRemarks?.comment ? `<aside class="student-layout-remarks ${program.layoutRemarks.resolvedAt ? "is-resolved" : ""}"><strong>${program.layoutRemarks.resolvedAt ? "Замечания до согласования" : "Ваши замечания к макету"}</strong><small>${esc(new Date(program.layoutRemarks.createdAt).toLocaleString("ru-RU"))} · ${esc(program.layoutRemarks.name)}</small><p>${esc(program.layoutRemarks.comment)}</p></aside>` : ""}
        ${program.files.length ? program.files.map(file => `<div class="student-award-file" data-file-kind="${esc(file.kind)}">
          <span><strong>${file.kind === "layout" ? "Макет документа" : "Скан документа"}</strong><small>${file.unassigned ? "Из общей папки слушателя · программа не определена · " : ""}${esc(file.name)}</small></span>
          <button class="ghost-button" type="button" data-award-view="${esc(file.id)}" data-application-id="${esc(program.id)}" data-file-name="${esc(file.name)}">Просмотр</button>
          <button class="primary-button student-award-download-button" type="button" data-award-download="${esc(file.id)}" data-application-id="${esc(program.id)}" data-file-name="${esc(file.name)}">${icon("download")}<span>${file.kind === "layout" ? "Скачать макет" : "Скачать документ"}</span></button>
          ${file.kind === "layout" && !file.unassigned && program.canApproveLayout ? `<button type="button" class="primary-button" data-award-approve="${esc(file.id)}" data-file-revision="${esc(file.revision)}" data-application-id="${esc(program.id)}">Согласовать макет</button><button class="ghost-button" type="button" data-award-remarks="${esc(file.id)}" data-application-id="${esc(program.id)}">Есть замечания</button>` : ""}
        </div>`).join("") : "<p>Доступных документов по этой программе пока нет. Макет появится после отправки на согласование или отправки электронного документа учебным центром.</p>"}
      </article>`).join("");
      host.querySelectorAll("[data-award-view], [data-award-download]").forEach(button => { button.disabled = busy; button.onclick = () => openFile(button.dataset.awardView || button.dataset.awardDownload, Boolean(button.dataset.awardView), "/award-file", button.dataset.applicationId, button.dataset.fileName, button.closest("[data-file-kind]").dataset.fileKind === "layout" ? "Скачать макет" : "Скачать документ"); });
      host.querySelectorAll("[data-award-approve]").forEach(button => { button.disabled = busy; button.onclick = () => run("Согласование макета…", async () => {
        await request("/approve-layout", { fileId: button.dataset.awardApprove, revision: button.dataset.fileRevision }, button.dataset.applicationId);
        await loadAwards(); message("Макет согласован. Отметка сохранена в Вашей карточке слушателя.");
      }); });
      host.querySelectorAll("[data-award-remarks]").forEach(button => { button.disabled = busy; button.onclick = () => {
        const program = result.programs.find(item => item.id === button.dataset.applicationId), file = program?.files.find(item => item.id === button.dataset.awardRemarks);
        if (!busy && file) openLayoutRemarks(program, file, button);
      }; });
    } catch (error) { if (sequence === awardsRequest && id === state.record.id && host.isConnected) host.textContent = error.message || "Не удалось загрузить документы."; }
  }
  function openLayoutRemarks(program, file, trigger) {
    const key = `${program.id}:${file.id}:${file.revision}`;
    if (!layoutRemarksDrafts.has(key)) layoutRemarksDrafts.set(key, program.layoutRemarks?.fileId === file.id ? program.layoutRemarks.comment : "");
    const dialog = document.createElement("dialog"); dialog.className = "student-layout-remarks-dialog";
    dialog.setAttribute("aria-labelledby", "student-layout-remarks-title");
    dialog.innerHTML = `<header><h2 id="student-layout-remarks-title">Замечания к макету</h2><button type="button" data-close aria-label="Закрыть замечания">×</button></header><p>${esc(program.program)}</p><form><label>Что нужно исправить?<textarea name="comment" rows="7" required maxlength="4000">${esc(layoutRemarksDrafts.get(key))}</textarea></label><small>До 4000 символов. Комментарий увидит сотрудник учебного центра.</small><p data-error role="alert" hidden></p><footer><button type="button" data-close>Отмена</button><button class="primary-button" type="submit">Передать замечания</button></footer></form>`;
    const form = dialog.querySelector("form"), input = form.elements.comment, error = dialog.querySelector("[data-error]");
    input.oninput = () => { layoutRemarksDrafts.set(key, input.value); error.hidden = true; };
    dialog.querySelectorAll("[data-close]").forEach(button => { button.onclick = () => { if (!busy) dialog.close(); }; });
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { dialog.remove(); if (trigger.isConnected) trigger.focus(); });
    form.onsubmit = async event => {
      event.preventDefault(); if (busy || !form.reportValidity()) return;
      const comment = input.value.trim();
      if (!comment) { error.textContent = "Напишите, что нужно исправить в макете."; error.hidden = false; input.focus(); return; }
      setBusy(true, "Сохранение замечаний…"); error.hidden = true;
      dialog.querySelectorAll("button, textarea").forEach(item => { item.disabled = true; });
      try {
        await request("/layout-remarks", { fileId: file.id, revision: file.revision, comment }, program.id);
        layoutRemarksDrafts.delete(key); dialog.close(); await loadAwards(); message("Замечания сохранены и доступны учебному центру в Вашей карточке.");
      } catch (failure) { error.textContent = failure.message || "Не удалось сохранить замечания. Текст сохранён, повторите отправку."; error.hidden = false; }
      finally { setBusy(false); dialog.querySelectorAll("button, textarea").forEach(item => { item.disabled = false; }); }
    };
    document.body.appendChild(dialog); dialog.showModal(); input.focus();
  }
  function financeActions() {
    return `${state.finances.debt > 0 ? `<p class="student-debt-note">Документ об образовании будет выдан после полного погашения задолженности.</p><button type="button" class="primary-button" data-pay>Оплатить ${money(state.finances.debt)} через ЮKassa</button><p data-payment-link hidden></p>` : ""}<button type="button" data-payment-refresh>Проверить оплату</button>`;
  }
  function feedbackResult() {
    const draft = feedbackDraft(), element = root.querySelector("[data-feedback-result]");
    element.textContent = draft.error || draft.status; element.hidden = !element.textContent;
    element.classList.toggle("is-error", Boolean(draft.error)); element.classList.toggle("is-success", !draft.error);
    element.setAttribute("role", draft.error ? "alert" : "status");
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
    root.querySelector("[data-enrollment-footer]").hidden = ["finances", "feedback", "awards"].includes(tab);
    root.querySelector(".student-portal-review").hidden = ["feedback", "awards"].includes(tab);
    setSidebar(false, false); accountMenu(false); window.scrollTo(0, 0); title.focus({ preventScroll: true });
    if (tab === "feedback") { drawHistory(); loadHistory(); }
    if (tab === "awards") loadAwards();
  }
  const url = (action = "", id = state?.record.id) => previewStudentId
    ? `api/students/portal-preview${action}?studentId=${encodeURIComponent(previewStudentId)}&id=${encodeURIComponent(id || "")}`
    : `api/student-portal${action}?id=${encodeURIComponent(id || "")}`;
  async function request(action, body, id = state?.record.id) {
    return api.request(url(action, id), body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
    else if (item.type === "combo") control = `<div class="combo-field" data-student-combo><div class="combo-input-wrap"><input ${attributes} type="text" value="${esc(value)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="student-options-${esc(item.key)}"><button type="button" class="combo-clear" data-combo-clear aria-label="Очистить значение" title="Очистить"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"></path></svg></button></div><div class="combo-options student-combo-options" id="student-options-${esc(item.key)}" role="listbox" aria-label="${esc(item.label)}" popover="auto">${item.options.map((option, index) => `<button type="button" role="option" tabindex="-1" id="student-option-${esc(item.key)}-${index}" data-value="${esc(option)}" aria-selected="${option === value}" class="${option === value ? "is-selected" : ""}">${esc(option)}</button>`).join("")}<span class="combo-empty" hidden>Нет совпадений. Можно ввести своё значение.</span></div></div>`;
    else if (item.type === "textarea") control = `<textarea ${attributes} rows="3">${esc(value)}</textarea>`;
    else control = `<input ${attributes} type="${item.type}" value="${esc(value)}">`;
    return `<label ${item.dependsOn ? `data-depends-on="${esc(item.dependsOn)}"` : ""}><span>${esc(item.label)}${item.required || item.dependsOn ? ' <b aria-label="обязательно">*</b>' : ""}</span>${control}</label>`;
  }
  function conditionalFields() {
    const form = root.querySelector("[data-profile]");
    form.querySelectorAll("[data-depends-on]").forEach(label => {
      label.hidden = !form.elements[label.dataset.dependsOn]?.checked;
      label.querySelector("input").required = !label.hidden;
    });
  }
  let comboEvents;
  function bindCombos() {
    comboEvents?.abort(); comboEvents = new AbortController();
    root.querySelectorAll("[data-student-combo]").forEach(combo => {
      const input = combo.querySelector("input"), list = combo.querySelector("[role=listbox]"), options = [...list.querySelectorAll("[role=option]")];
      let active = -1;
      const close = () => { if (list.matches(":popover-open")) list.hidePopover(); input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
      const place = () => {
        if (!list.matches(":popover-open")) return;
        const box = input.getBoundingClientRect(), below = innerHeight - box.bottom - 12, above = box.top - 12;
        const up = below < 200 && above > below, height = Math.max(60, Math.min(260, up ? above : below));
        list.style.width = `${Math.min(box.width, innerWidth - 16)}px`; list.style.left = `${Math.max(8, Math.min(box.left, innerWidth - box.width - 8))}px`;
        list.style.maxHeight = `${height}px`; list.style.top = `${up ? Math.max(8, box.top - Math.min(list.scrollHeight, height) - 6) : box.bottom + 6}px`;
      };
      const open = (filter = false) => {
        if (busy) return;
        const search = filter ? input.value.trim().toLocaleLowerCase("ru") : "";
        options.forEach(option => { option.hidden = !option.dataset.value.toLocaleLowerCase("ru").includes(search); option.classList.toggle("is-selected", option.dataset.value === input.value); option.setAttribute("aria-selected", String(option.dataset.value === input.value)); });
        list.querySelector(".combo-empty").hidden = options.some(option => !option.hidden);
        active = -1; input.removeAttribute("aria-activedescendant");
        list.showPopover(); input.setAttribute("aria-expanded", "true"); place();
      };
      input.onfocus = () => open(); input.onclick = () => { if (!list.matches(":popover-open")) open(); }; input.oninput = () => open(true);
      input.onblur = event => { if (!combo.contains(event.relatedTarget)) close(); };
      list.addEventListener("toggle", () => { input.setAttribute("aria-expanded", String(list.matches(":popover-open"))); });
      const choose = option => { input.value = option.dataset.value; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); close(); };
      options.forEach(option => { option.onpointerdown = event => event.preventDefault(); option.onclick = event => { event.preventDefault(); choose(option); }; });
      combo.querySelector("[data-combo-clear]").onclick = event => { event.preventDefault(); input.value = ""; input.focus(); input.dispatchEvent(new Event("input", { bubbles: true })); };
      input.onkeydown = event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault(); if (!list.matches(":popover-open")) open();
          const visible = options.filter(option => !option.hidden); if (!visible.length) return;
          active = (active + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
          options.forEach(option => option.classList.remove("is-active")); visible[active].classList.add("is-active");
          input.setAttribute("aria-activedescendant", visible[active].id); visible[active].scrollIntoView({ block: "nearest" });
        } else if (event.key === "Enter" && list.matches(":popover-open") && active >= 0) {
          event.preventDefault(); choose(options.filter(option => !option.hidden)[active]);
        } else if (["Escape", "Tab"].includes(event.key)) { if (event.key === "Escape") event.preventDefault(); close(); }
      };
      window.addEventListener("resize", place, { signal: comboEvents.signal });
      window.addEventListener("scroll", place, { capture: true, signal: comboEvents.signal });
    });
  }
  function render() {
    dirty = false;
    root.innerHTML = `<div class="partner-shell student-shell">${shellSidebar()}<div class="partner-workspace">${shellHeader()}<main class="partner-content student-portal">
      ${previewStudentId ? '<p class="student-portal-staff-notice" role="status">Кабинет открыт от имени слушателя. Вы продолжаете работать как сотрудник; действия записываются в журнал под вашей учётной записью.</p>' : ""}
      <section class="partner-panel student-program-panel" aria-label="Выбор программы"><label>Программа обучения<select data-application aria-label="Программа обучения">${state.applications.map(row => `<option value="${esc(row.id)}" ${row.id === state.record.id ? "selected" : ""}>${esc(row.program)} · ${esc(row.status)}</option>`).join("")}</select></label></section>
      <div data-message role="alert" hidden></div><div data-progress role="status" hidden><progress aria-label="Выполняется операция"></progress><span></span></div>
      <section class="partner-panel student-section-panel">
      <aside class="student-portal-review" data-review-status="${esc(state.record.enrollmentReviewStatus || "Заполняется")}" aria-label="Результат проверки документов"><div><strong>Документы: ${esc(state.record.enrollmentReviewStatus || "Заполняется")}</strong><button type="button" data-review-refresh>Обновить статус</button></div>${state.record.enrollmentReviewComment ? `<p class="muted">${["Приняты", "На доработке"].includes(state.record.enrollmentReviewStatus) ? "Комментарий учебного центра" : "Предыдущий комментарий учебного центра"}${state.record.enrollmentReviewedAt ? ` · ${esc(new Date(state.record.enrollmentReviewedAt).toLocaleString("ru-RU"))}` : ""}</p><p class="student-portal-review-comment">${esc(state.record.enrollmentReviewComment)}</p>` : ""}${state.record.enrollmentReviewStatus === "На доработке" ? "<p>Исправьте замечания, сохраните данные и нажмите «Отправить на проверку» повторно.</p>" : ""}</aside>
      ${dashboard()}
      <section data-panel="main" ${tab !== "main" ? "hidden" : ""} aria-label="Личные данные"><h2>Личные данные</h2><div class="student-profile-photo">${state.photoAvailable ? `<img src="${esc(api.appUrl(url("/photo")))}&v=${Date.now()}" alt="Фото слушателя">` : '<span class="student-photo-placeholder">Фото не загружено</span>'}<label class="ghost-button">${state.photoAvailable ? "Заменить фотографию" : "Загрузить фотографию"}<input type="file" data-photo accept="image/jpeg,image/png" hidden></label><small>JPEG или PNG, до 16 МБ. Фото сохраняется в карточке слушателя.</small></div><p>Заполните обязательные поля, отмеченные *. Если не работаете, укажите «Не работаю».</p><form data-profile novalidate><div class="student-portal-fields">${state.fields.map(field).join("")}</div><button class="primary-button" type="submit">Сохранить данные</button></form></section>
      <section data-panel="documents" ${tab !== "documents" ? "hidden" : ""} aria-label="Документы для зачисления"><h2>Документы для зачисления</h2><p>PDF, JPEG или PNG, до 20 МБ на файл. Файлы сохраняются в Вашей папке на Яндекс Диске. При повторной загрузке используется новый файл этого вида. <a href="https://zifra-plus.ru/edu_info/" target="_blank" rel="noopener noreferrer">Перечень документов ↗</a></p>
      <ul class="student-portal-documents">${state.requirements.map(doc => { const file = state.documents.find(item => item.kind === doc.key); return `<li><div><strong>${esc(doc.label)}</strong><small>${doc.required ? "Обязательно" : "При необходимости"}</small>${file ? `<span>✓ Загружен · ${esc(new Date(file.uploadedAt).toLocaleString("ru-RU"))}</span>` : "<span>Файл не загружен</span>"}</div><div class="student-portal-file-actions">${file ? `<button type="button" data-view="${esc(file.id)}">Просмотр</button><button type="button" data-download="${esc(file.id)}">Скачать</button>` : ""}<label class="student-portal-upload">${file ? "Заменить файл" : "Прикрепить файл"}<input aria-label="${esc(doc.label)}" type="file" accept="application/pdf,image/jpeg,image/png" data-upload="${doc.key}"></label></div></li>`; }).join("")}</ul></section>
      <section data-panel="finances" ${tab !== "finances" ? "hidden" : ""}><h2>Оплата обучения</h2><dl class="student-portal-finances"><div><dt>Стоимость обучения по договору</dt><dd>${money(state.finances.total)}</dd></div><div><dt>Оплачено</dt><dd>${money(state.finances.paid)}</dd></div>${state.finances.debt > 0 ? `<div><dt>Остаток долга</dt><dd>${money(state.finances.debt)}</dd></div>` : '<div><dt>Задолженность</dt><dd>Нет</dd></div>'}${state.finances.overpaid > 0 ? `<div><dt>Переплата</dt><dd>${money(state.finances.overpaid)}</dd></div>` : ""}</dl>${financeActions()}<h3>Ваши оплаты</h3>${state.finances.payments.length ? `<table class="data-table"><thead><tr><th>Дата</th><th>Сумма</th></tr></thead><tbody>${state.finances.payments.map(payment => `<tr><td>${esc(payment.date ? new Date(payment.date).toLocaleDateString("ru-RU") : "Дата не указана")}</td><td>${money(payment.amount)}</td></tr>`).join("")}</tbody></table>` : '<p>Оплаты пока не отражены.</p>'}<p>Данные по выбранной заявке. Если платёж пока не отображается, обратитесь в учебный центр.</p></section>
      <section data-panel="awards" ${tab !== "awards" ? "hidden" : ""}><h2>Документ об образовании</h2><p>Макеты и сканы по всем Вашим программам обучения.</p><button type="button" data-awards-refresh>Обновить документы</button><div data-awards-list></div></section>
      ${feedbackPanel()}
      <footer data-enrollment-footer ${["finances", "feedback", "awards"].includes(tab) ? "hidden" : ""}><p data-submit-hint role="status"></p><button class="primary-button" type="button" data-submit>Отправить на проверку</button></footer></section></main><footer class="partner-footer">ООО «Цифровизация Плюс» · Кабинет слушателя</footer></div></div>`;
    bindCombos(); conditionalFields();
    root.querySelector("[data-profile]").addEventListener("input", () => { dirty = true; conditionalFields(); availability(); });
    root.querySelector("[data-profile]").addEventListener("submit", event => { event.preventDefault(); run("Сохранение данных…", async () => { state = await request("/profile", profile()); render(); message("Данные сохранены."); }); });
    const feedbackForm = root.querySelector("[data-feedback-form]");
    root.querySelector("[data-feedback-refresh]").onclick = () => loadHistory(true);
    root.querySelector("[data-feedback-new]").onclick = () => { feedbackDraft().threadId = ""; feedbackDraft().requestId = ""; root.querySelector("[data-feedback-thread]").hidden = true; };
    root.querySelector("[data-awards-refresh]").onclick = loadAwards;
    root.querySelector("[data-photo]").onchange = event => {
      const file = event.target.files[0]; if (!file) return;
      run("Сохранение фотографии…", async () => {
        if (file.size > 16 * 1024 * 1024) throw Error("Максимальный размер фотографии — 16 МБ.");
        if (dirty) await request("/profile", profile());
        state = await request("/photo", { base64: await fileBase64(file) }); render(); message("Фотография сохранена.");
      });
    };
    root.querySelector("[data-pay]")?.addEventListener("click", () => {
      if (busy) return;
      const popup = window.open("about:blank", "_blank"); if (popup) { popup.opener = null; popup.document.body.textContent = "Подготовка оплаты через ЮKassa…"; }
      run("Подготовка ссылки оплаты…", async () => {
        try {
          const result = await request("/payment", {});
          if (!result.url) { popup?.close(); message(result.message || "Оплата уже получена. Обновите статус."); return; }
          const link = root.querySelector("[data-payment-link]"); link.hidden = false;
          link.innerHTML = `<a href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">Перейти к оплате ${money(result.amount)}</a>`;
          if (popup) popup.location.replace(result.url);
        } catch (error) { popup?.close(); throw error; }
      });
    });
    root.querySelector("[data-payment-refresh]").onclick = () => run("Проверка подтверждённых оплат…", async () => {
      if (dirty) await request("/profile", profile());
      state = await request("/payment-status", {}); render(); message("Сведения об оплатах обновлены.");
    });
    feedbackForm.addEventListener("input", event => {
      if (!["subject", "message"].includes(event.target.name)) return;
      const draft = feedbackDraft();
      draft[event.target.name] = event.target.value; draft.requestId = ""; draft.status = ""; draft.error = ""; feedbackResult();
    });
    feedbackForm.addEventListener("submit", event => {
      event.preventDefault(); if (busy || !feedbackForm.reportValidity()) return;
      const draft = feedbackDraft();
      draft.requestId ||= feedbackRequestId(); draft.status = ""; draft.error = ""; feedbackResult();
      run("Отправка сообщения в учебный центр…", async () => {
        const label = root.querySelector("[data-feedback-send-label]"); label.textContent = "Отправка…";
        try {
          const result = await request("/feedback", { subject: draft.subject, message: draft.message, requestId: draft.requestId, threadId: draft.threadId || "", fromCenter: event.submitter?.name === "fromCenter" });
          draft.subject = ""; draft.message = ""; draft.requestId = ""; draft.status = result.message || "Сообщение отправлено в учебный центр.";
          feedbackForm.elements.subject.value = ""; feedbackForm.elements.message.value = "";
          draft.threadId = ""; root.querySelector("[data-feedback-thread]").hidden = true; await loadHistory();
        } catch (error) { draft.error = error.message || "Не удалось отправить сообщение. Повторите позже."; }
        finally { feedbackResult(); label.textContent = "Отправить сообщение"; }
      });
    });
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
    root.querySelector(".student-portal-review").hidden = ["feedback", "awards"].includes(tab);
    setSidebar(false, false); availability();
    if (tab === "feedback") { drawHistory(); loadHistory(); }
    if (tab === "awards") loadAwards();
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
  function fileBase64(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(Error("Не удалось прочитать файл.")); reader.readAsDataURL(file); });
  }
  async function openFile(id, preview, endpoint = "/file", applicationId = state.record.id, fileName = "", downloadLabel = "Скачать файл") {
    await run("Получение документа…", async () => {
      const response = await fetch(api.appUrl(`${url(endpoint, applicationId)}&file=${encodeURIComponent(id)}`), { credentials: "same-origin" });
      if (!response.ok) throw Error("Файл недоступен. Повторите позже.");
      const blob = await response.blob(), objectUrl = URL.createObjectURL(blob);
      let name = fileName || state.documents.find(file => file.id === id)?.name || "Документ";
      const dispositionName = response.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
      if (dispositionName) { try { name = decodeURIComponent(dispositionName); } catch {} }
      // Legacy DOCX layouts are served as PDF by the server.
      if (blob.type === "application/pdf") name = name.replace(/\.docx$/iu, ".pdf");
      name = name.replace(/[\\/\u0000-\u001f]/gu, "_");
      if (!preview) {
        const link = document.createElement("a"); link.href = objectUrl; link.download = name; link.hidden = true; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000); return;
      }
      const dialog = document.createElement("dialog"); dialog.className = "modal student-portal-preview";
      dialog.innerHTML = `<header class="modal-head"><strong>${esc(name)}</strong><button class="icon-button" type="button" aria-label="Закрыть просмотр">×</button></header>${blob.type.startsWith("image/") ? '<img alt="Загруженный документ">' : '<iframe title="Просмотр документа"></iframe>'}<footer class="modal-actions"><a class="primary-button student-award-download-button" download="${esc(name)}">${icon("download")}<span>${esc(downloadLabel)}</span></a></footer>`;
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
  setInterval(() => { if (state && tab === "feedback" && !busy && !document.hidden) loadHistory(true); }, 60000);
  window.addEventListener("beforeunload", event => {
    if (dirty || busy || [...feedbackDrafts.values()].some(draft => draft.subject.trim() || draft.message.trim())) { event.preventDefault(); event.returnValue = ""; }
  });
  root.innerHTML = '<main class="partner-boot"><div class="partner-brand-mark">Ц+</div><strong role="status">Загрузка кабинета слушателя…</strong><span class="auth-spinner"></span></main>';
  api.request(url("", new URLSearchParams(location.search).get("student-application") || undefined)).then(result => {
    state = result; render();
    if (new URLSearchParams(location.search).has("student-payment")) run("Проверка оплаты через ЮKassa…", async () => { state = await request("/payment-status", {}); render(); message(state.finances.debt > 0 ? "Подтверждение платежа ещё ожидается. Нажмите «Проверить оплату» чуть позже." : "Оплата подтверждена. Задолженности нет."); });
  }).catch(error => {
    root.innerHTML = `<main class="partner-boot"><div class="partner-brand-mark">Ц+</div><p role="alert">${esc(error.message)}</p><button class="partner-primary-button" type="button">Повторить</button></main>`;
    root.querySelector("button").onclick = () => location.reload();
  });
})();
