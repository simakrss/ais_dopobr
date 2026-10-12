"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process"), Module = require("node:module");
const root = path.resolve(__dirname, ".."), repo = path.dirname(root);
const update = require("../local-update.js");
const names = [...update.FILES, ...update.COMPONENTS];
const source = fs.readFileSync(path.join(__dirname, "standalone-package.js"), "utf8");
const keys = crypto.generateKeyPairSync("ed25519");
// Test-only key substitution; there is deliberately no production key override.
const moduleUnderTest = new Module(path.join(__dirname, "standalone-package.fixture.js"));
moduleUnderTest.filename = path.join(__dirname, "standalone-package.fixture.js");
moduleUnderTest._compile(source.replace(update.PUBLIC_KEY, keys.publicKey.export({ format: "der", type: "spki" }).toString("base64")), moduleUnderTest.filename);
const api = moduleUnderTest.exports;
const bytes = new Map(names.map(name => [name, Buffer.from(name)]));
const descriptor = name => ({ path: name, size: bytes.get(name).length, sha256: update.hash(bytes.get(name)) });
const release = { protocol: 1, version: "1.7.602", commit: "a".repeat(40), files: update.FILES.map(descriptor), components: update.COMPONENTS.map(descriptor) };
function sign(value) { const payload = Buffer.from(JSON.stringify(value)); return { payload: payload.toString("base64"), signature: crypto.sign(null, payload, keys.privateKey).toString("base64") }; }
const envelope = sign(release);
const byHash = new Map(names.map(name => [descriptor(name).sha256, bytes.get(name)]));
const mockDownload = async url => url.endsWith("latest.json") ? Buffer.from(JSON.stringify(envelope)) : byHash.get(url.match(/([a-f0-9]{64})\.bin$/)[1]);
const psQuote = value => "'" + value.replace(/'/g, "''") + "'";
function powershell(code, env = {}) {
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from("$ErrorActionPreference='Stop';\n" + code, "utf16le").toString("base64")], { encoding: "utf8", timeout: 40000, windowsHide: true, env: { ...process.env, ...env } });
  assert.equal(result.status, 0, (result.error?.message || "") + result.stdout + result.stderr);
  return result;
}
async function main() {
  assert.equal(api.validate(envelope).files.length, names.length);
  assert.throws(() => require("./standalone-package.js").validate(envelope), /Подпись/);
  assert.throws(() => api.validate({ ...envelope, signature: Buffer.alloc(64).toString("base64") }), /Подпись/);
  for (const bad of ["../escape.js", "scripts/../../escape.ps1", "storage/settings.json", "data/private-defaults.js", "C:/escape.js", "scripts/a\\b.js", "scripts//evil.ps1"]) {
    assert.throws(() => api.validate(sign({ ...release, components: [...release.components, { ...release.files[0], path: bad }] })), /Недопустимый/);
  }
  assert.throws(() => api.validate(sign({ ...release, files: [] })), /Неполный/);
  assert.throws(() => api.validate(sign({ ...release, version: "1.7.601" })), /самостоятельную/);
  assert.throws(() => api.validate(sign({ ...release, components: [...release.components, release.files[0]] })), /Недопустимый/);
  assert.throws(() => api.validate(sign({ ...release, files: release.files.map((entry, i) => i ? entry : { ...entry, size: 0 }) })), /Недопустимый/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ais-standalone-test-"));
  try {
    const target = path.join(temp, "new-client");
    const result = await api.install(target, { download: mockDownload });
    assert.equal(result.files, names.length);
    for (const name of names) assert.deepEqual(fs.readFileSync(path.join(target, name)), bytes.get(name));
    assert.equal(fs.existsSync(path.join(target, "data")), false);
    fs.mkdirSync(path.join(target, "storage")); fs.writeFileSync(path.join(target, "storage", "keep.txt"), "user data");
    assert.deepEqual(await api.install(target, { download: () => { throw Error("must not download on reuse"); } }), { reused: true });
    assert.equal(fs.readFileSync(path.join(target, "storage", "keep.txt"), "utf8"), "user data");
    const occupied = path.join(temp, "occupied"); fs.mkdirSync(occupied); fs.writeFileSync(path.join(occupied, "keep"), "unchanged");
    await assert.rejects(api.install(occupied, { download: mockDownload }), /уже занята/);
    assert.equal(fs.readFileSync(path.join(occupied, "keep"), "utf8"), "unchanged");
    const failed = path.join(temp, "failed");
    await assert.rejects(api.install(failed, { download: async url => url.endsWith("latest.json") ? mockDownload(url) : Buffer.from("corrupt") }), /Контрольная сумма/);
    assert.equal(fs.existsSync(failed), false);
    assert.equal(fs.readdirSync(temp).some(name => name.startsWith("ais-install-")), false);
    await assert.rejects(api.download("https://test.invalid", 4, async (_url, options) => { assert.equal(options.redirect, "error"); return new Response("too many bytes"); }), /размер/);
    await assert.rejects(api.download("https://test.invalid", 4, async () => new Response("no", { status: 404 })), /HTTP 404/);
    // Real code-only installation fixture, without private defaults, seed or database.
    const codeRoot = path.join(temp, "code-only");
    for (const name of names) { const dest = path.join(codeRoot, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(root, name), dest); }
    const load = spawnSync(process.execPath, ["-e", "require('./app-server.js').ensureStorage().then(()=>console.log('code-only API loaded')).catch(e=>{console.error(e);process.exitCode=1})"], {
      cwd: codeRoot, env: { ...process.env, AIS_CLOUD_CLIENT: "1", AIS_TRUST_GATEWAY: "1", AIS_APP_ROOT: codeRoot }, encoding: "utf8", timeout: 30000, windowsHide: true
    });
    assert.equal(load.status, 0, (load.error?.message || "") + load.stdout + load.stderr);
    assert.match(load.stdout, /code-only API loaded/);
    assert.equal(fs.existsSync(path.join(codeRoot, "storage", "users.json")), false, "cloud client must not create local default accounts");
    if (process.platform === "win32") {
      const standaloneBat = path.join(temp, "Только BAT & папка"); fs.mkdirSync(standaloneBat);
      fs.copyFileSync(path.join(repo, "ЗАПУСТИТЬ АИС.bat"), path.join(standaloneBat, "start.bat"));
      const bat = spawnSync("cmd.exe", ["/d", "/c", "start.bat"], { cwd: standaloneBat, env: { ...process.env, AIS_LAUNCHER_VALIDATE_ONLY: "1" }, windowsHide: true, encoding: "utf8", timeout: 30000 });
      assert.equal(bat.status, 0, bat.stdout + bat.stderr); assert.match(bat.stdout, /Standalone launcher: OK/);
      assert.deepEqual(fs.readdirSync(standaloneBat), ["start.bat"]);
      const psFiles = ["bootstrap-local-system.ps1", "install-standalone.ps1", "build-standalone-launcher.ps1", "deploy-lms.ps1"];
      powershell(`foreach ($file in @(${psFiles.map(name => psQuote(path.join(__dirname, name))).join(",")})) {
        $tokens=$null; $errors=$null; [void][Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
        if ($errors.Count) { throw ($file + ': ' + ($errors.Message -join '; ')) }
      }
      & ${psQuote(path.join(__dirname, "install-standalone.ps1"))} -ValidateOnly`);
      // Load functions only: no real downloads, installs, elevation, services, or shutdown.
      powershell(`$ast=[Management.Automation.Language.Parser]::ParseFile(${psQuote(path.join(__dirname, "bootstrap-local-system.ps1"))},[ref]$null,[ref]$null)
      foreach ($name in @('Test-WslReady','Install-WslPrerequisite','Invoke-BootstrapProbe','Test-DockerInstallerSignature')) {
        $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$false)
        Invoke-Expression $function.Extent.Text
      }
      function Write-Step($text) {}
      function Get-Command { [pscustomobject]@{Source='wsl.exe'} }
      function Get-CimInstance { [pscustomobject]@{InstallState=1} }
      function Invoke-BootstrapProbe { [pscustomobject]@{Code=0;Text='WSL version: 2.1.5.0'} }
      if (-not (Test-WslReady)) { throw 'WSL 2.1.5 should be ready' }
      function Invoke-BootstrapProbe { [pscustomobject]@{Code=0;Text='WSL version: 1.0.0.0'} }
      if (Test-WslReady) { throw 'Old WSL must be rejected' }
      $skipInstall=$false; $script:dockerRestartRequired=$false; $script:calls=@()
      function Test-WslReady { return $script:calls.Count -ge 2 }
      function Start-Process { param($FilePath,$ArgumentList,$Verb,$WindowStyle,[switch]$Wait,[switch]$PassThru)
        if ($WindowStyle -ne 'Hidden' -or $Verb -ne 'RunAs') { throw 'Incorrect WSL launch' }
        $script:calls += ,$ArgumentList; [pscustomobject]@{ExitCode=0}
      }
      if (-not (Install-WslPrerequisite)) { throw 'Install and update WSL failed' }
      if ($script:calls.Count -ne 2 -or $script:calls[1][0] -ne '--update') { throw 'Missing WSL update' }
      function Test-WslReady { return $false }
      function Start-Process { [pscustomobject]@{ExitCode=3010} }
      if ((Install-WslPrerequisite) -or -not $script:dockerRestartRequired) { throw 'Reboot must be reported, never forced' }
      function Get-AuthenticodeSignature { [pscustomobject]@{Status='NotSigned';SignerCertificate=$null} }
      if (Test-DockerInstallerSignature ${psQuote(path.join(__dirname, "bootstrap-local-system.ps1"))}) { throw 'Unsigned installer accepted' }
      `);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  const installer = fs.readFileSync(path.join(__dirname, "install-standalone.ps1"), "utf8");
  assert.match(installer, /Import-DockerPath[\s\S]*?Start-LocalWorker/);
  assert.match(installer, /-Action', 'Prepare'/);
  assert.doesNotMatch(installer, /Restart-Computer|shutdown\.exe|InstallIfMissing|Add-Type[^\n]+TypeDefinition/);
  const supervisor = fs.readFileSync(path.join(__dirname, "start-lan-system.js"), "utf8");
  assert.match(supervisor, /host: cloudClient \? "127\.0\.0\.1" : "0\.0\.0\.0"/);
  assert.match(supervisor, /if \(cloudClient\) return "disabled-cloud-client"/);
  assert.match(supervisor, /AIS_CLOUD_CLIENT: cloudClient \? "1" : "0"/);
  console.log(`standalone launcher tests: OK (${names.length} code-only files, signature, rollback, reuse, cold API, BAT, PowerShell)`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
