import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { HistoryService } from "../src/main/history-service";
import { SyncEngine, type SyncAuth, type SyncDrive } from "../src/main/sync-engine";
import { SyncRepository } from "../src/main/sync-repository";
import {
  compareSyncVersion,
  mergeHistoryRecords,
  mergeStateFragments
} from "../src/shared/sync";

test("sync merge uses updatedAt then deviceId and lets tombstones win ties", () => {
  assert.equal(compareSyncVersion({ updatedAt: 2, deviceId: "a" }, { updatedAt: 1, deviceId: "z" }) > 0, true);
  assert.equal(compareSyncVersion({ updatedAt: 2, deviceId: "z" }, { updatedAt: 2, deviceId: "a" }) > 0, true);
  const live = { schema: 1 as const, id: "h", textHash: "h", text: "hello", preview: "hello", createdAt: 1, lastUsedAt: 2, updatedAt: 3, deviceId: "a" };
  const tombstone = { schema: 1 as const, id: "h", textHash: "h", createdAt: 1, lastUsedAt: 2, updatedAt: 3, deletedAt: 3, deviceId: "a" };
  assert.equal("deletedAt" in mergeHistoryRecords([live, tombstone])![0], true);
});

test("state fragments preserve independent groups and enter read-only on future schema", () => {
  const merged = mergeStateFragments([
    { schema: 1, deviceId: "a", settings: { tier: { value: "fast", updatedAt: 1, deviceId: "a" } }, templates: {}, groups: { one: { id: "one", name: "One", hosts: ["claude.ai"], updatedAt: 1, deviceId: "a" } } },
    { schema: 1, deviceId: "b", settings: { tier: { value: "think", updatedAt: 2, deviceId: "b" } }, templates: {}, groups: { two: { id: "two", name: "Two", hosts: ["chatgpt.com"], updatedAt: 2, deviceId: "b" } } },
    { schema: 2, deviceId: "future", settings: {}, templates: {}, groups: {} }
  ]);
  assert.equal(merged.settings.tier.value, "think");
  assert.deepEqual(merged.groups.map((group) => group.id), ["one", "two"]);
  assert.equal(merged.readOnly, true);
});

test("state merge accepts extension schema 1 entries that inherit the fragment device", () => {
  const merged = mergeStateFragments([{
    schema: 1,
    deviceId: "extension-device",
    settings: { amsTheme: { value: "dark", updatedAt: 2 } },
    templates: {},
    groups: { shared: { id: "shared", name: "Shared", hosts: ["claude.ai"], updatedAt: 3 } }
  }]);
  assert.equal(merged.corrupt, 0);
  assert.equal(merged.settings.amsTheme.deviceId, "extension-device");
  assert.equal(merged.groups[0]?.deviceId, "extension-device");
});

function auth(): SyncAuth & { disconnected: boolean } {
  return {
    disconnected: false,
    configured: () => true,
    securePersistence: () => true,
    connect: async () => undefined,
    async disconnect() { this.disconnected = true; }
  };
}

test("background sync stays idle while Drive is disconnected", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  let connectCalls = 0;
  const session: SyncAuth = {
    configured: () => true,
    securePersistence: () => true,
    connect: async () => { connectCalls += 1; },
    disconnect: async () => undefined
  };
  const drive: SyncDrive = {
    getStartToken: async () => { throw new Error("must_not_sync"); },
    listFiles: async () => { throw new Error("must_not_sync"); },
    listChanges: async () => { throw new Error("must_not_sync"); },
    download: async () => { throw new Error("must_not_sync"); },
    upsert: async () => { throw new Error("must_not_sync"); },
    clearAll: async () => { throw new Error("must_not_sync"); }
  };
  try {
    const status = await new SyncEngine({ repository, drive, auth: session }).syncNow("periodic");
    assert.equal(status.connected, false);
    assert.equal(status.state, "idle");
    assert.equal(connectCalls, 0);
  } finally { database.close(); }
});

