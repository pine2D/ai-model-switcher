#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");

function runtime(opened) {
  const updates = [], submits = [], site = { host: "a.test", url: "https://a.test/new" };
  let tab = { id: 20, windowId: 2, url: opened ? site.url : "https://a.test/chat/old", status: "complete" };
  const scope = vm.createContext({
    openTile: async (_sites, prune) => (assert.equal(prune, false), [{ host: site.host, windowId: 2, opened }]),
    getWindows: async () => ({ [site.host]: { id: 2, owned: true } }),
    tabsForHost: async () => [tab], currentSendEpoch: () => 0,
    submitWhenReady: async (...args) => { submits.push(args); return { host: site.host, ok: true }; },
    isNewSessionUrl: (left, right) => new URL(left).pathname === new URL(right).pathname,
    chrome: { tabs: { update: async (id, patch) => { updates.push({ id, patch }); tab = { ...tab, ...patch, status: "complete" }; return tab; }, get: async () => tab } },
    Date, URL, setTimeout,
  });
  vm.runInContext(fs.readFileSync("bg/synthesis.js", "utf8") + ";this.send=sendOneNewSession;this.valid=validSynthesisRequest", scope);
  return { send: scope.send, valid: scope.valid, site, updates, submits };
}

(async () => {
  const existing = runtime(false), result = await existing.send(existing.site, "payload", "think");
  assert.equal(existing.valid({ site: existing.site, text: "payload", tier: "think" }), true);
  assert.equal(existing.valid({ site: { host: "a.test", url: "https://evil.test/new" }, text: "payload" }), false);
  assert.equal(existing.valid({ site: existing.site, text: " ", tier: null }), false);
  assert.equal(existing.valid({ site: existing.site, text: "payload", tier: "unknown" }), false);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(existing.updates)), [{ id: 20, patch: { url: "https://a.test/new", active: true } }], "既有受管 popup 必须先导航到新会话");
  assert.equal(existing.submits[0][0].host, "a.test"); assert.equal(existing.submits[0].at(-1), false, "辅助综合不得覆盖群发状态点");
  const created = runtime(true); await created.send(created.site, "payload", null);
  assert.equal(created.updates.length, 0, "刚创建的新会话 popup 不得重复导航");
  assert.equal(fs.readFileSync("bg/synthesis.js", "utf8").includes("tabs.query"), false, "辅助综合不得查询或收编日常标签页");
  console.log("synthesis-runtime tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
