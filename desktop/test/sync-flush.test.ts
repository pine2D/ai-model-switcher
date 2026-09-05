import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { DriveClient, type AccessTokenProvider } from "../src/main/drive-client";
import { SyncEngine, type SyncAuth, type SyncDrive } from "../src/main/sync-engine";
import { SyncRepository } from "../src/main/sync-repository";

const auth = (): SyncAuth => ({ configured: () => true, securePersistence: () => true, connect: async () => undefined, disconnect: async () => undefined });

function connectedRepository(): { database: DesktopDatabase; repository: SyncRepository } {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "desktop-device");
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  return { database, repository };
}

test("several state outbox rows flush as a single state upload and are all completed", async () => {
  const { database, repository } = connectedRepository();
  // 三条不同业务键的 state 写入：outbox 按 key 各留一行（database.test.ts 明写的语义），折叠只发生在 flush 里。
  database.state.put("workspace", { selectedSites: ["claude"], tier: null, updatedAt: 1_000, deviceId: "desktop-device" }, 1_000);
  database.state.put("group:a", { id: "a", name: "A", sites: ["claude", "kimi"], updatedAt: 1_000, deviceId: "desktop-device" }, 1_000);
  database.state.put("group:b", { id: "b", name: "B", sites: ["gemini"], updatedAt: 1_000, deviceId: "desktop-device" }, 1_000);
  assert.equal(repository.pending(), 3);
  const uploads: string[] = [];
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => null,
    upsert: async (_id, name) => { uploads.push(name); return { id: `file-${uploads.length}` }; },
    clearAll: async () => undefined
  };
  try {
    const status = await new SyncEngine({ repository, drive, auth: auth() }).syncNow();
    assert.equal(status.state, "idle");
    assert.deepEqual(uploads, ["state-desktop-device.json"]);
    assert.equal(repository.pending(), 0);
  } finally { database.close(); }
});

test("a 403 rate-limit reason from Drive requeues the upload with backoff instead of blocking", async () => {
  const { database, repository } = connectedRepository();
  repository.enqueue({ key: "state", kind: "state", nextAt: 0, attempt: 0 });
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  const drive = new DriveClient(provider, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/changes/startPageToken")) return Response.json({ startPageToken: "start" });
    if (url.pathname.endsWith("/changes")) return Response.json({ changes: [], newStartPageToken: "next" });
    if (url.pathname.endsWith("/files") && init?.method !== "POST") return Response.json({ files: [] });
    return new Response(JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }), { status: 403 });
  });
  try {
    const status = await new SyncEngine({ repository, drive, auth: auth(), now: () => 10_000 }).syncNow();
    assert.equal(status.state, "waiting", "限流是可退避的等待，不是终态 blocked");
    assert.equal(repository.pending(), 1);
    assert.equal(repository.ready(10_000).length, 0, "重排队后必须带退避");
  } finally { database.close(); }
});

test("Drive maps storage quota exhaustion to forbidden, not to a retryable rate limit", async () => {
  const provider: AccessTokenProvider = { accessToken: async () => "token" };
  const quota = new DriveClient(provider, async () => new Response(JSON.stringify({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }), { status: 403 }));
  await assert.rejects(() => quota.listFiles(), (error: unknown) => (error as { code?: string }).code === "forbidden");
  const daily = new DriveClient(provider, async () => new Response(JSON.stringify({ error: { message: "dailyLimitExceeded" } }), { status: 403 }));
  await assert.rejects(() => daily.listFiles(), (error: unknown) => (error as { code?: string }).code === "rate_limited");
});

test("the future-schema lock releases once the recorded schema no longer exceeds the local one", async () => {
  const { database, repository } = connectedRepository();
  // 模拟「远端曾出现 schema 2 文件锁住本机，之后本机升级追平」：记录里的 schema 不再大于 SYNC_SCHEMA。
  repository.saveConfig({ readOnly: true, pageToken: "token", futureFiles: { future: 1 } });
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => null,
    upsert: async () => ({ id: "unused" }),
    clearAll: async () => undefined
  };
  try {
    const status = await new SyncEngine({ repository, drive, auth: auth() }).syncNow();
    assert.equal(status.readOnly, false);
    assert.equal(status.state, "idle");
  } finally { database.close(); }
});

test("a legacy futureFileIds list keeps the lock and is rewritten as futureFiles", async () => {
  const { database, repository } = connectedRepository();
  repository.saveConfig({ readOnly: true, pageToken: "token", futureFileIds: ["legacy"] });
  const drive: SyncDrive = {
    getStartToken: async () => "start",
    listFiles: async () => [],
    listChanges: async () => ({ changes: [], newStartPageToken: "next" }),
    download: async () => null,
    upsert: async () => { throw new Error("must_not_upload"); },
    clearAll: async () => undefined
  };
  try {
    const status = await new SyncEngine({ repository, drive, auth: auth() }).syncNow();
    assert.equal(status.readOnly, true, "旧版记录不知道 schema，按刚好高一版兜底，本机追平前保持只读");
    const config = repository.config();
    assert.deepEqual(config.futureFiles, { legacy: 2 });
    assert.equal(config.futureFileIds, undefined);
  } finally { database.close(); }
});
