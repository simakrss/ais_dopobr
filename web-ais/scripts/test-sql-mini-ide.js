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
const keywordHelpSource = sliceSource(
  "const ADMIN_SQL_KEYWORDS",
  "const ADMIN_SQL_FORBIDDEN_KEYWORDS"
);
const syntaxRendererSource = sliceSource(
  "function renderAdminSqlQueryPlainSyntax",
  "function renderSqlMiniIde"
);
const validationSource = sliceSource(
  "function getSqlLineAndColumn",
  "function getSqlSuggestionContext"
);
const { validateSqlMiniIdeQuery, getSqlMatchingParenthesisOffsets } = new Function(
  `${forbiddenKeywordsSource}\n${validationSource}\nreturn { validateSqlMiniIdeQuery, getSqlMatchingParenthesisOffsets };`
)();
const { renderAdminSqlQuerySyntax, ADMIN_SQL_KEYWORDS, ADMIN_SQL_KEYWORD_HELP } = new Function(`
  ${keywordHelpSource}
  const escapeHtml = (value) => String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const escapeAttr = escapeHtml;
  ${syntaxRendererSource}
  return { renderAdminSqlQuerySyntax, ADMIN_SQL_KEYWORDS, ADMIN_SQL_KEYWORD_HELP };
`)();
assert.deepEqual(
  [...ADMIN_SQL_KEYWORDS].filter((keyword) => !ADMIN_SQL_KEYWORD_HELP[keyword]),
  [],
  "Every highlighted SQL keyword should have hover help"
);

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

const nestedParenthesesQuery = "SELECT (SUM(amount + (tax))) FROM payments";
const outerOpen = nestedParenthesesQuery.indexOf("(");
const outerClose = nestedParenthesesQuery.lastIndexOf(")");
const innerOpen = nestedParenthesesQuery.lastIndexOf("(");
const innerClose = nestedParenthesesQuery.indexOf(")");
assert.deepEqual(getSqlMatchingParenthesisOffsets(nestedParenthesesQuery, outerOpen), [outerOpen, outerClose]);
assert.deepEqual(getSqlMatchingParenthesisOffsets(nestedParenthesesQuery, innerClose), [innerOpen, innerClose]);
const quotedParenthesisQuery = "SELECT '(' AS marker, (id) FROM contacts";
const realOpen = quotedParenthesisQuery.lastIndexOf("(");
assert.deepEqual(
  getSqlMatchingParenthesisOffsets(quotedParenthesisQuery, realOpen),
  [realOpen, quotedParenthesisQuery.indexOf(")", realOpen)]
);
assert.deepEqual(getSqlMatchingParenthesisOffsets("SELECT (id FROM contacts", 7), []);
const renderedSql = renderAdminSqlQuerySyntax("SELECT (id) FROM contacts");
assert.match(renderedSql, /data-sql-keyword-help="Выбирает поля/u);
assert.match(renderedSql, /data-sql-bracket-offset="7">\(<\/span>/u);
assert.match(renderedSql, /data-sql-bracket-offset="10">\)<\/span>/u);
assert.doesNotMatch(renderAdminSqlQuerySyntax("SELECT '(' AS marker"), /data-sql-bracket-offset/u);

assert.match(appSource, /function renderSqlMiniIde\(/u);
assert.match(appSource, /data-sql-mini-ide/u);
assert.match(appSource, /data-sql-query-editor/u);
assert.match(appSource, /data-advertising-source-field="sql"/u);
assert.match(appSource, /Ctrl[\s\S]*Пробел/u);
assert.match(appSource, /ADMIN_SQL_SUGGESTIONS/u);
assert.match(appSource, /showSqlMiniIdeSuggestions\(editor, true\)/u);
assert.doesNotMatch(appSource, /data-sql-open-suggestions/u);
assert.match(appSource, /data-sql-keyword-help/u);
assert.match(appSource, /data-sql-keyword-tooltip/u);
assert.match(appSource, /function updateSqlMiniIdeBracketHighlight\(/u);
const sqlEditorBindingSource = sliceSource(
  "function bindSqlMiniIdeEditor(",
  "function bindSqlMiniIdeEditors("
);
const sqlInputHandlerStart = sqlEditorBindingSource.indexOf('editor.addEventListener("input", () => {');
const sqlInputHandlerEnd = sqlEditorBindingSource.indexOf('editor.addEventListener("keydown"', sqlInputHandlerStart);
assert.ok(sqlInputHandlerStart >= 0 && sqlInputHandlerEnd > sqlInputHandlerStart, "Не найден обработчик ввода SQL");
const sqlInputHandlerSource = sqlEditorBindingSource.slice(sqlInputHandlerStart, sqlInputHandlerEnd);
assert.doesNotMatch(sqlInputHandlerSource, /refreshAdminSqlQueryEditor|refresh\(true\)/u);
assert.match(sqlInputHandlerSource, /suggestionPanel && !suggestionPanel\.hidden/u);
assert.match(sqlEditorBindingSource, /event\.ctrlKey[\s\S]*event\.code === "Space"[\s\S]*showSqlMiniIdeSuggestions\(editor, true\)/u);
assert.match(sqlEditorBindingSource, /editor\.addEventListener\("pointerdown", \(\) => closeSqlMiniIdeSuggestions\(editor\)\)/u);
assert.match(sqlEditorBindingSource, /mouseover[\s\S]*showSqlMiniIdeKeywordTooltip/u);
const sqlRefreshSource = sliceSource(
  "function refreshAdminSqlQueryEditor(",
  "function bindSqlMiniIdeEditor("
);
assert.match(sqlRefreshSource, /const scrollTop = editor\.scrollTop/u);
assert.match(sqlRefreshSource, /editor\.scrollTop = scrollTop/u);
assert.match(stylesSource, /\.sql-mini-ide-suggestions/u);
assert.match(stylesSource, /\.sql-mini-ide\.is-error/u);
assert.match(stylesSource, /\.admin-sql-token\.is-keyword/u);
const sqlEditorStyle = /\.admin-sql-query-editor\s*\{([^}]*)\}/u.exec(stylesSource)?.[1] || "";
assert.match(sqlEditorStyle, /overflow-x:\s*hidden;/u);
assert.match(sqlEditorStyle, /overflow-wrap:\s*anywhere;/u);
assert.match(sqlEditorStyle, /white-space:\s*pre-wrap;/u);
assert.match(stylesSource, /\.sql-mini-ide-keyword-tooltip/u);
assert.match(stylesSource, /::highlight\(ais-sql-matching-brackets\)/u);
assert.match(stylesSource, /\.admin-sql-bracket\.is-matching/u);
assert.match(stylesSource, /\.admin-connection-panel[\s\S]*input\[type="text"\][\s\S]*border-radius: 8px/u);

console.log("SQL mini IDE tests passed.");
