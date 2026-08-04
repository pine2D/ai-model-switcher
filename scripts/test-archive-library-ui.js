#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("console/archive.html", "utf8");
const js = fs.readFileSync("console/archive.js", "utf8");

for (const id of ["ar-search", "ar-favorites", "ar-tag", "ar-list", "ar-detail"]) {
  assert.ok(html.includes(`id="${id}"`), `结果库缺少 ${id}`);
}
assert.ok(js.includes('action: "archiveSearch"'), "结果库应使用 archiveSearch");
assert.ok(js.includes('action: "archiveTags"'), "结果库应加载 archiveTags");
assert.ok(js.includes("searchToken"), "stale search callbacks must be ignored");
assert.ok(!html.includes("<svg") || (html.match(/<svg/g) || []).length === 1, "do not add nonessential icons");
assert.equal(html.match(/<html lang="([^"]+)"/)?.[1], "zh-CN");
assert.equal(html.match(/id="ar-detail"[^>]+data-empty="([^"]+)"/)?.[1], "正在加载已保存的结果…",
  "详情区静态 fallback 应与声明的简体中文页面语言一致");

class El {
  constructor() { this.listeners = {}; this.classList = { add() {}, remove() {} }; this.children = []; this.value = ""; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn({ currentTarget: this }); }
  setAttribute(key, value) { this[key] = value; } removeAttribute(key) { delete this[key]; }
  replaceChildren(...children) { this.children = children; }
  appendChild(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  click() {}
}

function loadMoreIsSingleFlight() {
  const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture", "ar-search", "ar-favorites", "ar-tag"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()]));
  const pages = [];
  let resets = 0;
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
      if (message.action === "archiveTags") return done({ ok: true, tags: [] });
      if (message.action === "archiveSearch" && message.cursor == null) {
        resets++; return done({ ok: true, items: [{ id: `base-${resets}`, ts: resets, task: "base", results: [] }], nextCursor: `cursor-${resets}` });
      }
      if (message.action === "archiveSearch") pages.push({ message, done });
    } },
    storage: { local: { get() {} }, session: { get() {} } },
  };
  const document = { documentElement: {}, getElementById: (id) => els[id], addEventListener() {},
    createElement: () => new El(), createTextNode: () => new El() };
  const context = vm.createContext({ chrome, document, navigator: {}, URL, Blob, SITES: [], Date, setTimeout, clearTimeout,
    t: (key) => key, applyI18n() {}, ArchiveDetail: { render() {}, entryMarkdown: () => "markdown" } });
  vm.runInContext(js, context);

  els["ar-more"].fire("click"); els["ar-more"].fire("click");
  assert.equal(pages.length, 1, "同一 cursor 的加载更多只能有一个在途请求");

  els["ar-favorites"].fire("click");
  els["ar-more"].fire("click"); els["ar-more"].fire("click");
  assert.equal(pages.length, 2, "切换筛选后旧在途请求不得锁死新分页");
  pages[0].done({ ok: true, items: [{ id: "stale", ts: 3, task: "stale", results: [] }], nextCursor: null });
  els["ar-more"].fire("click");
  assert.equal(pages.length, 2, "旧回调不得释放当前筛选的分页锁");
  pages[1].done({ ok: true, items: [{ id: "page", ts: 4, task: "page", results: [] }], nextCursor: null });
  assert.deepEqual(vm.runInContext("archive.map((entry) => entry.id)", context), ["base-2", "page"], "分页结果不得重复追加");
}

