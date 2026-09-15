"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const requestedSource = String(process.env.AIS_TEST_APP_SOURCE || "").trim();
const appPath = requestedSource
  ? path.resolve(process.cwd(), requestedSource)
  : path.resolve(__dirname, "..", "app.js");
const appSource = fs.readFileSync(appPath, "utf8").replace(/\r\n/gu, "\n");

function extractNamedFunction(name) {
  const marker = `  function ${name}(`;
  const start = appSource.indexOf(marker);
  assert.ok(start >= 0, `Не найдена функция ${name}`);
  const nextFunction = appSource.indexOf("\n\n  function ", start + marker.length);
  const nextAsyncFunction = appSource.indexOf("\n\n  async function ", start + marker.length);
  const candidates = [nextFunction, nextAsyncFunction].filter((index) => index > start);
  assert.ok(candidates.length, `Не найден конец функции ${name}`);
  return appSource.slice(start, Math.min(...candidates)).replace(/^  /gmu, "");
}

function createContextEvent(overrides = {}) {
  return {
    clientX: 340,
    clientY: 210,
    key: "",
    shiftKey: false,
    currentTarget: null,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented += 1; },
    stopPropagation() { this.stopped += 1; },
    ...overrides
  };
}

const linksCalls = [];
const linksContext = {
  getStudentApplicationsSingleProgramFilterId() {
    return "";
  },
  getStudentApplicationProgram(row) {
    linksCalls.push(["program", row?.id || ""]);
    return row?.testProgram || null;
  },
  getProgramPromoUrl(program) {
    linksCalls.push(["promo", program?.id || ""]);
    return String(program?.testPromoUrl || "");
  },
  getProgramLandingPageUrl(landingCode) {
    linksCalls.push(["landing", String(landingCode || "")]);
    return landingCode ? `https://edu-plus.ru/?p=${encodeURIComponent(landingCode)}` : "";
  },
  getStudentOrderAdminUrl(orderId) {
    linksCalls.push(["order", String(orderId || "")]);
    return orderId ? `https://shop.example.test/orders/${encodeURIComponent(orderId)}` : "";
  }
};
vm.createContext(linksContext);
vm.runInContext(
  `${extractNamedFunction("getStudentApplicationsImportContextLinks")}
   this.getStudentApplicationsImportContextLinks = getStudentApplicationsImportContextLinks;`,
  linksContext
);

const promoProgram = {
  id: "program-promo",
  landingCode: "145",
  testPromoUrl: "https://landing.example.test/program-promo"
};
let links = linksContext.getStudentApplicationsImportContextLinks({
  id: "mysql-1",
  orderId: "801",
  sourceType: "mysql",
  source: "WooCommerce",
  testProgram: promoProgram
});
assert.equal(links.landingUrl, promoProgram.testPromoUrl, "Явная ссылка программы должна иметь приоритет");
assert.equal(links.orderUrl, "https://shop.example.test/orders/801");
assert.equal(links.landingUnavailableReason, "");
assert.equal(links.orderUnavailableReason, "");

const landingCodeProgram = {
  id: "program-code",
  landingCode: "972",
  testPromoUrl: ""
};
links = linksContext.getStudentApplicationsImportContextLinks({
  id: "mysql-2",
  orderId: "802",
  sourceType: "mysql",
  source: "Интернет-магазин",
  testProgram: landingCodeProgram
});
assert.equal(
  links.landingUrl,
  "https://edu-plus.ru/?p=972",
  "При отсутствии прямой ссылки должен использоваться код лендинга программы"
);
assert.equal(links.orderUrl, "https://shop.example.test/orders/802");

const orderCallsBeforeInSales = linksCalls.filter(([kind]) => kind === "order").length;
links = linksContext.getStudentApplicationsImportContextLinks({
  id: "insales-1",
  orderId: "803",
  sourceType: "email",
  source: "Заявка InSales",
  testProgram: landingCodeProgram
});
assert.equal(links.orderUrl, "", "Для InSales нельзя строить ссылку по шаблону WooCommerce");
assert.ok(links.orderUnavailableReason, "Для InSales должна быть объяснена недоступность перехода");
assert.equal(
  linksCalls.filter(([kind]) => kind === "order").length,
  orderCallsBeforeInSales,
  "Для InSales не следует вызывать генератор административной ссылки WooCommerce"
);

