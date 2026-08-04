#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync("console/run-meta.js", "utf8");
assert.match(fs.readFileSync("console/console.js", "utf8"), /const text = elPrompt\.value\.trim\(\); if \(!text\)/, "普通控制台发送必须保留 trim 语义");

const saved = {};
const chrome = {
  runtime: { lastError: null },
  storage: { session: {
    get(_key, done) { done({ ...saved }); },
    set(value, done) { Object.assign(saved, value); done(); },
    remove(key, done) { delete saved[key]; done(); },
  } },
};
const context = vm.createContext({ chrome });
vm.runInContext(source, context);

function failingApi(fail) {
  let removes = 0;
  const chrome = { runtime: { lastError: null }, storage: { session: {
    get(_key, done) { reply(done, {}, fail === "get"); },
    set(_value, done) { reply(done, {}, fail === "set"); },
    remove(_key, done) { removes++; reply(done, {}, fail === "remove"); },
  } } };
  function reply(done, value, failed) {
    chrome.runtime.lastError = failed ? { message: fail + " failed" } : null;
    done(value); chrome.runtime.lastError = null;
  }
  const context = vm.createContext({ chrome }); vm.runInContext(source, context);
  return { api: vm.runInContext("RunMeta", context), removes: () => removes };
}

(async () => {
  const RunMeta = vm.runInContext("RunMeta", context);
  await RunMeta.savePending({ text: "full", task: "task", source: { kind: "page", title: "T", url: "https://e.test" } });
  assert.deepEqual(JSON.parse(JSON.stringify(await RunMeta.resolve("full"))), { task: "task", source: { kind: "page", title: "T", url: "https://e.test" } });
  await RunMeta.savePending({ text: "full", task: "task", source: { kind: "page", title: "T", url: "https://e.test" } });
  assert.deepEqual(JSON.parse(JSON.stringify(await RunMeta.resolve("edited"))), { task: "edited", source: null });
  assert.equal(saved.amsPendingRun, undefined);
  await assert.rejects(failingApi("set").api.savePending({ text: "full", task: "task", source: null }), /set failed/);
  const getFailure = failingApi("get");
  await assert.rejects(getFailure.api.resolve("full"), /get failed/); assert.equal(getFailure.removes(), 1);
  await assert.rejects(failingApi("remove").api.resolve("full"), /remove failed/);
  console.log("run metadata tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
