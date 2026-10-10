"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");

function extractFunction(name) {
  const plainStart = appSource.indexOf(`  function ${name}(`);
  const asyncStart = appSource.indexOf(`  async function ${name}(`);
  const start = plainStart >= 0 ? plainStart : asyncStart;
  assert.ok(start >= 0, `Не найдена функция ${name}().`);
  const bodyStart = appSource.indexOf(") {", start) + 2;
  assert.ok(bodyStart > start, `Не найдено тело функции ${name}().`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    const char = appSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1).replace(/^  /gmu, "");
    }
  }
  throw new Error(`Функция ${name}() не завершена.`);
}

function hasFunction(name) {
  return appSource.includes(`  function ${name}(`)
    || appSource.includes(`  async function ${name}(`);
}

function buildFunctionBundle(entryNames, stubNames = []) {
  const stubbed = new Set(stubNames);
  const visited = new Set();
  const functions = [];
  const callPattern = /(?<!\.)\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gu;
  const visit = (name) => {
    if (visited.has(name) || stubbed.has(name)) return;
    visited.add(name);
    const source = extractFunction(name);
    for (const match of source.matchAll(callPattern)) {
      const dependency = match[1];
      if (dependency !== name && !stubbed.has(dependency) && hasFunction(dependency)) {
        visit(dependency);
      }
    }
    functions.push(source);
  };
  entryNames.forEach(visit);
  return functions.join("\n\n");
}

const program = {
  id: "program-name-search-target",
  name: "Главное название программы",
  shortName: "SHORTNAME-ONLY-MARKER",
  landingCode: "LANDING-ONLY-MARKER",
  type: "TYPE-ONLY-MARKER",
  hours: "987654-HOURS-ONLY-MARKER",
  commissionChair: "COMMISSION-ONLY-MARKER",
  commissionMember1: "Другой член комиссии"
};

const forbiddenQueries = [
  ["shortName", program.shortName],
  ["landingCode", program.landingCode],
  ["type", program.type],
  ["hours", program.hours],
  ["commission", program.commissionChair]
];

const registryStubNames = [
  "compareProgramNames",
  "filterRowsByTableValueFilters",
  "findProgramByName",
  "getProgramRegistryTypeFilterOptions",
  "getRowsForConfig",
  "getStudentListSelectedPrograms",
  "getTableCellValue",
  "getTableConfigId",
  "getTableValueFilterDisplayValue",
  "normalizeContractSection",
  "normalizeEducationProgramType",
  "normalizeGeneralExpenseSection",
  "parseTableSortDate"
];

const registryContext = {
  CONTRACT_SECTIONS: [],
  GENERAL_EXPENSE_SECTIONS: [],
  compareProgramNames: (left, right) => String(left || "").localeCompare(String(right || ""), "ru"),
  filterRowsByTableValueFilters: (rows) => rows,
  findProgramByName: () => null,
  getProgramRegistryTypeFilterOptions: () => [],
  getRowsForConfig: () => [program],
  getStudentListSelectedPrograms: () => [],
  getTableCellValue: (_config, row, key) => row[key],
  getTableConfigId: () => "programs",
  getTableValueFilterDisplayValue: () => "",
  normalizeContractSection: () => "",
  normalizeEducationProgramType: (value) => String(value || ""),
  normalizeGeneralExpenseSection: () => "",
  parseTableSortDate: () => null,
  registryRowSearchTextCache: new WeakMap(),
  state: {
    contractSectionFilter: [],
    directExpenseNoteFilter: "",
    documentTemplateSearch: "",
    generalExpenseSectionFilter: [],
    generalExpenseWorkTypeFilter: [],
    programRegistryTypeFilter: [],
    search: "",
    sort: { key: "", dir: "asc" },
    studentImportedViewIds: [],
    studentListFilters: {},
    studentProgramTypeFilter: [],
    view: "programs"
  }
};
vm.createContext(registryContext);
vm.runInContext(
  `${buildFunctionBundle(["getVisibleRows"], registryStubNames)}\n`
    + "this.searchProgramRegistry = (query) => { state.search = query; return getVisibleRows({ collection: 'programs', fields: [] }); };",
  registryContext
);

const registryNameMatches = registryContext.searchProgramRegistry("главное название");
assert.equal(registryNameMatches.length, 1, "Реестр программ должен находить запись по row.name.");
assert.equal(registryNameMatches[0].id, program.id);
for (const [field, query] of forbiddenQueries) {
  assert.equal(
    registryContext.searchProgramRegistry(String(query).toLocaleLowerCase("ru-RU")).length,
    0,
    `Реестр программ не должен находить запись только по полю ${field}.`
  );
}