async function updateOnlyAppliesAfterSuccess() {
  const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture", "ar-search", "ar-favorites", "ar-tag"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()]));
  const pending = [], renders = [], listeners = [];
  let searches = 0, tokenSeq = 0;
  const record = { id: "entry", ts: 1, task: "Question", text: "Question", results: [], favorite: false, tags: [], note: "", winnerHost: null };
  const other = { ...record, id: "other", task: "Other" };
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener(fn) { listeners.push(fn); } }, sendMessage(message, done) {
      if (message.action === "archiveSearch") { searches++; return done({ ok: true, items: [record, other], nextCursor: null }); }
      if (message.action === "archiveTags") return done({ ok: true, tags: [] });
      if (message.action === "archiveUpdate") pending.push({ message, done });
    } },
    storage: { local: { get() {} }, session: { get() {} } },
  };
  const document = { documentElement: {}, getElementById: (id) => els[id], addEventListener() {},
    createElement: () => new El(), createTextNode: () => new El() };
  const ArchiveDetail = { render(entry, options) { renders.push({ entry, options }); }, entryMarkdown: () => "markdown" };
  const context = vm.createContext({ chrome, document, navigator: {}, URL, Blob, SITES: [], Date, setTimeout, clearTimeout,
    t: (key) => key, applyI18n() {}, ArchiveDetail, crypto: { randomUUID: () => `change-${++tokenSeq}` } });
  vm.runInContext(js, context);
  assert.equal(renders.length, 1, "已加载条目应交给详情渲染器");

  const saved = renders[0].options.update("entry", { favorite: true });
  assert.equal(typeof saved?.then, "function", "详情更新必须返回 Promise");
  assert.deepEqual(JSON.parse(JSON.stringify(pending[0].message)), { source: "AMS_DATA", action: "archiveUpdate", id: "entry",
    patch: { favorite: true }, changeToken: "change-1" });
  const ownToken = pending[0].message.changeToken;
  assert.equal(vm.runInContext("archive[0].favorite", context), false, "响应成功前不得替换本地记录");
  els["ar-list"].children[1].fire("click");
  assert.equal(vm.runInContext("selectedId", context), "other");
  const rendersBeforeResponse = renders.length;
  pending.shift().done({ ok: true, record: { ...record, favorite: true } });
  assert.equal((await saved).favorite, true);
  assert.equal(vm.runInContext("archive[0].favorite", context), true);
  assert.equal(vm.runInContext("selectedId", context), "other", "A 的迟到响应不得把选择从 B 切回 A");
  assert.equal(renders.length, rendersBeforeResponse, "A 的迟到响应不得重绘并丢失 B 的详情输入");
  const searchesBeforeChange = searches;
  listeners.forEach((listener) => listener({ source: "AMS_DATA", type: "archiveChanged", changeToken: ownToken }));
  assert.equal(searches, searchesBeforeChange, "本页 archiveUpdate 的 archiveChanged 回流不得刷新 B");
  assert.equal(renders.length, rendersBeforeResponse, "本页 archiveChanged 回流不得重绘并丢失 B 的详情输入");

  const earlyChange = renders.at(-1).options.update("other", { note: "early-change" });
  const earlyToken = pending[0].message.changeToken, searchesBeforeEarlyChange = searches;
  listeners.forEach((listener) => listener({ source: "AMS_DATA", type: "archiveChanged", changeToken: earlyToken }));
  assert.equal(searches, searchesBeforeEarlyChange, "广播先于响应时也不得刷新当前详情");
  pending.shift().done({ ok: true, record: { ...other, note: "early-change" } });
  await earlyChange;

  const failed = renders.at(-1).options.update("other", { tags: ["draft"] });
  const failedToken = pending[0].message.changeToken;
  pending.shift().done({ ok: false });
  await assert.rejects(failed);
  assert.equal(els["ar-status"].textContent, "arc_updateFailed");
  assert.deepEqual(vm.runInContext("archive[0].tags", context), [], "失败更新不得替换本地记录");
  const searchesBeforeFailedChange = searches;
  listeners.forEach((listener) => listener({ source: "AMS_DATA", type: "archiveChanged", changeToken: failedToken }));
  assert.equal(searches, searchesBeforeFailedChange + 1, "失败请求清理 token 后不得误吞后续外部变化");
  listeners.forEach((listener) => listener({ source: "AMS_DATA", type: "archiveChanged", changeToken: "external" }));
  listeners.forEach((listener) => listener({ source: "AMS_DATA", type: "archiveChanged" }));
  assert.equal(searches, searchesBeforeFailedChange + 3, "外部或无 token 的 archiveChanged 必须正常刷新");
}

