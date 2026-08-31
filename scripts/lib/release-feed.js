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

// src.highSignal 是可选的精细分级：不设时（claude/gemini/deepseek/zhipu）一律不标记，行为与改造前完全一致。
// openai 的宽 filter 只挡掉非常明显的噪音，混进大量营销/案例稿（Bringing ChatGPT for Teachers…、Introducing
// the Admin plugin…）；highSignal 不匹配不等于丢弃——营销稿也可能夹带真发布，只降噪省人力，仍然开 issue。
function isLowSignal(src, entry) {
  return !!(src.highSignal && !src.highSignal.test(entry.title));
}
function issueTitle(src, entry) {
  // GitHub issue 标题硬上限 256 字符，截到 180 留 ≥20% 余量（前缀约 25 字）；截断是确定性的，不影响 seen 位置法
  const raw = entry.title.length > 180 ? entry.title.slice(0, 179) + "…" : entry.title;
  const key = isLowSignal(src, entry) ? `${src.key}/low` : src.key;
  return `[release-watch] ${key}: ${raw}`;
}
// 唯一职责：让整个源都落入 isLowSignal（永不匹配任何非空标题），复用既有 /low 分级路径而不是新开一个
// 字段——bailian 源（API 侧信号，天然不代表网页 UI）用它标记全部条目，见 SOURCES 里的注释。
const NEVER_HIGH_SIGNAL = /^$/;
// 旧存量 issue 的标题形态：本次改格式前既没有 /low 标记，也没有 datedSections 的「日期 — 摘要」拼接
// （那会儿 headings 源开出的标题只是纯日期原文）。freshEntries 靠它双测新旧两种形态兼容去重，否则
// 上线当天所有历史条目会因为标题形态变了而被当成"新"条目重新开一遍。
function legacyIssueTitle(src, entry) {
  const t = entry.legacyTitle ?? entry.title;
  const raw = t.length > 180 ? t.slice(0, 179) + "…" : t;
  return `[release-watch] ${src.key}: ${raw}`;
}
function issueBody(src, entry) {
  const lines = [];
  // snapshot 源（目前只有 kimi）没有「公告」这回事：entry.title 本身就是页面正文的稳定摘要，
  // 摘要变了 = 页面变了，措辞必须跟 changelog 类源区分开，不能沿用「官方发了公告」这句。
  if (src.kind === "snapshot") {
    lines.push(
      `摘要：${entry.title}`,
      `情报源（状态快照页，非 changelog）：${src.name} — ${entry.url || src.url}`,
      "",
      "这是 **UI 状态快照 diff**，不是发布公告——本条只代表这段稳定摘要跟上次登记的不一样，可能是模型/档位改了，也可能只是页面措辞/排版微调。处理步骤：",
      "1. 直接打开对应站点真机核对模型/档位 UI 标签是否变化（摘要文字不是 UI 标签原文，禁止直接抄进正则）。",
      `2. 有实质变化 → 按 docs/adapters.md 站点卡改 \`${src.adapter}\`，同步 state() 判定分支，补专项回归测试。`,
      "3. 纯措辞/排版调整、模型档位未变 → 直接关闭本 issue。"
    );
    return lines.join("\n");
  }
  if (isLowSignal(src, entry)) {
    lines.push(src.lowSignalNote || "低信号条目：标题未命中模型词表，多半是营销/案例文，快速扫一眼即可关闭。", "");
  }
  lines.push(
    `条目：${entry.title}`,
    `情报源：${src.name} — ${entry.url || src.url}`,
    "",
    "这是自动情报，**只代表官方发了公告，不代表网页 UI 已变**。处理步骤：",
    "1. 打开对应站点真机核对模型/档位 UI 标签是否变化（公告名 ≠ UI 标签，禁止直接抄进正则）。",
    `2. 有变化 → 按 docs/adapters.md 站点卡改 \`${src.adapter}\`，同步 state() 判定分支，补专项回归测试。`,
    "3. 无变化 → 直接关闭本 issue。"
  );
  return lines.join("\n");
}

// 日期型 changelog（claude/gemini/deepseek）：日期本身是 h2/h3，标题信息量为零（claude「August 26, 2026」、
// gemini「2026.08.19」）或与内容割裂（deepseek「Date: 2026-08-21」与紧随的型号标题是两个独立 heading）。
// 用 dateRe（即 src.filter）识别日期标题当分段点，段内取「第一个非日期 h2/h3 标题原文」当摘要拼进 title；
// 没有次级标题则退化取正文前 80 字；两者都没有则摘要为空，title 退化成纯日期。legacyTitle 固定存纯日期
// 原文，是本次改格式前的旧 issue 标题形态，配合 legacyIssueTitle 供 freshEntries 兼容去重。
//
// groupHeaderRe（可选第四参）：形如 support.claude.com 那种「月份大标题（August 2026）+ 日期小标题
// （August 25, 2026）」两级结构里，月份大标题既不匹配 dateRe 也不是真摘要，但它排在同月最早一条日期
// 标题之后、下月第一条日期标题之前。两处坑都要堵：① 当"第一个非日期标题"被当摘要回收；② 就算不当
// 摘要标题，它的纯文字仍嵌在 HTML 里，退化成正文前 80 字时会被 stripTags 原样吃进去——只删 heads
// 节点堵不住②（2026-08 实测坐实两版糊涂账："August 6, 2026 — July 2026" 和更隐蔽的
// "…beta. July 2026"）。做法：月份大标题不从 heads 里剔除，而是标记 group:true 并当成跟"下一条日期
// 标题"同等地位的内容边界——sectionEnd 提前停在它的起始位置，正文/摘要自然不会跨过去；对没有这层
// 结构的 gemini/deepseek（不传 groupHeaderRe），group 恒为 false，行为与改动前完全一致。
function datedSections(html, pageUrl, dateRe, groupHeaderRe) {
  const heads = [];
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  for (let m; (m = re.exec(html)) && heads.length < 60; ) {
    const title = stripTags(m[1]);
    if (title) heads.push({ title, at: m.index, end: re.lastIndex, group: !!(groupHeaderRe && groupHeaderRe.test(title)) });
  }
  const out = [];
  for (let i = 0; i < heads.length && out.length < 30; i++) {
    const h = heads[i];
    if (h.group || !dateRe.test(h.title)) continue; // 分组大标题和非日期标题一样，只作候选摘要来源，不是分段点
    let sectionEnd = html.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].group || dateRe.test(heads[j].title)) { sectionEnd = heads[j].at; break; } // 下一条日期或下一个分组大标题，谁先出现内容就在谁前面截止
    }
    let summary = "";
    for (let j = i + 1; j < heads.length && heads[j].at < sectionEnd; j++) {
      if (!dateRe.test(heads[j].title)) { summary = heads[j].title; break; }
    }
    if (!summary) summary = stripTags(html.slice(h.end, sectionEnd)).slice(0, 80);
    const date = h.title;
    out.push({ title: summary ? `${date} — ${summary.slice(0, 80)}` : date, date, legacyTitle: date, url: pageUrl });
  }
  return out;
}

