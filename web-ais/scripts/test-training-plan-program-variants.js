"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
function extract(name) {
  const start = app.indexOf(`  function ${name}(`);
  const next = /\n  (?:async )?function /gu;
  next.lastIndex = start + 1;
  const end = next.exec(app)?.index;
  assert.ok(start >= 0 && end > start, name);
  return app.slice(start, end);
}
const baseName = "Современные технологии преподавания математики в условиях реализации ФГОС";
const program = hours => ({id: `program-${hours}`, name: `${baseName} (${hours} ч)`, shortName: baseName, hours});
const p36 = program(36), p72 = program(72), p144 = program(144);
const input = (hours, values) => values.map((totalHours, index) => ({
  id: `training-plan-db-${hours}-${index}`, programName: program(hours).name, code: String(index + 1),
  discipline: index === 3 ? "Итоговая аттестация" : `Дисциплина ${index + 1}`,
  theoryHours: index === 3 ? 0 : 2, practiceHours: totalHours - (index === 3 ? 0 : 2), totalHours,
  xlsbTrainingPlanRow: hours + index, databaseSyncFormulaFields: ["theoryHours", "practiceHours"]
}));
const imported = [...input(36, [12, 12, 10, 2]), ...input(72, [18, 30, 22, 2]), ...input(144, [28, 68, 46, 2])];
const context = vm.createContext({
  state: {data: {collections: {programs: [p36, p72], trainingPlans: []}}},
  normalizeStudentDatabaseImportManagedFields: fields => fields,
  studentDatabaseFixedValuesEqual: (left, right) => String(left ?? "") === String(right ?? ""),
  collectProgramTrainingPlanRows: form => form.rows
});
const functions = ["normalizeProgramName", "findProgramInRows", "normalizeOptionalNumber", "parseTrainingPlanHoursValue",
  "roundTrainingPlanHours", "calculateTrainingPlanTotalHours", "normalizeTrainingPlanRecord", "trainingPlanImportKey",
  "mergeImportedTrainingPlanRows", "linkTrainingPlanRecordsToPrograms", "getTrainingPlanHours", "normalizeTrainingPlanProgramName",
  "getProgramTrainingPlanNameKeys", "isTrainingPlanRowLinkedToProgram", "getProgramTrainingPlanRows",
  "calculateProgramTrainingPlanHoursSummary", "getEducationDocumentTrainingPlanRows", "syncProgramTrainingPlanRows"];
vm.runInContext(functions.map(extract).join("\n"), context);
context.findEducationDocumentProgram = record => context.state.data.collections.programs.find(p => p.name === record.program) || null;
context.state.data.collections.trainingPlans = context.linkTrainingPlanRecordsToPrograms(
  context.mergeImportedTrainingPlanRows([], imported, []), [p36, p72]
);
const plans = context.state.data.collections.trainingPlans;
assert.equal(plans.length, 12, "Import preserves every Excel row, including the unregistered 144-hour variant");
assert.ok(plans.slice(8).every(row => !row.programId));
const selected = context.getProgramTrainingPlanRows(p72);
assert.equal(selected.length, 4);
assert.equal(context.calculateProgramTrainingPlanHoursSummary(72, selected).distributedHours, 72);
assert.equal(context.getProgramTrainingPlanRows(p36).length, 4);
assert.equal(context.getProgramTrainingPlanRows(p144).length, 4, "Unlinked exact variant stays available for its own program");
assert.equal(context.getEducationDocumentTrainingPlanRows({program: p72.name, hours: 72}).length, 4);

const row144 = plans[8];
assert.equal(context.isTrainingPlanRowLinkedToProgram(row144, p72), false);
assert.equal(context.isTrainingPlanRowLinkedToProgram(row144, {...p72, hours: ""}), false, "Hours can be read from the full program name");
assert.equal(context.isTrainingPlanRowLinkedToProgram({...row144, programName: `${baseName} (72 часов)`}, p72), true);
assert.equal(context.isTrainingPlanRowLinkedToProgram({...row144, programName: `${baseName} (72,5 ч)`}, {...p72, hours: "72,5"}), true);
assert.equal(context.isTrainingPlanRowLinkedToProgram(row144, {name: baseName}), false, "Unknown hours must not absorb a numbered variant");
assert.equal(context.isTrainingPlanRowLinkedToProgram({...row144, programName: baseName}, p72), true, "Legacy names without hours remain supported");
assert.equal(context.isTrainingPlanRowLinkedToProgram({...row144, programId: p72.id}, p72), true, "Explicit ID remains authoritative after renaming");
assert.equal(context.isTrainingPlanRowLinkedToProgram({...row144, programId: p36.id, programName: p72.name}, p72), false);

// Save the real selected plan: unrelated variants and their Excel metadata must survive unchanged.
const foreignBefore = JSON.stringify(plans.filter(row => row.programId !== p72.id));
context.syncProgramTrainingPlanRows({dataset: {config: "programs"}, rows: selected}, p72.id, p72, p72);
assert.equal(JSON.stringify(context.state.data.collections.trainingPlans.filter(row => row.programId !== p72.id)), foreignBefore);
assert.equal(context.state.data.collections.trainingPlans.length, 12);
assert.equal(context.getProgramTrainingPlanRows(p72).length, 4);

// If the correct plan is missing, document generation must not silently use the only other variant.
context.state.data.collections.trainingPlans = plans.slice(8);
assert.equal(context.getEducationDocumentTrainingPlanRows({program: p72.name, hours: 72}).length, 0);
context.state.data.collections.trainingPlans = [
  {...row144, programName: p72.name, programId: p36.id},
  ...plans.slice(8)
];
assert.equal(context.getEducationDocumentTrainingPlanRows({program: p72.name, hours: 72}).length, 0, "A foreign program ID cannot be borrowed via the name fallback");
context.state.data.collections.trainingPlans = [
  {...row144, programName: `${baseName} (72 часов)`, programId: ""},
  ...plans.slice(8)
];
assert.equal(context.getEducationDocumentTrainingPlanRows({program: p72.name, hours: 72}).length, 1);
console.log("Training plan variants: Excel import, 72 vs 144 hours, card totals, save isolation, aliases, explicit IDs and document fallback — OK");
