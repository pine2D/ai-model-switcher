import assert from "node:assert/strict";
import test from "node:test";

import { loadBootstrap } from "../src/renderer/bootstrap-model";

test("bootstrap applies one successful state", async () => {
  const fixtureState = { marker: "ready" } as const;
  const accepted: Array<typeof fixtureState> = [];

  const phase = await loadBootstrap(
    async () => fixtureState,
    (state) => accepted.push(state)
  );

  assert.equal(phase, "ready");
  assert.deepEqual(accepted, [fixtureState]);
});

test("bootstrap rejection is recoverable and applies no partial state", async () => {
  let loads = 0;
  let accepted = false;

  const phase = await loadBootstrap(
    async () => {
      loads += 1;
      throw new Error("ipc_failed");
    },
    () => { accepted = true; }
  );

  assert.equal(phase, "failed");
  assert.equal(loads, 1);
  assert.equal(accepted, false);
});
