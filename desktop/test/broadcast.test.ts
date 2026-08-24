import assert from "node:assert/strict";
import test from "node:test";

import { BroadcastCoordinator } from "../src/main/broadcast";
import type { SiteCommand, SiteResult } from "../src/shared/protocol";

test("broadcast uses one absolute deadline and dispatches every site concurrently", async () => {
  const coordinator = new BroadcastCoordinator(() => 1_000);
  const commands: SiteCommand[] = [];
  const result = await coordinator.send(
    { text: "question", tier: "fast", sites: ["claude", "gemini"], images: [] },
    async (_site, command) => {
      commands.push(command);
      return { ok: true };
    },
    22_000
  );

  assert.deepEqual(result.map((item) => item.ok), [true, true]);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].deadline, 23_000);
  assert.equal(commands[1].deadline, 23_000);
  assert.deepEqual(commands[0].images, []);
});

test("image broadcast uses the long deadline and forwards one validated payload", async () => {
  const coordinator = new BroadcastCoordinator(() => 1_000);
  const commands: SiteCommand[] = [];
  const images = [{
    name: "x.png",
    type: "image/png" as const,
    size: 8,
    dataUrl: "data:image/png;base64,iVBORw0KGgo="
  }];
  await coordinator.send(
    { text: "question", tier: null, sites: ["claude"], images },
    async (_site, command) => { commands.push(command); return { ok: true }; },
    90_000
  );

  assert.equal(commands[0].deadline, 91_000);
  assert.deepEqual(commands[0].images, images);
});

test("uncertain submit is returned once and is never auto-retried", async () => {
  const coordinator = new BroadcastCoordinator(() => 1_000);
  let calls = 0;
  const result = await coordinator.send(
    { text: "question", tier: null, sites: ["claude"], images: [] },
    async (): Promise<SiteResult> => {
      calls += 1;
      return { ok: false, code: "submit_unconfirmed" };
    },
    22_000
  );

  assert.equal(calls, 1);
  assert.deepEqual(result, [
    { site: "claude", ok: false, code: "submit_unconfirmed" }
  ]);
});

test("confirmed pre-submit readiness failures can retry within the same deadline", async () => {
  const coordinator = new BroadcastCoordinator(() => 1_000, async () => undefined);
  let calls = 0;
  const result = await coordinator.send(
    { text: "question", tier: null, sites: ["claude"], images: [] },
    async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, code: "composer_not_found" }
        : { ok: true };
    },
    22_000
  );

  assert.equal(calls, 2);
  assert.deepEqual(result, [{ site: "claude", ok: true }]);
});

test("cancel advances the epoch without retransmitting the same image", async () => {
  const coordinator = new BroadcastCoordinator(() => 1_000);
  let release!: (result: SiteResult) => void;
  let calls = 0;
  const images = [{
    name: "x.png",
    type: "image/png" as const,
    size: 8,
    dataUrl: "data:image/png;base64,iVBORw0KGgo="
  }];
  const pending = coordinator.send(
    { text: "question", tier: null, sites: ["claude"], images },
    (_site, command) => new Promise((resolve) => {
      calls += 1;
      assert.equal(command.images, images);
      release = resolve;
    }),
    90_000
  );

  coordinator.cancel();
  release({ ok: true });
  assert.equal(calls, 1);
  assert.deepEqual(await pending, [
    { site: "claude", ok: false, code: "cancelled" }
  ]);
});

test("cancel aborts active site dispatch instead of waiting for its deadline", async () => {
  const coordinator = new BroadcastCoordinator(() => 1_000);
  let dispatchStarted!: () => void;
  let receivedSignal: AbortSignal | undefined;
  const started = new Promise<void>((resolve) => { dispatchStarted = resolve; });
  const pending = coordinator.send(
    { text: "question", tier: null, sites: ["claude"], images: [] },
    (_site, _command, signal) => new Promise((resolve) => {
      receivedSignal = signal;
      dispatchStarted();
      signal?.addEventListener("abort", () => resolve({ ok: false, code: "cancelled" }), { once: true });
    }),
    22_000
  );

  await started;
  assert.ok(receivedSignal instanceof AbortSignal);
  coordinator.cancel();
  assert.deepEqual(await pending, [
    { site: "claude", ok: false, code: "cancelled" }
  ]);
});
