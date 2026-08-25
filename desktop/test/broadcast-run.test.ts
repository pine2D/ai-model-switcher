import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelledRunSites,
  completeRun,
  failedRunSites,
  mergeRunResults,
  retryRequest,
  runCoversSites
} from "../src/renderer/broadcast-run";
import {
  BroadcastFlowState,
  ExclusiveActionLock,
  cancelBroadcast,
  runWithBroadcastLock
} from "../src/renderer/broadcast-flow-state";
import type { BroadcastRequest } from "../src/shared/protocol";

test("a two-site run retries only its failed site", () => {
  const request: BroadcastRequest = {
    runId: "run-2",
    text: "compare",
    tier: null,
    sites: ["claude", "kimi"],
    images: []
  };
  const run = completeRun(request, [
    { site: "claude", ok: true },
    { site: "kimi", ok: false, code: "submit_unconfirmed" }
  ]);

  assert.deepEqual(failedRunSites(run), ["kimi"]);
  assert.deepEqual(retryRequest(run), { ...request, sites: ["kimi"] });
});

test("cancelled sites stay retryable without being counted as failed", () => {
  const request: BroadcastRequest = {
    runId: "run-cancelled",
    text: "compare",
    tier: null,
    sites: ["claude", "chatgpt", "kimi"],
    images: []
  };
  const run = completeRun(request, [
    { site: "claude", ok: false, code: "cancelled" },
    { site: "chatgpt", ok: false, code: "timeout" },
    { site: "kimi", ok: true }
  ]);

  assert.deepEqual(failedRunSites(run), ["chatgpt"]);
  assert.deepEqual(cancelledRunSites(run), ["claude"]);
  assert.deepEqual(retryRequest(run)?.sites, ["claude", "chatgpt"]);
});

test("a completed run ignores successful results outside its frozen scope", () => {
  const request: BroadcastRequest = {
    runId: "run-filtered",
    text: "compare",
    tier: null,
    sites: ["claude"],
    images: []
  };
  const run = completeRun(request, [
    { site: "claude", ok: false, code: "timeout" },
    { site: "kimi", ok: true }
  ]);

  assert.equal(run.results.has("kimi"), false);
  assert.equal([...run.results.values()].some((result) => result.ok), false);
});

test("a five-site retry merges results without changing the original scope", () => {
  const request: BroadcastRequest = {
    runId: "run-5",
    text: "compare",
    tier: "think",
    sites: ["claude", "chatgpt", "gemini", "kimi", "deepseek"],
    images: []
  };
  const run = completeRun(request, [
    { site: "claude", ok: true },
    { site: "chatgpt", ok: false, code: "submit_unconfirmed" },
    { site: "gemini", ok: true },
    { site: "kimi", ok: false, code: "timeout" },
    { site: "deepseek", ok: true }
  ]);

  assert.deepEqual(retryRequest(run)?.sites, ["chatgpt", "kimi"]);
  assert.equal(runCoversSites(run, ["claude", "kimi"]), true);
  assert.equal(runCoversSites(run, ["claude", "doubao"]), false);
  assert.equal(runCoversSites(run, []), false);

  const merged = mergeRunResults(run, [
    { site: "chatgpt", ok: true },
    { site: "kimi", ok: true },
    { site: "doubao", ok: false, code: "timeout" }
  ]);

  assert.equal(retryRequest(merged), null);
  assert.deepEqual(merged.request.sites, ["claude", "chatgpt", "gemini", "kimi", "deepseek"]);
  assert.equal(merged.results.has("doubao"), false);
});

test("invalidating rejects a late result but its settlement releases the physical lock", () => {
  const state = new BroadcastFlowState();
  const operation = state.begin(true);
  assert.ok(operation);
  const run = completeRun({
    runId: "run-stale",
    text: "compare",
    tier: null,
    sites: ["claude"],
    images: []
  }, [{ site: "claude", ok: true }]);

  state.invalidate();

  assert.equal(state.commit(operation, run), false);
  assert.equal(state.settle(operation), true);
  assert.equal(state.run, null);
  assert.equal(state.runState, "idle");
});

