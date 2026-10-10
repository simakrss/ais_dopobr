"use strict";
const assert = require("node:assert/strict");
const { recommendTemplates, templateText } = require("../rusender");
const programs = [
  { id: "vak", name: "Он-лайн семинар: Подготовка статей в издания ВАК", type: "ПРО", hours: "1" },
  { id: "math", name: "Современные технологии преподавания математики в условиях реализации ФГОС (72 ч)", hours: "72" },
  { id: "cad", name: "Разработка конструкторской документации в САПР Компас-3D", hours: "300" },
  { id: "none", name: "Ландшафтный дизайн и проектирование садов", hours: "144" }
];
const letters = [
  { id: 11, name: "Приглашение 06.10", contextText: templateText({ html: '<html><head><style>Ландшафтный дизайн</style></head><body>Приглашаем на практический семинар по подготовке статей в изданиях ВАК. <a href="https://example.invalid">Подробнее</a></body></html>' }) },
  { id: 12, name: "Новое письмо", contextText: "Современные технологии преподавания математики в условиях реализации ФГОС. 72 часа." },
  { id: 13, name: "Осенняя рассылка", contextText: "Разработка конструкторской документации в САПР Компас-3D. Запись на обучение открыта." },
  { id: 14, name: "Новости учебного центра", contextText: "Добрый день! Уважаемые слушатели! Скидка на образовательные программы. Обучение дистанционно. Учебный центр Цифровизация Плюс." }
];
const selected = recommendTemplates(programs, letters, []);
for (const [programId, templateId] of [["vak", 11], ["math", 12], ["cad", 13]]) {
  const recommendation = selected.find(row => row.programId === programId);
  assert.ok(recommendation, programId);
  assert.equal(recommendation.templateId, templateId);
  assert.equal(recommendation.ambiguous, false);
  assert.ok(recommendation.reasons.includes("Текст письма"));
}
assert.ok(!selected.some(row => row.programId === "none"));
// Campaign subject supplies context even when a template's name is meaningless.
const bySubject = recommendTemplates(programs, [{ id: 21, name: "Без названия" }], [{ templateId: 21, name: "Рассылка 3", subject: "Разработка конструкторской документации в САПР Компас-3D" }]);
assert.equal(bySubject[0].programId, "cad");
assert.ok(bySubject[0].reasons.includes("Тема / название рассылки"));
const tied = recommendTemplates([programs[2]], [letters[2], { ...letters[2], id: 30 }], []);
assert.equal(tied[0].ambiguous, true);
assert.equal(tied[0].candidates.length, 2);
// Related disciplines alone must not attach an unrelated course.
assert.deepEqual(recommendTemplates([{ id: "a", name: "Методика преподавания математики" }], [{ id: 1, name: "Методика преподавания английского языка" }], []), []);
const variants = [{ id: "a", name: "Преподавание математики (72 ч)", hours: 72 }, { id: "b", name: "Преподавание математики (144 ч)", hours: 144 }];
const noHours = recommendTemplates(variants, [{ id: 1, name: "Преподавание математики" }], []);
assert.ok(noHours.every(row => row.variantAmbiguous));
const hours = recommendTemplates(variants, [{ id: 1, name: "Преподавание математики 72 ч" }], []);
assert.equal(hours.find(row => row.programId === "a").ambiguous, false);
assert.ok(!hours.find(row => row.programId === "b") || hours.find(row => row.programId === "b").score < hours.find(row => row.programId === "a").score);
const html = templateText({ html: '<script>Скрытый текст</script><style>Стили</style><!--comment--><p>&#x41;&#1041;&nbsp;&laquo;ВАК&raquo;</p><img src=x onerror="private()">' });
assert.equal(html, 'AБ «ВАК»');
assert.ok(!templateText({ html: '<p>&#999999999;</p>' }).includes("999999"));
assert.ok(templateText({ text: "a".repeat(100000) }).length <= 60000);
assert.deepEqual(recommendTemplates([{ id: "a", name: "Образовательная программа повышения квалификации" }], letters, []), []);
// A digest mentioning topics far apart cannot combine them into one strong hit.
assert.deepEqual(recommendTemplates([{ id: "a", name: "Конструирование авиационных двигателей" }], [{ id: 1, name: "Дайджест", contextText: "Конструирование " + "письменность ".repeat(100) + "авиационных " + "ремонт ".repeat(100) + "двигателей" }], []), []);
console.log("PASS Rusender context: body-only and subject matches, Russian inflections, no unrelated/generic matches, ties, hour variants, HTML stripping and bounded content.");