async function updatesRespectActiveFilters() {
  const cases = [
    { name: "favorite", filters: { query: "", favorite: true, tag: "" }, patch: { favorite: false }, updated: { favorite: false } },
    { name: "tag", filters: { query: "", favorite: false, tag: "keep" }, patch: { tags: [] }, updated: { tags: [], searchText: "question" }, only: true },
    { name: "query", filters: { query: "needle", favorite: false, tag: "" }, patch: { note: "gone" }, updated: { note: "gone", searchText: "question gone" }, only: true },
  ];
  for (const testCase of cases) {
    const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture", "ar-search", "ar-favorites", "ar-tag"];
    const els = Object.fromEntries(ids.map((id) => [id, new El()]));
    const pending = [], renders = [];
    const record = { id: "entry", ts: 1, task: "Question", results: [], favorite: true, tags: ["keep"], note: "needle", searchText: "question needle keep" };
    const other = { ...record, id: "other", task: "Other", searchText: "other needle keep" };
    const chrome = {
      runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
        if (message.action === "archiveSearch") return done({ ok: true, items: testCase.only ? [record] : [record, other], nextCursor: null });
        if (message.action === "archiveTags") return done({ ok: true, tags: testCase.name === "tag" ? [] : ["keep"] });
        if (message.action === "archiveUpdate") pending.push(done);
      } }, storage: { local: { get() {} }, session: { get() {} } },
    };
    const document = { documentElement: {}, getElementById: (id) => els[id], addEventListener() {},
      createElement: () => new El(), createTextNode: () => new El() };
    const context = vm.createContext({ chrome, document, navigator: {}, URL, Blob, SITES: [], Date, setTimeout, clearTimeout,
      t: (key) => key, applyI18n() {}, ArchiveDetail: { render(entry, options) { renders.push({ entry, options }); }, entryMarkdown: () => "" },
      crypto: { randomUUID: () => "filter-change" } });
    vm.runInContext(js, context);
    vm.runInContext(`filters = ${JSON.stringify(testCase.filters)}; renderList("entry")`, context);
    const promise = renders.at(-1).options.update("entry", testCase.patch);
    pending.shift()({ ok: true, record: { ...record, ...testCase.updated } });
    await promise;
    assert.deepEqual(vm.runInContext("archive.map((entry) => entry.id)", context), testCase.only ? [] : ["other"], `${testCase.name} 更新后不匹配的记录应立即移出列表`);
    assert.equal(vm.runInContext("selectedId", context), testCase.only ? undefined : "other", `${testCase.name} 更新后应安全调整选择`);
    if (testCase.only) assert.equal(els["ar-detail"]["data-empty"], "arc_noMatches", "筛选结果被移空后应显示无匹配状态");
    if (testCase.name === "tag") assert.equal(els["ar-tag"].value, "keep", "移除最后一个当前标签后仍应保留筛选上下文");
  }
}

