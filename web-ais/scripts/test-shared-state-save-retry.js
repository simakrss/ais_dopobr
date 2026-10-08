"use strict";
// Execute the actual browser save/queue code with synthetic fetch, storage and time.
// No real browser, account, database or network is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "app.js"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
function extract(name) {
  const match = source.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  }`, "m"));
  assert.ok(match, `Missing function ${name}`);
  return match[0];
}

function harness() {
  let now = 100000, timerId = 0, revision = 10;
  const timers = new Map(), storage = new Map(), requests = [], recoveries = [], alerts = [];
  const seed = { collections: { students: [{ id: "test-1", note: "before" }] }, dictionaries: {}, meta: {} };
  let serverData = clone(seed);
  let reply = async body => {
    serverData = clone(c.applySharedApplicationStatePatchRaw(serverData, body.patch));
    return { revision: ++revision, data: serverData, source: "mysql", pendingCount: 0, offline: false };
  };
  const c = vm.createContext({
    sharedStateReady: true, sharedStateConflict: false, sharedStateConflictShown: false,
    sharedStateDirty: true, sharedStateSaveTimer: 0, sharedStateSavePromise: null,
    sharedStateSaveRunning: false, sharedStateSaveFailure: null,
    sharedStateChangeGeneration: 1, sharedStatePersistedGeneration: 0,
    sharedStateRevision: 10, sharedStateBackendId: "test", sharedStateVersionTag: "test-10",
    sharedStateUpdatedAt: "", sharedStateUpdatedBy: "", sharedStateSyncBlockedReason: "",
    sharedStatePendingPatch: null, sharedStateBaseData: clone(seed), sharedStatePendingCount: 0,
    sharedStateOffline: false, sharedStateSource: "mysql",
    sharedStateTransferProgress: { active: false, failed: false, percent: 0 },
    SHARED_STATE_SAVE_DELAY_MS: 700, SHARED_STATE_SAVE_RETRY_MIN_MS: 5000,
    SHARED_STATE_SAVE_RETRY_MAX_MS: 60000,
    SHARED_STATE_PENDING_STORAGE_KEY: "pending", SHARED_STATE_META_STORAGE_KEY: "meta",
    BROWSER_OFFLINE_RECOVERY_KEY: "recovery", TRAINING_END_NOTIFICATION_SERVER_META_KEYS: new Set(),
    recordLockClientId: "synthetic-client", state: { data: clone(seed) }, clone,
    sharedStateValuesEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    isSettingsDraftSessionActive: () => false, isDatabaseDemoMode: () => false,
    ensureDataShape: clone, withTrainingEndNotificationServerMeta: clone,
    persistStateToLocalStorage: data => storage.set("data", JSON.stringify(data)),
    queueBrowserOfflineWrite: async (key, snapshot) => { recoveries.push(clone(snapshot)); },
    localStorage: {
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)
    },
    updateSharedStateStatusUi() {}, photoApiUrl: value => value,
    beginSharedStateTransferProgress(operation, message) {
      c.sharedStateTransferProgress = { id: 1, active: true, failed: false, percent: 3, operation, message };
      return 1;
    },
    updateSharedStateTransferProgress(id, percent) { c.sharedStateTransferProgress.percent = percent; },
    finishSharedStateTransferProgress(id, message) {
      Object.assign(c.sharedStateTransferProgress, { active: false, failed: false, message, percent: 100 });
    },
    failSharedStateTransferProgress(id, message) {
      Object.assign(c.sharedStateTransferProgress, { active: true, failed: true, message });
    },
    readSharedApplicationStateResponse: response => response.json(),
    fetch: async (url, options) => {
      assert.equal(url, "/api/shared-state");
      const body = JSON.parse(options.body);
      requests.push(clone(body));
      try {
        const payload = await reply(body);
        return { ok: true, status: 200, json: async () => payload };
      } catch (error) {
        if (!error.status) throw error;
        return { ok: false, status: error.status, json: async () => ({ ...error.payload, error: error.message }) };
      }
    },
    escapeHtml: text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    formatDateTimeRu: value => value,
    alert: message => alerts.push(message), formatRecordLockMessage: () => "locked",
    reloadSharedApplicationState: async () => {}, console: { warn() {} },
    Date: class extends Date { static now() { return now; } },
    window: {
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout(id) { timers.delete(id); }
    }
  });
  vm.runInContext([
    "buildSharedApplicationStatePatch", "mergeSharedApplicationStatePatches",
    "applySharedApplicationStatePatchRaw", "applySharedApplicationStatePatchLocally",
    "persistSharedStateRecovery", "requestSharedApplicationState",
    "scheduleSharedApplicationStateSave", "flushSharedApplicationState", "performSharedApplicationStateSave",
    "flushSharedApplicationStateThroughGeneration", "getSharedStateStatusTone", "getSharedStateStatusLabel",
    "getSharedStateStatusTitle", "renderSharedStateStatusContents"
  ].map(extract).join("\n"), c);
  c.state.data.collections.students[0].note = "edited";
  c.persistSharedStateRecovery();
  return {
    c, timers, storage, requests, recoveries, alerts,
    fail(status, message = "Synthetic save rejection") {
      reply = async () => { throw Object.assign(new Error(message), { status }); };
    },
    setReply(fn) { reply = fn; },
    retryDelay() { assert.equal(timers.size, 1, "Exactly one pending retry"); return [...timers.values()][0].at - now; },
    async advance(ms) {
      now += ms;
      const due = [...timers].filter(([, timer]) => timer.at <= now);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
        if (c.sharedStateSavePromise) await c.sharedStateSavePromise;
        await Promise.resolve();
      }
    },
    acknowledge() {
      reply = async body => {
        serverData = clone(c.applySharedApplicationStatePatchRaw(serverData, body.patch));
        return { revision: ++revision, data: serverData, source: "mysql", pendingCount: 0, offline: false };
      };
    }
  };
}

(async () => {
  for (const status of [0, 500, 502, 503, 429]) {
    const h = harness(); h.fail(status);
    assert.equal(await h.c.flushSharedApplicationStateThroughGeneration(1), false, "Failure is not server confirmation");
    assert.equal(h.c.sharedStatePersistedGeneration, 0);
    assert.equal(h.c.sharedStateDirty, true);
    assert.equal(JSON.parse(h.storage.get("pending")).collections.students.upserts[0].note, "edited");
    assert.equal(h.c.sharedStateBaseData.collections.students[0].note, "before");
    assert.equal(h.retryDelay(), 5000);
    for (let i = 0; i < 10; i++) {
      h.c.scheduleSharedApplicationStateSave(0);
      assert.equal(await h.c.flushSharedApplicationStateThroughGeneration(1), false);
      await h.advance(0);
    }
    assert.equal(h.requests.length, 1, "No repeated requests without advancing time");
    assert.equal(h.retryDelay(), 5000);
    for (const [wait, nextWait] of [[5000, 10000], [10000, 20000], [20000, 40000], [40000, 60000], [60000, 60000]]) {
      await h.advance(wait - 1);
      assert.equal(h.retryDelay(), 1);
      await h.advance(1);
      assert.equal(h.retryDelay(), nextWait);
    }
    assert.equal(h.requests.length, 6);
    assert.equal(h.c.sharedStatePersistedGeneration, 0);
    h.c.state.data.collections.students[0].note = "edited again during outage";
    h.c.sharedStateChangeGeneration = 2;
    h.c.persistSharedStateRecovery();
    h.c.scheduleSharedApplicationStateSave(0);
    assert.equal(h.retryDelay(), 60000, "New edits respect the retry deadline");
    h.acknowledge();
    await h.advance(60000);
    assert.equal(h.c.state.data.collections.students[0].note, "edited again during outage");
    assert.equal(h.requests.at(-1).patch.collections.students.upserts[0].note, "edited again during outage");
    assert.equal(h.c.sharedStatePersistedGeneration, 2);
    assert.equal(h.c.sharedStateDirty, false);
    assert.equal(h.c.sharedStateSaveFailure, null);
    assert.equal(h.storage.has("pending"), false, "Only server confirmation clears the durable queue");
    assert.equal(h.recoveries.at(-1).pendingPatch, null);
    assert.equal(h.timers.size, 0);
    h.c.state.data.collections.students[0].note = "next edit";
    h.c.sharedStateDirty = true; h.c.sharedStateChangeGeneration++;
    h.fail(status);
    await h.c.flushSharedApplicationState();
    assert.equal(h.retryDelay(), 5000, "Success resets exponential backoff");
  }

  for (const status of [401, 403]) {
    const h = harness(); h.fail(status, "Доступ запрещён <test>");
    h.c.scheduleSharedApplicationStateSave(0);
    await h.advance(0);
    assert.equal(h.c.sharedStateSaveFailure.paused, true);
    assert.equal(h.c.sharedStatePersistedGeneration, 0);
    assert.equal(h.timers.size, 0, "Authentication/access errors stop automatic retries");
    for (let i = 0; i < 10; i++) { h.c.scheduleSharedApplicationStateSave(0); await h.advance(60000); }
    assert.equal(h.requests.length, 1);
    assert.equal(h.storage.has("pending"), true);
    assert.match(h.c.getSharedStateStatusLabel(), new RegExp(`HTTP ${status}`));
    assert.match(h.c.getSharedStateStatusTitle(), /Автоматические повторы приостановлены/);
    assert.match(h.c.renderSharedStateStatusContents(), /&lt;test&gt;/);
    assert.doesNotMatch(h.c.renderSharedStateStatusContents(), /<test>|shared-state-progress-value/);
    h.acknowledge();
    assert.equal(await h.c.flushSharedApplicationStateThroughGeneration(1), true, "Explicit save can retry after access is restored");
    assert.equal(h.c.sharedStateSaveFailure, null);
    assert.equal(h.timers.size, 0);
  }

  const concurrent = harness();
  let resolveRequest;
  concurrent.setReply(() => new Promise(resolve => { resolveRequest = resolve; }));
  const first = concurrent.c.flushSharedApplicationState();
  assert.equal(first, concurrent.c.flushSharedApplicationState(), "Concurrent callers share one request");
  assert.equal(concurrent.requests.length, 1);
  const confirmedData = clone(concurrent.c.state.data);
  concurrent.c.state.data.collections.students[0].note = "changed while saving";
  concurrent.c.sharedStateChangeGeneration = 2;
  concurrent.c.persistSharedStateRecovery();
  resolveRequest({ revision: 11, data: confirmedData });
  assert.equal(await first, true);
  assert.equal(concurrent.c.sharedStatePersistedGeneration, 1);
  assert.equal(concurrent.c.sharedStateDirty, true);
  assert.equal(concurrent.retryDelay(), 0, "Confirmed save immediately drains newer edits");
  assert.equal(concurrent.c.state.data.collections.students[0].note, "changed while saving");
  concurrent.acknowledge(); await concurrent.advance(0);
  assert.equal(concurrent.c.sharedStatePersistedGeneration, 2);
  assert.equal(concurrent.timers.size, 0);

  for (const status of [409, 423]) {
    const h = harness(); h.fail(status);
    assert.equal(await h.c.flushSharedApplicationState(), false);
    assert.equal(h.timers.size, 0, "Conflict/lock handling must not start generic retries");
    assert.equal(h.c.sharedStatePersistedGeneration, 0);
    assert.equal(h.storage.has("pending"), true);
    assert.equal(h.alerts.length, 1);
  }
  for (const status of [409, 423, 500]) {
    const h = harness(); h.fail(status);
    await assert.rejects(h.c.flushSharedApplicationState({ strictRevision: true, deferRevisionConflict: true, deferLockedSave: true }));
    assert.equal(h.timers.size, 0);
    assert.equal(h.c.sharedStatePersistedGeneration, 0);
    assert.equal(h.c.sharedStateSaveRunning, false);
    assert.equal(h.c.sharedStateSavePromise, null);
  }
  const empty = harness();
  empty.c.state.data = clone(empty.c.sharedStateBaseData);
  empty.c.sharedStatePendingPatch = null;
  empty.c.scheduleSharedApplicationStateSave(5000);
  assert.equal(await empty.c.flushSharedApplicationStateThroughGeneration(1), true);
  assert.equal(empty.requests.length, 0);
  assert.equal(empty.timers.size, 0, "A clean queue cancels obsolete save timers");
  assert.equal(empty.storage.has("pending"), false);

  console.log("Shared state save retry: network/5xx/429 backoff, 401/403 pause, recovery, generations, concurrent edits, conflict/lock/strict save and error UI passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
