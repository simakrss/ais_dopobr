"use strict";

const crypto = require("node:crypto");
const TEMPLATE_ID = "education-document-certificate-dop-pro";
const VERSION = 1;
const MARKERS = ["Дата выдачи", "ИО", "Номер бланка", "Прогр обуч факт", "Прогр обуч факт_ENG",
  "РегНомер", "РегНомер_ENG", "Срок обучения_ENG", "ФИО", "ФИО_ENG", "Email", "QRкод"];

function templateSettings(data) {
  const saved = data?.dictionaries?.documentTemplates;
  const rows = Array.isArray(saved) ? saved : [];
  const template = rows.find(item => item.id === TEMPLATE_ID)
    || rows.find(item => item.documentKind === "education" && item.programTypes?.includes("ПРО"));
  if (template) return template;
  return {id: TEMPLATE_ID, templateUrl: "Документы/Сертификат ПРО.docx",
    templatePath: "storage/document-templates/Сертификат ПРО.docx", useCustomDocumentProperties: "1",
    sampleUseTemplateDefaults: true,
    fields: MARKERS.map(name => ({name, formula: `=[${name}]`}))};
}

function sampleSource(program) {
  const english = String(program.nameEnglish || program["Название программы на английском"] || "").trim();
  if (!english) throw new Error("Заполните «Название программы на английском» в карточке программы для создания английского образца сертификата.");
  const date = String(program.webinarDate || "");
  const displayedDate = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
  return {
    "ФИО": "ОБРАЗЕЦ", "ФИО_ENG": "SAMPLE", "ФИО_eng": "SAMPLE", "ИО": "ОБРАЗЕЦ",
    "РегНомер": "ОБРАЗЕЦ", "РегНомер_ENG": "SAMPLE", "Номер бланка": "SAMPLE", "Id": "0", "uid": "0",
    "Email": "", "Фото": "", "Стажировка": "", "ФИО_несклон": "+",
    "Прогр обуч факт": String(program.name || "").trim(), "Прогр обуч факт_ENG": english,
    "Название программы на английском": english, "Наименование программы": String(program.name || "").trim(),
    "Вид  программы ДПО": "ПРО", "Вид программы ДПО": "ПРО", "Количество часов": String(program.hours), "Часы": String(program.hours),
    "Дата выдачи": displayedDate, "Дата выдачи документа": displayedDate, "Дата начала обучения": displayedDate,
    "Дата окончания обучения": displayedDate, "Срок обучения_ENG": "",
    "QRкод": `https://edu-plus.ru/other_course/${String(program.landingCode || "").trim().replace(/^\/+|\/+$/g, "")}/`
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
  return Object.fromEntries(MARKERS.concat([...definitions.keys()]).map(name => [name, values[name] ?? ""]));
}

async function markSamplePdf(bytes, PDF) {
  const document = await PDF.PDFDocument.load(bytes);
  if (document.getPageCount() !== 2) throw new Error("Шаблон «Сертификат ПРО» должен формировать две страницы: русскую и английскую. Проверьте шаблон и длину названий в конструкторе документов.");
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
  document.setTitle("Certificate samples / Образцы сертификатов");
  document.setAuthor(""); document.setSubject(""); document.setKeywords([]);
  return Buffer.from(await document.save());
}

async function prepare(program, data, preferLocalTemplate, services) {
  const source = sampleSource(program);
  const template = templateSettings(data);
  const bytes = await services.loadTemplate({...template, preferLocalTemplate});
  const hash = crypto.createHash("sha256").update(bytes).update(JSON.stringify({version: VERSION, source,
    fields: template.fields, custom: template.useCustomDocumentProperties})).digest("hex");
  return {hash, async generate() {
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
    const pdf = await markSamplePdf(await services.convert(docx), services.pdf);
    const images = [];
    for (const [index, language] of ["ru", "en"].entries()) {
      const rendered = await services.render(pdf, index + 1);
      if (rendered.pageCount !== 2 || rendered.preview?.mimeType !== "image/jpeg" || !rendered.preview.base64) {
        throw new Error("Не удалось получить обе страницы образца сертификата. Проверьте сервис обработки документов.");
      }
      images.push({language, base64: rendered.preview.base64});
    }
    return images;
  }};
}

module.exports = {TEMPLATE_ID, templateSettings, sampleSource, evaluateFields, markSamplePdf, prepare};
