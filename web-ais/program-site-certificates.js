"use strict";

const crypto = require("node:crypto");
const {PROGRAM_TYPES, programType, withTrainingPlan} = require("./program-site-generator");
const TEMPLATE_ID = "education-document-certificate-dop-pro";
const VERSION = 2;
const MARKERS = ["Дата выдачи", "ИО", "Номер бланка", "Прогр обуч факт", "Прогр обуч факт_ENG",
  "РегНомер", "РегНомер_ENG", "Срок обучения_ENG", "ФИО", "ФИО_ENG", "Email", "QRкод"];

function templateSettings(data, type = "ПРО") {
  const spec = PROGRAM_TYPES[type];
  const saved = data?.dictionaries?.documentTemplates;
  const rows = Array.isArray(saved) ? saved : [];
  const template = rows.find(item => item.id === spec.templateId)
    || rows.find(item => item.documentKind === "education" && item.programTypes?.includes(type));
  if (template) return template;
  return {id: spec.templateId, templateUrl: `Документы/${spec.template}`,
    templatePath: `storage/document-templates/${spec.template}`, useCustomDocumentProperties: "1",
    sampleUseTemplateDefaults: true,
    fields: MARKERS.map(name => ({name, formula: `=[${name}]`}))};
}

function sampleSource(program) {
  const type = programType(program);
  const spec = PROGRAM_TYPES[type];
  const english = String(program.nameEnglish || program["Название программы на английском"] || "").trim();
  if (spec.bilingual && !english) throw new Error("Заполните «Название программы на английском» в карточке программы для создания английского образца сертификата.");
  const date = String(type === "ПРО" ? program.webinarDate || "" : program.siteSampleDate || new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Укажите корректную дату для образцов документов.");
  const displayedDate = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
  const plan = program.siteTrainingPlan || [];
  if (!spec.bilingual && !plan.length) throw new Error("Заполните учебный план программы для формирования приложения к образцу документа.");
  const landingUrl = program.siteSampleLandingUrl || `https://edu-plus.ru/${spec.base}/${String(program.landingCode || "").trim().replace(/^\/+|\/+$/g, "")}/`;
  const parsedUrl = new URL(landingUrl);
  if (parsedUrl.origin !== "https://edu-plus.ru" || parsedUrl.username || parsedUrl.password) throw new Error("Не удалось проверить адрес лендинга для QR-кода образца.");
  return {
    "ФИО": "ОБРАЗЕЦ", "ФИО_ENG": "SAMPLE", "ФИО_eng": "SAMPLE", "ИО": "ОБРАЗЕЦ",
    "РегНомер": "ОБРАЗЕЦ", "РегНомер_ENG": "SAMPLE", "Номер бланка": "SAMPLE", "Id": "0", "uid": "0",
    "Email": "", "Фото": "", "Стажировка": "", "ФИО_несклон": "+",
    "Прогр обуч факт": String(program.name || "").trim(), "Прогр обуч факт_ENG": english,
    "Название программы на английском": english, "Наименование программы": String(program.name || "").trim(),
    "Вид  программы ДПО": type, "Вид программы ДПО": type, "Количество часов": String(program.hours), "Часы": String(program.hours),
    "Квалификация": String(program.qualification || ""), "СфераДеятельности": String(program.activityScope || program.qualification || ""),
    "УчебныйПлан": plan.map(row => [row.discipline, row.totalHours, "Зачтено"].join("\t")).join("\n"),
    "ДокументОбОбразовании": "ОБРАЗЕЦ", "Документ об образовании": "ОБРАЗЕЦ",
    "Обр_Вид образования": "Диплом", "Обр_Серия": "ОБРАЗЕЦ", "Обр_Номер": "ОБРАЗЕЦ",
    "Обр_Дата выдачи": displayedDate, "Обр_Кем выдан": "Учебная организация (образец)",
    "Номер протокола": "ОБРАЗЕЦ", "Оценка ИА": "Зачтено",
    "Дата начала": displayedDate, "Дата окончания": displayedDate, "Дата приказа": displayedDate, "Дата отчисления": displayedDate,
    "Дата приказа Отчисл Док Обр": displayedDate,
    "Дата выдачи": displayedDate, "Дата выдачи документа": displayedDate, "Дата начала обучения": displayedDate,
    "Дата окончания обучения": displayedDate, "Срок обучения_ENG": "",
    "QRкод": landingUrl
  };
}

function evaluateFields(template, source, evaluate, seed = {}) {
  const definitions = new Map((template.fields || []).filter(field => field.name).map(field => [field.name, field]));
  const values = {...source, ...seed};
  const active = new Set();
  const done = new Set();
  const resolve = name => {
    if (!definitions.has(name) || done.has(name)) return values[name] || "";
    if (active.has(name)) throw new Error(`Рекурсия в формуле сертификата «${name}».`);
    active.add(name);
    const formula = String(definitions.get(name).formula || "");
    // SQL references in retained Assistant templates use the saved program, never Excel/student rows.
    if (!formula.trim() || /Получить\s*SQL\s*запрос/i.test(formula)) values[name] = source[name] || "";
    else {
      for (const match of formula.matchAll(/#([^#]+)#|\[([^\]]+)\]/g)) {
        const reference = (match[1] || match[2]).trim();
        if (reference !== name) resolve(reference);
      }
      values[name] = evaluate(formula, {fieldValues: values, sourceValues: source, evaluatingName: name});
    }
    active.delete(name);
    done.add(name);
    return values[name];
  };
  definitions.forEach((_, name) => resolve(name));
  return Object.fromEntries([...new Set([...Object.keys(source), ...MARKERS, ...definitions.keys()])].map(name => [name, values[name] ?? ""]));
}

async function markSamplePdf(bytes, PDF, type = "ПРО") {
  const document = await PDF.PDFDocument.load(bytes);
  const count = document.getPageCount();
  if (PROGRAM_TYPES[type].bilingual ? count !== 2 : count < 3 || count > 8) throw new Error(PROGRAM_TYPES[type].bilingual
    ? "Сертификат должен формировать две страницы: русскую и английскую. Проверьте шаблон и длину названий в конструкторе документов."
    : "Документ с приложением должен формировать от 3 до 8 страниц. Проверьте шаблон, название программы и учебный план.");
  const font = await document.embedFont(PDF.StandardFonts.HelveticaBold);
  for (const page of document.getPages()) {
    const {width, height} = page.getSize();
    const size = width / 11;
    const textWidth = font.widthOfTextAtSize("SAMPLE", size);
    const angle = 35 * Math.PI / 180;
    const rotatedWidth = textWidth * Math.cos(angle) + size * Math.sin(angle);
    const rotatedHeight = textWidth * Math.sin(angle) + size * Math.cos(angle);
    page.drawText("SAMPLE", {font, size, x: (width - rotatedWidth) / 2 + size * Math.sin(angle), y: (height - rotatedHeight) / 2,
      rotate: PDF.degrees(35), color: PDF.rgb(0.55, 0.55, 0.55), opacity: 0.24});
  }
  document.setTitle("Education document samples / Образцы документов");
  document.setAuthor(""); document.setSubject(""); document.setKeywords([]);
  return Buffer.from(await document.save());
}

async function prepare(program, data, preferLocalTemplate, services) {
  program = withTrainingPlan(program, data);
  const type = programType(program);
  const spec = PROGRAM_TYPES[type];
  const source = sampleSource(program);
  const template = templateSettings(data, type);
  const bytes = await services.loadTemplate({...template, preferLocalTemplate});
  const hash = crypto.createHash("sha256").update(bytes).update(JSON.stringify({version: VERSION, source,
    fields: template.fields, custom: template.useCustomDocumentProperties})).digest("hex");
  return {hash, async generate(report = () => {}) {
    report("Подстановка формул в образцы документов");
    let values = evaluateFields(template, source, services.evaluate);
    if ([true, 1, "1", "true"].includes(template.useCustomDocumentProperties)) {
      values = services.applyFormulas(bytes, values, source);
      // Saved constructor formulas take priority over the retained Word defaults.
      if (!template.sampleUseTemplateDefaults) values = evaluateFields(template, source, services.evaluate, values);
    }
    // The public sample identity is not configurable and cannot consume a registration number.
    for (const name of ["ФИО", "ФИО_ENG", "ИО", "РегНомер", "РегНомер_ENG", "Номер бланка", "Email", "Фото", "QRкод"]) values[name] = source[name];
    const qr = services.createQr(values["QRкод"]);
    values["QRкод"] = "";
    const docx = services.fill(bytes, values, {"QRкод": qr, "Фото": null}, null, null, {preserveTemplateFonts: true});
    report("Преобразование образцов документов в PDF");
    let converted = await services.convert(docx);
    if (!spec.bilingual && services.removeBlankPages) converted = await services.removeBlankPages(converted);
    const pdf = await markSamplePdf(converted, services.pdf, type);
    const pageCount = (await services.pdf.PDFDocument.load(pdf)).getPageCount();
    const images = [];
    for (let index = 0; index < pageCount; index++) {
      report(`Подготовка изображения образца: страница ${index + 1} из ${pageCount}`);
      const language = index === 0 ? "ru" : spec.bilingual ? "en" : `page-${index + 1}`;
      const rendered = await services.render(pdf, index + 1);
      if (rendered.pageCount !== pageCount || rendered.preview?.mimeType !== "image/jpeg" || !rendered.preview.base64) {
        throw new Error("Не удалось получить все страницы образца документа. Проверьте сервис обработки документов.");
      }
      images.push({language, label: spec.bilingual ? (index ? "Сертификат — English" : "Сертификат — русский")
        : index ? `Приложение — страница ${index}` : type === "КПК" ? "Удостоверение" : "Диплом", base64: rendered.preview.base64});
    }
    return images;
  }};
}

module.exports = {TEMPLATE_ID, templateSettings, sampleSource, evaluateFields, markSamplePdf, prepare};
