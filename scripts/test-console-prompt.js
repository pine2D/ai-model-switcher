#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("console/console.html", "utf8");
const prompt = html.match(/<(input|textarea)\b[^>]*id="prompt"[^>]*>/)?.[0] || "";
assert.match(prompt, /^<textarea\b/, "控制台提示词控件必须保留来源载荷中的换行");
assert.match(prompt, /\brows="1"/, "控制台仍应保持单行视觉高度");

console.log("console prompt contract tests passed");
