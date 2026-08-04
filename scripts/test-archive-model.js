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
assert.equal(model.matches(updated, { query: "useful", favorite: true, tag: "battery" }), true);
assert.throws(() => model.update(updated, { winnerHost: "b.test" }, { now: 30, deviceId: "x" }), /invalid_winner/);
assert.throws(() => model.update(updated, { tags: Array(21).fill("x") }, { now: 30, deviceId: "x" }), /invalid_tags/);
assert.equal(model.validMetadata({ ...updated, source: { kind: "page", title: "Bad", url: "javascript:alert(1)" } }), false);
console.log("archive-model tests passed");
