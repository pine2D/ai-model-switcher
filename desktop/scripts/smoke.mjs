import assert from "node:assert/strict";
import { join } from "node:path";

import {
  launchRuntime,
  packageApplication,
  stopRuntime,
  waitForJson
} from "./runtime-runner.mjs";

if (!process.argv.includes("--skip-package")) packageApplication();

let runtime;
try {
  runtime = await launchRuntime("polyask-smoke-", (directory) => ({
    POLYASK_DIAGNOSTICS_FILE: join(directory, "diagnostic.json")
  }));
  const diagnosticPath = runtime.environment.POLYASK_DIAGNOSTICS_FILE;
  const snapshot = await waitForJson(
    diagnosticPath,
    runtime.child,
    (text) => JSON.parse(text),
    45_000
  );
  assert.equal(snapshot.ok, true, snapshot.violations?.join(","));
  assert.equal(snapshot.shellCount, 1);
  assert.equal(snapshot.sites.length, 9);
  assert.equal(new Set(snapshot.sites.map((site) => site.webContentsId)).size, 9);
  assert.ok(snapshot.sites.every((site) => site.partition === "persist:polyask-sites"));
  assert.ok(snapshot.sites.every((site) => site.sameSession));
  assert.ok(snapshot.sites.every((site) => site.sandbox && site.contextIsolation && !site.nodeIntegration));
  assert.ok(snapshot.sites.every((site) => site.bounds.width > 0 && site.bounds.height > 0));
  console.log(`smoke passed: shell=${snapshot.shellCount}, sites=${snapshot.sites.length}`);
} catch (error) {
  if (runtime?.logs()) console.error(runtime.logs());
  throw error;
} finally {
  if (runtime) await stopRuntime(runtime);
}