test("an explicit connection timeout stays disconnected and remains actionable", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  const session: SyncAuth = {
    configured: () => true,
    securePersistence: () => true,
    connect: async () => { throw new Error("network_timeout"); },
    disconnect: async () => undefined
  };
  const drive = {} as SyncDrive;
  try {
    const status = await new SyncEngine({ repository, drive, auth: session }).connect();
    assert.equal(status.connected, false);
    assert.equal(status.state, "offline");
    assert.equal(status.reason, "oauth_network_timeout");
  } finally { database.close(); }
});

test("Drive becomes connected only after the first authenticated handshake succeeds", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  const published: string[] = [];
  const drive: SyncDrive = {
    getStartToken: async () => { throw Object.assign(new Error("network_timeout"), { code: "network_timeout" }); },
    listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => null,
    upsert: async () => ({ id: "unused" }),
    clearAll: async () => undefined
  };
  try {
    const engine = new SyncEngine({
      repository,
      drive,
      auth: auth(),
      onStatus: (status) => { if (status.reason) published.push(status.reason); }
    });
    const status = await engine.connect();
    assert.equal(status.connected, false);
    assert.equal(repository.config().connected, false);
    assert.equal(status.state, "offline");
    assert.equal(status.reason, "drive_network_timeout");
    assert.deepEqual(published.slice(0, 2), ["oauth", "drive_check"]);
  } finally { database.close(); }
});

test("connection failures preserve the OAuth, token-storage, or Drive stage", async () => {
  const cases = [
    { authError: "network_error", expectedState: "offline", expectedReason: "oauth_network" },
    { authError: "auth_failed", expectedState: "auth", expectedReason: "oauth_rejected" },
    { authError: "oauth_invalid_grant", expectedState: "auth", expectedReason: "oauth_invalid_grant" },
    { authError: "oauth_invalid_client", expectedState: "blocked", expectedReason: "oauth_invalid_client" },
    { authError: "oauth_redirect_mismatch", expectedState: "blocked", expectedReason: "oauth_redirect_mismatch" },
    { authError: "refresh_token_missing", expectedState: "auth", expectedReason: "oauth_refresh_missing" },
    { authError: "token_store_failed", expectedState: "error", expectedReason: "token_storage" },
    { driveError: "network_error", expectedState: "offline", expectedReason: "drive_network" },
    { driveError: "unauthorized", expectedState: "auth", expectedReason: "drive_unauthorized" },
    { driveError: "invalid_response", expectedState: "error", expectedReason: "drive_response" }
  ] as const;

  for (const scenario of cases) {
    const database = DesktopDatabase.open(":memory:");
    database.meta.put("deviceId", "desktop-device");
    const repository = new SyncRepository(database);
    const session: SyncAuth = {
      configured: () => true,
      securePersistence: () => true,
      connect: async () => {
        if ("authError" in scenario) throw new Error(scenario.authError);
      },
      disconnect: async () => undefined
    };
    const drive: SyncDrive = {
      getStartToken: async () => {
        if ("driveError" in scenario) throw Object.assign(new Error(scenario.driveError), { code: scenario.driveError });
        return "start";
      },
      listFiles: async () => [],
      listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
      download: async () => null,
      upsert: async (_id, name, appProperties) => ({ id: `uploaded-${name}`, appProperties }),
      clearAll: async () => undefined
    };
    try {
      const status = await new SyncEngine({ repository, drive, auth: session }).connect();
      assert.equal(status.state, scenario.expectedState, scenario.expectedReason);
      assert.equal(status.reason, scenario.expectedReason);
    } finally { database.close(); }
  }
});