links = linksContext.getStudentApplicationsImportContextLinks({
  id: "email-woocommerce",
  orderId: "804",
  sourceType: "email",
  source: "WooCommerce",
  testProgram: landingCodeProgram
});
assert.equal(
  links.orderUrl,
  "https://shop.example.test/orders/804",
  "Сам по себе почтовый источник не должен отключать переход для WooCommerce"
);

links = linksContext.getStudentApplicationsImportContextLinks({
  id: "unmatched-product",
  orderId: "",
  productId: "441",
  sourceType: "mysql",
  source: "WooCommerce",
  testProgram: null
});
assert.equal(
  links.landingUrl,
  "https://edu-plus.ru/?p=441",
  "Код товара импортируемой заявки должен оставаться запасным кодом лендинга"
);

links = linksContext.getStudentApplicationsImportContextLinks({
  id: "missing-links",
  orderId: "",
  sourceType: "mysql",
  source: "WooCommerce",
  testProgram: null
});
assert.equal(links.landingUrl, "");
assert.equal(links.orderUrl, "");
assert.ok(links.landingUnavailableReason, "Причина недоступности лендинга должна быть показана пользователю");
assert.ok(links.orderUnavailableReason, "Причина недоступности заявки должна быть показана пользователю");

const closeSource = extractNamedFunction("closeStudentApplicationsImportContextMenu");
const showSource = extractNamedFunction("showStudentApplicationsImportContextMenu");
const bindSource = extractNamedFunction("bindStudentApplicationsImportRowContextMenu");

assert.match(closeSource, /\[data-student-applications-import-context-menu\]/u);
assert.match(closeSource, /\.remove\(\)/u, "Закрытие должно удалять контекстное меню");
assert.match(closeSource, /restoreFocus/u, "Закрытие должно уметь возвращать фокус строке");