async function draftsSurviveRefreshAndLateCallbacks() {
  const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture", "ar-search", "ar-favorites", "ar-tag"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()]));
  const pending = [], renders = [], listeners = [];
  let tokenSeq = 0;
  const entry = { id: "entry", ts: 1, task: "Question", results: [], favorite: false, tags: [], note: "", searchText: "question" };
  const other = { ...entry, id: "other", task: "Other", searchText: "other" };
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener(fn) { listeners.push(fn); } }, sendMessage(message, done) {
      if (message.action === "archiveSearch") return done({ ok: true, items: [entry, other], nextCursor: null });
      if (message.action === "archiveTags") return done({ ok: true, tags: ["draft-tag"] });
      if (message.action === "archiveUpdate") pending.push({ message, done });
    } }, storage: { local: { get() {} }, session: { get() {} } },
  };
  const document = { documentElement: {}, getElementById: (id) => els[id], addEventListener() {},
    createElement: () => new El(), createTextNode: () => new El() };
  const context = vm.createContext({ chrome, document, navigator: {}, URL, Blob, SITES: [], Date, setTimeout, clearTimeout,
    t: (key) => key, applyI18n() {}, ArchiveDetail: { render(record, options) { renders.push({ record, options }); }, entryMarkdown: () => "" },
    crypto: { randomUUID: () => `draft-${++tokenSeq}` } });
  vm.runInContext(js, context);

  let detail = renders.at(-1).options;
  detail.onDraft("entry", { tags: "draft-tag", note: "older" });
  const olderSave = detail.update("entry", { note: "older" });
  detail.onDraft("entry", { note: "newer" });
  pending.shift().done({ ok: true, record: { ...entry, note: "older", searchText: "question older" } });
  await olderSave;
  assert.equal(renders.at(-1).options.draft.note, "newer", "迟到成功回调不得覆盖更新的草稿");

  detail = renders.at(-1).options;
  const failed = detail.update("entry", { note: "newer" });
  pending.shift().done({ ok: false });
  await assert.rejects(failed);
  els["ar-list"].children[1].fire("click");
  listeners.forEach((listener) => listener({ source: "AMS_DATA", type: "archiveChanged" }));
  els["ar-list"].children[0].fire("click");
  detail = renders.at(-1).options;
  assert.deepEqual(JSON.parse(JSON.stringify(detail.draft)), { tags: "draft-tag", note: "newer" }, "失败、切换记录和外部刷新后应恢复原记录草稿");

  const noteRetry = detail.update("entry", { note: "newer" });
  pending.shift().done({ ok: true, record: { ...entry, note: "newer", searchText: "question newer" } });
  await noteRetry;
  assert.deepEqual(JSON.parse(JSON.stringify(renders.at(-1).options.draft)), { tags: "draft-tag" }, "备注成功只能清除已确认的备注草稿");
  const tagRetry = renders.at(-1).options.update("entry", { tags: ["draft-tag"] });
  pending.shift().done({ ok: true, record: { ...entry, tags: ["draft-tag"], searchText: "question draft-tag" } });
  await tagRetry;
  assert.equal(renders.at(-1).options.draft, undefined, "标签成功后应清除对应草稿");
}

function distinctEmptyAndLoadStates() {
  const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture", "ar-search", "ar-favorites", "ar-tag"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()]));
  const gets = [];
  let nextItems = [];
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
      if (message.action === "archiveSearch") return done({ ok: true, items: nextItems, nextCursor: null });
      if (message.action === "archiveTags") return done({ ok: true, tags: [] });
      if (message.action === "archiveGet") gets.push(done);
    } }, storage: { local: { get() {} }, session: { get() {} } },
  };
  const document = { documentElement: {}, getElementById: (id) => els[id], addEventListener() {},
    createElement: () => new El(), createTextNode: () => new El() };
  const context = vm.createContext({ chrome, document, navigator: {}, URL, Blob, SITES: [], Date, setTimeout, clearTimeout,
    t: (key) => key, applyI18n() {}, ArchiveDetail: { render() {}, entryMarkdown: () => "" }, crypto: { randomUUID: () => "state" } });
  vm.runInContext(js, context);
  assert.equal(els["ar-detail"]["data-empty"], "arc_empty", "空结果库应显示空库状态");

  els["ar-favorites"].fire("click");
  assert.equal(els["ar-detail"]["data-empty"], "arc_noMatches", "启用筛选但无结果时应显示无匹配状态");

  nextItems = [{ id: "remote", ts: 1, task: "Remote", favorite: false, tags: [], searchText: "remote",
    hosts: ["a.test", "b.test"], resultPreviews: [{ host: "a.test", label: "Alpha", text: "answer" }] }];
  els["ar-favorites"].fire("click");
  assert.equal(gets.length, 1, "元数据记录应按需加载正文");
  const sites = els["ar-list"].children[0].children.find((child) => child.className === "ar-item-sites");
  assert.equal(sites?.textContent, "Alpha · b.test", "列表应紧凑显示所有涉及站点并复用可用标签");
  assert.equal(els["ar-detail"]["data-empty"], "arc_loading", "云端正文加载期间应显示加载状态");
  gets.shift()({ ok: false });
  assert.equal(els["ar-detail"]["data-empty"], "arc_loadFailed", "云端正文加载失败应显示失败状态");
  els["ar-list"].children[0].fire("click");
  gets.shift()({ ok: true, record: { ...nextItems[0], results: [] } });
  assert.equal(els["ar-status"].textContent, "", "正文重载成功应清除旧失败状态");
}

