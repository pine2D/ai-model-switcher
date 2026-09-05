#!/usr/bin/env node
"use strict";
// 图片限额（4 张 / PNG+JPEG / 10 MiB）的全部落点：两份代码常量（site-runtime/upload.js、shared/images.ts）、
// 一处 accept、copy.ts 三语、README 两句、docs 叙述。任何一处漏改都不会让别的测试变红——
// 站点运行时与 Desktop 各自校验自己那份常量。这里做唯一一次全落点对账。
//
// 断言风格：先按锚点把片段抠出来，抠不到就 assert.fail（宁红勿假绿）——锚点漂了必须有人
// 来看一眼，静默跳过等于这份测试白写。
const assert = require("node:assert/strict");
const fs = require("node:fs");

const COUNT = 4;
const BYTES_EXPR = "10 * 1024 * 1024";
const TYPES = ["image/png", "image/jpeg"];
const ACCEPT = "image/png,image/jpeg";
const HINT = "（改图片限额要同改全部落点，清单见 docs/adapters.md 的「图片载荷」与 CLAUDE.md 硬约束）";

const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    assert.fail(`读不到 ${file}：${error.message}${HINT}`);
  }
};

// 按正则抠出一段并返回捕获组；抠不到即失败，不静默跳过。
function capture(source, file, label, pattern) {
  const match = source.match(pattern);
  if (!match) assert.fail(`${file} 找不到「${label}」锚点：${pattern}${HINT}`);
  return match;
}

function has(source, file, label, needle) {
  assert.ok(source.includes(needle),
    `${file} 的「${label}」应包含 ${JSON.stringify(needle)}${HINT}`);
}

// ── 1. 站点运行时 upload.js：注入侧校验层 ──────────────────────
{
  const file = "desktop/src/site-runtime/upload.js";
  const src = read(file);
  assert.equal(capture(src, file, "MAX_COUNT", /MAX_COUNT\s*=\s*(\d+)/)[1], String(COUNT));
  has(src, file, "MAX_BYTES", `MAX_BYTES = ${BYTES_EXPR}`);
  const types = capture(src, file, "TYPES", /TYPES\s*=\s*new Set\(\[([^\]]*)\]\)/)[1];
  for (const type of TYPES) has(types, file, "TYPES", `"${type}"`);
}

// ── 3. Desktop src/shared/images.ts：桌面端权威校验层 ─────────────────
{
  const file = "desktop/src/shared/images.ts";
  const src = read(file);
  assert.equal(capture(src, file, "MAX_IMAGE_COUNT", /MAX_IMAGE_COUNT\s*=\s*(\d+)/)[1], String(COUNT));
  has(src, file, "MAX_IMAGE_BYTES", `MAX_IMAGE_BYTES = ${BYTES_EXPR}`);
  const types = capture(src, file, "IMAGE_TYPES", /IMAGE_TYPES\s*=\s*\[([^\]]*)\]/)[1];
  for (const type of TYPES) has(types, file, "IMAGE_TYPES", `"${type}"`);
}

// ── 4. accept：文件选择框先过滤一道，与 TYPES 必须同源 ─────────────────
for (const file of ["desktop/src/renderer/image-picker.tsx"]) {
  const src = read(file);
  capture(src, file, `accept="${ACCEPT}"`, new RegExp(`accept=(?:"|\\{")${ACCEPT}(?:"|"\\})`));
}

// ── 6. desktop/src/shared/copy.ts 三语：桌面端用户可见的限额文案 ───────
// copy.ts 是一份对象字面量三段（en / zh_CN / zh_TW），同名 key 各出现一次；这里按出现次数
// 与内容双向对账：少一段说明某种语言漏改，多一段说明有人复制粘贴出了第四份。
{
  const file = "desktop/src/shared/copy.ts";
  const src = read(file);
  const all = (key) => [...src.matchAll(new RegExp(`^\\s*${key}:\\s*"([^"]*)",\\s*$`, "gm"))].map((m) => m[1]);
  const counts = all("imageCountError");
  assert.equal(counts.length, 3, `${file} 的 imageCountError 应恰好三语各一条，实际 ${counts.length} 条${HINT}`);
  assert.deepEqual(counts, ["Choose 1 to 4 images", "请选择 1 至 4 张图片", "請選取 1 至 4 張圖片"],
    `${file} 的 imageCountError 三语与 MAX_IMAGE_COUNT=${COUNT} 不一致${HINT}`);
  const sizes = all("imageSizeError");
  assert.equal(sizes.length, 3, `${file} 的 imageSizeError 应恰好三语各一条，实际 ${sizes.length} 条${HINT}`);
  for (const text of sizes)
    assert.ok(text.includes("10 MiB"), `${file} 的 imageSizeError 缺 10 MiB：${text}${HINT}`);
  const typeErrors = all("imageTypeError");
  assert.equal(typeErrors.length, 3, `${file} 的 imageTypeError 应恰好三语各一条${HINT}`);
  for (const text of typeErrors)
    assert.ok(/PNG/.test(text) && /JPEG/.test(text), `${file} 的 imageTypeError 应同时点名 PNG 与 JPEG：${text}${HINT}`);
}

// ── 7. README 两处：核心功能一句 + 桌面段一句，对外承诺不能落后于代码 ──
{
  const file = "README.md";
  const src = read(file);
  const lines = src.split("\n").filter((line) => /10 MiB/.test(line));
  assert.equal(lines.length, 2,
    `${file} 提到 10 MiB 的行应恰好两条（核心功能 + 桌面段），实际 ${lines.length} 条${HINT}`);
  for (const line of lines) {
    assert.ok(/4 张/.test(line), `${file} 该行缺「4 张」：${line}${HINT}`);
    assert.ok(/PNG/.test(line) && /JPEG/.test(line), `${file} 该行未同时点名 PNG 与 JPEG：${line}${HINT}`);
  }
}

// ── 8. docs：数值真源在 adapters.md，desktop.md 另有一句叙述 ────────
{
  const file = "docs/adapters.md";
  const src = read(file);
  has(src, file, "图片载荷", "**4 张**");
  has(src, file, "图片载荷", "**≤10 MiB**");
}
{
  const file = "docs/desktop.md";
  const src = read(file);
  const line = capture(src, file, "桌面图片限额叙述", /^.*4 张 PNG\/JPEG.*$/m)[0];
  assert.ok(/10 MiB/.test(line), `${file} 的图片限额叙述缺 10 MiB：${line}${HINT}`);
}

console.log("test-image-limits: 图片限额全部落点一致");
