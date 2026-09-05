#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { ROOT, PRELOAD, SITES: SITES_TS, SITE_RUNTIME, preloadRequires, desktopSites } = require("../desktop/scripts/lib/desktop-anchors");
// 站点登记一致性：站点表 + 适配器分卷 + preload require（漏一处该站静默缺席，不报错）。
// 扩展侧站点选择的默认 3 站语义随扩展下线；Desktop 的选择模型是另一套（workspace-service 无存储时默认全 9 站），不迁移。
const HINT = `（加站点必须同改 ${SITES_TS} / ${SITE_RUNTIME}/adapters-*.js，新开的分卷要在 ${PRELOAD} 里 require）`;
// SITES 真源是 desktop/src/main/sites.ts。
const sites = desktopSites();
// 清单一律从 preload 的 require 列表派生：硬编码文件名会让「preload 漏 require 某卷适配器」这种真事故照样绿
const adapterFiles = preloadRequires().filter((f) => /adapters.*\.js$/.test(f));
assert.ok(adapterFiles.length, `${PRELOAD} 的 require 列表里没有任何 adapters*.js —— 九站全部失去适配器`);
const adapterKeys = [];
const allAdapters = {}; // 合并三卷，供下面的四项钩子对账（漏收对象就测不出缺钩子）
for (const file of adapterFiles) {
  const S = { adapters: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), "utf8"),
    { window: { __AMS: S }, document: { querySelector: () => null, querySelectorAll: () => [] }, console });
  adapterKeys.push(...Object.keys(S.adapters));
  Object.assign(allAdapters, S.adapters);
}
assert.ok(adapterKeys.length, "适配器源码未注册任何键（vm 加载失败或 __AMS 契约变了）");
// 协议对账：每站必需 {think, fast, state, diagnose} 四项（CLAUDE.md 硬约束），其余钩子可选。
// 只加载 adapters-*.js、不加载 diag.js，测的是适配器自身是否实现，不吃 diag.js 对 diagnose 的兜底包装。
for (const [key, adapter] of Object.entries(allAdapters))
  for (const hook of ["think", "fast", "state", "diagnose"])
    assert.equal(typeof adapter[hook], "function", `适配器 "${key}" 缺少必需钩子 ${hook}——getState()/switchTier 会静默失效${HINT}`);
for (const { host } of sites) {
  assert.ok(adapterKeys.some((key) => host.includes(key)),
    `站点 ${host} 没有适配器：${PRELOAD} require 的 ${adapterFiles.join(" / ")} 里没有能被 hostname.includes() 命中的注册键（键是 hostname 子串，不必等于 host；新开一卷适配器要记得在 preload 里 require）${HINT}`);
}
for (const key of adapterKeys)
  assert.ok(sites.some((site) => site.host.includes(key)),
    `适配器键 "${key}" 没有任何 SITES 项能命中 → 僵尸适配器；去 ${SITES_TS} 补站点，或删掉这段适配器${HINT}`);

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
// 哨兵 scripts/watch-releases.js 的 SOURCES.adapter：抠出全部 desktop/src/site-runtime/adapters-*.js 子串，每个都必须真实存在。
// 口径是「抽子串」而不是「字段就是路径」：bailian 源的 adapter 是一句散文（同时覆盖两卷），压成单一路径会丢信息。
{
  const watcher = fs.readFileSync(path.join(__dirname, "watch-releases.js"), "utf8");
  const entries = [...watcher.matchAll(/\{ key: "([^"]+)"[\s\S]*?adapter: "([^"]*)"/g)];
  assert.ok(entries.length >= 8, `watch-releases.js 的 SOURCES 抽取失效，实得 ${entries.length} 条`);
  for (const [, key, adapter] of entries) {
    const files = adapter.match(/desktop\/src\/site-runtime\/adapters-[a-z0-9-]+\.js/g) || [];
    assert.ok(files.length, `SOURCES.${key} 的 adapter 字段里没有任何 ${SITE_RUNTIME}/adapters-*.js 路径：${adapter}`);
    for (const file of files) assert.ok(fs.existsSync(path.join(ROOT, file)), `SOURCES.${key} 指向不存在的适配器分卷 ${file}`);
  }
}
console.log("site selection tests passed");
