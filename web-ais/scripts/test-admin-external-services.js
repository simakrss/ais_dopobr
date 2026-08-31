"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const serverSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n/g, "\n");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8").replace(/\r\n/g, "\n");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8").replace(/\r\n/g, "\n");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

assert.match(appSource, /\{ id: "external-services", label: "Сервисы" \}/u);
assert.match(appSource, /\{ id: "audit", label: "Журнал" \}/u);
assert.match(appSource, /<h2>Сервисы<\/h2>/u);
assert.match(appSource, /\{ id: "email", label: "Почта" \}/u);
assert.doesNotMatch(appSource, /\{ id: "email", label: "Электронная почта" \}/u);
assert.match(appSource, /getOrderedTabs\("admin", \[/u);
assert.match(appSource, /data-orderable-tabs="admin"/u);
assert.match(appSource, /<h3>\$\{escapeHtml\(title\)\}<\/h3>/u);
assert.match(appSource, /title: "Распознавание"/u);
assert.match(appSource, /title: "Формирование документов"/u);
assert.match(appSource, /authRequest\("api\/admin\/external-services"\)/u);
assert.match(appSource, /probeLocalDocumentServices\(force\)/u);
assert.match(appSource, /Локальный Docker[\s\S]*Защищённый туннель/u);
assert.match(styles, /\.admin-external-services-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/su);
assert.match(styles, /@media \(max-width: 980px\)[\s\S]*\.admin-external-services-grid\s*\{[^}]*grid-template-columns:\s*1fr/su);

const nodeTunnelSummary = sourceBlock(
  serverSource,
  "async function readTunnelRuntimeAdminSummary()",
  "async function buildExternalServicesAdminPayload()"
);
assert.match(nodeTunnelSummary, /secretConfigured/u);
assert.doesNotMatch(nodeTunnelSummary, /\bsecret\s*[,}]/u);
assert.doesNotMatch(nodeTunnelSummary, /\bsecret\s*:/u);
assert.match(serverSource, /requestUrl\.pathname === "\/api\/admin\/external-services"[\s\S]*authUser\?\.role !== "admin"/u);

const phpTunnelSummary = sourceBlock(
  gatewaySource,
  "function gateway_tunnel_admin_summary(): array",
  "function gateway_external_services_admin_payload(): array"
);
assert.match(phpTunnelSummary, /secretConfigured/u);
assert.doesNotMatch(phpTunnelSummary, /['"]secret['"]\s*=>/u);
assert.match(gatewaySource, /gateway_handle_admin_external_services[\s\S]*gateway_require_admin\(\$currentUser\)/u);

console.log("admin external services checks: OK");
