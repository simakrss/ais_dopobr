const assert = require("node:assert/strict");

const { buildLocalDocumentSaveDialogLauncher } = require("../app-server.js");

const launcher = buildLocalDocumentSaveDialogLauncher();

assert.match(launcher, /\$dialog\.CheckPathExists = \$true/u);
assert.match(launcher, /\$dialog\.ValidateNames = \$true/u);
assert.match(launcher, /\$owner\.TopMost = \$true/u);
assert.match(launcher, /\$dialog\.ShowDialog\(\$owner\)/u);
assert.match(launcher, /\$form\.ShowDialog\(\$owner\)/u);
assert.match(launcher, /\$form\.Add_Shown\(\{ \[void\]\$form\.Activate\(\); \[void\]\$form\.BringToFront\(\) \}\)/u);
assert.match(launcher, /\[void\]\$owner\.Activate\(\)/u);
assert.match(launcher, /Файл «.*» уже существует\./u);
assert.match(launcher, /Заменить его\?/u);
assert.match(launcher, /Test-Path -LiteralPath \$selectedPath -PathType Leaf/u);
assert.match(launcher, /AIS_SAVE_PATH:/u);
assert.match(launcher, /\$dialog\.Dispose\(\)/u);
assert.match(launcher, /\$owner\.Dispose\(\)/u);

console.log("Local document save flow checks passed.");
