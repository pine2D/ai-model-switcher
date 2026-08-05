#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(fs.readFileSync("console/sites.js", "utf8"), context);
const resolve = (saved, host = "") => JSON.parse(vm.runInContext(
  `JSON.stringify(resolveSiteSelection(${JSON.stringify(saved)}, ${JSON.stringify(host)}))`, context));

const defaults = resolve({});
assert.deepEqual(Object.entries(defaults).filter(([, on]) => on).map(([host]) => host),
  ["claude.ai", "chatgpt.com", "gemini.google.com"]);
const disabled = Object.fromEntries(Object.keys(defaults).map((host) => [host, false]));
assert.deepEqual(resolve(disabled), disabled, "显式全关不得恢复默认站点");
assert.deepEqual(Object.entries(resolve({}, "www.kimi.com")).filter(([, on]) => on).map(([host]) => host), ["www.kimi.com"]);
const saved = { "chat.deepseek.com": true };
context.saved = saved; context.result = vm.runInContext("resolveSiteSelection(saved)", context);
assert.deepEqual(JSON.parse(JSON.stringify(context.result)), saved);
assert.notEqual(context.result, saved, "返回值不得复用调用方对象");

for (const file of ["console/console.js", "console/compose.js"])
  assert.match(fs.readFileSync(file, "utf8"), /resolveSiteSelection\(/, `${file} 必须复用共享选择逻辑`);
console.log("site selection tests passed");
