import assert from "node:assert/strict";
import test from "node:test";

import { DesktopDatabase } from "../src/main/database";
import { HistoryService } from "../src/main/history-service";

test("successful broadcasts upsert one normalized history record", () => {
  const database = DesktopDatabase.open(":memory:");
  let now = 1_000;
  try {
    const service = new HistoryService(database.history, {
      deviceId: () => "device-a",
      now: () => now
    });
    const first = service.record("  Compare answers  ");
    now = 2_000;
    const second = service.record("Compare answers");

    assert.equal(first.id, second.id);
    assert.equal(second.text, "Compare answers");
    assert.equal(second.createdAt, 1_000);
    assert.equal(second.lastUsedAt, 2_000);
    assert.deepEqual(database.history.get(second.id), second);
  } finally {
    database.close();
  }
});
