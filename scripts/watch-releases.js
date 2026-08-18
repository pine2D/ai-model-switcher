#!/usr/bin/env node
"use strict";
// scripts/watch-releases.js — 模型发布情报哨兵：轮询五个官方 changelog/RSS，发现新条目自动开 GitHub issue。
// 定位是「闹钟」：提醒去真机核对站点 UI——公告里的模型名与网页 UI 标签经常不同名，严禁直接抄进适配器
// 正则（docs/adapters.md：档位标签必须先真机确认）。Kimi/元宝/千问/豆包无官方 web changelog（2026-08 调研），
// 它们的 UI 变化靠巡检 diagnose 与真实群发失败信号兜底，不在本脚本覆盖面内。
// 运行环境：GitHub Actions（.github/workflows/release-watch.yml 注入 GITHUB_TOKEN/GITHUB_REPOSITORY）；
// 本地无 token 时 dry-run 只打印。命名不得改成 test- 前缀——verify.sh 会强制把 test-*.js 登记进无网络的 CI。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const LABEL = "release-watch";
const PER_SOURCE_CAP = 3; // 单源单次最多开 3 条，防解析异常/长间隔积压时刷屏
// filter 只放行真正的 changelog 条目（各页混有导航/页脚标题，2026-08 实测逐源定形）；页面改版导致
// 全部过滤不中时按「解析到 0 条」报错升红，不会静默失明。
const SOURCES = [
  { key: "openai", name: "OpenAI / ChatGPT", url: "https://openai.com/news/rss.xml", kind: "rss",
    filter: /gpt|chatgpt|model|\bo[0-9]\b|release|introducing/i, adapter: "content/adapters-intl.js" },
  { key: "claude", name: "Anthropic / Claude", url: "https://platform.claude.com/docs/en/release-notes/overview", kind: "headings",
    filter: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s*20\d\d$/i, adapter: "content/adapters-intl.js" },
  { key: "gemini", name: "Google / Gemini", url: "https://gemini.google/release-notes/", kind: "headings",
    filter: /^20\d\d[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/, adapter: "content/adapters-intl.js" },
  { key: "deepseek", name: "DeepSeek", url: "https://api-docs.deepseek.com/updates/", kind: "headings",
    filter: /20\d\d-\d{1,2}-\d{1,2}/, adapter: "content/adapters-cn.js" },
  { key: "zhipu", name: "智谱 / chatglm", url: "https://docs.bigmodel.cn/cn/update/new-releases", kind: "zhipu",
    filter: /^20\d\d-\d{1,2}-\d{1,2}/, adapter: "content/adapters-cn2.js" },
];

function stripTags(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-zA-Z#0-9]+;/g, " ")
    // 零宽符 + 词连接符 + BOM + 私有区（icon-font 字形，如 Claude 页日期前的日历图标 U+E09A）
    .replace(/[\u200B-\u200D\u2060\uFEFF\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim();
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

async function fetchText(url, retry = 1) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" }, redirect: "follow", signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    if (retry <= 0) throw e;
    await new Promise((res) => setTimeout(res, 3000)); // 瞬时网络抖动重试一次再判死
    return fetchText(url, retry - 1);
  } finally { clearTimeout(timer); }
}

const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPOSITORY || "";
// allow422 只给 label 创建这类幂等端点：issue POST 的 422 是校验失败（标题超 256 等），吞掉会变成
// 「日志喊 opened、实际没开、下轮还重试」的静默空转，必须抛错让 workflow 变红。
async function gh(method, path, body, allow422) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28", "user-agent": "polyask-release-watch",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow422 && r.status === 422) return null;
  if (!r.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${r.status}`);
  return r.json();
}
async function existingTitles() {
  const titles = new Set();
  for (let page = 1; page <= 3; page++) {
    const rows = await gh("GET", `/repos/${REPO}/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
    (rows || []).forEach((row) => titles.add(row.title));
    if (!rows || rows.length < 100) break;
  }
  return titles;
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
function freshEntries(src, entries, seen) {
  const idx = entries.findIndex((entry) => seen.has(issueTitle(src, entry)));
  const fresh = idx === -1 ? entries.slice(0, 1) : entries.slice(0, idx);
  if (fresh.length > PER_SOURCE_CAP) // 被截断的也是真新条目，静默丢弃会让「漏抓」和「没新东西」在日志里长一样
    console.warn(`${src.key}: 另有 ${fresh.length - PER_SOURCE_CAP} 条更早的新条目被单次上限截断，去 ${src.url} 人工看一眼`);
  return fresh.slice(0, PER_SOURCE_CAP);
}

(async () => {
  const dryRun = !TOKEN || !REPO;
  const seen = dryRun ? new Set() : await existingTitles();
  if (!dryRun) await gh("POST", `/repos/${REPO}/labels`, { name: LABEL, color: "d9b93b", description: "模型发布情报（watch-releases.js 自动创建）" }, true);
  const failures = [];
  for (const src of SOURCES) {
    let entries = [];
    try {
      const text = await fetchText(src.url);
      entries = src.kind === "rss" ? parseRss(text) : src.kind === "zhipu" ? parseZhipu(text, src.url) : parseHeadings(text, src.url);
      entries = dedupe(entries.filter((entry) => src.filter.test(entry.title))).slice(0, 10);
    } catch (e) { failures.push(`${src.key}: ${e.message}`); continue; }
    if (!entries.length) { failures.push(`${src.key}: 解析到 0 条（页面结构可能已变，去 ${src.url} 人工看一眼）`); continue; }
    const picked = freshEntries(src, entries, seen);
    for (const entry of picked) {
      const title = issueTitle(src, entry);
      if (dryRun) { console.log(`[dry-run] would open: ${title}`); continue; }
      const created = await gh("POST", `/repos/${REPO}/issues`, { title, body: issueBody(src, entry), labels: [LABEL] });
      if (!created || !created.number) { failures.push(`${src.key}: issue 创建失败 ${title}`); continue; }
      console.log(`opened: #${created.number} ${title}`);
    }
    if (!picked.length) console.log(`${src.key}: 无新条目`);
  }
  if (failures.length) { // 情报源自身失效也要可见：workflow 变红触发 GitHub 失败邮件，不静默失明
    console.error("情报源异常：\n" + failures.join("\n"));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