const renderStubNames = [
  "columnDataAttrs",
  "columnStyleAttr",
  "escapeAttr",
  "escapeHtml",
  "getProgramRows",
  "getStudentApplicationProgramRecommendation",
  "getStudentApplicationReceiptAmount",
  "getStudentApplicationRepeatTooltip",
  "getStudentApplicationsImportPagination",
  "getStudentApplicationsProgramFilterLabel",
  "getStudentApplicationsSelectedProgramIds",
  "getTableFields",
  "getVisibleStudentApplications",
  "isStudentApplicationImported",
  "money",
  "renderStudentApplicationDetail",
  "renderStudentApplicationImportTableCell",
  "renderStudentApplicationsImportPagination",
  "renderStudentStatusOptions",
  "renderTableOptions",
  "renderTableValueFilterChips",
  "unique"
];

const renderContext = {
  STUDENT_APPLICATIONS_IMPORT_DEFAULT_SORT: { key: "", dir: "asc" },
  STUDENT_APPLICATIONS_IMPORT_TABLE_CONFIG_ID: "studentApplicationsImport",
  columnDataAttrs: () => "",
  columnStyleAttr: () => "",
  escapeAttr: (value) => String(value ?? ""),
  escapeHtml: (value) => String(value ?? ""),
  getProgramRows: () => [program],
  getStudentApplicationProgramRecommendation: () => null,
  getStudentApplicationReceiptAmount: () => 0,
  getStudentApplicationRepeatTooltip: () => "",
  getStudentApplicationsImportPagination: () => ({ start: 0, end: 0, page: 1, totalPages: 1 }),
  getStudentApplicationsProgramFilterLabel: () => "Все программы",
  getStudentApplicationsSelectedProgramIds: () => [],
  getTableFields: () => [],
  getVisibleStudentApplications: () => [],
  isStudentApplicationImported: () => false,
  money: (value) => String(value || 0),
  renderStudentApplicationDetail: () => "",
  renderStudentApplicationImportTableCell: () => "",
  renderStudentApplicationsImportPagination: () => "",
  renderStudentStatusOptions: () => "",
  renderTableOptions: () => "",
  renderTableValueFilterChips: () => "",
  state: {
    data: { collections: { programs: [program] }, dictionaries: { statuses: [] } },
    studentApplicationsImport: {
      activeId: "",
      error: "",
      filters: {
        dateFrom: "",
        dateTo: "",
        onlyPaid: false,
        period: "all",
        programQuery: "",
        search: "",
        status: "На зачисление"
      },
      importedLookup: null,
      importing: false,
      loading: false,
      rows: [],
      selected: [],
      selectedPayment: 0,
      sort: { key: "", dir: "asc" },
      truncated: false,
      warnings: []
    }
  },
  studentApplicationsImportTableConfig: { fields: [] },
  unique: (values) => [...new Set(values)]
};
vm.createContext(renderContext);
vm.runInContext(
  `${buildFunctionBundle(["renderStudentApplicationsImport"], renderStubNames)}\n`
    + "this.renderImportForQuery = (query) => { state.studentApplicationsImport.filters.programQuery = query; return renderStudentApplicationsImport(); };",
  renderContext
);

function getProgramOptionMarkup(html) {
  const valueMarker = `value="${program.id}"`;
  const valueIndex = html.indexOf(valueMarker);
  if (valueIndex < 0) return "";
  const start = html.lastIndexOf("<label", valueIndex);
  const end = html.indexOf("</label>", valueIndex);
  assert.ok(start >= 0 && end >= 0, "Не удалось разобрать строку программы в фильтре импорта.");
  return html.slice(start, end + "</label>".length);
}

function optionIsHidden(markup) {
  if (!markup) return true;
  const openingTag = markup.slice(0, markup.indexOf(">") + 1);
  return /\shidden(?:\s|=|>)/u.test(openingTag) || /\bis-hidden\b/u.test(openingTag);
}

function assertInitialImportVisibility(query, expectedVisible, field) {
  const html = renderContext.renderImportForQuery(query);
  const option = getProgramOptionMarkup(html);
  assert.equal(
    Boolean(option) && !optionIsHidden(option),
    expectedVisible,
    expectedVisible
      ? "Первоначальная отрисовка должна находить программу по имени."
      : `Первоначальная отрисовка не должна находить программу только по полю ${field}.`
  );
  return html;
}

