"use strict";
// A single, user-scoped publisher. Only the configured origin branch can release.
// PINs and credentials are never accepted here; deploy-lms owns secret access.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const REPOSITORY = "https://github.com/simakrss/ais_dopobr.git";
const BASE = "https://edu-plus.ru/lms/";
const psQuote = value => "'" + String(value).replace(/'/g, "''") + "'";
function versionFromSource(source) {
  const value = /APPLICATION_RELEASE\s*=\s*Object\.freeze\(\{\s*version:\s*"(\d+\.\d+\.\d+)"/.exec(source)?.[1];
  if (!value) throw Error("No application release version in the selected commit.");
  return value;
}
function compareVersions(a, b) {
  if (![a, b].every(value => /^\d+\.\d+\.\d+$/.test(value))) throw Error("Invalid release version.");
  const aa = a.split(".").map(Number), bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}
function validateConfig(config) {
  if (config.ftpServer && !/^vh[0-9]+\.timeweb\.ru$/.test(config.ftpServer)) throw Error("Unapproved FTP server override.");
  if (config.repository !== REPOSITORY || !/^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,160}$/.test(config.branch || "") || config.branch.includes("..")) throw Error("Unapproved repository or branch.");
  for (const key of ["checkout", "git", "node", "powershell", "profileDirectory", "signingKeyPath", "stateDirectory", "localRoot"]) {
    if (!path.isAbsolute(config[key] || "")) throw Error("Missing absolute publisher path: " + key);
    if (config.startupMode && config[key].startsWith("\\\\")) throw Error("Startup publisher requires local paths: " + key);
  }
  if (path.basename(config.checkout) !== "central-checkout" || path.resolve(config.checkout) === path.resolve(config.localRoot)) throw Error("A dedicated central-checkout is required.");
  return config;
}
function deploymentPaths(changed, allowed) {
  const allow = new Set(allowed);
  return [...new Set(changed.filter(value => value.startsWith("web-ais/"))
    .map(value => value.slice(8)).filter(value => allow.has(value) && !value.split("/").includes("..")))].sort();
}
async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000), cache: "no-store" });
  if (!response.ok) throw Error("HTTP " + response.status + " at " + new URL(url).pathname);
  return Buffer.from(await response.arrayBuffer());
}
async function run(config, { dryRun = false, verifyDependencies = false } = {}) {
  validateConfig(config);
  fs.mkdirSync(config.stateDirectory, { recursive: true });
  const statusPath = path.join(config.stateDirectory, "status.json");
  const writeStatus = value => {
    const target = statusPath + "." + process.pid + ".tmp";
    fs.writeFileSync(target, JSON.stringify({ updatedAt: new Date().toISOString(), ...value }, null, 2));
    fs.renameSync(target, statusPath);
  };
  const lock = path.join(config.stateDirectory, "publisher.lock");
  if (fs.existsSync(lock)) {
    const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
    try { process.kill(owner.pid, 0); return { phase: "busy" }; }
    catch (error) { if (error.code !== "ESRCH") return { phase: "busy" }; }
    fs.unlinkSync(lock);
  }
  const nonce = crypto.randomUUID();
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce }), { flag: "wx" });
  let candidateVersion = "", commit = "";
  const command = (file, args, options = {}) => {
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PSModulePath$/i.test(key)));
    const result = spawnSync(file, args, {
      cwd: config.checkout, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024,
      windowsHide: true, env: { ...environment, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never",
        PATH: [path.dirname(config.node), path.dirname(config.git), process.env.PATH || ""].join(path.delimiter) }, ...options
    });
    if (result.error || result.status !== 0) {
      const output = String(result.stdout || "") + String(result.stderr || "");
      if (output.includes("AIS_SIGNING_REQUIRED")) throw Error("AIS_SIGNING_REQUIRED: confirm the changed installer on the publisher computer.");
      // Do not persist external command output: FTP and credential errors may contain secrets.
      throw Error(path.basename(file) + " failed (" + (result.error?.code || result.status) + ").");
    }
    return String(result.stdout || "").trim();
  };
  // The approved repository is public. Read-only fetch must not depend on a
  // logged-in user's Credential Manager/DPAPI or start any sign-in UI.
  const git = (...args) => command(config.git, ["-c", "credential.helper=", "-c", "core.askPass=", "-c", "credential.interactive=false", "-C", config.checkout, ...args]);
  try {
    writeStatus({ phase: "checking", branch: config.branch });
    if (git("remote", "get-url", "origin") !== REPOSITORY) throw Error("Publisher origin changed.");
    if (git("status", "--porcelain", "--untracked-files=no")) throw Error("Publisher checkout has uncommitted changes.");
    git("fetch", "--no-tags", "origin", "+refs/heads/" + config.branch + ":refs/remotes/origin/" + config.branch);
    commit = git("rev-parse", "refs/remotes/origin/" + config.branch);
    if (!/^[a-f0-9]{40}$/.test(commit)) throw Error("Invalid candidate commit.");
    candidateVersion = versionFromSource(git("show", commit + ":web-ais/app.js"));
    // This validator is part of the installed publisher, with the existing pinned public key.
    const update = require("../local-update.js");
    const published = update.validateEnvelope(JSON.parse(await fetchBytes(BASE + "updates/latest.json?publisher=" + Date.now())));
    if (verifyDependencies) {
      const key = crypto.createPrivateKey(fs.readFileSync(config.signingKeyPath));
      if (crypto.createPublicKey(key).export({format:"der",type:"spki"}).toString("base64") !== update.PUBLIC_KEY) throw Error("Package signing key does not match the publisher.");
      const probe = Buffer.from("AIS background publisher dependency probe");
      if (!crypto.verify(null, probe, crypto.createPublicKey(key), crypto.sign(null, probe, key))) throw Error("Package signing probe failed.");
      const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
      command(config.powershell, [...args, "-File", path.join(config.checkout,"web-ais/scripts/build-standalone-launcher.ps1"), "-NoInteractiveSigning"]);
      command(config.powershell, [...args, "-File", path.join(config.checkout,"web-ais/scripts/deploy-lms.ps1"), "-ValidateProfileConnection", "-ProfileDirectory",config.profileDirectory,
        ...(config.ftpServer ? ["-FtpServer",config.ftpServer] : [])]);
      const context = JSON.parse(command(config.powershell, [...args,"-Command",
        "[pscustomobject]@{sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;interactive=[Environment]::UserInteractive;user=[Security.Principal.WindowsIdentity]::GetCurrent().Name}|ConvertTo-Json -Compress"]));
      const proof = {updatedAt:new Date().toISOString(),...context,github:true,manifestSignature:true,packageSigning:true,installerSignature:true,ftpConnection:true,localRoot:config.localRoot};
      fs.writeFileSync(path.join(config.stateDirectory,"background-verification.json"),JSON.stringify(proof,null,2));
      writeStatus({phase:"verified-dependencies",publishedVersion:published.version,commit,...proof});
      return {phase:"verified-dependencies",sessionId:context.sessionId,interactive:context.interactive};
    }
    const newer = compareVersions(candidateVersion, published.version) > 0;
    if (!newer) {
      let localVersion = "", localPhase = "unavailable", verified = false;
      try {
        const response = JSON.parse(await fetchBytes("http://127.0.0.1:8081/api/local-update/status"));
        const local = response.status || response;
        localVersion = local.version; localPhase = local.phase;
        if (localVersion === published.version && ["idle", "complete"].includes(localPhase)) {
          for (const file of update.releaseFiles(published)) {
            if (update.hash(fs.readFileSync(update.safeTarget(config.localRoot, file.path))) !== file.sha256) throw Error("Local file mismatch.");
          }
          for (const name of ["app.js", "styles.css", "auth-bootstrap.js", "index.html"]) {
            const expected = update.releaseFiles(published).find(file => file.path === name);
            if (!expected || update.hash(await fetchBytes("http://127.0.0.1:8081/" + name + "?publisher=" + Date.now())) !== expected.sha256) throw Error("Local HTTP file mismatch.");
          }
          if (!JSON.parse(await fetchBytes("http://127.0.0.1:8081/api/health")).ok) throw Error("Local health check failed.");
          verified = true;
        }
      } catch { localPhase = "unavailable-or-not-verified"; }
      const phase = verified ? "idle" : "waiting-local";
      writeStatus({ phase, branch: config.branch, candidateVersion, publishedVersion: published.version, commit,
        localVersion, localPhase, localVerified: verified });
      return { phase, version: published.version, localVersion, localVerified: verified };
    }
    // Never roll back/rewrite the publisher branch; require continuity from the published release.
    git("merge-base", "--is-ancestor", published.commit, commit);
    if (dryRun) {
      writeStatus({ phase: "ready", branch: config.branch, candidateVersion, publishedVersion: published.version, commit });
      return { phase: "ready", version: candidateVersion, commit };
    }
    git("checkout", "--detach", commit);
    const deploy = path.join(config.checkout, "web-ais/scripts/deploy-lms.ps1");
    const psArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
    const allowed = command(config.powershell, [...psArgs, "-File", deploy, "-ListDeployable", "-ProfileDirectory", config.profileDirectory]).split(/\r?\n/);
    const changed = git("diff", "--name-only", published.commit, commit, "--", "web-ais/").split(/\r?\n/);
    const files = deploymentPaths(changed, allowed);
    if (!files.includes("app.js")) throw Error("A new release must include app.js with its new version.");
    // Check syntax before touching the website; release-specific tests run before the Git push.
    for (const file of files.filter(value => value.endsWith(".js"))) command(config.node, ["--check", path.join(config.checkout, "web-ais", file)]);
    writeStatus({ phase: "publishing", branch: config.branch, candidateVersion, commit, files });
    const script = `& ${psQuote(deploy)} -Unattended -ProfileDirectory ${psQuote(config.profileDirectory)} -SigningKeyPath ${psQuote(config.signingKeyPath)}${config.ftpServer ? " -FtpServer " + psQuote(config.ftpServer) : ""} -RelativePath @(${files.map(psQuote).join(",")})`;
    command(config.powershell, [...psArgs, "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 45 * 60 * 1000 });
    const current = update.validateEnvelope(JSON.parse(await fetchBytes(BASE + "updates/latest.json?publisher=" + Date.now())));
    if (current.version !== candidateVersion || current.commit !== commit) throw Error("Published manifest did not confirm the candidate commit.");
    for (const file of files.filter(value => /\.(?:js|css|html)$/.test(value) && ["app.js", "styles.css", "auth-bootstrap.js", "index.html"].includes(value))) {
      if (update.hash(await fetchBytes(BASE + file + "?publisher=" + Date.now())) !== update.hash(fs.readFileSync(path.join(config.checkout, "web-ais", file)))) throw Error("Published file mismatch: " + file);
    }
    const health = JSON.parse(await fetchBytes(BASE + "api/health"));
    if (!health.ok) throw Error("Website health check failed.");
    await fetchBytes(BASE);
    // Request the existing updater. It retains its normal card/operation safety checks.
    update.atomicJson(path.join(update.runtimeDir(config.localRoot), "check-request.json"), { requestedAt: Date.now() });
    writeStatus({ phase: "published", branch: config.branch, candidateVersion, publishedVersion: current.version, commit, files,
      localUpdate: "Requested; installation waits for open cards and operations." });
    return { phase: "published", version: current.version, commit };
  } catch (error) {
    writeStatus({ phase: error.message.startsWith("AIS_SIGNING_REQUIRED") ? "needs-signature" : "error", candidateVersion, commit, error: error.message });
    throw error;
  } finally {
    if (fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock, "utf8")).nonce === nonce) fs.unlinkSync(lock);
  }
}
module.exports = { versionFromSource, compareVersions, validateConfig, deploymentPaths, psQuote, run };
if (require.main === module) {
  const index = process.argv.indexOf("--config");
  if (index < 0 || !process.argv[index + 1]) throw Error("Specify --config with the local publisher configuration.");
  run(JSON.parse(fs.readFileSync(process.argv[index + 1], "utf8").replace(/^\uFEFF/, "")), { dryRun: process.argv.includes("--check-only"), verifyDependencies:process.argv.includes("--verify-dependencies") })
    .then(result => console.log(JSON.stringify(result)), error => { console.error(error.message); process.exitCode = 1; });
}
