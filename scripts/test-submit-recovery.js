#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const broadcast = fs.readFileSync("bg/broadcast.js", "utf8");
function harness(wasSubmitted) {
  let submits = 0;
  const chrome = {
    runtime: { lastError: null, sendMessage: (_msg, cb) => cb() },
    tabs: { sendMessage: async (_id, msg) => {
      if (msg.cmd === "getState") return { state: "fast", canConfirm: true };
      if (msg.cmd === "wasSubmitted") return { supported: true, ok: wasSubmitted() };
      if (msg.cmd === "submitPrompt") {
        submits++;
        if (submits === 1) throw new Error("message port closed after Kimi rerender");
        return { ok: true };
      }
      return undefined;
    } },
  };
  const context = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout,
    getWindows: async () => ({}), tabsForHost: async () => [{ id: 9 }] });
  vm.runInContext(broadcast, context);
  return { context, submits: () => submits };
}

test("Kimi 端口断开但用户消息已出现时判成功且不重发", async () => {
  const h = harness(() => true);
  const result = await vm.runInContext(
    'submitWhenReady({host:"www.kimi.com"}, "probe", null, 1000, 10, currentSendEpoch())', h.context);
  assert.equal(result.ok, true);
  assert.equal(h.submits(), 1);
});

test("Kimi 页面重挂且用户消息明确不存在时只重试一次", async () => {
  const h = harness(() => false);
  const result = await vm.runInContext(
    'submitWhenReady({host:"www.kimi.com"}, "probe", null, 1000, 10, currentSendEpoch())', h.context);
  assert.equal(result.ok, true);
  assert.equal(h.submits(), 2);
});
