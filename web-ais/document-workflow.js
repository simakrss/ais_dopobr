(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AIS_DOCUMENT_WORKFLOW = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const programTitleSql = "iif([Тип]='ПРО','Мероприятие',iif([Тип]='ДОП','Дополнительная общеобразовательная программа', iif([Тип]='КПК','Программа повышения квалификации','Программа профессиональной переподготовки'))) & ' «' & [Наименование программы] & '»'";
  const activeCondition = "Статус='Набор' and Тип in ('ППП','КПК','ДОП','ПРО')";
  const sqlFormula = (sql, table = true) => `=ПолучитьSQLзапрос("[Источник]\n\n\n\n${sql}"${table ? ";;СИМВОЛ(9);;СИМВОЛ(11)" : ""})`;
  const datedFields = [
    { name: "Номер приказа", formula: "=[Номер приказа]" },
    { name: "Дата приказа", formula: '=ТЕКСТ([Дата документа];"ДД.ММ.ГГГГ")' },
    { name: "Дата начала набора", formula: '=ТЕКСТ([Дата документа];"[$-ru-RU,genlower]ДД ММММ ГГГГ")' }
  ];
  const definitions = [
    {
      id: "workflow-commission-order", documentKind: "workflowCommissionOrder",
      title: "Приказ об утверждении состава ИАК", fileName: "ПРИКАЗ об утверждении состава ИАК.docx",
      orderNumberContext: "ИАК",
      templatePath: "storage/document-templates/workflow-commission-order.docx",
      localTemplateSource: "Документы/ИАК/ПРИКАЗ об утверждении состава ИАК.docx",
      fileNameTemplate: "ПРИКАЗ об утверждении состава ИАК",
      fileNameTemplateVersion: "2026-09-12-workflow-output-names",
      saveFolderTemplate: "Документы/ИАК",
      additionalSaveTargetsVersion: "2026-09-12-multiple-outputs",
      additionalSaveTargets: [{ saveFolderTemplate: "", fileNameTemplate: "ПРИКАЗ об утверждении состава ИАК_#Месяц и год генерации#", generationFormat: "pdf" }],
      condition: "Тип='ППП' and Статус='Набор' and not isNull(Председатель)",
      description: "Составы итоговых аттестационных комиссий по программам профессиональной переподготовки, открытым для набора.",
      fields: [{name: "Список", position: 1, fieldNumber: 1, formula: sqlFormula("SELECT '<b><№№>. По дополнительной профессиональной программе «' & [Наименование программы] & '»:</b>' & chr(13) & '1. Председатель – ' & [Председатель] & '.' & chr(13) & '2. Член комиссии – ' & [Член1] & '.' & chr(13) & '3. Член комиссии – ' & [Член2] & '.' & chr(13) & 'Секретарь – ' & [Секретарь] & '.' & chr(13) FROM [Реестр программ$] WHERE [Условие отбора]", false)}, ...datedFields.slice(0, 2)]
    },
    {
      id: "workflow-recruitment-order", documentKind: "workflowRecruitmentOrder",
      title: "Приказ о наборе", fileName: "Приказ о наборе.docx",
      orderNumberContext: "НАБОР",
      templatePath: "storage/document-templates/workflow-recruitment-order.docx",
      localTemplateSource: "Документы/Приказы о наборе/Приказ о наборе.docx",
      fileNameTemplate: "Действующий приказ о наборе",
      fileNameTemplateVersion: "2026-09-12-workflow-output-names",
      saveFolderTemplate: "Документы/Приказы о наборе", condition: activeCondition,
      additionalSaveTargetsVersion: "2026-09-12-multiple-outputs",
      additionalSaveTargets: [{ saveFolderTemplate: "", fileNameTemplate: "Приказ о наборе #Номер приказа#", generationFormat: "pdf" }],
      description: "Программы со статусом «Набор», стоимость обучения и партнёрские ставки по формуле шаблона.",
      legacyListFormula: sqlFormula(`SELECT ${programTitleSql}, Стоимость, iif(iif(isNull(Автор),'',Автор)='','25%','10%') as Процент FROM [Реестр программ$] WHERE [Условие отбора] ORDER BY [Тип], [Наименование программы]`),
      fields: [{name: "Список", position: 1, fieldNumber: 6, formula: sqlFormula(`SELECT ${programTitleSql}, Стоимость, iif(Стоимость=0,'–', iif(iif(isNull(Автор),'',Автор)='','25%','10%')) as Процент FROM [Реестр программ$] WHERE [Условие отбора] ORDER BY [Тип], [Наименование программы]`)}, ...datedFields]
    },
    {
      id: "workflow-commercial-proposal", documentKind: "workflowCommercialProposal",
      title: "Коммерческое предложение Цифровизация Плюс", fileName: "Коммерческое предложение Цифровизация Плюс.docx",
      templatePath: "storage/document-templates/workflow-commercial-proposal.docx",
      localTemplateSource: "[-1]/Реклама/Коммерческие/Коммерческое предложение Цифровизация Плюс.docx",
      fileNameTemplate: "Коммерческое_предложение_#ТекДата#",
      saveFolderTemplate: "Документы/Коммерческие предложения", condition: activeCondition,
      description: "Актуальные программы и цены, сгруппированные по видам: КПК, ППП, ДОП и ПРО.",
      fields: [
        {name: "ТекДата", position: 1, fieldNumber: 7, formula: '=ТЕКСТ([Дата документа];"ДД.ММ.ГГГГ")'},
        ...["КПК", "ППП", "ДОП", "ПРО"].map((type, index) => ({
          name: `Список${type}`, position: index + 2, fieldNumber: [6, 8, 9, 10][index],
          formula: sqlFormula(`SELECT ${type === "ПРО" ? "trim(' «' & [Наименование программы] & '»')" : programTitleSql}, Стоимость FROM [Реестр программ$] WHERE [Условие отбора] and [Тип] = '${type}' ORDER BY [Тип], [Наименование программы]`)
        }))
      ]
    }
  ];
  const columnMap = {
    "Наименование программы": "name", "Название программы на английском": "nameEnglish",
    "Наименование программы (без часов)": "shortName", "Тип": "type", "Статус": "status",
    "Стоимость": "price", "Старая цена": "oldPrice", "Автор": "authorSource", "Часы": "hours",
    "Председатель": "commissionChair", "Член1": "commissionMember1", "Член2": "commissionMember2",
    "Секретарь": "secretary", "Квалификация": "qualification", "Форма обучения": "studyForm",
    "Номер приказа": "programOrderNo", "Дата приказа": "programOrderDate", "Менеджер": "manager"
  };
  const normalize = value => String(value ?? "").trim().toLocaleLowerCase("ru-RU");
  const columns = new Map(Object.entries(columnMap).map(([name, key]) => [normalize(name), key]));
  Object.values(columnMap).forEach(key => columns.set(normalize(key), key));
  function formatDefaultOrderNumber(dateValue, contextValue) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || "").trim());
    const context = String(contextValue || "").trim().toLocaleUpperCase("ru-RU");
    if (!dateMatch || !/^[\p{L}\p{N}]+$/u.test(context)) return "";
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return `${String(year).slice(-1)}${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}/${context}`;
  }
  function tokenize(sql) {
    if (sql.length > 30000) throw new Error("SQL-формула слишком длинная.");
    const result = [];
    const pattern = /\s+|'(?:[^']|'')*'|\[(?:[^\]]|\]\])*\]|\d+(?:\.\d+)?|[\p{L}_][\p{L}\p{N}_$]*|<>|<=|>=|[(),&=<>+*/;\-]/uy;
    for (let offset = 0; offset < sql.length;) {
      pattern.lastIndex = offset;
      const match = pattern.exec(sql);
      if (!match) throw new Error(`Не поддерживается SQL-фрагмент: ${sql.slice(offset, offset + 35)}`);
      offset = pattern.lastIndex;
      const value = match[0];
      if (/^\s/u.test(value)) continue;
      result.push({value, key: value.toUpperCase(), type: value[0] === "'" ? "string" : value[0] === "[" ? "column" : /^\d/.test(value) ? "number" : "word"});
    }
    return result;
  }
  function compileQuery(sql) {
    const tokens = tokenize(sql);
    let pos = 0;
    const peek = key => tokens[pos]?.key === key;
    const take = key => peek(key) ? (pos++, true) : false;
    const expect = key => { if (!take(key)) throw new Error(`Ожидалось «${key}» в SQL-запросе.`); };
    function primary() {
      if (take("(")) { const item = or(); expect(")"); return item; }
      if (take("-")) { const item = primary(); return row => -Number(item(row)); }
      const token = tokens[pos++];
      if (!token) throw new Error("Незавершённое SQL-выражение.");
      if (token.type === "string") return () => token.value.slice(1, -1).replaceAll("''", "'");
      if (token.type === "number") return () => Number(token.value);
      if (token.key === "NULL") return () => null;
      if (token.key === "TRUE" || token.key === "FALSE") return () => token.key === "TRUE";
      if (take("(")) {
        const args = [];
        if (!peek(")")) { do { args.push(or()); } while (take(",")); }
        expect(")");
        const name = token.key;
        if (!["IIF", "ISNULL", "TRIM", "CHR", "LCASE", "UCASE", "ROUND", "LEN", "NZ"].includes(name)) throw new Error(`SQL-функция «${token.value}» не поддерживается.`);
        return row => {
          const value = index => args[index]?.(row);
          if (name === "IIF") return value(0) ? value(1) : value(2);
          if (name === "ISNULL") return value(0) == null;
          if (name === "NZ") return value(0) ?? value(1) ?? "";
          if (name === "CHR") return String.fromCharCode(Number(value(0)));
          if (name === "ROUND") { const scale = 10 ** Number(value(1) || 0); return Math.round(Number(value(0)) * scale) / scale; }
          const text = String(value(0) ?? "");
          if (name === "LEN") return text.length;
          if (name === "LCASE") return text.toLocaleLowerCase("ru-RU");
          if (name === "UCASE") return text.toLocaleUpperCase("ru-RU");
          return text.trim();
        };
      }
      const name = token.type === "column" ? token.value.slice(1, -1).replaceAll("]]", "]") : token.value;
      const key = columns.get(normalize(name));
      if (!key) throw new Error(`В реестре программ нет поля «${name}».`);
      return row => row[key] === "" || row[key] == null ? null : row[key];
    }
    function arithmetic() {
      let left = primary();
      while (["*", "/"].includes(tokens[pos]?.key)) { const op = tokens[pos++].key, a = left, b = primary(); left = row => op === "*" ? Number(a(row)) * Number(b(row)) : Number(a(row)) / Number(b(row)); }
      return left;
    }
    function concat() {
      let left = arithmetic();
      while (["&", "+", "-"].includes(tokens[pos]?.key)) {
        const op = tokens[pos++].key, a = left, b = arithmetic();
        left = row => op === "&" ? String(a(row) ?? "") + String(b(row) ?? "") : op === "+" ? Number(a(row)) + Number(b(row)) : Number(a(row)) - Number(b(row));
      }
      return left;
    }
    function comparison() {
      const left = concat();
      if (take("IS")) { const negate = take("NOT"); expect("NULL"); return row => (left(row) == null) !== negate; }
      const negateIn = peek("NOT") && tokens[pos + 1]?.key === "IN";
      if (negateIn) pos++;
      if (take("IN")) {
        expect("("); const values = []; do { values.push(concat()); } while (take(",")); expect(")");
        return row => values.some(value => normalize(value(row)) === normalize(left(row))) !== negateIn;
      }
      if (["=", "<>", "<", ">", "<=", ">="].includes(tokens[pos]?.key)) {
        const op = tokens[pos++].key, right = concat();
        return row => {
          const a = left(row), b = right(row);
          if (a == null || b == null) return false;
          const cmp = typeof a === "number" || typeof b === "number" ? Number(a) - Number(b) : normalize(a).localeCompare(normalize(b), "ru");
          return op === "=" ? cmp === 0 : op === "<>" ? cmp !== 0 : op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
        };
      }
      return left;
    }
    function not() { if (take("NOT")) { const item = not(); return row => !item(row); } return comparison(); }
    function and() { let left = not(); while (take("AND")) { const a = left, b = not(); left = row => Boolean(a(row) && b(row)); } return left; }
    function or() { let left = and(); while (take("OR")) { const a = left, b = and(); left = row => Boolean(a(row) || b(row)); } return left; }
    expect("SELECT"); const distinct = take("DISTINCT"), projections = [];
    do { projections.push(or()); if (take("AS")) { if (!tokens[pos++]) throw new Error("Не указан псевдоним SQL-колонки."); } } while (take(","));
    expect("FROM");
    const table = tokens[pos++];
    if (!table || normalize(table.value.replace(/^\[|\]$/g, "")) !== "реестр программ$") throw new Error("Документооборот читает только лист «Реестр программ».");
    const filter = take("WHERE") ? or() : () => true;
    const order = [];
    if (take("ORDER")) { expect("BY"); do { const get = concat(); const dir = take("DESC") ? -1 : (take("ASC"), 1); order.push({get, dir}); } while (take(",")); }
    take(";");
    if (pos !== tokens.length) throw new Error(`Не поддерживается SQL-фрагмент: ${tokens[pos].value}`);
    return programs => {
      const selected = programs.filter(filter);
      if (order.length) selected.sort((a, b) => {
        for (const item of order) { const av = item.get(a), bv = item.get(b); const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""), "ru", {numeric: true}); if (cmp) return cmp * item.dir; }
        return 0;
      });
      const seen = new Set();
      return selected.map(program => ({program, values: projections.map(get => get(program))})).filter(row => {
        if (!distinct) return true; const key = JSON.stringify(row.values); if (seen.has(key)) return false; seen.add(key); return true;
      });
    };
  }
  function evaluateSqlField(formula, programs, condition) {
    const match = /^\s*=\s*Получить\s*SQL\s*запрос\s*\(\s*"((?:[^"]|"")*)"([\s\S]*)\)\s*$/iu.exec(String(formula || ""));
    if (!match) throw new Error("Ожидалась формула ПолучитьSQLзапрос Ассистента.");
    const query = match[1].replaceAll('""', '"').replace(/\[Источник\]/giu, "").replace(/\[Условие отбора\]/giu, condition).trim();
    const rows = compileQuery(query)(Array.isArray(programs) ? programs : []);
    const separators = match[2].trim();
    if (separators && !/^;\s*;\s*СИМВОЛ\(9\)\s*;\s*;\s*СИМВОЛ\(11\)\s*$/iu.test(separators)) throw new Error("Для таблиц используйте разделители СИМВОЛ(9) и СИМВОЛ(11).");
    const text = rows.map((row, index) => row.values.map(value => String(value ?? "").replaceAll("<№№>", String(index + 1))).join(separators ? "\t" : " ")).join(separators ? "\u000b" : "\n");
    return {text, rows, table: Boolean(separators)};
  }
  function getDefinition(kind) { return definitions.find(item => item.documentKind === kind || item.id === kind) || null; }
  function getFixedOutputFileName(value, format = "pdf") {
    const base = String(value || "").trim().replace(/\.(?:pdf|docx)$/iu, "");
    const definition = definitions.find(item => item.fileNameTemplateVersion && item.fileNameTemplate === base);
    return definition ? `${definition.fileNameTemplate}.${format === "docx" ? "docx" : "pdf"}` : "";
  }
  function evaluateLists(document, programs) {
    const definition = getDefinition(document.documentKind);
    if (!definition) throw new Error("Неизвестный вид документа документооборота.");
    const values = {}, tableFields = [], selected = new Map();
    (document.fields || []).forEach(field => {
      if (!/Получить\s*SQL\s*запрос/iu.test(field.formula || "")) return;
      const result = evaluateSqlField(field.formula, programs, definition.condition);
      values[field.name] = result.text;
      if (result.table) tableFields.push(field.name);
      result.rows.forEach(({program}) => selected.set(program.id || program.name, program));
    });
    return {values, tableFields, programs: [...selected.values()]};
  }
  function normalizeAdditionalSaveTargets(value) {
    return (Array.isArray(value) ? value : []).slice(0, 10).map((target) => ({
      saveFolderTemplate: String(target?.saveFolderTemplate || "").trim(),
      fileNameTemplate: String(target?.fileNameTemplate || "").trim(),
      generationFormat: String(target?.generationFormat || "").toLowerCase() === "docx" ? "docx" : "pdf"
    }));
  }

  function getGenerationDateValues(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow", month: "2-digit", year: "numeric"
    }).formatToParts(date);
    const month = parts.find((part) => part.type === "month").value;
    const year = parts.find((part) => part.type === "year").value;
    return { "Месяц генерации": month, "Год генерации": year, "Месяц и год генерации": `${month}.${year}` };
  }

  function resolveOutputTemplate(template, values) {
    return String(template || "").replace(/#([^#]+)#/g, (_, name) => String(values[name] ?? ""));
  }

  // Additional copies keep the configured spaces; path separators in an order number are not directories.
  function safeOutputFileName(value, format) {
    const extension = String(format).toLowerCase() === "docx" ? "docx" : "pdf";
    let name = String(value || "").normalize("NFC").trim().replace(/\.(?:pdf|docx)$/iu, "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ")
      .replace(/^[. ]+|[. ]+$/g, "").slice(0, 160).replace(/[. ]+$/g, "");
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    return `${name || "документ"}.${extension}`;
  }

  return {definitions, columnMap, compileQuery, evaluateSqlField, evaluateLists, getDefinition, formatDefaultOrderNumber, getFixedOutputFileName,
    normalizeAdditionalSaveTargets, getGenerationDateValues, resolveOutputTemplate, safeOutputFileName};
});
