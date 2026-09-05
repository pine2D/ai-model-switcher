import assert from "node:assert/strict";
import test from "node:test";

import {
  createArchiveRecord,
  isArchiveRecord,
  tombstoneArchive,
  updateArchiveRecord
} from "../src/shared/archive";
import { archiveFixture } from "./fixtures";

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

// F213/F214: the extension has no length guard on tab.title (bg/page-context.js) or on
// the synthesis instruction textarea (console/compose.html), while normalizeSource() and
// normalizeSynthesis() below reject a title over 512 code points / an instruction over
// 4,000. isArchiveRecord() below wraps them in try/catch and returns false on throw, so
// a record synced in from the extension with an oversized field is judged corrupt and
// never surfaces on Desktop (main/sync-pull.ts noteCorrupt), with no user-visible error
// on either side. These two tests lock the *intentional* Desktop-side throw so nobody
// "fixes" the symptom here by truncating: isArchiveRecord()'s corruption check re-derives
// the record via JSON.stringify equality against normalizeSource()/normalizeSynthesis()'s
// output, so silently truncating in the normalizer would make every already-synced
// oversized record permanently fail that equality check too. The real fix belongs on the
// extension side (bg/page-context.js, bg/archive-model.js, console/compose.html) — see
// gap-verdicts F213/F214 fix_notes.
test("an overlong page title is rejected as corrupt, not truncated (F213)", () => {
  const withTitle = (length: number) => createArchiveRecord({
    text: "Why is the sky blue?",
    task: "Why is the sky blue?",
    results: [{ host: "claude.ai", label: "Claude", text: "Rayleigh scattering." }],
    source: { kind: "page", title: "x".repeat(length), url: "https://example.com/", truncated: false, capturedAt: 1_000 },
    createdAt: 1_000
  }, { id: "archive-a", now: 1_000, deviceId: "device-a" });

  const valid = withTitle(512);
  assert.equal(isArchiveRecord(valid), true);
  // A title one code point over the limit — as sent by the extension, which has no
  // length guard on tab.title — must still be judged corrupt, not silently accepted
  // or truncated (mutating record.source here mirrors an untrusted synced payload).
  assert.equal(isArchiveRecord({ ...valid, source: { ...valid.source, title: "x".repeat(513) } }), false);
});

test("an overlong synthesis instruction is rejected as corrupt, not truncated (F214)", () => {
  const withInstruction = (length: number) => updateArchiveRecord(archiveFixture(), {
    synthesis: { host: "claude.ai", text: "Combined answer.", state: null, instruction: "x".repeat(length), createdAt: 1_000 }
  }, { now: 2_000, deviceId: "device-a" });

  const valid = withInstruction(4_000);
  assert.equal(isArchiveRecord(valid), true);
  // Same principle for the synthesis instruction textarea, which has no maxlength
  // (console/compose.html): one code point over 4,000 must fail, not be truncated.
  assert.equal(isArchiveRecord({ ...valid, synthesis: { ...valid.synthesis, instruction: "x".repeat(4_001) } }), false);
});
