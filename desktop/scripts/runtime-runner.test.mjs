import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  packagedExecutablePath,
  prepareRuntime,
  removeRuntimeDirectory
} from "./runtime-runner.mjs";

test("packaged runtime paths follow the product name and executable name", () => {
  assert.match(
    packagedExecutablePath("linux", "x64"),
    /out[\\/]PolyAsk-linux-x64[\\/]polyask-desktop$/
  );
  assert.match(
    packagedExecutablePath("win32", "x64"),
    /out[\\/]PolyAsk-win32-x64[\\/]polyask-desktop\.exe$/
  );
  assert.match(
    packagedExecutablePath("darwin", "arm64"),
    /out[\\/]PolyAsk-darwin-arm64[\\/]PolyAsk\.app[\\/]Contents[\\/]MacOS[\\/]polyask-desktop$/
  );
});

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
