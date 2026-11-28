"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const publisher = require("./central-publisher.js");
assert.equal(publisher.versionFromSource('const APPLICATION_RELEASE = Object.freeze({ version: "1.7.655" })'), "1.7.655");
assert.throws(() => publisher.versionFromSource('version: "1.7.655"'));
assert.equal(publisher.compareVersions("1.7.655", "1.7.654"), 1);
assert.equal(publisher.compareVersions("1.7.655", "1.7.655"), 0);
assert.equal(publisher.compareVersions("1.7.9", "1.7.10"), -1);
assert.throws(() => publisher.compareVersions("1.7.655-test", "1.7.655"));
assert.deepEqual(publisher.deploymentPaths(["web-ais/app.js", "web-ais/storage/server-settings.json", "web-ais/app.js", "AGENTS.md", "web-ais/../secret"], ["app.js", "styles.css", "../secret"]), ["app.js"]);
assert.equal(publisher.psQuote("a' $(command)"), "'a'' $(command)'");
const config = {repository:"https://github.com/simakrss/ais_dopobr.git",branch:"codex/harden-static-serving",checkout:path.resolve("central-checkout")};
for (const key of ["git","node","powershell","profileDirectory","signingKeyPath","stateDirectory","localRoot"]) config[key]=path.resolve("fixture",key);
assert.equal(publisher.validateConfig(config),config);
assert.equal(publisher.validateConfig({...config,ftpServer:"vh486.timeweb.ru"}).ftpServer,"vh486.timeweb.ru");
for(const ftpServer of ["ftp://vh486.timeweb.ru","evil.test","vh486.timeweb.ru/other","vh486.timeweb.ru; command","vh486.timeweb.ru.evil.test"]) assert.throws(()=>publisher.validateConfig({...config,ftpServer}));
for(const changes of [{repository:"https://example.test/fork.git"},{branch:"../other"},{branch:"x; command"},{checkout:config.localRoot},{signingKeyPath:"relative.pem"}]) assert.throws(()=>publisher.validateConfig({...config,...changes}));
assert.throws(()=>publisher.validateConfig({...config,startupMode:true,localRoot:"\\\\server\\share\\app"}));

// Real Windows signature verification: use the already published, non-secret installer.
const root=path.resolve(__dirname,".."), signed=path.join(root,"updates/launcher/install-ais.ps1");
if (!fs.existsSync(signed)) throw Error("Download the published signed installer to updates/launcher before this test.");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"ais-launcher-signature-"));
const quote=publisher.psQuote;
try {
  const script=`
    $ErrorActionPreference='Stop'
    . ${quote(path.join(__dirname,"publisher-startup.ps1"))}
    $definition=New-AisPublisherTaskDefinition -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -PowerShell "$env:WINDIR\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Launcher ${quote(path.join(temp,"run.ps1"))} -WorkingDirectory ${quote(temp)} -AtStartup
    if ([string]$definition.Principal.LogonType -ne 'S4U' -or [string]$definition.Principal.RunLevel -ne 'Limited') { throw 'Startup task must use a limited non-interactive user logon' }
    if (@($definition.Triggers|Where-Object {$_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger'}).Count -ne 1) { throw 'Missing boot trigger' }
    if (@($definition.Triggers|Where-Object {$_.Repetition.Interval -eq 'PT3M'}).Count -ne 1) { throw 'Missing three-minute repetition' }
    if (@($definition.Triggers|Where-Object {$_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger'}).Count) { throw 'Startup task depends on user sign-in' }
    $fixture=Join-Path ${quote(temp)} 'fixture.txt'; [IO.File]::WriteAllText($fixture,'fixture')
    function Get-CimInstance { param($ClassName,$Filter) if($Filter -eq "DeviceID='W:'") { [pscustomobject]@{DriveType=4;ProviderName='\\\\localhost\\fixture'} } else { [pscustomobject]@{DriveType=3} } }
    function Get-SmbShare { param($Name) if($Name -ne 'fixture'){throw 'Unexpected share'}; [pscustomobject]@{Path=${quote(temp)}} }
    if((Resolve-AisPublisherStartupPath 'W:\\fixture.txt') -ne $fixture){throw 'Mapped local share was not resolved to a physical path'}
    $rejected=$false;try{Resolve-AisPublisherStartupPath '\\\\another-server\\share\\file'|Out-Null}catch{$rejected=$true};if(-not $rejected){throw 'Remote share was accepted for startup'}
    . ${quote(path.join(__dirname,"launcher-signature.ps1"))}
    $signed=${quote(signed)}; $thumb='65F97E8E8A4FD85B23624BDAA1F97541AC87ECEB'
    $text=[IO.File]::ReadAllText($signed); $body=Get-AisLauncherBody $text
    if (-not (Test-AisReusableLauncher $signed $body $thumb)) { $s=Get-AuthenticodeSignature -LiteralPath $signed; throw ('Valid launcher was not reusable: '+$s.Status+'; '+$s.StatusMessage+'; body length '+$body.Length) }
    if (Test-AisReusableLauncher $signed ($body+'changed') $thumb) { throw 'Different installer source accepted' }
    if (Test-AisReusableLauncher $signed $body ('0'*40)) { throw 'Wrong publisher accepted' }
    $unsigned=Join-Path ${quote(temp)} 'unsigned.ps1'; [IO.File]::WriteAllText($unsigned,$body)
    if (Test-AisReusableLauncher $unsigned $body $thumb) { throw 'Unsigned launcher accepted' }
    $tampered=Join-Path ${quote(temp)} 'tampered.ps1'; [IO.File]::WriteAllText($tampered,('# changed'+[Environment]::NewLine+$text),(New-Object Text.UTF8Encoding($true)))
    if (Test-AisReusableLauncher $tampered ('# changed'+[Environment]::NewLine+$body) $thumb) { throw 'Tampered signed launcher accepted' }
    Write-Output 'Real signature: unchanged accepted; source change, wrong publisher, unsigned and tampered files rejected.'
  `;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PSModulePath$/i.test(key)));
  const result=spawnSync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{encoding:"utf8",windowsHide:true,timeout:45000,env});
  assert.equal(result.status,0,result.stdout+result.stderr);console.log(result.stdout.trim());
} finally {
  // Delete only the three explicitly created test files, never a computed directory tree.
  for(const name of ["unsigned.ps1","tampered.ps1","fixture.txt"]) {const file=path.join(temp,name);if(fs.existsSync(file))fs.unlinkSync(file);}
  fs.rmdirSync(temp);
}
console.log("Central publisher: release ordering, origin/branch/path restrictions and source-bound signature reuse: OK");