test("an unrecognized Google token rejection reaches the UI as a safe diagnostic", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  const session: SyncAuth = {
    configured: () => true,
    securePersistence: () => true,
    connect: async () => {
      throw Object.assign(new Error("oauth_provider_error"), {
        providerCode: "invalid_request",
        providerDetail: "client_secret"
      });
    },
    disconnect: async () => undefined
  };
  try {
    const status = await new SyncEngine({ repository, drive: {} as SyncDrive, auth: session }).connect();
    assert.equal(status.state, "auth");
    assert.equal(status.reason, "oauth_provider_error");
    assert.equal(status.diagnostic, "invalid_request / client_secret");
  } finally { database.close(); }
});

test("a successful first Drive handshake commits the connected state", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => null,
    upsert: async (_id, name, appProperties) => ({ id: `uploaded-${name}`, appProperties }),
    clearAll: async () => undefined
  };
  try {
    const status = await new SyncEngine({ repository, drive, auth: auth(), now: () => 2_000 }).connect();
    assert.equal(status.connected, true);
    assert.equal(status.state, "idle");
    assert.equal(status.reason, undefined);
    assert.equal(status.lastSuccessAt, 2_000);
  } finally { database.close(); }
});

test("sync diagnostics reflect the engine clock, runtime, and persisted connection state", () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({
    connected: false,
    state: "blocked",
    reason: "oauth_invalid_client",
    diagnostic: "invalid_client / client_secret"
  });
  try {
    const diagnostics = new SyncEngine({
      repository,
      drive: {} as SyncDrive,
      auth: auth(),
      now: () => 4_000
    }).diagnostics({ version: "0.21.0", distribution: "portable" });
    assert.equal(diagnostics.generatedAt, 4_000);
    assert.equal(diagnostics.appVersion, "0.21.0");
    assert.equal(diagnostics.distribution, "portable");
    assert.equal(diagnostics.reason, "oauth_invalid_client");
    assert.equal(diagnostics.diagnostic, "invalid_client / client_secret");
    assert.equal(diagnostics.stages.find((stage) => stage.id === "token-exchange")?.state, "failed");
  } finally { database.close(); }
});

test("an imported pending history flushes as the portable device without overwriting the old file", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "device-old");
  database.history.put({
    schema: 1,
    id: "history-a",
    textHash: "history-a",
    text: "Question",
    preview: "Question",
    createdAt: 1_000,
    lastUsedAt: 1_000,
    updatedAt: 1_000,
    deviceId: "device-old"
  });
  database.driveFiles.put({
    id: "drive-old",
    name: "history-history-a-device-old.json",
    appProperties: { kind: "history", device: "device-old" },
    logicalKey: "history:history-a:device-old",
    seenAt: 1_000
  });
  database.adoptImportedProfile("device-portable");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true, pageToken: "current" });
  const uploads: Array<{ fileId: string | null; name: string; device?: string; bodyDevice?: string }> = [];
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => null,
    upsert: async (fileId, name, appProperties, body) => {
      uploads.push({
        fileId,
        name,
        device: appProperties.device,
        bodyDevice: (body as { deviceId?: string }).deviceId
      });
      return { id: `uploaded-${name}`, appProperties };
    },
    clearAll: async () => undefined
  };
  try {
    assert.equal((await new SyncEngine({ repository, drive, auth: auth() }).syncNow()).state, "idle");
    assert.deepEqual(uploads, [{
      fileId: null,
      name: "history-history-a-device-portable.json",
      device: "device-portable",
      bodyDevice: "device-portable"
    }]);
    assert.equal(database.driveFiles.find("history:history-a:device-old")?.id, "drive-old");
  } finally { database.close(); }
});

test("startup clears stale disconnected OAuth and Drive-check phases", () => {
  for (const reason of ["oauth", "drive_check"] as const) {
    const database = DesktopDatabase.open(":memory:");
    database.meta.put("deviceId", "desktop-device");
    const repository = new SyncRepository(database);
    repository.saveConfig({ connected: false, state: "syncing", reason });
    const statuses: Array<{ state: string; reason?: string }> = [];
    const engine = new SyncEngine({
      repository,
      drive: {} as SyncDrive,
      auth: auth(),
      onStatus: (status) => statuses.push(status)
    });
    try {
      engine.start();
      assert.equal(repository.config().state, "idle");
      assert.equal(repository.config().reason, undefined);
      assert.equal(statuses.at(-1)?.state, "idle");
      assert.equal(statuses.at(-1)?.reason, undefined);
    } finally {
      engine.dispose();
      database.close();
    }
  }
});