function latestEntryLoadWins() {
  const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture", "ar-search", "ar-favorites", "ar-tag"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()]));
  const gets = [], renders = [];
  const a = { id: "a", ts: 1, task: "A", favorite: false, tags: [], searchText: "a" };
  const b = { ...a, id: "b", task: "B", searchText: "b" };
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
      if (message.action === "archiveSearch") return done({ ok: true, items: [a, b], nextCursor: null });
      if (message.action === "archiveTags") return done({ ok: true, tags: [] });
      if (message.action === "archiveGet") gets.push({ id: message.id, done });
    } }, storage: { local: { get() {} }, session: { get() {} } },
  };
  const document = { documentElement: {}, getElementById: (id) => els[id], addEventListener() {},
    createElement: () => new El(), createTextNode: () => new El() };
  const context = vm.createContext({ chrome, document, navigator: {}, URL, Blob, SITES: [], Date, setTimeout, clearTimeout,
    t: (key) => key, applyI18n() {}, ArchiveDetail: { render(record) { renders.push(record); }, entryMarkdown: () => "" }, crypto: { randomUUID: () => "load" } });
  vm.runInContext(js, context);
  els["ar-list"].children[1].fire("click");
  gets[1].done({ ok: false });
  els["ar-list"].children[0].fire("click"); assert.equal(els["ar-status"].textContent, "", "新正文请求开始时应立即清除上一条目的加载失败状态");
  assert.deepEqual(gets.map((request) => request.id), ["a", "b", "a"], "A→B→A 应创建三次独立正文请求");
  gets[2].done({ ok: true, record: { ...a, note: "fresh", results: [] } });
  assert.equal(renders.at(-1).note, "fresh");
  assert.equal(els["ar-status"].textContent, "", "最新 A 请求成功应清除 B 的旧失败状态");
  gets[0].done({ ok: false });
  assert.equal(els["ar-status"].textContent, "", "最早 A 请求的迟到失败不得覆盖最新成功");
  assert.notEqual(els["ar-detail"]["data-empty"], "arc_loadFailed", "迟到失败不得清空已加载详情");
}
function refreshInvalidatesEntryLoad() {
  const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture", "ar-search", "ar-favorites", "ar-tag"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()])), gets = [], searches = [];
  const a = { id: "a", ts: 1, task: "A", favorite: false, tags: [], searchText: "a" }; let firstSearch = true;
  const chrome = { runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
      if (message.action === "archiveSearch" && firstSearch) { firstSearch = false; return done({ ok: true, items: [a], nextCursor: null }); }
      if (message.action === "archiveSearch") return searches.push(done);
      if (message.action === "archiveTags") return done({ ok: true, tags: [] });
      if (message.action === "archiveGet") gets.push(done);
    } }, storage: { local: { get() {} }, session: { get() {} } } };
  const document = { documentElement: {}, getElementById: (id) => els[id], addEventListener() {}, createElement: () => new El(), createTextNode: () => new El() };
  const context = vm.createContext({ chrome, document, navigator: {}, URL, Blob, SITES: [], Date, setTimeout, clearTimeout, t: (key) => key,
    applyI18n() {}, ArchiveDetail: { render() {}, entryMarkdown: () => "" }, crypto: { randomUUID: () => "refresh" } });
  vm.runInContext(js, context); els["ar-favorites"].fire("click"); assert.equal(els["ar-detail"]["data-empty"], "arc_loading", "筛选搜索未返回时应保持加载状态");
  gets.shift()({ ok: false }); assert.equal(els["ar-status"].textContent || "", "", "刷新前的正文失败不得显示为当前错误"); assert.equal(els["ar-detail"]["data-empty"], "arc_loading", "刷新前的正文失败不得覆盖新搜索加载态");
  searches.shift()({ ok: true, items: [], nextCursor: null }); assert.equal(els["ar-detail"]["data-empty"], "arc_noMatches", "新筛选搜索回调应正常落地");
}
loadMoreIsSingleFlight();
distinctEmptyAndLoadStates();
latestEntryLoadWins();
refreshInvalidatesEntryLoad();
Promise.all([updateOnlyAppliesAfterSuccess(), updatesRespectActiveFilters(), draftsSurviveRefreshAndLateCallbacks()]).then(() => console.log("archive library UI contract tests passed"), (error) => { console.error(error); process.exitCode = 1; });
