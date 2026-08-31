const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const gatewaySource = fs.readFileSync(path.join(root, "gateway.php"), "utf8").replace(/\r\n?/gu, "\n");
const appServerSource = fs.readFileSync(path.join(root, "app-server.js"), "utf8").replace(/\r\n?/gu, "\n");
const supervisorSource = fs.readFileSync(
  path.join(root, "scripts", "start-remote-services.ps1"),
  "utf8"
).replace(/\r\n?/gu, "\n");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

assert.match(
  gatewaySource,
  /const AIS_TUNNEL_CONNECT_TIMEOUT_SECONDS = 5;/u,
  "Недоступный tunnel не должен удерживать gateway на 20-секундном connect timeout."
);
assert.match(
  gatewaySource,
  /const AIS_TUNNEL_RUNTIME_MAX_AGE_SECONDS = 8 \* 60 \* 60;/u
);
const affinityTtlHours = Number(gatewaySource.match(
  /const AIS_DOCUMENT_PREVIEW_AFFINITY_TTL_SECONDS = (\d+) \* 60 \* 60;/u
)?.[1] || 0);
const editorTtlHours = Number(appServerSource.match(
  /const GENERATED_DOCUMENT_EDITOR_TTL_MS = (\d+) \* 60 \* 60 \* 1000;/u
)?.[1] || 0);
assert.ok(
  affinityTtlHours > editorTtlHours,
  "Gateway affinity TTL должен с запасом перекрывать двухчасовую editor session."
);
assert.match(
  supervisorSource,
  /TotalHours -ge 6[\s\S]+Publish-TunnelRuntime/u,
  "Supervisor должен обновлять runtime раньше восьмичасового TTL."
);

const freshnessSource = sourceBlock(
  gatewaySource,
  "function gateway_tunnel_runtime_is_fresh",
  "\n\nfunction gateway_tunnel_settings"
);
assert.match(freshnessSource, /\$runtime\['updatedAt'\]/u);
assert.match(
  freshnessSource,
  /\(\\\.\\d\{6\}\)\\d\+/u,
  "PowerShell ISO timestamp с седьмой долей секунды должен разбираться PHP."
);
assert.match(freshnessSource, /AIS_TUNNEL_RUNTIME_CLOCK_SKEW_SECONDS/u);
assert.match(freshnessSource, /AIS_TUNNEL_RUNTIME_MAX_AGE_SECONDS/u);

const settingsSource = sourceBlock(
  gatewaySource,
  "function gateway_tunnel_settings",
  "\n\nfunction gateway_handle_advertising_source_proxy"
);
assert.match(
  settingsSource,
  /!gateway_tunnel_runtime_is_fresh\(\$settings\)[\s\S]+return null;/u,
  "Stale runtime не должен считаться активной tunnel-конфигурацией."
);

const summarySource = sourceBlock(
  gatewaySource,
  "function gateway_tunnel_admin_summary",
  "\n\nfunction gateway_external_services_admin_payload"
);
assert.match(summarySource, /'configured' => \$enabled && \$fresh/u);
assert.match(summarySource, /'stale' => \$enabled && !\$fresh/u);

