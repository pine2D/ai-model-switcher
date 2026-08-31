#!/usr/bin/env node
"use strict";
// scripts/watch-releases.js — 模型发布情报哨兵：轮询五个官方 changelog/RSS，发现新条目自动开 GitHub issue。
// 定位是「闹钟」：提醒去真机核对站点 UI——公告里的模型名与网页 UI 标签经常不同名，严禁直接抄进适配器
// 正则（docs/adapters.md：档位标签必须先真机确认）。Kimi/元宝/千问/豆包无官方 web changelog（2026-08 调研），
// 它们的 UI 变化靠巡检 diagnose 与真实群发失败信号兜底，不在本脚本覆盖面内。
// 运行环境：GitHub Actions（.github/workflows/release-watch.yml 注入 GITHUB_TOKEN/GITHUB_REPOSITORY）；
// 本地无 token 时 dry-run 只打印。命名不得改成 test- 前缀——verify.sh 会强制把 test-*.js 登记进无网络的 CI。

const {
  PER_SOURCE_CAP,
  dedupe,
  parseRss,
  parseHeadings,
  parseZhipu,
  issueTitle,
  issueBody,
  freshEntries,
} = require("./lib/release-feed.js");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const LABEL = "release-watch";
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
