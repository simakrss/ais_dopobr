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
      foreach ($name in @('Test-WslReady','Install-WslPrerequisite','Invoke-BootstrapProbe','Test-DockerInstallerSignature','Invoke-WslSetup','Write-WslLog','Test-WslRestartPending')) {
        $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$false)
        Invoke-Expression $function.Extent.Text
      }
      function Write-Step($text) {}
      $runtimeRoot=${psQuote(temp)}; $utf8=New-Object Text.UTF8Encoding($false)
      function Get-Command { [pscustomobject]@{Source='wsl.exe'} }
      function Get-CimInstance { [pscustomobject]@{InstallState=1} }
      function Invoke-BootstrapProbe { [pscustomobject]@{Code=0;Text='WSL version: 2.1.5.0'} }
      if (-not (Test-WslReady)) { throw 'WSL 2.1.5 should be ready' }
      function Invoke-BootstrapProbe { [pscustomobject]@{Code=0;Text='WSL version: 1.0.0.0'} }
      if (Test-WslReady) { throw 'Old WSL must be rejected' }
      $skipInstall=$false; $script:dockerRestartRequired=$false; $script:ready=$false
      function Test-WslReady { return $script:ready }
      function Invoke-ElevatedWslSetup { $script:ready=$true; return 0 }
      if (-not (Install-WslPrerequisite)) { throw 'WSL preparation failed' }
      function Test-WslReady { return $false }
      $script:boot=[datetime]'2026-11-15T10:00:00Z'
      function Get-CimInstance { [pscustomobject]@{LastBootUpTime=$script:boot} }
      function Invoke-ElevatedWslSetup { return 3010 }
      if ((Install-WslPrerequisite) -or -not $script:dockerRestartRequired) { throw 'Reboot must be reported, never forced' }
      function Invoke-ElevatedWslSetup { throw 'Must not repeat setup before reboot' }
      $script:dockerRestartRequired=$false
      if ((Install-WslPrerequisite) -or -not $script:dockerRestartRequired) { throw 'Must remember pending reboot' }
      $script:boot=$script:boot.AddHours(1)
      if (Test-WslRestartPending) { throw 'Reboot marker must clear logically after a new Windows boot' }
      function Invoke-ElevatedWslSetup { throw (New-Object ComponentModel.Win32Exception(1223)) }
      try { [void](Install-WslPrerequisite); throw 'Cancellation accepted' } catch { if ($_.Exception.Message -notmatch 'администратора отменено') { throw } }

      # Fresh Windows: enable both prerequisites, return 3010 without calling WSL before reboot.
      $script:enabled=@()
      function Get-WindowsOptionalFeature { [pscustomobject]@{State='Disabled'} }
      function Enable-WindowsOptionalFeature { param([switch]$Online,$FeatureName,[switch]$All,[switch]$NoRestart,$ErrorAction)
        if (-not $NoRestart) { throw 'Never reboot automatically' }
        $script:enabled += $FeatureName; [pscustomobject]@{RestartNeeded=$true}
      }
      function Invoke-BootstrapProbe { throw 'WSL must wait for reboot' }
      $logPath=Join-Path $runtimeRoot 'wsl-test.log'
      if ((Invoke-WslSetup $logPath) -ne 3010 -or $script:enabled.Count -ne 2) { throw 'Feature preparation did not request reboot' }
      function Get-WindowsOptionalFeature { [pscustomobject]@{State='EnablePending'} }
      function Enable-WindowsOptionalFeature { throw 'Pending feature must not be enabled again' }
      if ((Invoke-WslSetup $logPath) -ne 3010) { throw 'Pending reboot missed' }

      # Older inbox WSL does not support --web-download: use only supported flags.
      function Get-WindowsOptionalFeature { [pscustomobject]@{State='Enabled'} }
      $script:ready=$false; $script:calls=@()
      function Test-WslReady { return $script:ready }
      function Invoke-BootstrapProbe { param($FilePath,$Arguments,$TimeoutMilliseconds,$LogPath)
        $script:calls += $Arguments
        if ($Arguments -eq '--help') { return [pscustomobject]@{Code=0;Text='--install --no-distribution'} }
        if ($Arguments -eq '--version') { return [pscustomobject]@{Code=1;Text='unsupported'} }
        if ($Arguments -ne '--install --no-distribution') { throw 'Unsupported flag used' }
        $script:ready=$true; return [pscustomobject]@{Code=0;Text='installed'}
      }
      if ((Invoke-WslSetup $logPath) -ne 0) { throw 'Inbox WSL installation failed' }
      # Network/web-channel error: preserve OS details and retry the standard Microsoft channel.
      $script:ready=$false; $script:calls=@()
      function Invoke-BootstrapProbe { param($FilePath,$Arguments,$TimeoutMilliseconds,$LogPath)
        $script:calls += $Arguments
        if ($Arguments -eq '--help') { return [pscustomobject]@{Code=0;Text='--web-download'} }
        if ($Arguments -eq '--version') { return [pscustomobject]@{Code=1;Text='not installed'} }
        if ($Arguments -match '--web-download') { return [pscustomobject]@{Code=1;Text='Сбой загрузки 0x80072ee7'} }
        $script:ready=$true; return [pscustomobject]@{Code=0;Text='installed'}
      }
      if ((Invoke-WslSetup $logPath) -ne 0 -or $script:calls[-1] -ne '--install --no-distribution') { throw 'Missing standard channel fallback' }
      if ([IO.File]::ReadAllText($logPath) -notmatch '0x80072ee7') { throw 'Lost Windows error details' }
      $script:ready=$false
      function Invoke-BootstrapProbe { [pscustomobject]@{Code=1;Text='Отказано в доступе 0x80070005'} }
      try { [void](Invoke-WslSetup $logPath); throw 'Failure accepted' } catch { if ($_.Exception.Message -notmatch '0x80070005') { throw } }
      function Get-AuthenticodeSignature { [pscustomobject]@{Status='NotSigned';SignerCertificate=$null} }
      if (Test-DockerInstallerSignature ${psQuote(path.join(__dirname, "bootstrap-local-system.ps1"))}) { throw 'Unsigned installer accepted' }
      `);
      powershell(`$ast=[Management.Automation.Language.Parser]::ParseFile(${psQuote(path.join(__dirname, "bootstrap-local-system.ps1"))},[ref]$null,[ref]$null)
      $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-BootstrapProbe'},$false)
      Invoke-Expression $function.Extent.Text
      $result=Invoke-BootstrapProbe $env:ComSpec '/d /c "echo stdout-value & echo stderr-value 1>&2 & exit /b 17"'
      if ($result.Code -ne 17 -or $result.Text -notmatch 'stdout-value' -or $result.Text -notmatch 'stderr-value') { throw 'Probe lost stderr or exit code' }
      # Compile a tiny fixture that behaves like WSL redirected output, not an actual WSL install.
      $fixture=${psQuote(path.join(temp, "wsl.exe"))}
      Add-Type -TypeDefinition 'using System; using System.Text; public class WslProbeFixture { public static void Main() { Console.OutputEncoding = Encoding.Unicode; Console.WriteLine("Ошибка Windows"); Console.Error.WriteLine("Подробности 0x80070005"); Environment.Exit(1); } }' -OutputAssembly $fixture -OutputType ConsoleApplication
      $result=Invoke-BootstrapProbe $fixture '--version'
      if ($result.Code -ne 1 -or $result.Text -notmatch 'Ошибка Windows' -or $result.Text -notmatch 'Подробности 0x80070005') { throw 'WSL Unicode output corrupted' }
      `);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  const installer = fs.readFileSync(path.join(__dirname, "install-standalone.ps1"), "utf8");
  assert.match(installer, /Import-DockerPath[\s\S]*?Start-LocalWorker/);
  assert.match(installer, /-Action', 'Prepare'/);
  assert.match(installer, /@@AIS_COMPONENT_PREPARER_BASE64@@/);
  assert.match(installer, /-PreparationRoot', \$appRoot/);
  assert.match(installer, /Открыть журнал/);
  assert.match(installer, /\$bar.Value = if \(\$exitCode -eq 0\) \{ 100 \} else \{ 0 \}/);
  assert.doesNotMatch(installer, /Restart-Computer|shutdown\.exe|InstallIfMissing|Add-Type[^\n]+TypeDefinition/);
  const supervisor = fs.readFileSync(path.join(__dirname, "start-lan-system.js"), "utf8");
  assert.match(supervisor, /host: cloudClient \? "127\.0\.0\.1" : "0\.0\.0\.0"/);
  assert.match(supervisor, /if \(cloudClient\) return "disabled-cloud-client"/);
  assert.match(supervisor, /AIS_CLOUD_CLIENT: cloudClient \? "1" : "0"/);
  console.log(`standalone launcher tests: OK (${names.length} code-only files, signature, rollback, reuse, cold API, BAT, PowerShell)`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