// kind "snapshot"（目前只有 kimi 帮助中心「模型与模式怎么选」）：页面不是 changelog，没有条目列表，
// 只有「现在长什么样」。只产 1 条 entry，title 就是正文的稳定摘要——内容不变→摘要不变→原样命中
// freshEntries 的 seen 集合→不重复开单；内容变了→摘要变了→freshEntries 找不到匹配（idx===-1）→
// 走首轮基线那条路径，天然当成"新的 1 条"开单。不需要改 freshEntries，位置法对单条列表一样成立。
// 提取范围锁定 <article>…</article>（真机实测 2026-08：该页整段正文都在这个容器里，容器外是导航/
// 侧栏噪音）；anchorRe 命中就从锚点开始截，摘要优先落在模型/档位关键词段落而不是开头重复的面包屑+
// 标题；锚点没命中（页面改版）就退化成正文最前 160 字，不是空摘要，仍然产出可比对的条目。
function parseSnapshot(html, pageUrl, anchorRe) {
  const container = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const text = stripTags(container ? container[1] : html);
  if (!text) return [];
  const at = anchorRe ? text.search(anchorRe) : -1;
  const start = at >= 0 ? at : 0;
  return [{ title: text.slice(start, start + 160), url: pageUrl }];
}

// kind "bailian"（阿里云百炼「模型上线表」，跨厂商 API 上线信号：Qwen/GLM/Kimi 等经百炼平台上线的
// 型号）：<table><thead><tr><th>…</th></tr></thead><tbody><tr><td>Model type</td><td>Date</td>
// <td>Model ID</td><td>Description</td></tr>…</tbody></table>，表格本身已按日期倒序（2026-08 实测）。
// 表头行是 <th>，本函数只认 <td>，天然跳过不必单独判断。entry.title 是「日期 模型ID」，entry.date
// 单独存日期原文供 src.filter 校验格式——用法与 datedSections 的 date 字段一致，watch-releases.js
// 主循环 `entry.date ?? entry.title` 那行不用为这个 kind 加分支。
function parseBailian(html, pageUrl) {
  const table = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return [];
  const out = [];
  for (const row of table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    if (out.length >= 30) break;
    const cells = [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1]));
    const [, date, modelId] = cells; // cells[0] 是 Model type，用不上
    if (!date || !modelId) continue;
    out.push({ title: `${date} ${modelId}`, date, url: pageUrl });
  }
  return out;
}

// 新条目判定用位置法：条目新到旧排列，取「第一条已见条目」之上的部分。首轮（全未见）只登记最新
// 一条作基线——否则第二轮会把基线之下的全部旧条目当作新条目刷出来（简单 not-in-seen 判定的坑）。
// 每条同时用 issueTitle（当前形态）和 legacyIssueTitle（改格式前的旧形态：无 /low 标记、纯日期无摘要）
// 两种标题去匹配 seen——旧存量 issue 都是无标记/无摘要形态，只测当前形态会让它们全部失配、当天重复开单。
function freshEntries(src, entries, seen, warn = (msg) => console.warn(msg)) {
  const idx = entries.findIndex((entry) => seen.has(issueTitle(src, entry)) || seen.has(legacyIssueTitle(src, entry)));
  const fresh = idx === -1 ? entries.slice(0, 1) : entries.slice(0, idx);
  if (fresh.length > PER_SOURCE_CAP) // 被截断的也是真新条目，静默丢弃会让「漏抓」和「没新东西」在日志里长一样
    warn(`${src.key}: 另有 ${fresh.length - PER_SOURCE_CAP} 条更早的新条目被单次上限截断，去 ${src.url} 人工看一眼`);
  return fresh.slice(0, PER_SOURCE_CAP);
}

module.exports = {
  PER_SOURCE_CAP,
  NEVER_HIGH_SIGNAL,
  stripTags,
  dedupe,
  parseRss,
  parseHeadings,
  parseZhipu,
  datedSections,
  parseSnapshot,
  parseBailian,
  issueTitle,
  legacyIssueTitle,
  issueBody,
  freshEntries,
};
