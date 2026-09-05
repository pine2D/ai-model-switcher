#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { PRELOAD, SITES: SITES_TS, preloadRequires, desktopSites } = require("./lib/desktop-anchors");
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
// 站点登记一致性：站点表 + 适配器分卷 + preload require（漏一处该站静默缺席，不报错）
const HINT = `（加站点必须同改 ${SITES_TS} / content/adapters-*.js，新开的分卷要在 ${PRELOAD} 里 require；扩展退役前 manifest.json / console/sites.js 仍是跟随项）`;
// SITES 真源是 desktop/src/main/sites.ts；console/sites.js 派生的那份只在扩展退役前作对拍（TODO(Step 9) 删）。
const sites = desktopSites();
const extensionSites = JSON.parse(vm.runInContext("JSON.stringify(SITES)", context));
assert.deepEqual(
  sites.map(({ host, label }) => ({ host, label })),
  extensionSites.map(({ host, label }) => ({ host, label })),
  "sites.ts 抽出的 {host,label} 与 console/sites.js 不一致——新锚点抽错字段，或两端站点表真的漂了");
// 清单一律从 preload 的 require 列表派生：硬编码文件名会让「preload 漏 require 某卷适配器」这种真事故照样绿
const adapterFiles = preloadRequires().filter((f) => /adapters.*\.js$/.test(f));
assert.ok(adapterFiles.length, `${PRELOAD} 的 require 列表里没有任何 adapters*.js —— 九站全部失去适配器`);
// TODO(Step 9)：manifest 派生的 matches / adapterFiles 随扩展一起删；此刻并存只为对拍新锚点。
const blocks = JSON.parse(fs.readFileSync("manifest.json", "utf8")).content_scripts;
const matches = blocks.flatMap((b) => b.matches || []);
assert.deepEqual(adapterFiles, blocks.flatMap((b) => b.js || []).filter((f) => /adapters.*\.js$/.test(f)),
  "preload require 派生的适配器分卷与 manifest 派生的不一致——新锚点抽错了");
const adapterKeys = [];
const allAdapters = {}; // 合并三卷，供下面的四项钩子对账（漏收对象就测不出缺钩子）
for (const file of adapterFiles) {
  const S = { adapters: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"),
    { window: { __AMS: S }, document: { querySelector: () => null, querySelectorAll: () => [] }, console });
  adapterKeys.push(...Object.keys(S.adapters));
  Object.assign(allAdapters, S.adapters);
}
assert.ok(adapterKeys.length, "适配器源码未注册任何键（vm 加载失败或 __AMS 契约变了）");
// 协议对账：每站必需 {think, fast, state, diagnose} 四项（CLAUDE.md 硬约束），其余钩子可选。
// 只加载 adapters-*.js、不加载 content/diag.js，测的是适配器自身是否实现，不吃 diag.js 对 diagnose 的兜底包装。
for (const [key, adapter] of Object.entries(allAdapters))
  for (const hook of ["think", "fast", "state", "diagnose"])
    assert.equal(typeof adapter[hook], "function", `适配器 "${key}" 缺少必需钩子 ${hook}——getState()/switchTier 会静默失效${HINT}`);
// match pattern 语义：`*.example.com` 同时覆盖裸域名与子域名
const covers = (pattern, host) => {
  const domain = (pattern.match(/^[^:]+:\/\/([^/]+)/) || [])[1] || "";
  return domain.startsWith("*.") ? host === domain.slice(2) || host.endsWith(domain.slice(1)) : host === domain;
};
// TODO(Step 9)：covers / matches 覆盖 / 孤儿匹配三段随 manifest 一起删。
for (const { host } of sites) {
  assert.ok(matches.some((p) => covers(p, host)),
    `站点 ${host} 未被 manifest.json content_scripts 的任何 matches 覆盖 → content script 不注入、该站永远不参与群发；去 manifest.json 补一条匹配${HINT}`);
  assert.ok(adapterKeys.some((key) => host.includes(key)),
    `站点 ${host} 没有适配器：${PRELOAD} require 的 ${adapterFiles.join(" / ")} 里没有能被 hostname.includes() 命中的注册键（键是 hostname 子串，不必等于 host；新开一卷适配器要记得在 preload 里 require）${HINT}`);
}
for (const key of adapterKeys)
  assert.ok(sites.some((site) => site.host.includes(key)),
    `适配器键 "${key}" 没有任何 SITES 项能命中 → 僵尸适配器；去 ${SITES_TS} 补站点，或删掉这段适配器${HINT}`);
for (const pattern of matches)
  assert.ok(sites.some((site) => covers(pattern, site.host)),
    `manifest.json 匹配 "${pattern}" 没有对应 SITES 项 → 孤儿匹配（注入了却不参与群发）；去 console/sites.js 补站点，或删掉这条匹配${HINT}`);

// F197：报障 issue 模板的站点下拉与 SITES 对账——加第 10 站时表单不会静默过期
{
  const tpl = fs.readFileSync(".github/ISSUE_TEMPLATE/site-breakage.yml", "utf8");
  const block = (tpl.match(/label: 哪个站点？[\s\S]*?options:\n([\s\S]*?)\n    validations:/) || [])[1];
  assert.ok(block, "issue 模板里找不到「哪个站点」下拉的 options 块（结构变了就同步这段抽取）");
  const rows = [...block.matchAll(/-\s*(.+?)\s*\(([^)]+)\)/g)].map((m) => ({ label: m[1].trim(), host: m[2].trim() }));
  const tplHosts = new Set(rows.map((r) => r.host));
  for (const site of sites)
    assert.ok(tplHosts.has(site.host), `issue 模板站点下拉缺 ${site.host}（${site.label}）；加站点第 8 步：同步 .github/ISSUE_TEMPLATE/site-breakage.yml`);
  for (const r of rows) {
    const site = sites.find((x) => x.host === r.host);
    assert.ok(site, `issue 模板下拉含未登记站点 ${r.host}；站点已下架就同步删掉该选项`);
    assert.equal(r.label, site.label, `issue 模板站点名 "${r.label}" 与 ${SITES_TS} 的 "${site.label}" 不一致`);
  }
}
console.log("site selection tests passed");
