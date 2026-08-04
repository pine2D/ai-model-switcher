#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const scope = vm.createContext({ console });
vm.runInContext(fs.readFileSync("bg/archive-model.js", "utf8") + ";this.model=ArchiveModel", scope);
const model = scope.model;
const entry = model.normalize({ text: "Full prompt", task: "Check claim", source: { kind: "page", title: "Example", url: "https://example.com", truncated: false, capturedAt: 1 },
  results: [{ host: "a.test", label: "A", text: "An answer about lithium", state: "think" }, { host: "b.test", label: "B", text: null, code: "no_answer" }] },
  { id: "id", now: 10, deviceId: "device" });
assert.equal(entry.task, "Check claim");
assert.deepEqual(entry.hosts, ["a.test", "b.test"]);
assert.equal(entry.resultPreviews[0].text, "An answer about lithium");
assert.ok(entry.searchText.includes("example") && entry.searchText.includes("lithium"));
const updated = model.update(entry, { favorite: true, tags: [" research ", "research", "battery"], note: "Useful", winnerHost: "a.test" }, { now: 20, deviceId: "other" });
assert.deepEqual([...updated.tags], ["research", "battery"]);
assert.equal(updated.updatedAt, 20);
assert.equal(model.matches(updated, { query: "useful", favorite: true, tag: "battery" }), true);
assert.throws(() => model.update(updated, { winnerHost: "b.test" }, { now: 30, deviceId: "x" }), /invalid_winner/);
assert.throws(() => model.update(updated, { tags: Array(21).fill("x") }, { now: 30, deviceId: "x" }), /invalid_tags/);
console.log("archive-model tests passed");