assert.match(
  showSource,
  /data-student-applications-import-context-menu|dataset\.studentApplicationsImportContextMenu/u
);
const landingButton = showSource.match(
  /<button\b(?=[^>]*data-student-application-import-link=["']landing["'])[^>]*>[\s\S]*?<\/button>/u
)?.[0] || "";
const orderButton = showSource.match(
  /<button\b(?=[^>]*data-student-application-import-link=["']order["'])[^>]*>[\s\S]*?<\/button>/u
)?.[0] || "";
assert.ok(landingButton, "В меню отсутствует пункт перехода к лендингу");
assert.ok(orderButton, "В меню отсутствует пункт перехода к заявке");
assert.match(landingButton, /Перейти к лендингу/u);
assert.match(orderButton, /Перейти к заявке в интернет-магазин/u);
assert.match(landingButton, /disabled/u, "Недоступный лендинг должен блокировать кнопку");
assert.match(orderButton, /disabled/u, "Недоступная заявка должна блокировать кнопку");
assert.match(showSource, /landingUnavailableReason/u);
assert.match(showSource, /orderUnavailableReason/u);
assert.match(showSource, /openExternalUrl\s*\(/u, "Внешние ссылки должны открываться общим безопасным helper'ом");
assert.doesNotMatch(showSource, /(?:window\.)?location\s*=|window\.open\s*\(/u);
assert.match(showSource, /pointerdown/u, "Щелчок вне меню должен закрывать его");
assert.match(showSource, /(?:Escape|Tab)/u, "Меню должно закрываться с клавиатуры");

class FakeRow {
  constructor() {
    this.dataset = { studentApplicationRow: "row-1" };
    this.listeners = new Map();
    this.tabIndex = 0;
    this.isConnected = true;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  getBoundingClientRect() {
    return { left: 120, top: 80, right: 560, bottom: 112, width: 440, height: 32 };
  }
}

const fakeRow = new FakeRow();
const updateCalls = [];
const showCalls = [];
const bindContext = {
  Element: FakeRow,
  HTMLElement: FakeRow,
  state: {
    studentApplicationsImport: {
      activeId: "",
      selected: ["already-selected"],
      rows: [{ id: "row-1" }]
    }
  },
  updateStudentApplicationsSelectionUi(options) {
    updateCalls.push(options);
  },
  showStudentApplicationsImportContextMenu(...args) {
    showCalls.push(args);
  }
};
vm.createContext(bindContext);
vm.runInContext(
  `${bindSource}
   this.bindStudentApplicationsImportRowContextMenu = bindStudentApplicationsImportRowContextMenu;`,
  bindContext
);

bindContext.bindStudentApplicationsImportRowContextMenu(fakeRow);
bindContext.bindStudentApplicationsImportRowContextMenu(fakeRow);
assert.equal(fakeRow.listeners.get("contextmenu")?.length, 1, "Повторная привязка не должна дублировать меню");
assert.equal(fakeRow.listeners.get("keydown")?.length, 1, "Клавиатурный обработчик не должен дублироваться");

const pointerEvent = createContextEvent({ currentTarget: fakeRow });
fakeRow.listeners.get("contextmenu")[0](pointerEvent);
assert.equal(pointerEvent.prevented, 1);
assert.equal(pointerEvent.stopped, 1);
assert.equal(bindContext.state.studentApplicationsImport.activeId, "row-1");
assert.deepEqual(
  Array.from(bindContext.state.studentApplicationsImport.selected),
  ["already-selected"],
  "Правый щелчок не должен менять выбор заявок"
);
assert.equal(updateCalls.length, 1, "Правая кнопка должна обновить подробности активной заявки");
assert.equal(updateCalls[0].row, fakeRow);
assert.equal(updateCalls[0].updateDetail, true);
assert.deepEqual(showCalls[0], [fakeRow, 340, 210]);

const contextMenuKey = createContextEvent({ key: "ContextMenu", currentTarget: fakeRow });
fakeRow.listeners.get("keydown")[0](contextMenuKey);
assert.equal(contextMenuKey.prevented, 1);
assert.equal(contextMenuKey.stopped, 1);
assert.equal(showCalls.length, 2, "Клавиша контекстного меню должна открыть меню у строки");

const plainF10 = createContextEvent({ key: "F10", currentTarget: fakeRow });
fakeRow.listeners.get("keydown")[0](plainF10);
assert.equal(plainF10.prevented, 0, "F10 без Shift должен сохранить обычное поведение");
assert.equal(showCalls.length, 2);

const shiftF10 = createContextEvent({ key: "F10", shiftKey: true, currentTarget: fakeRow });
fakeRow.listeners.get("keydown")[0](shiftF10);
assert.equal(shiftF10.prevented, 1);
assert.equal(shiftF10.stopped, 1);
assert.equal(showCalls.length, 3, "Shift+F10 должен открыть меню у строки");

assert.doesNotMatch(
  bindSource,
  /toggleStudentApplicationSelection/u,
  "Контекстное меню не должно переключать checkbox заявки"
);
assert.match(bindSource, /updateStudentApplicationsSelectionUi/u);
assert.match(bindSource, /showStudentApplicationsImportContextMenu/u);

assert.match(
  appSource,
  /scope\.querySelectorAll\("\[data-student-application-row\]"\)[\s\S]{0,500}bindStudentApplicationsImportRowContextMenu\(row\)/u,
  "Контекстное меню должно привязываться ко всем строкам импорта"
);
assert.match(
  extractNamedFunction("closeStudentApplicationsImport"),
  /closeStudentApplicationsImportContextMenu\s*\(/u,
  "Закрытие окна импорта должно удалить его контекстное меню"
);
assert.match(
  extractNamedFunction("refreshStudentApplicationsImportDialog"),
  /closeStudentApplicationsImportContextMenu\s*\(/u,
  "Перерисовка окна импорта должна удалить устаревшее контекстное меню"
);
assert.match(
  extractNamedFunction("render"),
  /closeStudentApplicationsImportContextMenu\s*\(/u,
  "Общая перерисовка интерфейса должна удалить контекстное меню импорта"
);

assert.match(
  appSource,
  /data-student-application-row="\$\{escapeAttr\(row\.id\)\}"[^>]*tabindex="0"/u,
  "Строки импорта должны получать фокус для клавиатурного контекстного меню"
);

console.log("student applications import context menu tests: OK");
