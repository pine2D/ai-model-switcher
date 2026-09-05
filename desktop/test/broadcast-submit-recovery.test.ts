import assert from "node:assert/strict";
import test from "node:test";

import { BroadcastCoordinator, type SubmittedProbe } from "../src/main/broadcast";
import type { SiteResult, SiteSubmittedResponse } from "../src/shared/protocol";
import { readSource } from "./fixtures";

// 「提交不确定 ≠ 可以重发」的唯一合法例外：站点实现了只读 submitted() 且明确确认未提交，才允许重发一次。
// 每条用例都显式传 resubmit，不依赖 POLYASK_KIMI_RESUBMIT 的默认值——否则日后改默认值会让一条用例静默失效。

function clock(): { coordinator: BroadcastCoordinator; now: () => number } {
  let now = 1_000;
  const coordinator = new BroadcastCoordinator(() => now, async (ms) => { now += ms; });
  return { coordinator, now: () => now };
}

const unconfirmed = async (): Promise<SiteResult> => ({ ok: false, code: "submit_unconfirmed" });
const request = { text: "question", tier: null, sites: ["kimi" as const], images: [] };

async function run(dispatch: (call: number) => Promise<SiteResult>, probe: SubmittedProbe | undefined, resubmit: boolean) {
  const { coordinator } = clock();
  let calls = 0;
  const result = await coordinator.send(request, () => dispatch(++calls), 22_000, undefined, { confirm: probe, resubmit });
  return { calls, result: result[0] };
}

test("a supported site that confirms the message was sent is reported as sent without a resend", async () => {
  const { calls, result } = await run(unconfirmed, async () => ({ supported: true, ok: true }), true);
  assert.equal(calls, 1);
  assert.deepEqual(result, { site: "kimi", ok: true });
});

test("a supported site that confirms the message was not sent is resent exactly once", async () => {
  const probes: string[] = [];
  const probe: SubmittedProbe = async (_site, command) => { probes.push(command.text); return { supported: true, ok: false }; };
  const { calls, result } = await run(async (call) => call === 1 ? { ok: false, code: "submit_unconfirmed" } : { ok: true }, probe, true);
  assert.equal(calls, 2);
  assert.deepEqual(result, { site: "kimi", ok: true });
  assert.ok(probes.every((text) => text === "question"));
  // 重发后仍不确定且仍未提交：不再重发，原样交用户
  const second = await run(unconfirmed, probe, true);
  assert.equal(second.calls, 2);
  assert.deepEqual(second.result, { site: "kimi", ok: false, code: "submit_unconfirmed" });
});

test("a site without a read-only submitted() check is never resent", async () => {
  const { calls, result } = await run(unconfirmed, async () => ({ supported: false, ok: false }), true);
  assert.equal(calls, 1);
  assert.deepEqual(result, { site: "kimi", ok: false, code: "submit_unconfirmed" });
});

test("codes outside the retriable set are terminal even when they are known site codes", async () => {
  const { calls, result } = await run(async () => ({ ok: false, code: "inject_failed" }), async () => ({ supported: true, ok: false }), true);
  assert.equal(calls, 1);
  assert.deepEqual(result, { site: "kimi", ok: false, code: "inject_failed" });
});

test("malformed, non-object, throwing or silent probe answers never lead to a resend", async () => {
  for (const probe of [
    async () => ({ supported: true }) as unknown as SiteSubmittedResponse,
    async () => null as unknown as SiteSubmittedResponse,
    async () => ({ supported: "yes", ok: false }) as unknown as SiteSubmittedResponse,
    async () => { throw new Error("page remounting"); }
  ]) {
    const { calls, result } = await run(unconfirmed, probe, true);
    assert.equal(calls, 1);
    assert.deepEqual(result, { site: "kimi", ok: false, code: "submit_unconfirmed" });
  }
});

test("with the resend switch off, a confirmed 'not sent' still goes back to the user", async () => {
  const { calls, result } = await run(unconfirmed, async () => ({ supported: true, ok: false }), false);
  assert.equal(calls, 1);
  assert.deepEqual(result, { site: "kimi", ok: false, code: "submit_unconfirmed" });
});

test("the resend switch ships as false until the F067 real-machine cases pass", () => {
  assert.match(readSource("src/main/broadcast.ts"), /^const POLYASK_KIMI_RESUBMIT = false;$/m);
  assert.match(readSource("src/preload/site.ts"), /probing \? normalizeSubmitted\(value\) : normalizeResult\(value\)/, "wasSubmitted 必须走 normalizeSubmitted，不得走 normalizeResult");
});
