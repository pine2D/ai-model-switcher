#!/usr/bin/env node
"use strict";
// 错误码翻译表不变量：四张 code→i18n 键的映射表必须指向真实存在且三语齐全的词条，
// 且归档页的表要覆盖「真能随归档结果落库」的码——落不到表里就会被 resultError 兜底成「无回答」。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const LANGS = ["en", "zh_CN", "zh_TW"];

// 错误码文案都在 i18n.js 的 MSG（workspace/options 分册只补工作区文案，不含 con_err*）
function messages() {
  const source = fs.readFileSync("i18n.js", "utf8");
  const scope = {};
  vm.runInNewContext(`${source.slice(0, source.indexOf("\nconst I18N_LANGS"))}\nglobalThis.result = MSG;`, scope);
  return scope.result;
}
// 从源码里取出对象/函数体的字面量（配平大括号）：这些表都是纯字符串字面量，不引入运行时依赖
function block(source, at, label) {
  assert.notEqual(at, -1, `${label}: 源码里找不到锚点（表被改名或删了？）`); // indexOf("{", -1) 会当 0 处理，锚点必须先验
  const start = source.indexOf("{", at);
  assert.notEqual(start, -1, `${label}: 找不到左大括号`);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${label}: 大括号未闭合`);
}
function table(file, name) {
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(new RegExp(`(?:^|[^\\w$])${name}\\s*=\\s*\\{`, "m"));
  assert.ok(match, `${file}: 找不到错误码表 ${name}（被改名了？测试须同步跟上）`);
  const scope = {};
  vm.runInNewContext(`globalThis.result = ${block(source, match.index, `${file} ${name}`)};`, scope);
  return scope.result;
}

const rows = messages();
const tables = {
  "console/status.js ERR_KEYS": table("console/status.js", "ERR_KEYS"),
  "console/archive.js ARCH_ERR_KEYS": table("console/archive.js", "ARCH_ERR_KEYS"),
  "console/compose-synthesis.js ERR_KEYS": table("console/compose-synthesis.js", "ERR_KEYS"),
  "console/scope.js CHECK_ERR_KEYS": table("console/scope.js", "CHECK_ERR_KEYS"),
};

// 1) 每张表的每个 i18n 键都真实存在且三语齐全（t(ERR_KEYS[code]) 是动态取键，test-content-l10n.js 静态扫不到）
for (const [where, map] of Object.entries(tables)) {
  assert.ok(Object.keys(map).length, `${where}: 表为空，抽取逻辑已失效`);
  for (const [code, key] of Object.entries(map)) {
    const row = rows[key];
    assert.ok(row, `${where}: ${code} → ${key} 在 i18n.js 中不存在，界面会显示空白`);
    for (const lang of LANGS) assert.ok(typeof row[lang] === "string" && row[lang].trim(), `${where}: ${code} → ${key} 缺 ${lang} 文案`);
  }
}

// 2) 同一个码在各表里必须映射到同一个词条，否则同一失败在不同页面读起来是两回事
const canonical = tables["console/status.js ERR_KEYS"];
for (const [where, map] of Object.entries(tables)) {
  for (const [code, key] of Object.entries(map)) {
    if (canonical[code]) assert.equal(key, canonical[code], `${where}: ${code} 映射与 status.js 的 ${canonical[code]} 不一致`);
  }
}

// 3) 归档页覆盖度：归档条目的 results[].code 只来自 bg/broadcast.js 的 collectAll
//    ARCH_ERR_KEYS 里另有若干「现链路走不到」的码（timeout/inject_failed…），是旧版归档与迁移包
//    带进来的历史记录兜底，别按「最小覆盖」删掉——删了老条目会集体错报成「无回答」。
//    （console/status.js archiveSummary 与 console/archive.js 的「采集当前结果」都只喂 collect 的返回值，
//     sendAll 的 submit 期错误码不入档）。从源码现取，collectAll 加新码时这里自动跟着红。
const broadcast = fs.readFileSync("bg/broadcast.js", "utf8");
const collectAll = block(broadcast, broadcast.indexOf("function collectAll"), "bg/broadcast.js collectAll");
const archived = [...new Set([...collectAll.matchAll(/code:\s*"([a-z_]+)"/g)].map((m) => m[1]))];
assert.ok(archived.length >= 3 && archived.includes("no_answer"), `collectAll 错误码抽取失效，实得: ${archived.join(", ") || "空"}`);
for (const code of archived) {
  assert.ok(tables["console/archive.js ARCH_ERR_KEYS"][code],
    `console/archive.js ARCH_ERR_KEYS 缺 ${code}：归档页 resultError 会把它错报成「无回答」(con_errNoAnswer)，用户会照着错误提示重发`);
}

// 4) 反向：群发链路产出的码必须都能在 console 显示层翻译。按「产生位置」立规则而不是按码名——
//    content/ 与 bg/broadcast.js 是群发链路，产出的码会流到圆点与失败汇总；其余文件的码
//    （Drive 的 auth_failed、右键读页的 page_empty、数据层的 not_found…）走各自的提示通道，不在此列。
//    两种写法都要抓：`code: "x"` 字面量与 `r.code = "x"` 赋值（tier_unconfirmed 就是后者）。
const SEND_CHAIN = ["bg/broadcast.js", ...fs.readdirSync("content").filter((f) => f.endsWith(".js")).map((f) => `content/${f}`)];
const produced = new Map();
for (const file of SEND_CHAIN) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?:\bcode:\s*|\.code\s*=\s*)"([a-z_]+)"/g)) if (!produced.has(m[1])) produced.set(m[1], file);
}
assert.ok(produced.size >= 10, `群发链路错误码抽取失效，实得 ${produced.size} 个（正则或文件清单坏了？）`);
for (const [code, file] of produced) {
  assert.ok(canonical[code],
    `${file} 产出错误码 ${code}，但 console/status.js 的 ERR_KEYS 没有它 → 圆点 title 会裸露英文 code；` +
    `补 ERR_KEYS 映射 + i18n.js 三语词条（归档/综合页若也会收到，一并补 ARCH_ERR_KEYS 与 compose-synthesis.js）`);
}

console.log(`✓ err-codes: 4 张表词条三语齐全、跨表一致；归档覆盖 collectAll (${archived.join(", ")})；群发链路 ${produced.size} 个码均可翻译`);
