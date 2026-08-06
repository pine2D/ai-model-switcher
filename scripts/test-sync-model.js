#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({ crypto: require("node:crypto").webcrypto, TextEncoder, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "bg/sync-model.js"), "utf8") + ";this.model=SyncModel", context);
const transferSource = fs.existsSync(path.join(__dirname, "..", "bg/transfer.js")) ?
  fs.readFileSync(path.join(__dirname, "..", "bg/transfer.js"), "utf8") : "";
vm.runInContext(transferSource + ";this.transfer=typeof Transfer === 'undefined' ? undefined : Transfer", context);
const M = context.model;
const Transfer = context.transfer;

async function main() {
  assert.equal(typeof Transfer, "object", "必须提供迁移包格式校验");
  assert.equal(Transfer.validateHeader({ format: "polyask-transfer", version: 1, exportedAt: new Date().toISOString() }), true);
  assert.throws(() => Transfer.validateHeader({ format: "polyask-transfer", version: 2 }), /newer_format/);
  assert.throws(() => Transfer.validateRecord({ kind: "unknown", value: {} }), /unknown_kind/);
  assert.throws(() => Transfer.validateRecord({ kind: "history", value: { id: "h" } }), /invalid_record/);
  const id = "00000000-0000-4000-8000-000000000001", hash = await M.hashText("same text");
  assert.equal(Transfer.validateRecord({ kind: "template", value: { id: "t", updatedAt: 1, deletedAt: 1 } }), true);
  assert.equal(Transfer.validateRecord({ kind: "group", value: { id: "g", updatedAt: 1, deletedAt: 1 } }), true);
  await Transfer.validateContent({ kind: "history", value: { id: hash, textHash: hash, text: "same text", createdAt: 1, lastUsedAt: 1 } });
  await Transfer.validateContent({ kind: "history", value: { id: hash, textHash: hash, createdAt: 1, lastUsedAt: 1,
    updatedAt: 2, deletedAt: 2, deviceId: "device", schema: 1 } });
  await Transfer.validateContent({ kind: "archive", value: { id, createdAt: 1, deletedAt: 1 } });
  await assert.rejects(Transfer.validateContent({ kind: "history", value: { id: hash, textHash: hash, text: "other", createdAt: 1, lastUsedAt: 1 } }), /invalid_record/);
  await assert.rejects(Transfer.validateContent({ kind: "archive", value: { id: "not-uuid", createdAt: 1, deletedAt: 1 } }), /invalid_record/);
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
  const deletedHistory = { id: "h", textHash: "h", createdAt: 1, lastUsedAt: 2, updatedAt: 3, deletedAt: 3, deviceId: "b", schema: 1 };
  assert.equal(M.mergeHistory([{ id: "h", textHash: "h", text: "q", createdAt: 1, lastUsedAt: 2, updatedAt: 2, deviceId: "a" }, deletedHistory])[0].deletedAt, 3,
    "较新的历史 tombstone 必须保留并覆盖正文");
  assert.equal(M.mergeHistory([{ ...deletedHistory, deletedAt: 2, updatedAt: 2, deviceId: "z" },
    { id: "h", textHash: "h", text: "q", createdAt: 1, lastUsedAt: 2, updatedAt: 2, deviceId: "a" }])[0].deletedAt, 2,
    "历史版本同刻时 tombstone 必须获胜");

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
