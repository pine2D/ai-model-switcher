import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DataAdminService } from "../src/main/data-admin-service";
import { DesktopDatabase } from "../src/main/database";
import { HistoryService } from "../src/main/history-service";
import type { SyncStatus } from "../src/shared/sync";
import { archiveFixture } from "./fixtures";

const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({
  state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: true, secureTokenStorage: true, ...patch
});

function seeded(path: string): DesktopDatabase {
  const database = DesktopDatabase.open(path);
  database.meta.put("deviceId", "device-a");
  const history = new HistoryService(database.history, { deviceId: () => "device-a", now: () => 1_000 });
  history.record("first question");
  history.record("second question");
  database.archives.put(archiveFixture());
  database.archives.put({ ...archiveFixture(), id: "archive-b" });
  return database;
}

function rows(path: string, table: string): { id: string; deleted_at: number | null }[] {
  const raw = new DatabaseSync(path);
  try { return raw.prepare(`SELECT id, deleted_at FROM ${table} ORDER BY id`).all() as { id: string; deleted_at: number | null }[]; }
  finally { raw.close(); }
}

test("clearing history and result library tombstones every row and queues the deletions", () => {
  // CLAUDE.md「删除一律 tombstone」在 Desktop 侧的第一份测试：行还在、deleted_at 非空、outbox 有对应行。
  const directory = mkdtempSync(join(tmpdir(), "polyask-data-admin-"));
  const path = join(directory, "polyask.sqlite");
  try {
    const database = seeded(path);
    const before = database.outbox.count();
    const admin = new DataAdminService({
      database, deviceId: () => "device-a", now: () => 5_000,
      sync: { disconnect: async () => status(), status: () => status() }
    });
    assert.equal(admin.clearHistory(), 2);
    assert.equal(admin.clearArchives(), 2);
    assert.deepEqual(database.history.list(), []);
    assert.deepEqual(database.archives.list(), []);
    database.close();
    for (const table of ["history", "archives"]) {
      const stored = rows(path, table);
      assert.equal(stored.length, 2, `${table} 的行必须仍在（tombstone，不物理删）`);
      assert.ok(stored.every((row) => row.deleted_at === 5_000), `${table} 每行 deleted_at 必须非空`);
    }
    const reopened = DesktopDatabase.open(path);
    assert.ok(reopened.outbox.count() >= before, "每条 tombstone 都要进 outbox，删除才会同步到其它设备");
    assert.deepEqual(reopened.outbox.ready(0).filter((op) => op.kind === "archive").map((op) => op.key).sort(), ["archive:archive-a", "archive:archive-b"]);
    assert.equal(reopened.outbox.ready(0).filter((op) => op.kind === "history").length, 2);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resetting local data disconnects first, wipes only this device, and keeps the device id", async () => {
  const database = seeded(":memory:");
  database.state.put("workspace", { selectedSites: ["claude"], tier: "think", updatedAt: 1, deviceId: "device-a" }, 1);
  database.state.put("group:g", { id: "g", name: "G", sites: ["claude"], updatedAt: 1, deviceId: "device-a" }, 1);
  database.meta.put("syncConfig", { connected: true, state: "idle" });
  database.driveFiles.put({ id: "f", name: "n", appProperties: {}, logicalKey: "archive:archive-a", seenAt: 1 });
  const events: string[] = [];
  const admin = new DataAdminService({
    database, deviceId: () => "device-a",
    sync: {
      disconnect: async () => { events.push(`disconnect:rows=${database.archives.list().length}`); return status(); },
      status: () => status({ connected: false })
    }
  });
  try {
    const result = await admin.resetLocal();
    assert.deepEqual(events, ["disconnect:rows=2"], "必须先断开、再清库（断开时数据仍在，撤销授权不依赖本机数据）");
    assert.equal(result.connected, false);
    assert.equal(database.history.list().length, 0);
    assert.equal(database.archives.list().length, 0);
    assert.equal(database.archives.get("archive-a"), null, "重置是本机物理清空，不是 tombstone——tombstone 会在重新连接后赢过云端副本并把云端也删掉");
    assert.equal(database.state.get("workspace"), null);
    assert.equal(database.state.list("group:").length, 0);
    assert.equal(database.outbox.count(), 0);
    assert.equal(database.driveFiles.list().length, 0);
    assert.equal(database.meta.get("syncConfig"), null);
    assert.equal(database.meta.get("deviceId"), "device-a", "deviceId 保留：重连后据此继承本机在云端的旧设置键");
  } finally { database.close(); }
});
