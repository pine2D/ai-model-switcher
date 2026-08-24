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
// 站点登记一致性：扩展三处 + desktop M0（漏一处该端静默缺席，不报错）
const HINT = "（加站点必须同改 manifest.json / content/adapters-*.js / console/sites.js，desktop 另改 desktop/src/main/sites.ts）";
const sites = JSON.parse(vm.runInContext("JSON.stringify(SITES)", context));
const desktopSource = fs.readFileSync("desktop/src/main/sites.ts", "utf8");
const desktopHosts = [...desktopSource.matchAll(/\bhost:\s*"([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(new Set(desktopHosts), new Set(sites.map((site) => site.host)),
  `desktop 站点清单必须与扩展 SITES 完全一致${HINT}`);
// 清单一律从 manifest 派生：硬编码文件名会让「manifest 漏挂某卷适配器」这种真事故照样绿
const blocks = JSON.parse(fs.readFileSync("manifest.json", "utf8")).content_scripts;
const matches = blocks.flatMap((b) => b.matches || []);
const adapterFiles = blocks.flatMap((b) => b.js || []).filter((f) => /adapters.*\.js$/.test(f));
assert.ok(adapterFiles.length, "manifest.json 的 content_scripts.js 里没有任何 adapters*.js —— 九站全部失去适配器");
const adapterKeys = [];
for (const file of adapterFiles) {
  const S = { adapters: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"),
    { window: { __AMS: S }, document: { querySelector: () => null, querySelectorAll: () => [] }, console });
  adapterKeys.push(...Object.keys(S.adapters));
}
assert.ok(adapterKeys.length, "适配器源码未注册任何键（vm 加载失败或 __AMS 契约变了）");
// match pattern 语义：`*.example.com` 同时覆盖裸域名与子域名
const covers = (pattern, host) => {
  const domain = (pattern.match(/^[^:]+:\/\/([^/]+)/) || [])[1] || "";
  return domain.startsWith("*.") ? host === domain.slice(2) || host.endsWith(domain.slice(1)) : host === domain;
};
for (const { host } of sites) {
  assert.ok(matches.some((p) => covers(p, host)),
    `站点 ${host} 未被 manifest.json content_scripts 的任何 matches 覆盖 → content script 不注入、该站永远不参与群发；去 manifest.json 补一条匹配${HINT}`);
  assert.ok(adapterKeys.some((key) => host.includes(key)),
    `站点 ${host} 没有适配器：manifest 挂载的 ${adapterFiles.join(" / ")} 里没有能被 hostname.includes() 命中的注册键（键是 hostname 子串，不必等于 host；新开一卷适配器要记得挂进 manifest）${HINT}`);
}
for (const key of adapterKeys)
  assert.ok(sites.some((site) => site.host.includes(key)),
    `适配器键 "${key}" 没有任何 SITES 项能命中 → 僵尸适配器；去 console/sites.js 补站点，或删掉这段适配器${HINT}`);
for (const pattern of matches)
  assert.ok(sites.some((site) => covers(pattern, site.host)),
    `manifest.json 匹配 "${pattern}" 没有对应 SITES 项 → 孤儿匹配（注入了却不参与群发）；去 console/sites.js 补站点，或删掉这条匹配${HINT}`);
console.log("site selection tests passed");
