#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("console/archive.html", "utf8");
const js = fs.readFileSync("console/archive.js", "utf8");

for (const id of ["ar-search", "ar-favorites", "ar-tag", "ar-list", "ar-detail"]) {
  assert.ok(html.includes(`id="${id}"`), `结果库缺少 ${id}`);
}
assert.ok(js.includes('action: "archiveSearch"'), "结果库应使用 archiveSearch");
assert.ok(js.includes('action: "archiveTags"'), "结果库应加载 archiveTags");
assert.ok(js.includes("searchToken"), "stale search callbacks must be ignored");
assert.ok(!html.includes("<svg") || (html.match(/<svg/g) || []).length === 1, "do not add nonessential icons");

console.log("archive library UI contract tests passed");
