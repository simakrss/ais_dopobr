"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const gateway = path.join(__dirname, "..", "gateway.php");
const source = fs.readFileSync(gateway, "utf8");
const cases = [];
const normalize = value => {
  if (typeof value === "string") return value.toWellFormed();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
  return value;
};
function add(text, name) {
  const value = { baseRevision: 10, patch: { collections: { students: { upserts: [{ id: "fixture", note: text }] } } }, untouched: "ФИО, телефон и другие поля не меняются", flags: [null, true, 0] };
  const expected = normalize(value);
  const replacements = [...text].filter(char => char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff).length;
  cases.push({ name, raw: JSON.stringify(value), expected, replacements });
}
for (const [name, text] of [
  ["plain-text", "Текст без ошибок"],
  ["valid-emoji", "😀🚀𐀀􏿿"],
  ["high-at-end", "Текст \ud83d"],
  ["low-at-start", "\udc00 Текст"],
  ["bounds", "\ud800x\udbffx\udc00x\udfff"],
  ["mixed", "😀\ud83dРусский текст\udc00🚀"],
  ["literal-escapes", "Literal \\\\ud83d \\ud800 \\udfff and \\\\uD83D\\\\uDE00" + "\ud83d"],
  ["escaped-quotes", 'Text "key": "\\ud800" / \r\n \t \b \f \u0000 \ud83d'],
  ["large-text", "Письмо 😀 ".repeat(200000) + "\ud83d"],
  ["many-escapes", ('\\" quote " \n\t').repeat(10000) + "\udfff"],
]) add(text, name);
for (let count = 0; count < 10; count++) add("\\".repeat(count) + "ud83d \ud83d", "backslashes-" + count);
// Deterministic randomized UTF-16: compare against the JS Unicode-standard repair.
let seed = 123456789;
const fragments = ["x", "я", "\ud800", "\udbff", "\udc00", "\udfff", "😀", "\\", '"', "\n", ":", "uD83D", "\u0000"];
for (let index = 0; index < 250; index++) {
  let text = "";
  for (let i = 0; i < 60; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    text += fragments[seed % fragments.length];
  }
  add(text, "fuzz-" + index);
}
cases.push({ name: "uppercase-escapes", raw: '{"note":"\\uD800\\uDC00 \\uDBFFx\\uDC00"}', expected: { note: "𐀀 �x�" }, replacements: 2 });
for (const [name, raw] of [
  ["bad-key", '{"\\ud800":"not normalized","\\ufffd":"must not be overwritten"}'],
  ["bad-key-and-value", '{"\\ud800":"\\udfff","\\ufffd":"must not be overwritten"}'],
  ["unclosed", '{"note":"\\ud800"'],
  ["broken-syntax", '{"note":"\\ud800","other":}'],
  ["bad-escape", '{"note":"\\ud800\\q"}'],
  ["scalar", '"text\\ud800"'],
  ["depth", '{"value":'.repeat(600) + '"\\ud800"' + "}".repeat(600)],
]) cases.push({ name, raw, invalid: true });

const script = [
  "define('AIS_GATEWAY_LIBRARY_ONLY', true);",
  "require $argv[1];",
  "$cases = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);",
  "$results = [];",
  "foreach ($cases as $case) {",
  "  $count = 0;",
  "  $value = gateway_decode_shared_state_json($case['raw'], $count);",
  "  $results[] = ['name'=>$case['name'], 'value'=>$value, 'count'=>$count, 'jsonError'=>json_last_error()];",
  "}",
  "echo json_encode($results, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);"
].join("\n");
const run = spawnSync(process.env.PHP_BINARY || "php", ["-d", "auto_prepend_file=", "-r", script, gateway], {
  input: JSON.stringify(cases.map(({ name, raw }) => ({ name, raw }))),
  encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024
});
assert.equal(run.status, 0, run.error?.message || run.stderr || run.stdout.slice(0, 1000));
const results = JSON.parse(run.stdout);
assert.equal(results.length, cases.length);
for (let i = 0; i < cases.length; i++) {
  const fixture = cases[i], result = results[i];
  if (fixture.invalid) {
    assert.equal(result.value, null, fixture.name + ": invalid syntax or keys must not be silently accepted");
  } else {
    assert.deepEqual(result.value, fixture.expected, fixture.name);
    assert.equal(result.count, fixture.replacements, fixture.name + ": only isolated UTF-16 units are replaced");
    assert.equal(result.jsonError, 0, fixture.name);
  }
}
const handler = source.slice(source.indexOf("function gateway_handle_shared_state"), source.indexOf("function gateway_trash_error"));
assert.match(handler, /gateway_decode_shared_state_json\(\$body, \$unicodeReplacements\)/);
assert.match(handler, /if \(\$data !== null \|\| \$merged \|\| \$unicodeReplacements > 0\) \{\s*\$savedData = gateway_shared_state_read_data\(\$pdo\);/);
assert.match(handler, /if \(\$response\['merged'\] \|\| \$unicodeReplacements > 0\) \{\s*\$response\['data'\] = \$savedData;/);
console.log("Shared state JSON Unicode: " + cases.length + " cases passed; valid text/emoji/escapes preserved, bad keys/syntax rejected, canonical response required.");