test("sync pulls a remote history tombstone and never lets an old upload revision clear a newer write", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  let now = 1_000;
  const history = new HistoryService(database.history, { deviceId: () => "desktop-device", now: () => now });
  const local = history.record("Question")!;
  const tombstone = { schema: 1 as const, id: local.id, textHash: local.id, createdAt: local.createdAt, lastUsedAt: local.lastUsedAt, updatedAt: 2_000, deletedAt: 2_000, deviceId: "remote" };
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  const first = repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
  repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
  assert.equal(repository.complete(first.key, first.revision), false);
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [{ id: "history-file", appProperties: { app: "polyask", schema: "1", kind: "history", id: local.id, device: "remote" } }],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => tombstone,
    upsert: async (_id, name, appProperties) => ({ id: `uploaded-${name}`, appProperties }),
    clearAll: async () => undefined
  };
  try {
    const engine = new SyncEngine({ repository, drive, auth: auth(), now: () => now });
    const status = await engine.syncNow();
    assert.equal(status.state, "idle");
    assert.equal("deletedAt" in repository.history(local.id)!, true);
    assert.equal(repository.config().pageToken, "next");
  } finally { database.close(); }
});

test("future schema blocks uploads and disconnect keeps local and remote data intact", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
  let uploads = 0;
  let clears = 0;
  const session = auth();
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [{ id: "future", appProperties: { app: "polyask", schema: "2", kind: "state", id: "future" } }],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => { throw new Error("must_not_download"); },
    upsert: async () => { uploads += 1; return { id: "uploaded" }; },
    clearAll: async () => { clears += 1; }
  };
  try {
    const engine = new SyncEngine({ repository, drive, auth: session });
    assert.equal((await engine.syncNow()).state, "schema");
    assert.equal(uploads, 0);
    assert.equal((await engine.disconnect()).connected, false);
    assert.equal(session.disconnected, true);
    assert.equal(clears, 0);
    assert.equal(repository.pending(), 1);
  } finally { database.close(); }
});

test("remote body identity must match Drive metadata before import", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [{ id: "mismatch", appProperties: { app: "polyask", schema: "1", kind: "history", id: "expected", device: "remote" } }],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => ({ schema: 1, id: "actual", textHash: "actual", text: "not a matching hash", preview: "", createdAt: 1, lastUsedAt: 1, updatedAt: 1, deviceId: "remote" }),
    upsert: async () => ({ id: "unused" }),
    clearAll: async () => undefined
  };
  try {
    await new SyncEngine({ repository, drive, auth: auth() }).syncNow();
    assert.equal(repository.history("actual"), null);
    assert.equal(repository.config().errorCount, 1);
  } finally { database.close(); }
});

test("disconnect aborts the active pull before waiting for the serial queue", async () => {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  let started!: () => void;
  let aborted = false;
  const pullStarted = new Promise<void>((resolve) => { started = resolve; });
  const drive: SyncDrive = {
    getStartToken: (signal) => new Promise((resolve) => {
      started();
      signal?.addEventListener("abort", () => { aborted = true; resolve("aborted"); }, { once: true });
      setTimeout(() => resolve("late"), 80);
    }),
    listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => null,
    upsert: async () => ({ id: "unused" }),
    clearAll: async () => undefined
  };
  try {
    const engine = new SyncEngine({ repository, drive, auth: auth() });
    const syncing = engine.syncNow();
    await pullStarted;
    const disconnecting = engine.disconnect();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(aborted, true);
    await Promise.all([syncing, disconnecting]);
  } finally { database.close(); }
});
