#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const scope = vm.createContext({ console, URL });
vm.runInContext(fs.readFileSync("bg/archive-model.js", "utf8") + ";this.model=ArchiveModel", scope);
const model = scope.model;
const entry = model.normalize({ text: "Full prompt", task: "Check claim", source: { kind: "page", title: "Example", url: "https://example.com", truncated: false, capturedAt: 1 },
  results: [{ host: "a.test", label: "A", text: "An answer about lithium", state: "think" }, { host: "b.test", label: "B", text: null, code: "no_answer" }] },
  { id: "id", now: 10, deviceId: "device" });
assert.equal(entry.task, "Check claim");
assert.equal(model.normalize({ text: "Reference payload", task: "", source: entry.source, results: [] }, { id: "source-only", now: 10, deviceId: "device" }).task, "", "来源型归档必须保留空任务语义");
assert.deepEqual(entry.hosts, ["a.test", "b.test"]);
assert.equal(entry.resultPreviews[0].text, "An answer about lithium");
assert.ok(entry.searchText.includes("example") && entry.searchText.includes("lithium"));
const sourceEntry = (url) => model.normalize({ text: "Q", source: { kind: "page", title: "Source", url }, results: [] }, { id: url, now: 1, deviceId: "d" });
assert.equal(sourceEntry("http://example.com/a").source.url, "http://example.com/a");
assert.equal(sourceEntry("https://example.com/a b").source.url, "https://example.com/a%20b");
for (const url of ["javascript:alert(1)", "data:text/plain,x", "not a url"])
  assert.throws(() => sourceEntry(url), /invalid_source/, `${url} 不得进入归档来源`);
const updated = model.update(entry, { favorite: true, tags: [" research ", "research", "battery"], note: "Useful", winnerHost: "a.test" }, { now: 20, deviceId: "other" });
assert.deepEqual([...updated.tags], ["research", "battery"]);
assert.equal(updated.updatedAt, 20);
assert.equal(model.validMetadata(updated), true);
assert.equal(model.matches(updated, { query: "useful", favorite: true, tag: "battery" }), true);
assert.throws(() => model.update(updated, { winnerHost: "b.test" }, { now: 30, deviceId: "x" }), /invalid_winner/);
assert.throws(() => model.update(updated, { tags: Array(21).fill("x") }, { now: 30, deviceId: "x" }), /invalid_tags/);
const synthesis = { host: "a.test", text: "Combined answer", state: "think", instruction: "Resolve disagreements", createdAt: 30 };
const withSynthesis = model.update(updated, { synthesis }, { now: 30, deviceId: "device" });
assert.deepEqual(JSON.parse(JSON.stringify(withSynthesis.synthesis)), synthesis);
assert.ok(withSynthesis.searchText.includes("combined answer"));
assert.throws(() => model.update(updated, { synthesis: { ...synthesis, text: "" } }, { now: 30, deviceId: "device" }), /invalid_synthesis/);
assert.equal(model.update(withSynthesis, { synthesis: null }, { now: 31, deviceId: "device" }).synthesis, null);
// F214：instruction 与桌面端 desktop/src/shared/synthesis.ts 的 4000 码点上限对齐，必须 throw（不截断）
assert.equal(model.update(updated, { synthesis: { ...synthesis, instruction: "y".repeat(4000) } }, { now: 30, deviceId: "device" }).synthesis.instruction.length, 4000, "4000 码点边界值应放行");
assert.throws(() => model.update(updated, { synthesis: { ...synthesis, instruction: "y".repeat(4001) } }, { now: 30, deviceId: "device" }), /invalid_synthesis/, "超过 4000 码点必须拒绝，不得静默截断");
// F213：title 与桌面端 desktop/src/shared/archive.ts 的 512 码点上限对齐，这里截断而非 throw（validMetadata 不比较 title）
const longTitleEntry = model.normalize({ text: "Q", source: { kind: "page", title: "x".repeat(600), url: "https://example.com" }, results: [] }, { id: "long-title", now: 1, deviceId: "d" });
assert.equal(longTitleEntry.source.title.length, 512, "超长标题应截断到 512 码点，而不是拒绝整条归档");
assert.equal(model.validMetadata(longTitleEntry), true, "截断后的记录仍应通过校验");
assert.equal(model.validMetadata({ ...updated, source: { kind: "page", title: "Bad", url: "javascript:alert(1)" } }), false);
const invalid = (patch) => assert.equal(model.validMetadata({ ...updated, ...patch }), false);
invalid({ resultPreviews: [null] });
invalid({ hosts: ["wrong"] });
invalid({ searchText: "stale" });
const missing = { ...updated }; delete missing.synthesis; assert.equal(model.validMetadata(missing), false);
invalid({ source: { ...updated.source, extra: true } });
invalid({ source: { kind: "page", title: "Example", url: updated.source.url } });
invalid({ source: { ...updated.source, url: "https://example.com" } });
invalid({ source: { ...updated.source, capturedAt: -1 } });
for (const patch of [{ host: 1 }, { label: null }, { text: {} }, { extra: true }]) {
  const results = [{ host: "a.test", label: "A", text: "Answer", ...patch }];
  invalid({ results, hosts: ["a.test"], resultPreviews: [{ host: "a.test", label: "A", text: "Answer" }] });
}
for (const patch of [{ host: "h".repeat(257) }, { label: "l".repeat(257) }, { code: "c".repeat(65) }, { state: "s".repeat(65) }]) {
  const value = model.normalize({ text: "Q", results: [{ host: "a", label: "A", text: "Answer", state: null, code: null, ...patch }] },
    { id: "bounded", now: 1, deviceId: "d" });
  assert.equal(model.validMetadata(value), false);
}
assert.throws(() => model.update({ ...updated, resultPreviews: [null] }, { note: "safe" }, { now: 30, deviceId: "x" }), /invalid_record/);
assert.equal(model.validMetadata(model.normalize({ text: "Q", source: null, results: [] }, { id: "null-source", now: 1, deviceId: "d" })), true);
const localeScope = vm.createContext({ console, URL });
vm.runInContext('String.prototype.toLocaleLowerCase = function () { return String(this).replaceAll("I", "ı").toLowerCase(); }', localeScope);
vm.runInContext(fs.readFileSync("bg/archive-model.js", "utf8") + ";this.model=ArchiveModel", localeScope);
const localeRecord = localeScope.model.normalize({ text: "ISTANBUL", results: [] }, { id: "locale", now: 1, deviceId: "d" });
vm.runInContext('String.prototype.toLocaleLowerCase = function () { return String(this).toLowerCase(); }', localeScope);
assert.equal(localeScope.model.validMetadata(localeRecord), true, "一个 locale 生成的归档在另一个 locale 下仍应有效");
assert.equal(localeScope.model.matches(localeRecord, { query: "ISTANBUL" }), true, "跨 locale 后仍应搜索到原记录");
console.log("archive-model tests passed");
