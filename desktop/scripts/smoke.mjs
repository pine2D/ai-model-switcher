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
  const attached = snapshot.sites.filter((site) => site.attached);
  // 所有已勾选站点（默认九站）都必须挂在视图树里且有正尺寸：未挂载的视图页面视口是 0×0，
  // findComposer 恒 null，群发对它必然 composer_not_found。当前页最多 4 格，是 attached 的子集。
  assert.equal(attached.length, 9);
  assert.ok(snapshot.layout.placements.length > 0 && snapshot.layout.placements.length <= 4);
  assert.ok(attached.every((site) => site.bounds.width > 0 && site.bounds.height > 0));
  const attachedKeys = new Set(attached.map((site) => site.site));
  assert.ok(snapshot.layout.placements.every((placement) => attachedKeys.has(placement.key)));
  console.log(`smoke passed: shell=${snapshot.shellCount}, sites=${snapshot.sites.length}, attached=${attached.length}`);
} catch (error) {
  if (runtime?.logs()) console.error(runtime.logs());
  throw error;
} finally {
  if (runtime) await stopRuntime(runtime);
}
