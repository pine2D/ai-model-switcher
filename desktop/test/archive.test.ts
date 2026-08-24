import assert from "node:assert/strict";
import test from "node:test";

import {
  createArchiveRecord,
  isArchiveRecord,
  tombstoneArchive
} from "../src/shared/archive";

export function archiveFixture() {
  return createArchiveRecord({
    text: "Why is the sky blue?",
    task: "Why is the sky blue?",
    results: [
      { host: "claude.ai", label: "Claude", text: "Rayleigh scattering." },
      { host: "chatgpt.com", label: "ChatGPT", text: null, code: "no_answer" }
    ],
    createdAt: 1_000
  }, { id: "archive-a", now: 1_000, deviceId: "device-a" });
}

test("archive records retain extension schema 1 metadata", () => {
  const record = archiveFixture();

  assert.equal(isArchiveRecord(record), true);
  assert.equal(record.schema, 1);
  assert.deepEqual(record.hosts, ["claude.ai", "chatgpt.com"]);
  assert.deepEqual(record.resultPreviews, [
    { host: "claude.ai", label: "Claude", text: "Rayleigh scattering." }
  ]);
  assert.match(record.searchText, /rayleigh scattering/);
});

test("deleting an archive keeps only a syncable tombstone", () => {
  const deleted = tombstoneArchive(archiveFixture(), 2_000, "device-b");

  assert.deepEqual(deleted, {
    id: "archive-a",
    createdAt: 1_000,
    updatedAt: 2_000,
    deletedAt: 2_000,
    deviceId: "device-b",
    schema: 1
  });
  assert.equal("text" in deleted, false);
  assert.equal("results" in deleted, false);
});
