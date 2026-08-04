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

class El {
  constructor() { this.listeners = {}; this.classList = { add() {}, remove() {} }; this.children = []; this.value = ""; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn({ currentTarget: this }); }
  setAttribute(key, value) { this[key] = value; }
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
  const pending = [], renders = [];
  const record = { id: "entry", ts: 1, task: "Question", text: "Question", results: [], favorite: false, tags: [], note: "", winnerHost: null };
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
      if (message.action === "archiveSearch") return done({ ok: true, items: [record], nextCursor: null });
      if (message.action === "archiveTags") return done({ ok: true, tags: [] });
      if (message.action === "archiveUpdate") pending.push({ message, done });
    } },
    storage: { local: { get() {} }, session: { get() {} } },
  };
  const document = { documentElement: {}, getElementById: (id) => els[id], addEventListener() {},
    createElement: () => new El(), createTextNode: () => new El() };
  const ArchiveDetail = { render(entry, options) { renders.push({ entry, options }); }, entryMarkdown: () => "markdown" };
  const context = vm.createContext({ chrome, document, navigator: {}, URL, Blob, SITES: [], Date, setTimeout, clearTimeout,
    t: (key) => key, applyI18n() {}, ArchiveDetail });
  vm.runInContext(js, context);
  assert.equal(renders.length, 1, "已加载条目应交给详情渲染器");

  const saved = renders[0].options.update({ favorite: true });
  assert.equal(typeof saved?.then, "function", "详情更新必须返回 Promise");
  assert.equal(vm.runInContext("archive[0].favorite", context), false, "响应成功前不得替换本地记录");
  pending.shift().done({ ok: true, record: { ...record, favorite: true } });
  assert.equal((await saved).favorite, true);
  assert.equal(vm.runInContext("archive[0].favorite", context), true);

  const failed = renders.at(-1).options.update({ tags: ["draft"] });
  pending.shift().done({ ok: false });
  await assert.rejects(failed);
  assert.equal(els["ar-status"].textContent, "arc_updateFailed");
  assert.deepEqual(vm.runInContext("archive[0].tags", context), [], "失败更新不得替换本地记录");
}

loadMoreIsSingleFlight();
updateOnlyAppliesAfterSuccess().then(() => console.log("archive library UI contract tests passed"), (error) => { console.error(error); process.exitCode = 1; });
