import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { readJson } from "../src/main/repository-utils";

test("readJson treats a corrupt body as a missing row instead of throwing", () => {
  assert.equal(readJson({ body: "{broken" }), null);
  assert.equal(readJson({ body: 42 }), null);
  assert.deepEqual(readJson({ body: "{\"ok\":true}" }), { ok: true });
});

test("one corrupt history row is skipped and the rest of the list still loads", () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-corrupt-"));
  const path = join(directory, "polyask.sqlite");
  try {
    const first = DesktopDatabase.open(path);
    for (const id of ["good", "bad"]) {
      first.history.put({ id, textHash: id, text: id, preview: id, createdAt: 1_000, lastUsedAt: 1_000, updatedAt: 1_000, deviceId: "device-a", schema: 1 });
    }
    first.close();
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE history SET body = ? WHERE id = ?").run("{broken", "bad");
    raw.close();
    const reopened = DesktopDatabase.open(path);
    assert.deepEqual(reopened.history.list().map((record) => record.id), ["good"]);
    assert.equal(reopened.history.get("bad"), null);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
