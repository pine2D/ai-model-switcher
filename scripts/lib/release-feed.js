// scripts/lib/release-feed.js — scripts/watch-releases.js 的纯解析/去重逻辑，抽出来是为了
// scripts/test-release-feed.js 能离线 require 到（watch-releases.js 顶层是一个立即执行的
// async IIFE，直接 fetch 五个真实站点、有 token 时还会向 GitHub POST issue，不能被测试 require）。
"use strict";

const PER_SOURCE_CAP = 3; // 单源单次最多开 3 条，防解析异常/长间隔积压时刷屏

// 零宽符（U+200B..U+200D）+ 词连接符（U+2060）+ BOM（U+FEFF）+ 私有区（U+E000..U+F8FF，
// icon-font 字形，如 Claude 页日期前的日历图标 U+E09A）。按码点过滤而非正则字符类字面量，
// 避免在源码里直接书写这批不可见字符本身（历史上曾被工具链意外转写成真字符，肉眼不可辨）。
function isInvisibleCodePoint(cp) {
  if (cp >= 0x200b && cp <= 0x200d) return true;
  if (cp === 0x2060 || cp === 0xfeff) return true;
  if (cp >= 0xe000 && cp <= 0xf8ff) return true;
  return false;
}
function stripInvisible(s) {
  let out = "";
  for (const ch of s) {
    if (!isInvisibleCodePoint(ch.codePointAt(0))) out += ch;
  }
  return out;
}

function stripTags(html) {
  return stripInvisible(html.replace(/<[^>]*>/g, " ").replace(/&[a-zA-Z#0-9]+;/g, " ")).replace(/\s+/g, " ").trim();
}
function dedupe(entries) {
  const seen = new Set();
  return entries.filter((entry) => !seen.has(entry.title) && seen.add(entry.title));
}

// RSS：item 的标题与链接（新到旧）
function parseRss(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  for (let m; (m = re.exec(xml)) && out.length < 20; ) {
    const title = stripTags((m[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "");
    const link = ((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
    if (title) out.push({ title, url: link });
  }
  return out;
}
// HTML changelog：h2/h3 标题当条目（这些页每条更新是一个标题，新到旧），配合 filter 剔除导航标题
function parseHeadings(html, pageUrl) {
  const out = [];
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  for (let m; (m = re.exec(html)) && out.length < 30; ) {
    const title = stripTags(m[1]);
    if (title.length >= 4 && title.length <= 120) out.push({ title, url: pageUrl });
  }
  return out;
}
// 智谱 docs（Mintlify 系）：条目带 data-component-part="update-label"（日期）/"update-description"（标题）。
// 按 label 位置切块、块内取 description——两趟独立 matchAll 按下标 zip 会在某条缺 description 时整列错位，
// 标题全体漂移 → seen 永远匹配不上 → 每轮重复开 issue。desc 截 60 字：官方微调措辞不应改变去重键。
function parseZhipu(html, pageUrl) {
  const marks = [...html.matchAll(/data-component-part="update-label"[^>]*>([^<]+)</g)]
    .map((m) => ({ label: stripTags(m[1]), at: m.index }));
  return marks.map((mark, i) => {
    const seg = html.slice(mark.at, marks[i + 1] ? marks[i + 1].at : mark.at + 4000);
    const d = seg.match(/data-component-part="update-description"[^>]*>([\s\S]*?)<\/div>/);
    return { title: `${mark.label} ${d ? stripTags(d[1]).slice(0, 60) : ""}`.trim(), url: pageUrl };
  });
}

function issueTitle(src, entry) {
  // GitHub issue 标题硬上限 256 字符，截到 180 留 ≥20% 余量（前缀约 25 字）；截断是确定性的，不影响 seen 位置法
  const raw = entry.title.length > 180 ? entry.title.slice(0, 179) + "…" : entry.title;
  return `[release-watch] ${src.key}: ${raw}`;
}
function issueBody(src, entry) {
  return [
    `条目：${entry.title}`,
    `情报源：${src.name} — ${entry.url || src.url}`,
    "",
    "这是自动情报，**只代表官方发了公告，不代表网页 UI 已变**。处理步骤：",
    "1. 打开对应站点真机核对模型/档位 UI 标签是否变化（公告名 ≠ UI 标签，禁止直接抄进正则）。",
    `2. 有变化 → 按 docs/adapters.md 站点卡改 \`${src.adapter}\`，同步 state() 判定分支，补专项回归测试。`,
    "3. 无变化 → 直接关闭本 issue。",
  ].join("\n");
}

// 新条目判定用位置法：条目新到旧排列，取「第一条已见条目」之上的部分。首轮（全未见）只登记最新
// 一条作基线——否则第二轮会把基线之下的全部旧条目当作新条目刷出来（简单 not-in-seen 判定的坑）。
function freshEntries(src, entries, seen, warn = (msg) => console.warn(msg)) {
  const idx = entries.findIndex((entry) => seen.has(issueTitle(src, entry)));
  const fresh = idx === -1 ? entries.slice(0, 1) : entries.slice(0, idx);
  if (fresh.length > PER_SOURCE_CAP) // 被截断的也是真新条目，静默丢弃会让「漏抓」和「没新东西」在日志里长一样
    warn(`${src.key}: 另有 ${fresh.length - PER_SOURCE_CAP} 条更早的新条目被单次上限截断，去 ${src.url} 人工看一眼`);
  return fresh.slice(0, PER_SOURCE_CAP);
}

module.exports = {
  PER_SOURCE_CAP,
  stripTags,
  dedupe,
  parseRss,
  parseHeadings,
  parseZhipu,
  issueTitle,
  issueBody,
  freshEntries,
};
