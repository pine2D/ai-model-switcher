import assert from "node:assert/strict";
import { join } from "node:path";

import {
  launchRuntime,
  packageApplication,
  stopRuntime,
  waitForJson
} from "./runtime-runner.mjs";

const minutesArgument = process.argv.find((argument) => argument.startsWith("--minutes="));
const minutes = Number(minutesArgument?.slice("--minutes=".length) ?? "60");
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1_440) {
  throw new Error("minutes_must_be_between_0_and_1440");
}
if (!process.argv.includes("--skip-package")) packageApplication();

let runtime;
try {
  runtime = await launchRuntime("polyask-soak-", (directory) => ({
    POLYASK_DIAGNOSTICS_FILE: join(directory, "diagnostic.json"),
    POLYASK_SOAK_REPORT: join(directory, "soak.jsonl"),
    POLYASK_SOAK_MINUTES: String(minutes)
  }));
  const diagnosticPath = runtime.environment.POLYASK_DIAGNOSTICS_FILE;
  const reportPath = runtime.environment.POLYASK_SOAK_REPORT;
  const snapshot = await waitForJson(
    diagnosticPath,
    runtime.child,
    (text) => JSON.parse(text),
    45_000
  );
  assert.equal(snapshot.ok, true, snapshot.violations?.join(","));

  const summary = await waitForJson(
    reportPath,
    runtime.child,
    (text) => text.trim().split("\n").map((line) => JSON.parse(line)).find((item) => item.kind === "summary"),
    minutes * 60_000 + 45_000
  );
  assert.ok(summary.sampleCount >= 2);
  assert.deepEqual(summary.failures, []);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (runtime?.logs()) console.error(runtime.logs());
  throw error;
} finally {
  if (runtime) await stopRuntime(runtime);
}
