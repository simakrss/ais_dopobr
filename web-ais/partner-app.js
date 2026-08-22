(() => {
  "use strict";

  const app = document.getElementById("app");
  const authApi = window.AIS_AUTH_API;
  const authUser = window.AIS_AUTH_USER || {};
  const PROFILE_TAB_STORAGE_KEY = "ais-partner-profile-tabs-v1";
  const DOCUMENTS_VIEW_STORAGE_KEY = "ais-partner-documents-view-v1";
  const PROFILE_TABS = Object.freeze([
    { id: "main", label: "Основное" },
    { id: "contract", label: "Договор" },
    { id: "documents", label: "Документы" }
  ]);
  const NAV_ITEMS = Object.freeze([
    { id: "dashboard", label: "Рабочий стол", icon: "dashboard" },
    { id: "payments", label: "Реестр выплат", icon: "payments" },
    { id: "materials", label: "Материалы партнёра", icon: "folder" },
    { id: "profile", label: "Профиль", icon: "profile" },
    { id: "feedback", label: "Обратная связь", icon: "mail" }
  ]);

  const state = {
    loading: true,
    error: "",
    portal: null,
    view: "dashboard",
    sidebarOpen: false,
    paymentFilters: { q: "", status: "", source: "", from: "", to: "" },
    selectedMonth: "",
    paymentSort: { key: "effectiveDate", direction: "desc" },
    groupSort: { key: "month", direction: "desc" },
    materials: null,
    materialsLoading: false,
    materialsError: "",
    profileTab: "main",
    profileTabs: loadProfileTabOrder(),
    draggedProfileTab: "",
    profileDraft: {},
    profileSaving: false,
    profileStatus: "",
    profileError: "",
    documentsOpen: false,
    documentsPath: "",
    documentsData: null,
    documentsLoading: false,
    documentsError: "",
    documentsView: localStorage.getItem(DOCUMENTS_VIEW_STORAGE_KEY) === "table" ? "table" : "tiles",
    feedbackStatus: "",
    feedbackError: "",
    feedbackSending: false,
    feedbackDraft: { subject: "", message: "" }
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function icon(name, className = "") {
    const paths = {
      dashboard: '<path d="M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z"/>',
      payments: '<path d="M3 7h18M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 9h4m4 0h2M7 16h2"/>',
      folder: '<path d="M3 7.5h7l2 2h9v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Zm0 0V6a2 2 0 0 1 2-2h5l2 2h5"/>',
      profile: '<path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/>',
      mail: '<path d="M3 6h18v12H3V6Zm0 1 9 7 9-7"/>',
      logout: '<path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5m5-4 4-4-4-4m4 4H9"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
      download: '<path d="M12 3v12m-5-5 5 5 5-5M5 20h14"/>',
      external: '<path d="M14 4h6v6m0-6-9 9M19 13v6H5V5h6"/>',
      file: '<path d="M6 3h8l4 4v14H6V3Zm8 0v5h5"/>',
      chevron: '<path d="m9 6 6 6-6 6"/>',
      chart: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V3"/>',
      filter: '<path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/>',
      refresh: '<path d="M20 7v5h-5M4 17v-5h5m10-2a8 8 0 0 0-14-3l-1 2m1 5a8 8 0 0 0 14 3l1-2"/>',
      tiles: '<path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z"/>',
      table: '<path d="M4 5h16v14H4V5Zm0 5h16M9 5v14"/>'
    };
    return `<svg class="partner-icon ${escapeAttr(className)}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  }

  function formatMoney(value) {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
  }

  function formatDate(value) {
    const source = String(value || "").slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(source);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : source || "—";
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value || "—")
      : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function formatFileSize(value) {
    let size = Math.max(0, Number(value) || 0);
    const units = ["Б", "КБ", "МБ", "ГБ"];
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: unit ? 1 : 0 }).format(size)} ${units[unit]}`;
  }

  function loadProfileTabOrder() {
    try {
      const saved = JSON.parse(localStorage.getItem(PROFILE_TAB_STORAGE_KEY) || "[]");
      const ids = PROFILE_TABS.map((tab) => tab.id);
      return [...saved.filter((id) => ids.includes(id)), ...ids.filter((id) => !saved.includes(id))];
    } catch {
      return PROFILE_TABS.map((tab) => tab.id);
    }
  }

  function saveProfileTabOrder() {
    localStorage.setItem(PROFILE_TAB_STORAGE_KEY, JSON.stringify(state.profileTabs));
  }

  function parseRoute() {
    const hash = String(window.location.hash || "").replace(/^#\/?/u, "");
    const [path, query = ""] = hash.split("?");
    const view = path.replace(/^partner\/?/u, "") || "dashboard";
    state.view = NAV_ITEMS.some((item) => item.id === view) ? view : "dashboard";
    const params = new URLSearchParams(query);
    if (state.view === "payments" && params.has("status")) {
      state.paymentFilters.status = params.get("status") || "";
    }
  }

  function navigate(view, options = {}) {
    if (!NAV_ITEMS.some((item) => item.id === view)) return;
    state.view = view;
    state.sidebarOpen = false;
    if (view === "payments" && Object.prototype.hasOwnProperty.call(options, "status")) {
      state.paymentFilters.status = options.status || "";
    }
    const params = new URLSearchParams();
    if (view === "payments" && state.paymentFilters.status) params.set("status", state.paymentFilters.status);
    const suffix = params.toString() ? `?${params}` : "";
    window.history.pushState({}, "", `#partner/${view}${suffix}`);
    render();
    if (view === "materials" && !state.materials) loadMaterials("/");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderSidebar() {
    const profile = state.portal?.profile || {};
    const initials = String(profile.name || authUser.name || "П")
      .split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("ru-RU");
    return `
      <aside class="partner-sidebar ${state.sidebarOpen ? "is-open" : ""}" aria-label="Навигация кабинета партнёра">
        <div class="partner-brand">
          <div class="partner-brand-mark">Ц+</div>
          <div><strong>Цифровизация Плюс</strong><span>Кабинет партнёра</span></div>
          <button class="partner-sidebar-close" data-action="toggle-sidebar" type="button" aria-label="Закрыть меню">${icon("close")}</button>
        </div>
        <nav class="partner-nav">
          ${NAV_ITEMS.map((item) => `
            <button class="partner-nav-item ${state.view === item.id ? "is-active" : ""}" data-view="${item.id}" type="button">
              ${icon(item.icon)}<span>${escapeHtml(item.label)}</span>
            </button>
          `).join("")}
        </nav>
        <div class="partner-sidebar-user">
          <span class="partner-avatar">${escapeHtml(initials || "П")}</span>
          <div><strong>${escapeHtml(profile.name || authUser.name || "Партнёр")}</strong><small>${escapeHtml(authUser.login || "")}</small></div>
          <button data-action="logout" type="button" title="Выйти" aria-label="Выйти">${icon("logout")}</button>
        </div>
      </aside>
      <button class="partner-sidebar-backdrop ${state.sidebarOpen ? "is-visible" : ""}" data-action="toggle-sidebar" type="button" aria-label="Закрыть меню"></button>
    `;
  }

  function renderHeader() {
    const active = NAV_ITEMS.find((item) => item.id === state.view) || NAV_ITEMS[0];
    return `
      <header class="partner-topbar">
        <button class="partner-menu-button" data-action="toggle-sidebar" type="button" aria-label="Открыть меню">${icon("menu")}</button>
        <div><span>Кабинет партнёра</span><h1>${escapeHtml(active.label)}</h1></div>
        <button class="partner-topbar-profile" data-view="profile" type="button">
          ${icon("profile")}<span>${escapeHtml(state.portal?.profile?.name || authUser.name || "Партнёр")}</span>
        </button>
      </header>
    `;
  }

  function renderDashboard() {
    const payments = state.portal.payments || {};
    const summary = payments.summary || {};
    const monthly = Array.isArray(payments.monthly) ? payments.monthly : [];
    const maxAmount = Math.max(1, ...monthly.map((item) => Number(item.amount) || 0));
    const payableRows = (payments.rows || []).filter((row) => row.statusKey === "payable" && Number(row.amount) > 0);
    return `
      <section class="partner-page-heading">
        <div><p>Здравствуйте, ${escapeHtml(firstName(state.portal.profile?.name))}!</p><h2>Ваши начисления и выплаты</h2></div>
        <span>Данные обновляются из реестров АИС</span>
      </section>
      <section class="partner-kpi-grid">
        <button class="partner-kpi-card is-primary" data-action="open-payable" type="button">
          <span>Текущая сумма к выплате</span>
          <strong>${formatMoney(summary.currentPayable)}</strong>
          <small>${payableRows.length ? `${payableRows.length} ${plural(payableRows.length, "начисление", "начисления", "начислений")}` : "Начислений к выплате нет"}</small>
          <i>${icon("arrow")}</i>
        </button>
        <article class="partner-kpi-card">
          <span>Выплачено за всё время</span><strong>${formatMoney(summary.totalPaid)}</strong><small>По данным реестра выплат</small>
        </article>
        <article class="partner-kpi-card">
          <span>Последняя выплата</span><strong class="is-date">${formatDate(summary.lastPaymentDate)}</strong><small>${summary.lastPaymentDate ? "Дата последней выплаты" : "Выплат пока нет"}</small>
        </article>
        <article class="partner-kpi-card">
          <span>Записей в реестре</span><strong>${Number(summary.paymentRows) || 0}</strong><small>Начисления и выплаты</small>
        </article>
      </section>
      <section class="partner-panel partner-chart-panel">
        <header class="partner-panel-head"><div>${icon("chart")}<span><h3>Выплаты по месяцам</h3><p>От последней выплаты к более ранним</p></span></div><button data-view="payments" type="button">Открыть реестр ${icon("arrow")}</button></header>
        ${monthly.length ? `
          <div class="partner-month-chart">
            ${monthly.map((item) => `
              <button data-action="open-month" data-month="${escapeAttr(item.month)}" type="button">
                <span>${escapeHtml(item.label)}</span>
                <i><b style="width:${Math.max(3, Math.round((Number(item.amount) / maxAmount) * 100))}%"></b></i>
                <strong>${formatMoney(item.amount)}</strong>
              </button>
            `).join("")}
          </div>
        ` : renderEmpty("Выплат по месяцам пока нет.")}
      </section>
      <section class="partner-panel">
        <header class="partner-panel-head"><div>${icon("payments")}<span><h3>К выплате</h3><p>Начисления, готовые к оплате</p></span></div></header>
        ${payableRows.length ? renderCompactPayments(payableRows.slice(0, 6)) : renderEmpty("Сейчас нет начислений со статусом «К выплате».")}
      </section>
    `;
  }

  function firstName(fullName) {
    const parts = String(fullName || "").trim().split(/\s+/u);
    return parts[1] || parts[0] || "партнёр";
  }

  function plural(number, one, few, many) {
    const value = Math.abs(number) % 100;
    const last = value % 10;
    if (value > 10 && value < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  function renderEmpty(message) {
    return `<div class="partner-empty">${icon("file")}<p>${escapeHtml(message)}</p></div>`;
  }

  function renderCompactPayments(rows) {
    return `<div class="partner-compact-list">${rows.map((row) => `
      <button data-action="open-payment-row" data-month="${escapeAttr(row.monthKey)}" type="button">
        <span><strong>${escapeHtml(row.description)}</strong><small>${formatDate(row.effectiveDate)} · ${escapeHtml(row.source)}</small></span>
        <b>${formatMoney(row.amount)}</b>${icon("chevron")}
      </button>
    `).join("")}</div>`;
  }

  function getFilteredPayments() {
    const filters = state.paymentFilters;
    const query = filters.q.trim().toLocaleLowerCase("ru-RU");
    const rows = (state.portal?.payments?.rows || []).filter((row) => {
      if (filters.status && row.statusKey !== filters.status) return false;
      if (filters.source && row.source !== filters.source) return false;
      if (filters.from && String(row.effectiveDate || "") < filters.from) return false;
      if (filters.to && String(row.effectiveDate || "") > filters.to) return false;
      if (query && ![row.source, row.description, row.comment, row.status, row.amount]
        .join(" ").toLocaleLowerCase("ru-RU").includes(query)) return false;
      return true;
    });
    return sortRows(rows, state.paymentSort);
  }

  function sortRows(rows, sort) {
    const multiplier = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = left?.[sort.key];
      const b = right?.[sort.key];
      if (sort.key === "amount") return ((Number(a) || 0) - (Number(b) || 0)) * multiplier;
      return String(a || "").localeCompare(String(b || ""), "ru", { numeric: true, sensitivity: "base" }) * multiplier;
    });
  }

  function groupPayments(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const key = row.monthKey || "undated";
      const group = map.get(key) || { month: key, label: monthLabel(key), count: 0, total: 0, payable: 0, paid: 0 };
      group.count += 1;
      group.total += Number(row.amount) || 0;
      if (row.statusKey === "payable" && Number(row.amount) > 0) group.payable += Number(row.amount);
      if (row.statusKey === "paid" && Number(row.amount) > 0) group.paid += Number(row.amount);
      map.set(key, group);
    });
    return sortRows([...map.values()], state.groupSort);
  }

  function monthLabel(key) {
    if (!/^\d{4}-\d{2}$/u.test(String(key || ""))) return "Без даты";
    const [year, month] = key.split("-").map(Number);
    const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
    return label.replace(/^./u, (letter) => letter.toLocaleUpperCase("ru-RU"));
  }

  function sortButton(key, label, type = "payment") {
    const sort = type === "group" ? state.groupSort : state.paymentSort;
    const marker = sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
    return `<button data-action="sort-${type}" data-key="${escapeAttr(key)}" type="button">${escapeHtml(label)}${marker}</button>`;
  }

  function renderPayments() {
    const allRows = state.portal.payments?.rows || [];
    const rows = getFilteredPayments();
    const groups = groupPayments(rows);
    const sources = [...new Set(allRows.map((row) => row.source).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
    if (!state.selectedMonth || !groups.some((group) => group.month === state.selectedMonth)) {
      state.selectedMonth = groups[0]?.month || "";
    }
    const details = rows.filter((row) => row.monthKey === state.selectedMonth);
    const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return `
      <section class="partner-page-heading"><div><p>Финансовые данные</p><h2>Реестр выплат</h2></div><span>${rows.length} из ${allRows.length} записей · ${formatMoney(total)}</span></section>
      <section class="partner-panel partner-filter-panel">
        <div class="partner-filter-heading">${icon("filter")}<strong>Фильтры</strong></div>
        <div class="partner-filters">
          <label class="is-wide"><span>Поиск</span><input data-filter="q" type="search" value="${escapeAttr(state.paymentFilters.q)}" placeholder="Описание, источник, комментарий"></label>
          <label><span>Статус</span><select data-filter="status"><option value="">Все статусы</option>${paymentStatusOptions()}</select></label>
          <label><span>Источник</span><select data-filter="source"><option value="">Все источники</option>${sources.map((source) => `<option value="${escapeAttr(source)}" ${state.paymentFilters.source === source ? "selected" : ""}>${escapeHtml(source)}</option>`).join("")}</select></label>
          <label><span>Дата с</span><input data-filter="from" type="date" value="${escapeAttr(state.paymentFilters.from)}"></label>
          <label><span>Дата по</span><input data-filter="to" type="date" value="${escapeAttr(state.paymentFilters.to)}"></label>
          <div class="partner-filter-actions"><button class="partner-secondary-button" data-action="reset-payment-filters" type="button">Сбросить</button><button class="partner-primary-button" data-action="export-payments" type="button">${icon("download")}Экспорт CSV</button></div>
        </div>
      </section>
      <section class="partner-panel">
        <header class="partner-panel-head"><div>${icon("payments")}<span><h3>Выплаты по месяцам</h3><p>Выберите месяц для детализации</p></span></div></header>
        ${groups.length ? `<div class="partner-table-wrap"><table class="partner-table partner-month-table"><thead><tr><th>${sortButton("month", "Месяц", "group")}</th><th>${sortButton("count", "Записей", "group")}</th><th>${sortButton("paid", "Оплачено", "group")}</th><th>${sortButton("payable", "К выплате", "group")}</th><th>${sortButton("total", "Всего", "group")}</th></tr></thead><tbody>${groups.map((group) => `<tr class="${state.selectedMonth === group.month ? "is-selected" : ""}" data-action="select-payment-month" data-month="${escapeAttr(group.month)}" tabindex="0"><td><strong>${escapeHtml(group.label)}</strong></td><td>${group.count}</td><td>${formatMoney(group.paid)}</td><td>${formatMoney(group.payable)}</td><td><strong>${formatMoney(group.total)}</strong></td></tr>`).join("")}</tbody></table></div>` : renderEmpty("По выбранным фильтрам выплат не найдено.")}
      </section>
      ${groups.length ? `
        <section class="partner-panel">
          <header class="partner-panel-head"><div>${icon("file")}<span><h3>${escapeHtml(monthLabel(state.selectedMonth))}</h3><p>Детализация начислений и выплат</p></span></div><strong>${details.length} ${plural(details.length, "запись", "записи", "записей")}</strong></header>
          <div class="partner-table-wrap"><table class="partner-table partner-detail-table"><thead><tr><th>${sortButton("effectiveDate", "Дата")}</th><th>${sortButton("source", "Источник")}</th><th>${sortButton("description", "Назначение")}</th><th>Комментарий</th><th>${sortButton("status", "Статус")}</th><th>${sortButton("amount", "Сумма")}</th></tr></thead><tbody>${details.map((row) => `<tr><td>${formatDate(row.effectiveDate)}</td><td>${escapeHtml(row.source)}</td><td><strong>${escapeHtml(row.description)}</strong></td><td>${escapeHtml(row.comment || "—")}</td><td><span class="partner-status is-${escapeAttr(row.statusKey)}">${escapeHtml(row.status)}</span></td><td class="is-money">${formatMoney(row.amount)}</td></tr>`).join("")}</tbody></table></div>
        </section>
      ` : ""}
    `;
  }

  function paymentStatusOptions() {
    const labels = new Map((state.portal.payments?.rows || []).map((row) => [row.statusKey, row.status]));
    return [...labels].map(([key, label]) => `<option value="${escapeAttr(key)}" ${state.paymentFilters.status === key ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  }

  function renderMaterials() {
    const folder = state.materials;
    const items = folder?.items || [];
    return `
      <section class="partner-page-heading"><div><p>Рекламные материалы</p><h2>Материалы партнёра</h2></div><a class="partner-secondary-button" href="${escapeAttr(state.portal.materials?.publicUrl || "#")}" target="_blank" rel="noopener noreferrer">${icon("external")}Открыть на Яндекс‑Диске</a></section>
      <section class="partner-panel partner-materials-panel">
        <header class="partner-materials-toolbar">
          <nav class="partner-breadcrumbs" aria-label="Путь в материалах">${renderMaterialBreadcrumbs(folder?.path || "/")}</nav>
          <button data-action="refresh-materials" type="button" title="Обновить список">${icon("refresh")}</button>
        </header>
        ${state.materialsLoading ? `<div class="partner-loading-inline"><span class="auth-spinner"></span>Загрузка папки...</div>` : state.materialsError ? `<div class="partner-error-panel"><p>${escapeHtml(state.materialsError)}</p><button class="partner-secondary-button" data-action="refresh-materials" type="button">Повторить</button></div>` : items.length ? `<div class="partner-file-grid">${items.map(renderMaterialItem).join("")}</div>` : renderEmpty("В этой папке пока нет материалов.")}
      </section>
    `;
  }

  function renderMaterialBreadcrumbs(path) {
    const parts = String(path || "/").split("/").filter(Boolean);
    const crumbs = [{ label: "Материалы", path: "/" }];
    parts.forEach((part, index) => crumbs.push({ label: part, path: `/${parts.slice(0, index + 1).join("/")}` }));
    return crumbs.map((crumb, index) => `${index ? icon("chevron") : ""}<button data-action="open-material-folder" data-path="${escapeAttr(crumb.path)}" type="button" ${index === crumbs.length - 1 ? "disabled" : ""}>${escapeHtml(crumb.label)}</button>`).join("");
  }

  function renderMaterialItem(item) {
    const isFolder = item.type === "dir";
    const action = isFolder
      ? `button data-action="open-material-folder" data-path="${escapeAttr(item.path)}" type="button"`
      : `a href="${escapeAttr(item.downloadUrl || item.previewUrl || state.portal.materials?.publicUrl || "#")}" target="_blank" rel="noopener noreferrer"`;
    return `<${action} class="partner-file-card ${isFolder ? "is-folder" : "is-file"}"><span class="partner-file-icon">${icon(isFolder ? "folder" : "file")}</span><span><strong>${escapeHtml(item.name)}</strong><small>${isFolder ? "Папка" : [formatFileSize(item.size), formatDateTime(item.modified)].filter(Boolean).join(" · ")}</small></span>${icon(isFolder ? "chevron" : "download")}</${isFolder ? "button" : "a"}>`;
  }

  function renderProfile() {
    const profile = state.portal.profile || {};
    const tabsById = new Map(PROFILE_TABS.map((tab) => [tab.id, tab]));
    const activeFields = profile.tabs?.[state.profileTab] || [];
    return `
      <section class="partner-page-heading"><div><p>Личные данные</p><h2>${escapeHtml(profile.name || "Профиль")}</h2></div><button class="partner-secondary-button" data-action="open-documents" type="button">${icon("folder")}Документы на Яндекс‑Диске</button></section>
      <section class="partner-profile-layout">
        <aside class="partner-profile-summary partner-panel">
          ${profile.photoAvailable ? `<img src="${escapeAttr(authApi.appUrl("api/partner/photo"))}" alt="Фотография ${escapeAttr(profile.name)}">` : `<div class="partner-profile-placeholder">${icon("profile")}</div>`}
          <h3>${escapeHtml(profile.name)}</h3><p>Партнёр Цифровизации Плюс</p>
        </aside>
        <section class="partner-panel partner-profile-card">
          <div class="partner-profile-tabs" role="tablist" aria-label="Разделы профиля" title="Вкладки можно менять местами. Щёлкните правой кнопкой, чтобы восстановить исходный порядок.">
            ${state.profileTabs.map((id) => { const tab = tabsById.get(id); return `<button class="${state.profileTab === id ? "is-active" : ""}" data-profile-tab="${id}" draggable="true" role="tab" aria-selected="${state.profileTab === id}">${escapeHtml(tab.label)}</button>`; }).join("")}
          </div>
          <form data-profile-form>
            <div class="partner-profile-fields">${activeFields.map(renderProfileField).join("") || renderEmpty("Данные этого раздела не заполнены.")}</div>
            <div class="partner-profile-actions">
              <span>${profile.contractNo ? `Договор № ${escapeHtml(profile.contractNo)}` : "Договор не указан"}</span>
              ${state.profileError ? `<p class="partner-form-message is-error">${escapeHtml(state.profileError)}</p>` : ""}
              ${state.profileStatus ? `<p class="partner-form-message is-success">${escapeHtml(state.profileStatus)}</p>` : ""}
              <button class="partner-primary-button" type="submit" ${state.profileSaving ? "disabled" : ""}>${state.profileSaving ? "Сохранение..." : "Сохранить изменения"}</button>
            </div>
          </form>
        </section>
      </section>
      ${state.documentsOpen ? renderDocumentsModal() : ""}
    `;
  }

  function renderProfileField(field) {
    let value = Object.prototype.hasOwnProperty.call(state.profileDraft, field.key)
      ? state.profileDraft[field.key] : field.value;
    if (field.editable) {
      if (field.kind === "boolean") {
        return `<label class="partner-profile-field is-checkbox"><span>${escapeHtml(field.label)}</span><input data-profile-field="${escapeAttr(field.key)}" type="checkbox" ${value ? "checked" : ""}></label>`;
      }
      const type = { date: "date", email: "email", phone: "tel", password: "password" }[field.kind] || "text";
      const placeholder = field.kind === "password" ? "Оставьте пустым, чтобы не менять" : "";
      const control = field.kind === "multiline"
        ? `<textarea data-profile-field="${escapeAttr(field.key)}" rows="3">${escapeHtml(value)}</textarea>`
        : `<input data-profile-field="${escapeAttr(field.key)}" type="${type}" value="${field.kind === "password" ? "" : escapeAttr(value)}" placeholder="${placeholder}">`;
      return `<label class="partner-profile-field ${field.kind === "multiline" ? "is-wide" : ""}"><span>${escapeHtml(field.label)}</span>${control}</label>`;
    }
    if (field.kind === "boolean") value = value ? "Да" : "Нет";
    if (field.kind === "date") value = formatDate(value);
    const empty = value === "" || value === null || value === undefined;
    const content = empty ? "Не указано" : String(value);
    const display = field.kind === "email" && !empty
      ? `<a href="mailto:${escapeAttr(content)}">${escapeHtml(content)}</a>`
      : field.kind === "phone" && !empty
        ? `<a href="tel:${escapeAttr(content.replace(/[^+\d]/gu, ""))}">${escapeHtml(content)}</a>`
        : escapeHtml(content).replaceAll("\n", "<br>");
    return `<div class="partner-profile-field ${field.kind === "multiline" ? "is-wide" : ""} ${empty ? "is-empty" : ""}"><span>${escapeHtml(field.label)}</span><strong>${display}</strong></div>`;
  }

  function renderDocumentsModal() {
    const data = state.documentsData;
    const parts = String(data?.path || "").split("/").filter(Boolean);
    const crumbs = [{ label: "Документы", path: "" }, ...parts.map((part, index) => ({
      label: part, path: parts.slice(0, index + 1).join("/")
    }))];
    return `<div class="student-webdav-browser-backdrop partner-modal-backdrop" data-documents-backdrop><section class="student-webdav-browser-dialog partner-documents-modal" role="dialog" aria-modal="true" aria-label="Документы партнёра">
      <header class="student-webdav-browser-head"><div><h2>Документы партнёра</h2><p>Облачная папка на Яндекс‑Диске</p></div><button class="icon-button" data-action="close-documents" type="button" title="Закрыть" aria-label="Закрыть">×</button></header>
      <div class="student-webdav-browser-toolbar partner-documents-toolbar">
        <nav class="student-webdav-browser-path">${crumbs.map((crumb, index) => `<button data-action="open-document-folder" data-path="${escapeAttr(crumb.path)}" type="button" ${index === crumbs.length - 1 ? 'aria-current="page" disabled' : ""}>${escapeHtml(crumb.label)}</button>`).join("")}</nav>
        <div class="partner-documents-view-switch" role="group" aria-label="Режим отображения">
          <button class="icon-button ${state.documentsView === "tiles" ? "is-active" : ""}" data-action="set-documents-view" data-view-mode="tiles" type="button" title="Плитка" aria-label="Плитка" aria-pressed="${state.documentsView === "tiles"}">${icon("tiles")}</button>
          <button class="icon-button ${state.documentsView === "table" ? "is-active" : ""}" data-action="set-documents-view" data-view-mode="table" type="button" title="Таблица" aria-label="Таблица" aria-pressed="${state.documentsView === "table"}">${icon("table")}</button>
        </div>
        <button class="ghost-button" data-action="refresh-documents" type="button">Обновить</button>
      </div>
      <div class="student-webdav-browser-workspace partner-documents-workspace"><section class="student-webdav-browser-files partner-documents-body">${state.documentsLoading ? `<div class="partner-loading-inline"><span class="auth-spinner"></span>Загрузка папки...</div>` : state.documentsError ? `<div class="student-webdav-browser-empty is-error">${escapeHtml(state.documentsError)}</div>` : data?.entries?.length ? renderPartnerDocumentEntries(data.entries) : `<div class="student-webdav-browser-empty">В папке пока нет документов.</div>`}</section></div>
    </section></div>`;
  }

  function partnerDocumentType(item) {
    if (item.isDirectory) return "Папка";
    const name = String(item.name || "");
    const extension = name.includes(".") ? name.split(".").pop() : "";
    return extension ? extension.toLocaleUpperCase("ru-RU") : "Файл";
  }

  function partnerDocumentUrl(item, download = false) {
    const params = new URLSearchParams({ path: item.path });
    if (download) params.set("download", "1");
    return authApi.appUrl(`api/partner/documents/file?${params}`);
  }

  function renderPartnerDocumentEntries(entries) {
    if (state.documentsView === "table") {
      return `<div class="partner-documents-table-wrap"><table class="partner-documents-table"><thead><tr><th>Название</th><th>Тип</th><th>Размер</th><th>Изменён</th><th></th></tr></thead><tbody>${entries.map((item) => `<tr class="${item.isDirectory ? "is-directory" : "is-file"}"><td>${item.isDirectory
        ? `<button class="partner-document-name" data-action="open-document-folder" data-path="${escapeAttr(item.path)}" type="button">${icon("folder")}<strong>${escapeHtml(item.name)}</strong></button>`
        : `<a class="partner-document-name" href="${escapeAttr(partnerDocumentUrl(item))}" target="_blank" rel="noopener">${icon("file")}<strong>${escapeHtml(item.name)}</strong></a>`}</td><td>${escapeHtml(partnerDocumentType(item))}</td><td>${item.isDirectory ? "—" : escapeHtml(formatFileSize(item.size))}</td><td>${escapeHtml(formatDateTime(item.modifiedAt))}</td><td>${item.isDirectory ? icon("chevron") : `<a class="icon-button" href="${escapeAttr(partnerDocumentUrl(item, true))}" title="Скачать" aria-label="Скачать">${icon("download")}</a>`}</td></tr>`).join("")}</tbody></table></div>`;
    }
    return `<div class="partner-file-grid partner-documents-tiles">${entries.map((item) => item.isDirectory
      ? `<button class="partner-file-card is-folder" data-action="open-document-folder" data-path="${escapeAttr(item.path)}" type="button"><span class="partner-file-icon">${icon("folder")}</span><span><strong>${escapeHtml(item.name)}</strong><small>Папка</small></span>${icon("chevron")}</button>`
      : `<a class="partner-file-card is-file" href="${escapeAttr(partnerDocumentUrl(item))}" target="_blank" rel="noopener"><span class="partner-file-icon">${icon("file")}</span><span><strong>${escapeHtml(item.name)}</strong><small>${formatFileSize(item.size)} · ${formatDateTime(item.modifiedAt)}</small></span>${icon("external")}</a>`).join("")}</div>`;
  }

  function renderFeedback() {
    return `
      <section class="partner-page-heading"><div><p>Связь с учебным центром</p><h2>Обратная связь</h2></div><span>Ответ поступит на email из вашего профиля</span></section>
      <section class="partner-feedback-layout">
        <article class="partner-panel partner-feedback-info">${icon("mail")}<h3>Напишите нам</h3><p>Задайте вопрос по начислениям, договору или материалам партнёрской программы.</p><dl><dt>Получатель</dt><dd>${escapeHtml(state.portal.feedbackRecipient || "mail@zifra-plus.ru")}</dd><dt>Ваш email</dt><dd>${escapeHtml(authUser.email || state.portal.profile?.tabs?.main?.find((field) => field.key === "email")?.value || "не указан")}</dd></dl></article>
        <form class="partner-panel partner-feedback-form" data-feedback-form>
          <label><span>Тема</span><input name="subject" type="text" maxlength="180" required value="${escapeAttr(state.feedbackDraft.subject)}" placeholder="Кратко опишите вопрос"></label>
          <label><span>Сообщение</span><textarea name="message" rows="9" minlength="10" maxlength="10000" required placeholder="Введите сообщение">${escapeHtml(state.feedbackDraft.message)}</textarea></label>
          ${state.feedbackError ? `<p class="partner-form-message is-error" role="alert">${escapeHtml(state.feedbackError)}</p>` : ""}
          ${state.feedbackStatus ? `<p class="partner-form-message is-success" role="status">${escapeHtml(state.feedbackStatus)}</p>` : ""}
          <button class="partner-primary-button" type="submit" ${state.feedbackSending ? "disabled" : ""}>${icon("mail")}${state.feedbackSending ? "Отправка..." : "Отправить сообщение"}</button>
        </form>
      </section>
    `;
  }

  function renderMainView() {
    if (state.view === "payments") return renderPayments();
    if (state.view === "materials") return renderMaterials();
    if (state.view === "profile") return renderProfile();
    if (state.view === "feedback") return renderFeedback();
    return renderDashboard();
  }

  function render() {
    document.body.classList.add("partner-portal-body");
    if (state.loading) {
      app.innerHTML = `<main class="partner-boot"><div class="partner-brand-mark">Ц+</div><strong>Загрузка кабинета партнёра</strong><span class="auth-spinner"></span></main>`;
      return;
    }
    if (state.error) {
      app.innerHTML = `<main class="partner-boot"><div class="partner-error-panel"><h1>Не удалось открыть кабинет</h1><p>${escapeHtml(state.error)}</p><button class="partner-primary-button" data-action="reload-portal" type="button">Повторить</button></div></main>`;
      return;
    }
    app.innerHTML = `<div class="partner-shell">${renderSidebar()}<div class="partner-workspace">${renderHeader()}<main class="partner-content">${renderMainView()}</main><footer class="partner-footer">ООО «Цифровизация Плюс» · Кабинет партнёра</footer></div></div>`;
  }

  async function loadPortal() {
    state.loading = true;
    state.error = "";
    render();
    try {
      state.portal = await authApi.request("api/partner/portal");
      state.profileDraft = {};
      state.loading = false;
      document.title = "Кабинет партнёра · Цифровизация Плюс";
      render();
      if (state.view === "materials") loadMaterials("/");
    } catch (error) {
      state.loading = false;
      state.error = error.message;
      render();
    }
  }

  async function loadMaterials(path) {
    state.materialsLoading = true;
    state.materialsError = "";
    render();
    try {
      state.materials = await authApi.request(`api/partner/materials?path=${encodeURIComponent(path || "/")}`);
    } catch (error) {
      state.materialsError = error.message;
    } finally {
      state.materialsLoading = false;
      render();
    }
  }

  async function loadDocuments(path = "") {
    state.documentsOpen = true;
    state.documentsLoading = true;
    state.documentsError = "";
    render();
    try {
      state.documentsData = await authApi.request("api/partner/documents/list", {
        method: "POST", body: JSON.stringify({ path })
      });
      state.documentsPath = state.documentsData.path || "";
    } catch (error) {
      state.documentsError = error.message;
    } finally {
      state.documentsLoading = false;
      render();
    }
  }

  function updateFilter(element) {
    const key = element.dataset.filter;
    if (!key) return;
    state.paymentFilters[key] = element.value;
    state.selectedMonth = "";
    const params = new URLSearchParams();
    if (state.paymentFilters.status) params.set("status", state.paymentFilters.status);
    window.history.replaceState({}, "", `#partner/payments${params.toString() ? `?${params}` : ""}`);
    render();
    const replacement = app.querySelector(`[data-filter="${CSS.escape(key)}"]`);
    if (replacement && key === "q") {
      replacement.focus({ preventScroll: true });
      replacement.setSelectionRange(replacement.value.length, replacement.value.length);
    }
  }

  function exportPayments() {
    const rows = getFilteredPayments();
    const columns = [
      ["effectiveDate", "Дата"], ["source", "Источник"], ["description", "Назначение"],
      ["comment", "Комментарий"], ["status", "Статус"], ["amount", "Сумма"]
    ];
    const csvCell = (value) => {
      const source = String(value ?? "");
      const safe = /^[=+@-]/u.test(source) ? `'${source}` : source;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const lines = [columns.map(([, label]) => csvCell(label)).join(";")];
    rows.forEach((row) => lines.push(columns.map(([key]) => csvCell(key === "effectiveDate" ? formatDate(row[key]) : row[key])).join(";")));
    const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Реестр_выплат_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function changeSort(type, key) {
    const sort = type === "group" ? state.groupSort : state.paymentSort;
    sort.direction = sort.key === key && sort.direction === "desc" ? "asc" : "desc";
    sort.key = key;
    render();
  }

  async function logout() {
    try { await authApi.request("api/auth/logout", { method: "POST" }); } catch { /* reload clears the view */ }
    if (authApi.redirectToLogin) authApi.redirectToLogin();
    else window.location.replace(authApi.appUrl(""));
  }

  function showProfileTabMenu(x, y) {
    document.querySelector(".partner-tab-context-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "partner-tab-context-menu";
    menu.style.left = `${Math.min(x, window.innerWidth - 250)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 60)}px`;
    menu.innerHTML = '<button data-action="restore-profile-tabs" type="button">Восстановить исходный порядок</button>';
    document.body.append(menu);
  }

  app.addEventListener("click", (event) => {
    if (event.target.matches("[data-documents-backdrop]")) {
      state.documentsOpen = false;
      render();
      return;
    }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      navigate(viewButton.dataset.view);
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "toggle-sidebar") { state.sidebarOpen = !state.sidebarOpen; render(); }
    if (action === "logout") logout();
    if (action === "reload-portal") loadPortal();
    if (action === "open-payable") navigate("payments", { status: "payable" });
    if (["open-month", "open-payment-row"].includes(action)) { state.selectedMonth = button.dataset.month || ""; navigate("payments"); }
    if (action === "select-payment-month") { state.selectedMonth = button.dataset.month || ""; render(); }
    if (action === "reset-payment-filters") { state.paymentFilters = { q: "", status: "", source: "", from: "", to: "" }; state.selectedMonth = ""; render(); }
    if (action === "export-payments") exportPayments();
    if (action === "sort-payment") changeSort("payment", button.dataset.key);
    if (action === "sort-group") changeSort("group", button.dataset.key);
    if (action === "open-material-folder") loadMaterials(button.dataset.path || "/");
    if (action === "refresh-materials") loadMaterials(state.materials?.path || "/");
    if (action === "open-documents") loadDocuments("");
    if (action === "open-document-folder") loadDocuments(button.dataset.path || "");
    if (action === "refresh-documents") loadDocuments(state.documentsData?.path || "");
    if (action === "set-documents-view") {
      state.documentsView = button.dataset.viewMode === "table" ? "table" : "tiles";
      localStorage.setItem(DOCUMENTS_VIEW_STORAGE_KEY, state.documentsView);
      render();
    }
    if (action === "close-documents") { state.documentsOpen = false; render(); }
  });

  app.addEventListener("input", (event) => {
    if (event.target.matches("[data-filter='q']")) updateFilter(event.target);
    if (event.target.closest("[data-feedback-form]") && event.target.name in state.feedbackDraft) {
      state.feedbackDraft[event.target.name] = event.target.value;
    }
    if (event.target.matches("[data-profile-field]")) {
      state.profileDraft[event.target.dataset.profileField] = event.target.type === "checkbox"
        ? event.target.checked : event.target.value;
      state.profileStatus = "";
    }
  });

  app.addEventListener("change", (event) => {
    if (event.target.matches("[data-filter]")) updateFilter(event.target);
    if (event.target.matches("[data-profile-field][type='checkbox']")) {
      state.profileDraft[event.target.dataset.profileField] = event.target.checked;
    }
  });

  app.addEventListener("keydown", (event) => {
    const row = event.target.closest("tr[data-action='select-payment-month']");
    if (row && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      state.selectedMonth = row.dataset.month || "";
      render();
    }
    if (event.key === "Escape" && (state.sidebarOpen || state.documentsOpen)) {
      state.sidebarOpen = false; state.documentsOpen = false;
      render();
    }
  });

  app.addEventListener("submit", async (event) => {
    const profileForm = event.target.closest("[data-profile-form]");
    if (profileForm) {
      event.preventDefault();
      if (state.profileSaving) return;
      state.profileSaving = true; state.profileError = ""; state.profileStatus = ""; render();
      try {
        const result = await authApi.request("api/partner/profile", {
          method: "PUT", body: JSON.stringify({ values: state.profileDraft })
        });
        state.portal.profile = result.profile;
        state.profileDraft = {};
        state.profileStatus = result.message || "Профиль сохранён.";
      } catch (error) { state.profileError = error.message; }
      finally { state.profileSaving = false; render(); }
      return;
    }
    const form = event.target.closest("[data-feedback-form]");
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity() || state.feedbackSending) return;
    const data = new FormData(form);
    state.feedbackSending = true;
    state.feedbackError = "";
    state.feedbackStatus = "";
    render();
    try {
      const payload = await authApi.request("api/partner/feedback", {
        method: "POST",
        body: JSON.stringify({ subject: data.get("subject"), message: data.get("message") })
      });
      state.feedbackStatus = payload.message || "Сообщение отправлено.";
      state.feedbackDraft = { subject: "", message: "" };
    } catch (error) {
      state.feedbackError = error.message;
    } finally {
      state.feedbackSending = false;
      render();
    }
  });

  app.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-profile-tab]");
    if (!tab) return;
    state.profileTab = tab.dataset.profileTab;
    render();
  });

  app.addEventListener("contextmenu", (event) => {
    if (!event.target.closest(".partner-profile-tabs")) return;
    event.preventDefault();
    showProfileTabMenu(event.clientX, event.clientY);
  });

  app.addEventListener("dragstart", (event) => {
    const tab = event.target.closest("[data-profile-tab]");
    if (!tab) return;
    state.draggedProfileTab = tab.dataset.profileTab;
    event.dataTransfer.effectAllowed = "move";
  });

  app.addEventListener("dragover", (event) => {
    if (event.target.closest("[data-profile-tab]") && state.draggedProfileTab) event.preventDefault();
  });

  app.addEventListener("drop", (event) => {
    const target = event.target.closest("[data-profile-tab]");
    if (!target || !state.draggedProfileTab) return;
    event.preventDefault();
    const from = state.profileTabs.indexOf(state.draggedProfileTab);
    const to = state.profileTabs.indexOf(target.dataset.profileTab);
    if (from >= 0 && to >= 0 && from !== to) {
      state.profileTabs.splice(to, 0, state.profileTabs.splice(from, 1)[0]);
      saveProfileTabOrder();
      render();
    }
    state.draggedProfileTab = "";
  });

  document.addEventListener("click", (event) => {
    const restore = event.target.closest("[data-action='restore-profile-tabs']");
    if (restore) {
      state.profileTabs = PROFILE_TABS.map((tab) => tab.id);
      saveProfileTabOrder();
      render();
    }
    if (!event.target.closest(".partner-tab-context-menu")) document.querySelector(".partner-tab-context-menu")?.remove();
  });

  window.addEventListener("hashchange", () => { parseRoute(); render(); if (state.view === "materials" && !state.materials) loadMaterials("/"); });
  window.addEventListener("ais:auth-refreshed", (event) => {
    if (event.detail?.user?.role !== "partner") window.location.reload();
  });

  parseRoute();
  loadPortal();
})();
