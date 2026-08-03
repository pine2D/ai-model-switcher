#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ crypto: require("node:crypto").webcrypto, TextEncoder, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg/sync-model.js"), "utf8") + ";this.model=SyncModel", context);
const M = context.model;

async function main() {
  assert.equal(M.compareVersion({ updatedAt: 2, deviceId: "a" }, { updatedAt: 1, deviceId: "z" }), 1);
  assert.equal(M.compareVersion({ updatedAt: 2, deviceId: "b" }, { updatedAt: 2, deviceId: "a" }), 1);
  assert.ok(new TextEncoder().encode(M.utf8Preview("问".repeat(100))).length <= 96);
  assert.equal(await M.hashText("same text"), await M.hashText("same text"));
  assert.equal(await M.hashText("same text"), "2e68a7bba11b90d1bae1daea2dd4951779cf45d5897c62539d01f44054bcb1e0");

  const merged = M.mergeStateFragments([
    { schema: 1, deviceId: "a", settings: { amsTheme: { value: "dark", updatedAt: 2, deviceId: "a" } }, templates: {}, groups: {} },
    { schema: 1, deviceId: "b", settings: { amsTheme: { value: "light", updatedAt: 2, deviceId: "b" } }, templates: {}, groups: {} },
  ]);
  assert.equal(merged.settings.amsTheme.value, "light");
  assert.equal(M.mergeStateFragments([{ schema: 2 }]).readOnly, true);

  assert.equal(M.mergeHistory([
    { textHash: "h", text: "q", lastUsedAt: 1, deviceId: "a" },
    { textHash: "h", text: "q", lastUsedAt: 3, deviceId: "b" },
  ]).length, 1);
  assert.equal(M.mergeHistory([{ textHash: "h", text: "q", lastUsedAt: 1 }, { textHash: "h", text: "q", lastUsedAt: 3 }])[0].lastUsedAt, 3);

  assert.equal(JSON.stringify(M.mergeArchives([
    { id: "x", createdAt: 1, text: "q" },
    { id: "x", createdAt: 1, deletedAt: 2 },
  ])), "[]");
  assert.equal(M.retryDelay(0, () => 0), 750);
  assert.equal(M.retryDelay(20, () => 1), 1125000);

  console.log("sync-model tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
