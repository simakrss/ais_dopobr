"use strict";
// Only isolated temporary fixtures; no production documents, settings or emails.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const workflow = require("../document-workflow.js");
const root = path.resolve(__dirname, "..");
async function main() {
  const source = (await fs.readFile(path.join(root, "app-server.js"), "utf8")).replace(/\r\n/g, "\n");
  const extract = name => {
    const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}$`, "m"));
    assert.ok(match, name);
    return match[0];
  };
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ais-current-template-"));
  const calls = [];
  let cloudError = null;
  const context = {
    fs, path, process, URL, ROOT: fixtureRoot, documentWorkflow: workflow,
    DEFAULT_LOCAL_DOCUMENTS_ROOT: fixtureRoot, DEFAULT_YANDEX_DISK_BASE_PATH: "Company/System",
    serverSettings: {localDocumentsRoot: fixtureRoot, localDocumentsRootIsSystemParent: true, yandexDiskBasePath: "Company/System", openDocumentsLocally: false},
    WORD_TEMPLATE_EXTENSIONS: new Set(["docx"]), MAX_DOCX_BYTES: 100000,
    loadRemoteTemplateBytes: async url => { calls.push(url); if (cloudError) throw cloudError; return Buffer.from("CLOUD"); },
    isLocalDocumentStorageAvailable: () => assert.fail("Reading a template must not depend on storage settings")
  };
  vm.createContext(context);
  for (const name of ["normalizeSystemDocumentsRelativePath", "usesParentSystemDocumentsFolder", "normalizeWebDavPath",
    "parseHttpResourceUrl", "isYandexWebDavHost", "extractYandexWebDavPath", "resolveConfiguredYandexWebDavPath",
    "getAbsoluteFileSystemPathApi", "getRuntimeFileSystemPathApi", "resolveLocalDocumentsPath",
    "resolveLocalTemplatePathFromWebDavSource", "resolveLocalDocumentTemplateFile", "isUnavailableDocumentPathError",
    "loadLocalTemplateBytes", "loadTemplateBytes", "loadTemplateBytesForRequest"])
    vm.runInContext(extract(name), context);
  const write = async (file, value) => { await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, value); };
  try {
    const templateUrl = "[-1]/Договора/Шаблон договора (общий).docx";
    const original = path.join(fixtureRoot, "Договора", "Шаблон договора (общий).docx");
    const bundled = path.join(fixtureRoot, "storage", "old.docx");
    await write(original, "CURRENT-A"); await write(bundled, "OLD-COPY");
    await write(path.join(fixtureRoot, "System", "Договора", path.basename(original)), "WRONG-FOLDER");
    const request = {templateUrl, templatePath: original, fallbackTemplatePath: bundled, preferLocalTemplate: true};
    assert.equal(context.resolveLocalTemplatePathFromWebDavSource(templateUrl), original);
    assert.equal(await context.resolveLocalDocumentTemplateFile(templateUrl, bundled), original,
      "Reveal and generation preserve [-1] and use the same source");
    assert.equal((await context.loadTemplateBytesForRequest(request)).toString(), "CURRENT-A");
    const originalStat = await fs.stat(original);
    await write(original, "CURRENT-B");
    await fs.utimes(original, originalStat.atime, originalStat.mtime);
    assert.equal((await context.loadTemplateBytesForRequest(request)).toString(), "CURRENT-B",
      "Every generation rereads disk, including edits with identical size and modification time");
    assert.equal(calls.length, 0, "Accessible local source never uses cloud or bundled copies");
    assert.equal((await context.loadTemplateBytesForRequest({...request, templateUrl: "[-1]/Missing.docx"})).toString(), "CURRENT-B",
      "Explicit absolute local path is tried before cloud");
    assert.equal((await context.loadTemplateBytesForRequest({...request, templateUrl: "https://example.invalid/template.docx"})).toString(), "CURRENT-B");
    const relativeRequest = {...request, templateUrl: "[-1]/Missing.docx", templatePath: "storage/old.docx"};
    assert.equal((await context.loadTemplateBytesForRequest(relativeRequest)).toString(), "CLOUD");
    assert.equal(calls.at(-1), relativeRequest.templateUrl, "Offline fallback uses the same configured source, not a stored snapshot");
    cloudError = new Error("Configured template unavailable");
    await assert.rejects(context.loadTemplateBytesForRequest(relativeRequest), /Configured template unavailable/);
    cloudError = null;
    assert.equal((await context.loadTemplateBytesForRequest({templatePath: "storage/old.docx", preferLocalTemplate: true})).toString(), "OLD-COPY",
      "Intentionally uploaded templates without a linked original remain usable");
    for (const definition of workflow.definitions) {
      const file = context.resolveLocalDocumentsPath(definition.localTemplateSource);
      await write(file, definition.id);
      assert.equal((await context.loadTemplateBytesForRequest({templatePath: definition.templatePath, preferLocalTemplate: true})).toString(), definition.id,
        "Workflow document uses original: " + definition.id);
    }
    const remoteCount = calls.length;
    context.MAX_DOCX_BYTES = 1;
    await assert.rejects(context.loadTemplateBytesForRequest(request), /слишком большой/);
    assert.equal(calls.length, remoteCount, "Invalid local templates are not silently replaced");
    context.MAX_DOCX_BYTES = 100000;
    await assert.rejects(context.loadTemplateBytesForRequest({...request, templateUrl: "../outside.docx"}), /недопустимый сегмент/);

    // The outer generation handler used to swallow source errors and use a bundled contract.
    let fallbackCalls = 0, errorResponse;
    context.readJsonBody = async req => req.body;
    context.throwIfDocumentGenerationCancelled = () => {};
    context.loadTemplateBytesForRequest = async () => {throw new Error("Cannot read current template");};
    context.loadTemplateBytes = async () => {fallbackCalls++; throw new Error("Bundled fallback reached");};
    context.sendError = (_res, _status, message) => {errorResponse = message;};
    vm.runInContext(extract("handleContractDocument"), context);
    await context.handleContractDocument({body: request}, {}, {});
    assert.equal(errorResponse, "Cannot read current template"); assert.equal(fallbackCalls, 0);
    await context.handleContractDocument({body: {...request, preferLocalTemplate: false}}, {}, {});
    assert.equal(fallbackCalls, 1, "Non-local legacy fallback is unchanged");
    console.log("PASS: latest local bytes, sibling folders, source/reveal consistency, explicit paths, all workflow originals, no cached/bundled substitution, offline same-source fallback");
  } finally {
    assert.ok(fixtureRoot.startsWith(path.join(os.tmpdir(), "ais-current-template-")));
    await fs.rm(fixtureRoot, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error);process.exitCode = 1;});