test("an active operation prevents a second send or retry from broadcasting", async () => {
  const state = new BroadcastFlowState();
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  let broadcastCalls = 0;
  const broadcast = async (): Promise<string> => {
    broadcastCalls += 1;
    await blocker;
    return "first";
  };

  const first = runWithBroadcastLock(state, true, async () => broadcast(), () => undefined);
  const secondSend = await runWithBroadcastLock(
    state, true, async () => broadcast(), () => undefined
  );
  const retry = await runWithBroadcastLock(
    state, false, async () => broadcast(), () => undefined
  );

  assert.equal(secondSend, null);
  assert.equal(retry, null);
  assert.equal(broadcastCalls, 1);

  release();
  assert.equal(await first, "first");
  assert.equal(state.runState, "idle");
});

test("invalidation keeps the physical lock until the stale IPC settles", async () => {
  const state = new BroadcastFlowState();
  const run = completeRun({
    runId: "run-invalidated",
    text: "compare",
    tier: null,
    sites: ["claude"],
    images: []
  }, [{ site: "claude", ok: true }]);
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  let broadcastCalls = 0;
  const first = runWithBroadcastLock(state, true, async (operation) => {
    broadcastCalls += 1;
    await blocker;
    return state.commit(operation, run);
  }, () => undefined);

  state.invalidate();
  const blocked = await runWithBroadcastLock(state, true, async () => {
    broadcastCalls += 1;
    return true;
  }, () => undefined);

  assert.equal(blocked, null);
  assert.equal(broadcastCalls, 1);

  release();
  assert.equal(await first, false);
  assert.equal(state.run, null);
  assert.equal(state.runState, "idle");

  const afterSettlement = await runWithBroadcastLock(state, false, async () => {
    broadcastCalls += 1;
    return true;
  }, () => undefined);

  assert.equal(afterSettlement, true);
  assert.equal(broadcastCalls, 2);
});

test("cancel remains locked until the current operation settles", () => {
  const state = new BroadcastFlowState();
  const operation = state.begin(true);
  assert.ok(operation);

  state.cancel();

  assert.equal(state.runState, "cancelling");
  assert.equal(state.settle(operation), true);
  assert.equal(state.runState, "idle");
});

test("cancel publishes the locked state before sending its IPC", () => {
  const state = new BroadcastFlowState();
  state.begin(true);
  const events: string[] = [];

  cancelBroadcast(
    state,
    (runState) => events.push(runState),
    () => events.push("ipc")
  );

  assert.deepEqual(events, ["cancelling", "ipc"]);
  assert.equal(state.runState, "cancelling");
});

test("renderer action lock blocks submit and retry during auxiliary work", async () => {
  const lock = new ExclusiveActionLock();
  let releaseAuxiliary!: () => void;
  const auxiliaryBlocker = new Promise<void>((resolve) => { releaseAuxiliary = resolve; });
  let broadcasts = 0;

  const auxiliary = lock.run(async () => auxiliaryBlocker);
  const submit = await lock.run(async () => { broadcasts += 1; });
  const retry = await lock.run(async () => { broadcasts += 1; });

  assert.equal(submit, null);
  assert.equal(retry, null);
  assert.equal(broadcasts, 0);
  releaseAuxiliary();
  await auxiliary;

  let releaseSubmit!: () => void;
  const submitBlocker = new Promise<void>((resolve) => { releaseSubmit = resolve; });
  let auxiliaryCalls = 0;
  const activeSubmit = lock.run(async () => {
    broadcasts += 1;
    await submitBlocker;
  });
  const blockedAuxiliary = await lock.run(async () => { auxiliaryCalls += 1; });

  assert.equal(blockedAuxiliary, null);
  assert.equal(broadcasts, 1);
  assert.equal(auxiliaryCalls, 0);
  releaseSubmit();
  await activeSubmit;
});

test("renderer action lock admits only one reentrant new-session action", async () => {
  const lock = new ExclusiveActionLock();
  let releaseSession!: () => void;
  const sessionBlocker = new Promise<void>((resolve) => { releaseSession = resolve; });
  let newSessionCalls = 0;
  const newSession = async (): Promise<void> => {
    newSessionCalls += 1;
    await sessionBlocker;
  };

  const first = lock.run(newSession);
  const second = await lock.run(newSession);

  assert.equal(second, null);
  assert.equal(newSessionCalls, 1);
  releaseSession();
  await first;
});