assertInitialImportVisibility("главное название", true, "name");
for (const [field, query] of forbiddenQueries) {
  assertInitialImportVisibility(query, false, field);
}
const unfilteredImportHtml = renderContext.renderImportForQuery("");
assert.match(
  unfilteredImportHtml,
  new RegExp(`\\[${program.landingCode}\\]`, "u"),
  "Код лендинга может оставаться видимым в подписи программы."
);

function decodeBasicHtml(value) {
  return String(value || "")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function htmlText(value) {
  return decodeBasicHtml(String(value || "").replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim());
}

function dataNameToProperty(name) {
  return name.slice(5).replace(/-([a-z0-9])/gu, (_match, char) => char.toUpperCase());
}

function attributesFromTag(tag) {
  const attributes = new Map();
  for (const match of String(tag || "").matchAll(/\s([a-zA-Z_:][\w:.-]*)(?:="([^"]*)")?/gu)) {
    attributes.set(match[1], decodeBasicHtml(match[2] ?? ""));
  }
  return attributes;
}

function createProgramOptionElement(markup) {
  const openingTag = markup.slice(0, markup.indexOf(">") + 1);
  const attributes = attributesFromTag(openingTag);
  const dataset = {};
  attributes.forEach((value, name) => {
    if (name.startsWith("data-")) dataset[dataNameToProperty(name)] = value;
  });
  const inputTag = markup.match(/<input\b[^>]*>/u)?.[0] || "";
  const inputAttributes = attributesFromTag(inputTag);
  const spanMarkup = markup.match(/<span\b[^>]*>[\s\S]*?<\/span>/u)?.[0] || "";
  const spanTag = spanMarkup.match(/<span\b[^>]*>/u)?.[0] || "";
  const spanAttributes = attributesFromTag(spanTag);
  const makeChild = (childAttributes, textContent = "") => {
    const childDataset = {};
    childAttributes.forEach((value, name) => {
      if (name.startsWith("data-")) childDataset[dataNameToProperty(name)] = value;
    });
    return {
      dataset: childDataset,
      getAttribute: (name) => childAttributes.get(name) ?? null,
      textContent,
      value: childAttributes.get("value") || ""
    };
  };
  return {
    dataset,
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hidden: false,
    querySelector(selector) {
      if (/input/u.test(selector)) {
        return makeChild(inputAttributes);
      }
      const requestedAttribute = String(selector || "").match(/\[([a-zA-Z_:][\w:.-]*)/u)?.[1] || "";
      if (requestedAttribute) {
        if (spanAttributes.has(requestedAttribute)) {
          return makeChild(spanAttributes, htmlText(spanMarkup));
        }
        return null;
      }
      if (/span|name|search/iu.test(selector)) {
        return spanMarkup ? makeChild(spanAttributes, htmlText(spanMarkup)) : null;
      }
      return null;
    },
    textContent: `${htmlText(markup)} ${forbiddenQueries.map(([, value]) => value).join(" ")}`
  };
}

const dynamicStubNames = ["getProgramRows"];
const dynamicContext = {
  getProgramRows: () => [program],
  state: renderContext.state
};
vm.createContext(dynamicContext);
vm.runInContext(
  `${buildFunctionBundle(["applyStudentApplicationsProgramSearch"], dynamicStubNames)}\n`
    + "this.applyImportProgramSearch = applyStudentApplicationsProgramSearch;",
  dynamicContext
);

function assertDynamicImportVisibility(query, expectedVisible, field) {
  const optionMarkup = getProgramOptionMarkup(unfilteredImportHtml);
  assert.ok(optionMarkup, "В первоначальной разметке отсутствует тестовая программа.");
  const row = createProgramOptionElement(optionMarkup);
  const empty = { hidden: true };
  const rootElement = {
    querySelector(selector) {
      return selector === "[data-student-applications-program-filter-empty]" ? empty : null;
    },
    querySelectorAll(selector) {
      return selector === "[data-student-applications-program-option-row]" ? [row] : [];
    }
  };
  dynamicContext.applyImportProgramSearch(query, rootElement);
  assert.equal(
    !row.hidden,
    expectedVisible,
    expectedVisible
      ? "Динамический поиск должен находить программу по имени."
      : `Динамический поиск не должен находить программу только по полю ${field}.`
  );
  assert.equal(
    empty.hidden,
    expectedVisible,
    "Индикатор пустого списка должен соответствовать видимости программ."
  );
}

assertDynamicImportVisibility("главное название", true, "name");
for (const [field, query] of forbiddenQueries) {
  assertDynamicImportVisibility(query, false, field);
}

console.log("program name-only search checks: OK");
