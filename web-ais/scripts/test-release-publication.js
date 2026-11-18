"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), deploy = fs.readFileSync(path.join(__dirname, "deploy-lms.ps1"), "utf8");
const start = deploy.indexOf("$signedRelease = if ("), end = deploy.indexOf("$results = if ($MoodleSso)", start);
assert.ok(start >= 0 && end > start, "Signing must complete before the first site upload");
const prepare = deploy.slice(start, end);
const publishStart = deploy.lastIndexOf("if ($signedRelease) {");
assert.ok(publishStart > end, "Release publication must follow successful site publication");
const publish = deploy.slice(publishStart);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ais-release-publication-"));
const app = path.join(temp, "Сборка & выпуск"), scripts = path.join(app, "scripts"), trace = path.join(temp, "trace.txt"), key = path.join(temp, "fixture.pem");
const ps = text => "'" + text.replace(/'/g, "''") + "'";
function powershell(source, failure = "", success = true) {
  fs.writeFileSync(trace, "");
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(`
    $ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
    . ${ps(path.join(scripts, "release-publication.ps1"))}
    $appRoot=${ps(app)}; $SigningKeyPath=${ps(key)}; $WindowsComponents=$false
    $MoodleSso=$false; $VituEmailExportRoot=''; $ProgramSites=$false; $DocumentRelay=$false; $TunnelRuntime=$false; $ValidateProfile=$false
    $remoteRoot='/fixture'; $StandaloneLauncher=$false
    function Publish-FileTarget([string]$RelativeFile, [string]$RemotePath, [string]$Target) {
      Add-Content -LiteralPath $env:AIS_RELEASE_FIXTURE_TRACE -Value ('upload:'+$RelativeFile)
      if ($env:AIS_RELEASE_FIXTURE_FAIL -eq $RelativeFile) { throw 'fixture upload failed' }
      [pscustomobject]@{File=$RelativeFile;Status='uploaded'}
    }
    ${source}
  `, "utf16le").toString("base64")], {
    encoding: "utf8", timeout: 30000, windowsHide: true,
    env: { ...process.env, LOCALAPPDATA: path.join(temp, "local-data"), AIS_RELEASE_FIXTURE_TRACE: trace, AIS_RELEASE_FIXTURE_FAIL: failure }
  });
  if (success) assert.equal(result.status, 0, (result.error?.message || "") + result.stdout + result.stderr);
  else assert.notEqual(result.status, 0, "Failure must not be reported as a successful publication");
  return fs.readFileSync(trace, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean);
}
try {
  fs.mkdirSync(scripts, { recursive: true }); fs.mkdirSync(path.join(temp, "local-data")); fs.writeFileSync(key, "fixture-only");
  fs.copyFileSync(path.join(__dirname, "release-publication.ps1"), path.join(scripts, "release-publication.ps1"));
  fs.writeFileSync(path.join(scripts, "build-local-update.js"), `
    const fs=require('fs'),path=require('path'),crypto=require('crypto');
    fs.appendFileSync(process.env.AIS_RELEASE_FIXTURE_TRACE,'package-sign\\n');
    if(process.env.AIS_RELEASE_FIXTURE_FAIL==='package')process.exit(1);
    const app=path.dirname(__dirname),dir=path.join(app,'updates');fs.mkdirSync(path.join(dir,'files'),{recursive:true});
    const entries=['app.js','scripts/start.js'].map(name=>{const bytes=Buffer.from(name),sha256=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(path.join(dir,'files',sha256+'.bin'),bytes);return {path:name,size:bytes.length,sha256};});
    const payload=Buffer.from(JSON.stringify({version:'1.7.648',files:[entries[0]],components:[entries[1]]})).toString('base64');
    fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify({payload,signature:'fixture-signature'}));
  `);
  fs.writeFileSync(path.join(scripts, "build-standalone-launcher.ps1"), `
    Add-Content -LiteralPath $env:AIS_RELEASE_FIXTURE_TRACE -Value 'installer-sign'
    if ($env:AIS_RELEASE_FIXTURE_FAIL -eq 'certificate') { throw 'fixture certificate unavailable' }
    $global:LASTEXITCODE=0
  `);
  const flow = `${prepare}\nPublish-FileTarget 'index.html' '/fixture/index.html' 'public' | Out-Null\n${publish}`;
  const events = powershell(flow), uploaded = events.filter(item => item.startsWith("upload:"));
  assert.deepEqual(events.slice(0, 3), ["package-sign", "installer-sign", "upload:index.html"], "Both signatures must precede site writes, without -StandaloneLauncher");
  assert.ok(uploaded.includes("upload:updates/install-1.7.648.zip"));
  assert.ok(uploaded.includes("upload:updates/launcher/install-ais.ps1"));
  assert.ok(uploaded.includes("upload:updates/launcher/start-ais.bat"));
  assert.equal(uploaded.at(-1), "upload:updates/latest.json", "Activate the release only after both deliverables");
  assert.deepEqual(powershell(flow), events, "Repeat publication must validate and reuse the complete ZIP");
  for (const failure of ["package", "certificate"]) {
    assert.ok(powershell(flow, failure, false).every(event => !event.startsWith("upload:")), "Signing failure must leave the website and latest release unchanged");
  }
  for (const failure of ["index.html", "updates/install-1.7.648.zip", "updates/launcher/install-ais.ps1", "updates/launcher/start-ais.bat"]) {
    assert.ok(!powershell(flow, failure, false).includes("upload:updates/latest.json"), "Failed upload must not activate the new version");
  }
  assert.deepEqual(powershell(`$SigningKeyPath=${ps(key + ".missing")}\n${flow}`, "", false), [], "Missing explicit key must fail before any build or upload");
  for (const variable of ["MoodleSso", "VituEmailExportRoot", "ProgramSites", "DocumentRelay", "TunnelRuntime", "ValidateProfile"]) {
    assert.deepEqual(powershell(`$${variable}=${variable === "VituEmailExportRoot" ? "'fixture'" : "$true"}\n${prepare}\n${publish}`), [], `${variable} must keep its separate deployment scope`);
  }
  const zip = path.join(app, "updates/install-1.7.648.zip"), zipBytes = fs.readFileSync(zip);
  fs.writeFileSync(zip, "invalid archive");
  assert.ok(!powershell(flow, "", false).some(event => event.startsWith("upload:")), "Corrupt cached ZIP must not reach publication");
  fs.writeFileSync(zip, zipBytes);
  powershell(`
    $root=${ps(path.join(temp, "key-locations"))}; [void][IO.Directory]::CreateDirectory($root)
    try { Resolve-AisReleaseSigningKey '' $root; throw 'missing key accepted' } catch { if ($_.Exception.Message -eq 'missing key accepted') { throw } }
    $redirected=Join-Path $root 'Packages/OpenAI.Codex_fixture/LocalCache/Local/AisDopobrPublisher/local-update-signing-private.pem'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $redirected)); [IO.File]::WriteAllText($redirected,'fixture-only')
    if ((Resolve-AisReleaseSigningKey '' $root) -ne $redirected) { throw 'Redirected key not discovered' }
    $standard=Join-Path $root 'AisDopobrPublisher/local-update-signing-private.pem'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $standard)); [IO.File]::WriteAllText($standard,'fixture-only')
    if ((Resolve-AisReleaseSigningKey '' $root) -ne $standard) { throw 'Standard key must take precedence' }
    if ((Resolve-AisReleaseSigningKey ${ps(key)} $root) -ne ${ps(key)}) { throw 'Explicit key must take precedence' }
  `);
  const missing = spawnSync(process.execPath, [path.join(__dirname, "build-local-update.js"), "--signing-key-path", key + ".absent"], { encoding: "utf8", windowsHide: true });
  assert.notEqual(missing.status, 0, "Direct package build must not silently skip missing signing key");
  assert.match(missing.stderr, /Ключ подписи пакета не найден/);
  console.log("Release publication: mandatory package + installer signatures, key discovery, fail-before-upload, ZIP verification, manifest last, repeat and integration-only modes: OK");
} finally {
  const resolved = fs.realpathSync(temp);
  assert.equal(resolved.toLowerCase(), path.resolve(temp).toLowerCase());
  assert.ok(path.basename(resolved).startsWith("ais-release-publication-") && path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase());
  fs.rmSync(resolved, { recursive: true, force: true });
}
