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
const {
  renderAdminSqlQuerySyntax,
  tokenizeSqlForFormatting,
  formatSqlQueryForAnalysis,
  shouldAutoFormatSqlQuery,
  ADMIN_SQL_KEYWORDS,
  ADMIN_SQL_KEYWORD_HELP
} = new Function(`
  ${keywordHelpSource}
  const escapeHtml = (value) => String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const escapeAttr = escapeHtml;
  ${syntaxRendererSource}
  return {
    renderAdminSqlQuerySyntax,
    tokenizeSqlForFormatting,
    formatSqlQueryForAnalysis,
    shouldAutoFormatSqlQuery,
    ADMIN_SQL_KEYWORDS,
    ADMIN_SQL_KEYWORD_HELP
  };
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
assert.equal(
  validateSqlMiniIdeQuery(
    "SELECT DISTINCT email, org AS organization, location AS origin, date AS sourceReceivedAt FROM wp_ass_reg WHERE email IS NOT NULL AND TRIM(email) <> ''",
    { allowWith: true, allowComments: true, allowTrailingSemicolon: true }
  ).tone,
  "valid",
  "Оператор сравнения перед пустой строкой не должен считаться незавершённым"
);
assert.equal(
  validateSqlMiniIdeQuery("SELECT '' AS empty_value, '(' AS marker FROM `contacts`", {}).tone,
  "valid",
  "Строковые литералы и экранированные имена должны учитываться как значения"
);
assert.match(
  validateSqlMiniIdeQuery("SELECT email FROM contacts WHERE email <>", {}).message,
  /не завершена/u
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

const compactSql = "SELECT DISTINCT email, org AS organization, location AS origin, date AS sourceReceivedAt FROM wp_ass_reg WHERE email IS NOT NULL AND TRIM(email) <> ''";
const formattedSql = formatSqlQueryForAnalysis(compactSql);
assert.match(formattedSql, /^SELECT\n  DISTINCT email,/u);
assert.match(formattedSql, /\n  org AS organization,/u);
assert.match(formattedSql, /\nFROM wp_ass_reg/u);
assert.match(formattedSql, /\nWHERE email IS NOT NULL\n  AND TRIM\(email\) <> ''$/u);
assert.equal(
  tokenizeSqlForFormatting(formattedSql).map((token) => token.text).join("\u0000"),
  tokenizeSqlForFormatting(compactSql).map((token) => token.text).join("\u0000"),
  "Форматирование должно менять только пробелы и переносы строк"
);
assert.equal(formatSqlQueryForAnalysis(formattedSql), formattedSql, "Повторное форматирование должно быть стабильным");
const literalSql = "SELECT 'FROM x WHERE y AND z' AS sample, :email AS parameter_value FROM contacts -- WHERE внутри комментария";
const formattedLiteralSql = formatSqlQueryForAnalysis(literalSql);
assert.match(formattedLiteralSql, /'FROM x WHERE y AND z'/u);
assert.match(formattedLiteralSql, /:email/u);
assert.match(formattedLiteralSql, /-- WHERE внутри комментария/u);
assert.match(formatSqlQueryForAnalysis("SELECT _utf8mb4'текст', X'AB12'"), /_utf8mb4'текст',[\s\S]*X'AB12'/u);
assert.match(formatSqlQueryForAnalysis("SELECT email /* пояснение */, org FROM contacts"), /email \/\* пояснение \*\//u);
assert.equal(formatSqlQueryForAnalysis("SELECT 'незакрытая строка"), "SELECT 'незакрытая строка");
assert.match(
  formatSqlQueryForAnalysis("WITH recent AS (SELECT email FROM contacts WHERE active = 1) SELECT email FROM recent"),
  /^WITH recent AS \(\n  SELECT[\s\S]*\n\)\nSELECT/u
);
assert.equal(shouldAutoFormatSqlQuery(compactSql), true);
assert.equal(shouldAutoFormatSqlQuery("SELECT\n  email\nFROM contacts"), false);

assert.match(appSource, /function renderSqlMiniIde\(/u);
assert.match(appSource, /data-sql-mini-ide/u);
assert.match(appSource, /data-sql-query-editor/u);
assert.match(appSource, /data-sql-line-numbers/u);
assert.match(appSource, /data-action="format-sql-query"/u);
assert.match(appSource, /function formatSqlMiniIdeEditor\(/u);
assert.match(appSource, /Синтаксис корректен/u);
assert.doesNotMatch(appSource, /Синтаксис: корректно/u);
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
assert.match(stylesSource, /\.sql-mini-ide-editor-frame/u);
assert.match(stylesSource, /\.sql-mini-ide-line-numbers/u);
assert.match(stylesSource, /\.sql-mini-ide-format-button/u);
const sqlEditorFrameStyle = /\.sql-mini-ide-editor-frame\s*\{([^}]*)\}/u.exec(stylesSource)?.[1] || "";
assert.match(sqlEditorFrameStyle, /height:\s*300px;/u);
assert.match(sqlEditorFrameStyle, /resize:\s*vertical;/u);
assert.match(sqlEditorFrameStyle, /overflow:\s*hidden;/u);
const sqlMiniIdeEditorStyle = /\.sql-mini-ide \.admin-sql-query-editor\s*\{([^}]*)\}/u.exec(stylesSource)?.[1] || "";
assert.match(sqlMiniIdeEditorStyle, /height:\s*100%;/u);
assert.match(sqlMiniIdeEditorStyle, /min-height:\s*0;/u);
assert.match(sqlMiniIdeEditorStyle, /resize:\s*none;/u);
assert.match(stylesSource, /::highlight\(ais-sql-matching-brackets\)/u);
assert.match(stylesSource, /\.admin-sql-bracket\.is-matching/u);
assert.match(stylesSource, /\.admin-connection-panel[\s\S]*input\[type="text"\][\s\S]*border-radius: 8px/u);

console.log("SQL mini IDE tests passed.");
