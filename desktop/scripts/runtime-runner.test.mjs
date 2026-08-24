import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { prepareRuntime, removeRuntimeDirectory } from "./runtime-runner.mjs";

test("runtime environment paths belong to the same temporary launch context", async () => {
  const prepared = await prepareRuntime("polyask-runner-test-", (directory) => ({
    POLYASK_DIAGNOSTICS_FILE: join(directory, "diagnostic.json"),
    POLYASK_SOAK_REPORT: join(directory, "soak.jsonl")
  }));
  try {
    assert.equal(prepared.environment.POLYASK_DIAGNOSTICS_FILE, join(prepared.directory, "diagnostic.json"));
    assert.equal(prepared.environment.POLYASK_SOAK_REPORT, join(prepared.directory, "soak.jsonl"));
    assert.equal(prepared.userData, join(prepared.directory, "user-data"));
  } finally {
    await removeRuntimeDirectory(prepared.directory);
  }
});
