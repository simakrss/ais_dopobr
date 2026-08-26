const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function sliceSource(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Не найдено начало блока: ${startMarker}`);
  assert.ok(end > start, `Не найден конец блока: ${endMarker}`);
  return appSource.slice(start, end);
}

const forbiddenKeywordsSource = sliceSource(
  "const ADMIN_SQL_FORBIDDEN_KEYWORDS",
  "const ADMIN_SQL_SUGGESTIONS"
);
const validationSource = sliceSource(
  "function getSqlLineAndColumn",
  "function getSqlSuggestionContext"
);
const { validateSqlMiniIdeQuery } = new Function(
  `${forbiddenKeywordsSource}\n${validationSource}\nreturn { validateSqlMiniIdeQuery };`
)();

const applicationsQueryScript = fs.readFileSync(
  path.join(root, "scripts", "query-student-applications.ps1"),
  "utf8"
);
const defaultApplicationsQuery = String(
  /\$query\s*=\s*@'\r?\n([\s\S]*?)\r?\n'@/u.exec(applicationsQueryScript)?.[1] || ""
).trim();
assert.ok(defaultApplicationsQuery, "Не найден стандартный SQL-запрос интернет-магазина");
assert.equal(
  validateSqlMiniIdeQuery(defaultApplicationsQuery, {
    allowWith: false,
    allowComments: false,
    allowTrailingSemicolon: false,
    requiredParameters: 2
  }).tone,
  "valid",
  "Стандартный запрос интернет-магазина должен проходить проверку мини-IDE"
);

assert.equal(
  validateSqlMiniIdeQuery(
    "SELECT * FROM orders WHERE date_created >= ? AND date_created <= ?",
    { allowWith: false, allowComments: false, allowTrailingSemicolon: false, requiredParameters: 2 }
  ).tone,
  "valid"
);
assert.equal(
  validateSqlMiniIdeQuery(
    "WITH recent AS (SELECT email FROM contacts) SELECT email FROM recent;",
    { allowWith: true, allowComments: true, allowTrailingSemicolon: true }
  ).tone,
  "valid"
);
assert.match(
  validateSqlMiniIdeQuery("SELECT email FROM contacts WHERE name = 'Иванов", {}).message,
  /Не закрыта строка/u
);
assert.match(
  validateSqlMiniIdeQuery("SELECT email FROM contacts; DELETE FROM contacts", {}).message,
  /Разрешён только один SQL-запрос|DELETE/u
);
assert.match(
  validateSqlMiniIdeQuery("UPDATE contacts SET email = NULL", {}).message,
  /начинаться с SELECT|UPDATE/u
);
assert.match(
  validateSqlMiniIdeQuery("SELECT (email FROM contacts", {}).message,
  /Не закрыта круглая скобка/u
);
assert.match(
  validateSqlMiniIdeQuery("SELECT * FROM orders WHERE created_at >= ?", {
    allowWith: false,
    allowComments: false,
    allowTrailingSemicolon: false,
    requiredParameters: 2
  }).message,
  /Требуется параметров/u
);
assert.match(
  validateSqlMiniIdeQuery("SELECT * FROM orders -- комментарий\nWHERE id = 1", {
    allowWith: false,
    allowComments: false
  }).message,
  /Комментарии/u
);

assert.match(appSource, /function renderSqlMiniIde\(/u);
assert.match(appSource, /data-sql-mini-ide/u);
assert.match(appSource, /data-sql-query-editor/u);
assert.match(appSource, /data-advertising-source-field="sql"/u);
assert.match(appSource, /Ctrl[\s\S]*Пробел/u);
assert.match(appSource, /ADMIN_SQL_SUGGESTIONS/u);
assert.match(appSource, /showSqlMiniIdeSuggestions\(editor, true\)/u);
assert.match(appSource, /data-sql-open-suggestions/u);
assert.match(stylesSource, /\.sql-mini-ide-suggestions/u);
assert.match(stylesSource, /\.sql-mini-ide\.is-error/u);
assert.match(stylesSource, /\.admin-sql-token\.is-keyword/u);

console.log("SQL mini IDE tests passed.");
