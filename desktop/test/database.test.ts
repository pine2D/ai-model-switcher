import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { createArchiveRecord } from "../src/shared/archive";

function archiveFixture() {
  return createArchiveRecord({
    text: "Why is the sky blue?",
    task: "Why is the sky blue?",
    results: [{ host: "claude.ai", label: "Claude", text: "Rayleigh scattering." }],
    createdAt: 1_000
  }, { id: "archive-a", now: 1_000, deviceId: "device-a" });
}

test("desktop database enables WAL and preserves archive tombstones across reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-database-"));
  const path = join(directory, "polyask.sqlite");
  try {
    const first = DesktopDatabase.open(path);
    assert.deepEqual(first.configuration(), { journalMode: "wal", foreignKeys: true, userVersion: 1 });
    first.archives.put(archiveFixture());
    first.archives.delete("archive-a", 2_000, "device-b");
    assert.equal(first.outbox.count(), 1);
    first.close();

    const reopened = DesktopDatabase.open(path);
    const stored = reopened.archives.get("archive-a");
    assert.ok(stored && "deletedAt" in stored);
    assert.equal(stored.deletedAt, 2_000);
    assert.equal("text" in (stored || {}), false);
    assert.equal(reopened.outbox.count(), 1);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("state items and history survive reopen without physical deletion", () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-database-"));
  const path = join(directory, "polyask.sqlite");
  try {
    const first = DesktopDatabase.open(path);
    first.meta.put("deviceId", "device-a");
    first.state.put("workspace", { selectedSites: ["claude"], tier: null }, 1_000);
    first.history.put({
      id: "hash-a",
      textHash: "hash-a",
      text: "Question",
      preview: "Question",
      createdAt: 1_000,
      lastUsedAt: 1_000,
      updatedAt: 1_000,
      deviceId: "device-a",
      schema: 1
    });
    first.history.delete("hash-a", 2_000, "device-b");
    first.close();

    const reopened = DesktopDatabase.open(path);
    assert.equal(reopened.meta.get("deviceId"), "device-a");
    assert.deepEqual(reopened.state.get("workspace"), { selectedSites: ["claude"], tier: null });
    const history = reopened.history.get("hash-a");
    assert.ok(history && "deletedAt" in history);
    assert.equal(history.deletedAt, 2_000);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
