import assert from "node:assert/strict";
import test from "node:test";

import { runStartup } from "../src/main/startup";

test("startup guard reports a rejected initialization exactly once", async () => {
  const failure = new Error("database_not_ready");
  const seen: unknown[] = [];

  const ok = await runStartup(
    async () => { throw failure; },
    (error) => { seen.push(error); }
  );

  assert.equal(ok, false);
  assert.deepEqual(seen, [failure]);
});

test("startup guard absorbs a throwing failure handler after reporting once", async () => {
  const failure = new Error("database_not_ready");
  const seen: unknown[] = [];

  const ok = await runStartup(
    async () => { throw failure; },
    (error) => {
      seen.push(error);
      throw new Error("dialog_unavailable");
    }
  );

  assert.equal(ok, false);
  assert.deepEqual(seen, [failure]);
});

test("startup guard returns success without reporting", async () => {
  let reports = 0;

  const ok = await runStartup(
    async () => undefined,
    () => { reports += 1; }
  );

  assert.equal(ok, true);
  assert.equal(reports, 0);
});