const documentRouteSource = sourceBlock(
  gatewaySource,
  "function gateway_document_tunnel_handles",
  "\n\nfunction gateway_response_header"
);
assert.match(documentRouteSource, /\$method === 'POST'/u);
assert.match(documentRouteSource, /'\/api\/contracts\/student-document'/u);
assert.match(documentRouteSource, /student-document-preview\/editor-page' => \['GET'\]/u);
assert.match(documentRouteSource, /student-document-preview\/editor-file' => \['GET', 'HEAD'\]/u);
assert.match(documentRouteSource, /student-document-preview\/editor-callback' => \['POST'\]/u);

assert.doesNotMatch(
  gatewaySource,
  /gateway_tunnel_response_requires_server_fallback/u,
  "HTTP 502/503/504/52x не доказывает, что POST не был выполнен, и не должен запускать replay."
);

const affinitySource = sourceBlock(
  gatewaySource,
  "function gateway_response_header",
  "\n\nfunction gateway_tunnel_handles"
);
assert.match(
  affinitySource,
  /function gateway_document_preview_request_token[\s\S]+\$queryToken[\s\S]+editor-page[\s\S]+editor-file[\s\S]+editor-callback/u,
  "Editor page/file/callback должны извлекать preview token из query."
);
assert.match(affinitySource, /AIS_DOCUMENT_PREVIEW_AFFINITY_TTL_SECONDS/u);
assert.match(affinitySource, /AIS_DOCUMENT_PREVIEW_AFFINITY_MAX_TOKENS/u);
assert.match(
  affinitySource,
  /hash\('sha256', \$token\)/u,
  "В PHP session должен храниться hash preview token, а не сам bearer token."
);
assert.match(affinitySource, /\['server', 'tunnel'\]/u);
assert.match(affinitySource, /X-Document-Preview-Token/u);
assert.match(
  affinitySource,
  /student-document-preview\/finalize[\s\S]+student-document-preview\/cancel[\s\S]+gateway_clear_document_preview_affinity/u,
  "Завершённые preview не должны оставлять affinity в сессии."
);

const transportSource = sourceBlock(
  gatewaySource,
  "function gateway_run_tunnel",
  "\n\nfunction gateway_server_settings"
);
assert.match(
  transportSource,
  /CURLOPT_CONNECTTIMEOUT => AIS_TUNNEL_CONNECT_TIMEOUT_SECONDS/u
);
assert.match(
  transportSource,
  /\$connectTime <= 0\.0[\s\S]+throw new GatewayTunnelUnavailableException/u,
  "Failover разрешён только когда соединение с tunnel не было установлено."
);
assert.equal(
  (transportSource.match(/throw new GatewayTunnelUnavailableException/gu) || []).length,
  1,
  "Transport failover exception должен возникать только при cURL connectTime=0."
);
const streamFailureSource = sourceBlock(
  transportSource,
  "if ($responseBody === false && $responseLines === [])",
  "\n    $status = 502;"
);
assert.match(streamFailureSource, /throw new RuntimeException/u);
assert.doesNotMatch(
  streamFailureSource,
  /GatewayTunnelUnavailableException/u,
  "Stream transport не сообщает connectTime, поэтому replay через SERVER для него небезопасен."
);
assert.match(
  transportSource,
  /X-AIS-Gateway-Token: ' \. \$settings\['secret'\]/u,
  "Живой tunnel должен по-прежнему получать отдельный gateway secret."
);

const dispatchSource = sourceBlock(
  gatewaySource,
  "$documentTunnelRoute = gateway_document_tunnel_handles($method, $path);",
  "\n\n    if ($method === 'POST' && $path === '/api/students/recognize-documents/start')"
);
assert.match(dispatchSource, /gateway_run_tunnel/u);
assert.match(
  dispatchSource,
  /\$tunnelHeaders\['x-ais-document-backend'\] = 'tunnel'[\s\S]+gateway_run_tunnel/u,
  "Tunnel app-server должен получать явный backend marker."
);
assert.match(
  dispatchSource,
  /gateway_track_document_preview_affinity\([\s\S]+?'tunnel'[\s\S]+X-AIS-Processing'[\]] = 'local-tunnel'[\s\S]+gateway_send_node_response/u,
  "Любой HTTP-ответ живого tunnel должен возвращаться без server replay."
);
assert.match(
  dispatchSource,
  /\$previewAffinityBackend !== 'server'[\s\S]+gateway_run_tunnel/u,
  "Preview, созданный на SERVER, не должен переключаться на оживший tunnel."
);
assert.match(
  dispatchSource,
  /\$previewAffinityBackend === 'tunnel' && \$tunnelSettings === null[\s\S]+gateway_fail/u,
  "Preview, созданный в tunnel, нельзя молча переносить на SERVER при stale runtime."
);
const unavailableCatchSource = sourceBlock(
  dispatchSource,
  "catch (GatewayTunnelUnavailableException $tunnelError)",
  " catch (Throwable $tunnelError)"
);
assert.match(
  unavailableCatchSource,
  /if \(!\$documentTunnelRoute \|\| \$previewRequestToken !== ''\)[\s\S]+gateway_fail/u,
  "Transport failover разрешён для создания документа, но не для уже созданного preview."
);

const finalServerDispatch = gatewaySource.slice(gatewaySource.lastIndexOf(
  "$serverHeaders = $authenticatedHeaders;"
));
assert.match(finalServerDispatch, /\$serverHeaders\['x-ais-document-backend'\] = 'server'/u);
assert.match(finalServerDispatch, /gateway_run_node\(\$url, \$method, \$serverHeaders, \$body\)/u);
assert.match(
  finalServerDispatch,
  /gateway_track_document_preview_affinity\([\s\S]+?'server'/u,
  "SERVER preview token должен закреплять последующие finalize/editor запросы за SERVER."
);
assert.match(finalServerDispatch, /gateway_send_node_response\(\$response\)/u);

const editorStartSource = sourceBlock(
  appServerSource,
  "async function handleGeneratedDocumentPreviewEditorStart",
  "\n\nasync function handleGeneratedDocumentPreviewEditorPage"
);
const editorBackendGuardSource = sourceBlock(
  appServerSource,
  "function assertGeneratedDocumentEditorBackendAvailable",
  "\n\nasync function resolveGeneratedDocumentEditorBrowserBaseUrl"
);
assert.match(
  editorBackendGuardSource,
  /generatedDocumentRequestBackend\(req\) !== "server"[\s\S]+generatedDocumentPreviewError\([\s\S]+503/u
);
assert.ok(
  editorStartSource.indexOf("assertGeneratedDocumentEditorBackendAvailable(req)")
    < editorStartSource.indexOf("beginGeneratedDocumentPreviewEditor"),
  "SERVER editor-start должен отклоняться до создания editor session и iframe URL."
);
for (const handler of ["EditorPage", "EditorFile", "EditorCallback"]) {
  const handlerStart = appServerSource.indexOf(`async function handleGeneratedDocumentPreview${handler}`);
  assert.ok(handlerStart >= 0);
  assert.match(
    appServerSource.slice(handlerStart, handlerStart + 800),
    /assertGeneratedDocumentEditorBackendAvailable\(req\)/u,
    `${handler} не должен обходить SERVER editor guard.`
  );
}

console.log("gateway document tunnel failover checks: OK");
