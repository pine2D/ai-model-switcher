"use strict";
// scripts/test-release-feed.js — scripts/lib/release-feed.js 的离线回归。
// 纯逻辑测试：不 fetch 任何网络地址，只喂固定的 RSS/HTML 样本字符串（docs/verify.md：
// 真机/联网脚本不得用 test- 前缀，本文件必须完全离线才配得上这个前缀）。

const assert = require("assert");
const feed = require("./lib/release-feed.js");

assert.strictEqual(typeof feed.freshEntries, "function", "release-feed 必须导出 freshEntries");

// —— stripTags：标签、实体、不可见字符都要清掉，可见文字与空白正常保留 ——
{
  const out = feed.stripTags("<p>Hello&nbsp;World</p>\n\t  trailing  ");
  assert.strictEqual(out, "Hello World trailing", "stripTags 应清掉标签、折叠空白并去首尾空格");
}
{
  // U+200B 零宽空格 + U+FEFF BOM 夹在文字中间，不应留下任何痕迹
  const zwsp = String.fromCharCode(0x200b);
  const bom = String.fromCharCode(0xfeff);
  const out = feed.stripTags(`<h2>2026${zwsp}-08${bom}-20</h2>`);
  assert.strictEqual(out, "2026-08-20", "stripTags 必须清掉零宽符/BOM 等不可见字符");
}

// —— dedupe：同标题只留第一条，保序 ——
{
  const out = feed.dedupe([{ title: "A" }, { title: "B" }, { title: "A" }, { title: "C" }]);
  assert.deepStrictEqual(out.map((e) => e.title), ["A", "B", "C"], "dedupe 应按标题去重且保序");
}

// —— parseRss：按 <item> 抽 <title>/<link>，CDATA 与普通标题都要认 ——
{
  const xml = `<rss><channel>
    <item><title><![CDATA[GPT-5.6 released]]></title><link>https://a/1</link></item>
    <item><title>o4 update</title><link>https://a/2</link></item>
    <item><title></title><link>https://a/3</link></item>
  </channel></rss>`;
  const out = feed.parseRss(xml);
  assert.deepStrictEqual(out, [
    { title: "GPT-5.6 released", url: "https://a/1" },
    { title: "o4 update", url: "https://a/2" },
  ], "parseRss 应跳过空标题条目，保留 CDATA 与普通标题");
}

// —— parseHeadings：h2/h3 当条目，太短/太长的标题（导航/页脚噪音）被过滤 ——
{
  const html = `
    <h2>2026-08-20</h2>
    <h3>2026-08-15</h3>
    <h2>ab</h2>
    <h2>${"x".repeat(121)}</h2>
  `;
  const out = feed.parseHeadings(html, "https://example.test/notes");
  assert.deepStrictEqual(
    out.map((e) => e.title),
    ["2026-08-20", "2026-08-15"],
    "parseHeadings 应保留 4~120 字标题，过滤过短/过长噪音"
  );
  assert.ok(out.every((e) => e.url === "https://example.test/notes"), "parseHeadings 条目应携带页面 URL");
}

// —— parseZhipu：位置法切块，某条缺 description 不得让后续条目整体错位（watch-releases.js 注释点名的老坑）——
{
  const html = [
    '<div data-component-part="update-label">2026-08-20</div>',
    '<div data-component-part="update-description">Feature A released</div>',
    '<div data-component-part="update-label">2026-08-15</div>', // 本条故意不带 description
    '<div data-component-part="update-label">2026-08-10</div>',
    '<div data-component-part="update-description">Feature C released</div>',
  ].join("\n");
  const out = feed.parseZhipu(html, "https://docs.example.test/updates");
  assert.deepStrictEqual(
    out.map((e) => e.title),
    ["2026-08-20 Feature A released", "2026-08-15", "2026-08-10 Feature C released"],
    "parseZhipu 必须按位置对齐 label/description，缺 description 只影响那一条，不能让后面的条目错位"
  );
}

// —— issueTitle：超 180 字截断并加省略号，前缀带 src.key ——
{
  const src = { key: "openai" };
  const short = feed.issueTitle(src, { title: "hello" });
  assert.strictEqual(short, "[release-watch] openai: hello");
  const long = feed.issueTitle(src, { title: "x".repeat(200) });
  assert.ok(long.length < 220, "issueTitle 必须截断超长标题");
  assert.ok(long.endsWith("…"), "截断后必须保留省略号标记");
}

// —— freshEntries：首轮全未见只登基线 1 条；命中已见条目后只取之上的部分；超单源上限截断并 warn ——
{
  const src = { key: "openai", url: "https://openai.test/notes" };
  const entries = [{ title: "E5" }, { title: "E4" }, { title: "E3" }, { title: "E2" }, { title: "E1" }];

  // 首轮：seen 为空，只登记最新一条作基线，不把历史全量当新条目刷出来
  const first = feed.freshEntries(src, entries, new Set());
  assert.deepStrictEqual(first.map((e) => e.title), ["E5"], "首轮全未见时只应登记最新一条作基线");

  // 第二轮：E3 已见，E5/E4 是新条目（都在 E3 之上）
  const seenAtE3 = new Set([feed.issueTitle(src, { title: "E3" })]);
  const second = feed.freshEntries(src, entries, seenAtE3);
  assert.deepStrictEqual(second.map((e) => e.title), ["E5", "E4"], "命中已见条目后，只应取该条目之上的新条目");

  // 超单源上限：命中已见条目之上有 5 条新条目（> PER_SOURCE_CAP），必须截断到上限并 warn（不静默丢弃）。
  // 用 N1（最旧一条）已见来触发「非首轮」分支——首轮（idx===-1）无论多少条都只登基线 1 条，
  // 那条分支单独在上面测过，这里要测的是另一条路径：真的超量时会截断+告警。
  const manyEntries = [{ title: "N6" }, { title: "N5" }, { title: "N4" }, { title: "N3" }, { title: "N2" }, { title: "N1" }];
  const seenAtN1 = new Set([feed.issueTitle(src, { title: "N1" })]);
  let warned = "";
  const capped = feed.freshEntries(src, manyEntries, seenAtN1, (msg) => { warned = msg; });
  assert.strictEqual(capped.length, feed.PER_SOURCE_CAP, "超上限时必须截断到 PER_SOURCE_CAP");
  assert.deepStrictEqual(capped.map((e) => e.title), ["N6", "N5", "N4"]);
  assert.ok(warned.includes("openai"), "超上限截断必须显式 warn，不能静默丢弃『漏抓』信号");
}

console.log("release feed tests passed");
