import assert from "node:assert/strict";
import test from "node:test";

import { SerialActions } from "../src/renderer/serial-actions";

test("serial UI actions preserve adjacent writes and remain usable after a failure", async () => {
  const busy: boolean[] = [];
  const failures: string[] = [];
  const order: string[] = [];
  let release!: () => void;
  const queue = new SerialActions(
    (value) => busy.push(value),
    (failure) => failures.push(failure)
  );
  const first = queue.run(async () => {
    order.push("first:start");
    await new Promise<void>((resolve) => { release = resolve; });
    order.push("first:end");
  }, "first failed");
  const second = queue.run(async () => { order.push("second"); }, "second failed");
  const third = queue.run(async () => { throw new Error("boom"); }, "third failed");
  const fourth = queue.run(async () => { order.push("fourth"); }, "fourth failed");

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first:start"]);
  release();
  await Promise.all([first, second, third, fourth]);
  assert.deepEqual(order, ["first:start", "first:end", "second", "fourth"]);
  assert.deepEqual(failures, ["third failed"]);
  assert.deepEqual(busy, [true, false]);
});
