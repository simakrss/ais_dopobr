const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n?/gu, "\n");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/\r\n?/gu, "\n");

function sourceBlock(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Не найдено начало блока: ${startMarker}`);
  assert.ok(end > start, `Не найден конец блока: ${endMarker}`);
  return appSource.slice(start, end);
}

const dialogSource = sourceBlock(
  "  function chooseStudentExpulsionEducationDocumentAction(",
  "\n\n  async function openStudentEnrollmentOrderDocument("
);
assert.match(dialogSource, /role="alertdialog"/u);
assert.match(dialogSource, /Не заполнены данные для выдачи документа/u);
assert.match(dialogSource, /Если программа не освоена/u);
assert.match(dialogSource, /Пропустить заполнение/u);
assert.match(dialogSource, /Заполнить реквизиты/u);
assert.match(dialogSource, /missing\.map\(\(item\) =>/u);
assert.match(dialogSource, /finish\("skip"\)/u);
assert.match(dialogSource, /finish\("fill"\)/u);
assert.match(dialogSource, /finish\("cancel"\)/u);

const escapeSource = sourceBlock(
  "  function closeTopmostWindowByEscape()",
  "\n\n  function bindEvents()"
);
assert.match(
  escapeSource,
  /data-student-expulsion-education-document-dialog[\s\S]*?cancelStudentExpulsionEducationDocumentDialog/u,
  "Escape должен отменять формирование, а не пропускать реквизиты"
);

const autofillSource = sourceBlock(
  "  function autoFillEducationDocument()",
  "\n\n  function getOrdersSdoAutofillContext("
);
assert.match(autofillSource, /return values;/u);

const expulsionAutofillSource = sourceBlock(
  "  function getStudentEducationDocumentSequenceRecords(",
  "\n\n  async function openStudentEnrollmentOrderDocument("
);
assert.match(expulsionAutofillSource, /records: sequenceRecords/u);
assert.match(
  expulsionAutofillSource,
  /Object\.fromEntries\([\s\S]*?missingFields\.map\(\(item\) => \[item\.key, generatedValues\[item\.key\]\]\)/u,
  "Автозаполнение должно применять только отсутствующие реквизиты"
);
assert.match(expulsionAutofillSource, /updateStudentEducationDocumentSequenceRecords\(/u);
assert.doesNotMatch(
  expulsionAutofillSource,
  /values = autoFillEducationDocument\(\)/u,
  "Заполнение из предупреждения не должно перезаписывать все поля формы"
);

const sequenceSource = sourceBlock(
  "  function getDataFormulaTargetRecords(",
  "\n\n  function buildDataFormulaSequencePattern("
);
assert.match(sequenceSource, /Array\.isArray\(context\.records\)/u);
assert.match(sequenceSource, /getDataFormulaTargetRecords\(formula, currentId, context\)/u);

const educationNumberSequenceSource = sourceBlock(
  "  function getNextEducationBlankNumber(",
  "\n\n  function getEducationDocumentAutofillValues("
).replace(/^  /gmu, "");
const educationNumberContext = {
  state: {
    data: {
      collections: {
        students: [
          { id: "state-1", educationType: "КПК", diplomaBlankNo: "0000000099" }
        ]
      }
    }
  },
  normalizeEducationProgramType(value) {
    return String(value || "");
  },
  getStudentProgramTypeCode(record) {
    return record.educationType;
  }
};
vm.createContext(educationNumberContext);
vm.runInContext(
  educationNumberSequenceSource
    + "\nthis.nextBlank = getNextEducationBlankNumber;"
    + "\nthis.nextProtocol = getNextEducationProtocolNo;",
  educationNumberContext
);
const reservedEducationNumbers = [
  {
    id: "reserved-1",
    educationType: "КПК",
    diplomaBlankNo: "0000000001"
  },
  {
    id: "reserved-ppp-1",
    educationType: "ППП",
    diplomaBlankNo: "0000000004",
    diplomaIssueDate: "2026-08-31",
    protocolNo: "1"
  }
];
assert.equal(
  educationNumberContext.nextBlank("КПК", "", reservedEducationNumbers),
  "0000000002",
  "Номер бланка должен рассчитываться по рабочей коллекции приказа"
);
assert.equal(
  educationNumberContext.nextProtocol("2026-08-31", "", reservedEducationNumbers),
  "2",
  "Номер протокола должен учитывать уже зарезервированные значения"
);

const registrationSequenceSource = [
  sourceBlock(
    "  function evaluateDataFormula(",
    "\n\n  function getDataFormulaTargetRecords("
  ),
  sourceBlock(
    "  function getDataFormulaTargetRecords(",
    "\n\n  function parseOrdersSdoDate("
  )
].join("\n").replace(/^  /gmu, "");
const registrationSequenceContext = {
  Date,
  state: {
    data: {
      collections: {
        students: Array.from({ length: 5 }, (_, index) => ({
          id: "state-" + String(index + 1),
          registrationNo: String(index + 1) + "/26-ПК"
        })),
        contracts: []
      }
    }
  },
  educationRegistrationTypeCodeDefaults: [{ code: "ПК" }],
  getEducationRegistrationTypeCode() {
    return "ПК";
  }
};
vm.createContext(registrationSequenceContext);
vm.runInContext(
  registrationSequenceSource + "\nthis.nextRegistration = getNextDataFormulaYearSequence;",
  registrationSequenceContext
);
const registrationFormula = {
  targetField: "registrationNo",
  template: "{ПорядковыйНомерЗаГод}/{Год2}-{СокращениеТипаПрограммы}"
};
const reservedRegistrations = [{ id: "reserved-1", registrationNo: "1/26-ПК" }];
const registrationDate = new Date(2026, 7, 31);
assert.equal(
  registrationSequenceContext.nextRegistration(
    registrationFormula,
    registrationDate,
    "",
    {
      programType: "КПК",
      programTypeCode: "ПК",
      records: reservedRegistrations
    }
  ),
  2,
  "Регистрационный номер должен рассчитываться по рабочей коллекции, а не по сохранённому состоянию"
);
reservedRegistrations.push({ id: "reserved-2", registrationNo: "2/26-ПК" });
assert.equal(
  registrationSequenceContext.nextRegistration(
    registrationFormula,
    registrationDate,
    "",
    {
      programType: "КПК",
      programTypeCode: "ПК",
      records: reservedRegistrations
    }
  ),
  3,
  "Следующее автозаполнение должно видеть номер, зарезервированный предыдущему слушателю"
);

const openOrderSource = sourceBlock(
  "  async function openStudentExpulsionOrderDocument(",
  "\n\n  function getEmployeeContractDocumentFields("
);
assert.match(
  openOrderSource,
  /let orderRecords = getStudentOrderDocumentRecords\(record, "expulsionOrderNo"\);[\s\S]*?for \(const orderRecord of orderRecords\)/u
);
assert.match(
  openOrderSource,
  /getMissingStudentEducationDocumentIssueFields\(orderRecord\)[\s\S]*?chooseStudentExpulsionEducationDocumentAction\([\s\S]*?orderRecord,[\s\S]*?missingFields/u
);
assert.match(
  openOrderSource,
  /educationDocumentAction === "fill"[\s\S]*?autoFillStudentExpulsionEducationDocument\([\s\S]*?orderRecord,[\s\S]*?currentRecordId,[\s\S]*?educationDocumentSequenceRecords[\s\S]*?record = collectStudentFormDraft\(\)/u
);
assert.match(openOrderSource, /educationDocumentAction === "cancel"\) return null;/u);
assert.match(
  openOrderSource,
  /orderRecords = getStudentOrderDocumentRecords\(record, "expulsionOrderNo"\);[\s\S]*?openStudentCardBoundDocument/u
);

const issueFieldsSource = sourceBlock(
  "  function getStudentEducationDocumentIssueFields(",
  "\n\n  function formatExpulsionOrderStudentListItem("
);
assert.match(issueFieldsSource, /key: "diplomaBlankNo"/u);
assert.match(issueFieldsSource, /key: "registrationNo"/u);
assert.match(issueFieldsSource, /key: "diplomaIssueDate"/u);
assert.match(
  issueFieldsSource,
  /programType === "ППП"[\s\S]*?key: "protocolNo"[\s\S]*?key: "qualification"/u
);
assert.match(issueFieldsSource, /record\?\.qualification \|\| program\?\.qualification/u);
assert.match(issueFieldsSource, /getMissingStudentEducationDocumentIssueFields\(record\)\.length === 0/u);

const expulsionFilterSource = sourceBlock(
  "  function getExpulsionOrderDocumentRecords(",
  "\n\n  function formatExpulsionOrderStudentList("
);
assert.match(
  expulsionFilterSource,
  /hasStudentEducationDocumentIssueData\(item\) === issuedFilter/u,
  "Частично заполненные реквизиты нельзя считать выдачей документа"
);

function createOrderHarness(initialRecord, options = {}) {
  let draft = { ...initialRecord };
  const decisions = [...(options.decisions || [])];
  let records = (options.orderRecords?.length ? options.orderRecords : [initialRecord])
    .map((record) => ({ ...record }));
  if (!records.some((record) => String(record.id || "") === String(initialRecord.id || ""))) {
    records.unshift({ ...initialRecord });
  }
  const calls = {
    collect: 0,
    autofill: 0,
    generated: 0,
    marked: 0,
    warnings: [],
    markedRecords: []
  };
  const getMissingIssueFields = (record) => {
    const fields = [
      { key: "diplomaBlankNo", label: "Номер бланка" },
      { key: "registrationNo", label: "Регистрационный номер" },
      { key: "diplomaIssueDate", label: "Дата выдачи" }
    ];
    if (record.educationType === "ППП") {
      fields.push(
        { key: "protocolNo", label: "Номер протокола" },
        { key: "qualification", label: "Квалификация" }
      );
    }
    return fields.filter((field) => !String(record[field.key] || "").trim());
  };
  const updateStoredRecord = (recordId, values) => {
    records = records.map((record) => (
      String(record.id || "") === String(recordId || "")
        ? { ...record, ...values }
        : record
    ));
  };
  const context = {
    state: {
      modal: {
        id: initialRecord.id
      }
    },
    collectStudentFormDraft() {
      calls.collect += 1;
      return { ...draft };
    },
    getStudentCardDocumentTemplate() {
      return { title: "Приказ об отчислении", documentKind: "expulsionOrder" };
    },
    validateStudentDocumentRequiredFields() {
      return true;
    },
    ensureStudentOrderDocumentDate() {
      return true;
    },
    ensureStudentOrderNumber() {
      return true;
    },
    getMissingStudentEducationDocumentIssueFields(record) {
      return getMissingIssueFields(record);
    },
    getStudentEducationDocumentSequenceRecords(record) {
      return records.map((storedRecord) => (
        String(storedRecord.id || "") === String(record.id || "")
          ? { ...storedRecord, ...record }
          : { ...storedRecord }
      ));
    },
    async chooseStudentExpulsionEducationDocumentAction(record, missingFields) {
      calls.warnings.push({
        id: record.id,
        name: record.name,
        missing: missingFields.map((field) => field.key)
      });
      return decisions.shift() || "cancel";
    },
    autoFillStudentExpulsionEducationDocument(record, currentRecordId, sequenceRecords) {
      calls.autofill += 1;
      const usedBlankNumbers = sequenceRecords
        .map((item) => String(item.diplomaBlankNo || ""))
        .filter((value) => /^\d{1,10}$/u.test(value))
        .map(Number);
      const registrationCount = sequenceRecords
        .filter((item) => String(item.registrationNo || "").trim())
        .length;
      const generatedValues = {
        diplomaBlankNo: String((usedBlankNumbers.length ? Math.max(...usedBlankNumbers) : 0) + 1)
          .padStart(10, "0"),
        registrationNo: String(registrationCount + 1) + "/26-ПК",
        diplomaIssueDate: record.expulsionDate
      };
      if (record.educationType === "ППП") {
        generatedValues.protocolNo = "ПР-" + String(registrationCount + 1);
        generatedValues.qualification = "Специалист";
      }
      const values = Object.fromEntries(
        getMissingIssueFields(record).map((field) => [field.key, generatedValues[field.key]])
      );
      const updatedRecord = { ...record, ...values };
      if (String(record.id || "") === String(initialRecord.id || "")) {
        draft = { ...draft, ...updatedRecord };
      }
      updateStoredRecord(record.id, values);
      const sequenceIndex = sequenceRecords.findIndex((item) => (
        String(item.id || "") === String(record.id || "")
      ));
      if (sequenceIndex >= 0) sequenceRecords[sequenceIndex] = { ...sequenceRecords[sequenceIndex], ...updatedRecord };
      return updatedRecord;
    },
    getStudentOrderDocumentRecords(record) {
      return records.map((storedRecord) => (
        String(storedRecord.id || "") === String(record.id || "")
          ? { ...storedRecord, ...record }
          : { ...storedRecord }
      ));
    },
    async openStudentCardBoundDocument() {
      calls.generated += 1;
      return { generated: true };
    },
    markStudentEventsCompleted(orderRecords) {
      calls.marked += 1;
      calls.markedRecords = Array.isArray(orderRecords)
        ? orderRecords.map((record) => ({ ...record }))
        : [{ ...orderRecords }];
    }
  };
  vm.createContext(context);
  vm.runInContext(`${openOrderSource}\nthis.openOrder = openStudentExpulsionOrderDocument;`, context);
  return {
    calls,
    run: () => context.openOrder({ currentTarget: null })
  };
}

async function run() {
  const baseRecord = {
    id: "student-1",
    name: "Иванов Иван",
    program: "Курс",
    expulsionDate: "2026-08-31",
    expulsionOrderNo: "Отч-1",
    educationType: "КПК"
  };

  const ready = createOrderHarness({
    ...baseRecord,
    diplomaBlankNo: "0000000001",
    registrationNo: "КПК-1",
    diplomaIssueDate: "2026-08-31"
  }, { decisions: ["cancel"] });
  await ready.run();
  assert.equal(ready.calls.warnings.length, 0);
  assert.equal(ready.calls.generated, 1);

  const skipped = createOrderHarness(baseRecord, { decisions: ["skip"] });
  await skipped.run();
  assert.equal(skipped.calls.warnings.length, 1);
  assert.deepEqual(
    skipped.calls.warnings[0].missing,
    ["diplomaBlankNo", "registrationNo", "diplomaIssueDate"]
  );
  assert.equal(skipped.calls.autofill, 0);
  assert.equal(skipped.calls.generated, 1);

  const filled = createOrderHarness({
    ...baseRecord,
    diplomaBlankNo: "частично заполнено"
  }, { decisions: ["fill"] });
  await filled.run();
  assert.deepEqual(
    filled.calls.warnings[0].missing,
    ["registrationNo", "diplomaIssueDate"],
    "Частично заполненные реквизиты должны вызывать предупреждение"
  );
  assert.equal(filled.calls.autofill, 1);
  assert.equal(filled.calls.collect, 2);
  assert.equal(
    filled.calls.markedRecords[0].diplomaBlankNo,
    "частично заполнено",
    "Уже введённый номер бланка нельзя заменять"
  );
  assert.equal(filled.calls.markedRecords[0].registrationNo, "1/26-ПК");
  assert.equal(filled.calls.markedRecords[0].diplomaIssueDate, "2026-08-31");
  assert.equal(filled.calls.generated, 1);

  const cancelled = createOrderHarness(baseRecord, { decisions: ["cancel"] });
  const cancelledResult = await cancelled.run();
  assert.equal(cancelledResult, null);
  assert.equal(cancelled.calls.generated, 0);
  assert.equal(cancelled.calls.marked, 0);

  const groupCurrent = {
    ...baseRecord,
    diplomaBlankNo: "0000000001",
    registrationNo: "КПК-1",
    diplomaIssueDate: "2026-08-31"
  };
  const groupMissing = {
    ...baseRecord,
    id: "student-2",
    name: "Петров Пётр",
    diplomaBlankNo: "частично заполнено"
  };
  const group = createOrderHarness(groupCurrent, {
    decisions: ["fill"],
    orderRecords: [groupCurrent, groupMissing]
  });
  await group.run();
  assert.equal(group.calls.warnings.length, 1);
  assert.equal(group.calls.warnings[0].id, "student-2");
  assert.equal(group.calls.warnings[0].name, "Петров Пётр");
  assert.deepEqual(group.calls.warnings[0].missing, ["registrationNo", "diplomaIssueDate"]);
  assert.equal(group.calls.autofill, 1);
  assert.equal(group.calls.generated, 1);
  const filledGroupRecord = group.calls.markedRecords.find((record) => record.id === "student-2");
  assert.equal(filledGroupRecord.diplomaBlankNo, "частично заполнено");
  assert.equal(filledGroupRecord.registrationNo, "2/26-ПК");
  assert.equal(filledGroupRecord.diplomaIssueDate, "2026-08-31");

  const sequenceGroup = createOrderHarness(baseRecord, {
    decisions: ["fill", "fill"],
    orderRecords: [
      baseRecord,
      {
        ...baseRecord,
        id: "student-3",
        name: "Сидоров Семён"
      }
    ]
  });
  await sequenceGroup.run();
  assert.deepEqual(
    sequenceGroup.calls.warnings.map((warning) => warning.id),
    ["student-1", "student-3"]
  );
  const firstGenerated = sequenceGroup.calls.markedRecords.find((record) => record.id === "student-1");
  const secondGenerated = sequenceGroup.calls.markedRecords.find((record) => record.id === "student-3");
  assert.equal(firstGenerated.diplomaBlankNo, "0000000001");
  assert.equal(secondGenerated.diplomaBlankNo, "0000000002");
  assert.equal(firstGenerated.registrationNo, "1/26-ПК");
  assert.equal(secondGenerated.registrationNo, "2/26-ПК");

  const ppp = createOrderHarness({
    ...baseRecord,
    educationType: "ППП",
    diplomaBlankNo: "0000000002",
    registrationNo: "ППП-2",
    diplomaIssueDate: "2026-08-31"
  }, { decisions: ["skip"] });
  await ppp.run();
  assert.deepEqual(ppp.calls.warnings[0].missing, ["protocolNo", "qualification"]);
  assert.equal(ppp.calls.generated, 1);

  assert.match(appSource, /version: "1\.7\.372"[\s\S]*?предупреждает об отсутствии реквизитов документа об образовании/u);
  assert.match(indexSource, /20260831-html-links-visible-text-v2/u);
  console.log("expulsion order education data warning checks: OK");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
