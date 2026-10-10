"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  parseStudentEventSettings,
  parseContractEventSettings,
  validateStudentDatabaseReconciliationSelectionsAgainstOutput
} = require("../app-server.js");

const templates = [{ key: "first", label: "Event A" }, { key: "second", label: "Event B" }];
const byLabel = new Map(templates.map(event => [event.label.toLowerCase(), event.key]));
const kinds = [
  { root: "КарточкаСлушателя", collection: "students", parse: parseStudentEventSettings },
  { root: "КарточкаКонтрагента", collection: "contracts", parse: parseContractEventSettings }
];
function settings(root, selected, date = "") {
  return [
    `[${root}]`, "События=", `[${root}\\События]`, "Тип=LB", "Кол=2",
    ...(selected === null ? [] : [`Выд=${selected}`]),
    `[${root}\\События\\1]`, "Кол=2", `0=${Buffer.from(date).toString("base64")}`,
    `1=${Buffer.from("Event A").toString("base64")}`,
    `[${root}\\События\\2]`, "Кол=2", "0=", `1=${Buffer.from("Event B").toString("base64")}`
  ].join("\r\n");
}
for (const kind of kinds) {
  for (const selected of [null, "", " ", ",", " , , ", "invalid,-1,1.5,0x0,0e0,9007199254740993"]) {
    const parsed = kind.parse(settings(kind.root, selected), templates, byLabel);
    assert.equal(parsed.event_first_state, undefined, `${kind.root}: empty/invalid selection must not check event 0 (${selected})`);
    assert.equal(parsed.event_second_state, undefined);
    assert.equal(parsed.eventOrder, "first,second");
  }
  for (const [selected, expected] of [["0", [true, false]], ["1", [false, true]], [",1,", [false, true]], ["0,1", [true, true]], [" 0 , 0 ", [true, false]]]) {
    const parsed = kind.parse(settings(kind.root, selected), templates, byLabel);
    assert.deepEqual([parsed.event_first_state === "checked", parsed.event_second_state === "checked"], expected);
  }
  const dated = kind.parse(settings(kind.root, "0", "06.10.2026"), templates, byLabel);
  assert.equal(dated.event_first_state, "dated");
  assert.equal(dated.event_first_date, "2026-10-06");
  const uncheckedDate = kind.parse(settings(kind.root, "", "06.10.2026"), templates, byLabel);
  assert.equal(uncheckedDate.event_first_state, "unchecked");
  assert.equal(uncheckedDate.event_first_date, "2026-10-06");
  const latest = kind.parse(settings(kind.root, "0") + "\r\n" + settings(kind.root, ""), templates, byLabel);
  assert.equal(latest.event_first_state, undefined, "The latest empty selection replaces an older checked block");
}

// Exercise the real PowerShell serializer without opening Excel or touching a workbook.
if (process.platform === "win32") {
  const cases = kinds.flatMap(kind => [
    {}, { event_first_state: "checked" }, { event_second_state: "checked" },
    { event_first_state: "dated", event_first_date: "2026-10-06" },
    { event_first_state: "unchecked", event_first_date: "2026-10-06" },
    { event_first_state: "checked", eventDeleted: "first" }
  ].map(fields => ({
    root: kind.root, collection: kind.collection, templates,
    record: { id: "test-event-selection", uid: "test-1184", name: "Test", contractNo: "test", eventOrder: "first,second", ...fields }
  })));
  const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.join(__dirname, "test-student-database-event-selection.ps1")], {
    input: JSON.stringify(cases), encoding: "utf8", timeout: 30000, windowsHide: true
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const serialized = JSON.parse(run.stdout.trim());
  assert.equal(serialized.length, cases.length);
  cases.forEach((fixture, index) => {
    const kind = kinds.find(item => item.root === fixture.root);
    const parsed = kind.parse(serialized[index], templates, byLabel);
    const intended = {
      students: [], contracts: [],
      macroSettings: { studentEventTemplates: templates, contractEventTemplates: templates },
      [kind.collection]: [fixture.record]
    };
    const output = { ...intended, [kind.collection]: [{ id: fixture.record.id, uid: fixture.record.uid, name: fixture.record.name, contractNo: fixture.record.contractNo, ...parsed }] };
    assert.doesNotThrow(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(intended, output, {}), `Event round trip: ${index}`);
    const corrupted = structuredClone(output);
    const key = fixture.record.eventDeleted === "first" ? "second" : "first";
    const field = `event_${key}_state`;
    corrupted[kind.collection][0][field] = ["checked", "dated"].includes(parsed[field]) ? "unchecked" : "checked";
    assert.throws(() => validateStudentDatabaseReconciliationSelectionsAgainstOutput(intended, corrupted, {}), { code: "STUDENT_DATABASE_RECONCILIATION_OUTPUT_MISMATCH" }, "Real changes must still be rejected");
  });
}
console.log("PASS event selection: empty lists, strict indices, student/contract states and dates, real PowerShell round trip, mismatch protection");
