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

// —— datedSections：deepseek 形态（独立 Date 标题 + 紧随的型号标题配对；无型号标题退化取正文前 80 字；
// 两者都没有则退化成纯日期），并核对 legacyTitle 固定存纯日期原文 ——
{
  const dateRe = /20\d\d-\d{1,2}-\d{1,2}/; // deepseek 的 filter：非锚定，容忍 "Date: 2026-08-21" 这类前缀
  const html = [
    "<h2>Date: 2026-08-21</h2>",
    "<h3>DeepSeek-V4-Flash-Vision-Exp Release</h3>",
    "<h2>Date: 2026-08-15</h2>", // 本条无型号 heading，退化取正文前 80 字
    "<p>Fixed a rate-limit rollout bug affecting some API keys in the eu-west region.</p>",
    "<h2>Date: 2026-08-10</h2>", // 本条既无型号 heading 也无正文，退化成纯日期
    "<h2>Date: 2026-08-05</h2>",
  ].join("\n");
  const out = feed.datedSections(html, "https://api-docs.deepseek.test/updates", dateRe);
  assert.deepStrictEqual(
    out.map((e) => e.title),
    [
      "Date: 2026-08-21 — DeepSeek-V4-Flash-Vision-Exp Release",
      "Date: 2026-08-15 — Fixed a rate-limit rollout bug affecting some API keys in the eu-west region.",
      "Date: 2026-08-10",
      "Date: 2026-08-05",
    ],
    "datedSections 应配对 deepseek 的 Date+型号双标题，退化取正文摘要，两者都没有则退化成纯日期"
  );
  assert.ok(out.every((e) => e.legacyTitle === e.date), "legacyTitle 必须固定是纯日期原文，供旧存量去重兼容");
  assert.strictEqual(out[0].date, "Date: 2026-08-21");
}

// —— datedSections：claude 形态（日期后紧跟正文段落、没有二级摘要标题），并核对摘要严格截到 80 字 ——
{
  const dateRe = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s*20\d\d$/i;
  const longBody =
    "Added support for extended thinking budgets in the API and fixed a regression in tool_choice validation that rejected valid schemas silently since the previous release.";
  const html = [
    "<h2>August 26, 2026</h2>",
    `<p>${longBody}</p>`,
    "<h2>August 19, 2026</h2>",
    "<p>Short fix.</p>",
  ].join("\n");
  const out = feed.datedSections(html, "https://platform.claude.test/release-notes", dateRe);
  assert.strictEqual(out[0].date, "August 26, 2026");
  assert.strictEqual(out[0].title, `August 26, 2026 — ${longBody.slice(0, 80)}`);
  assert.strictEqual(
    out[0].title.length,
    "August 26, 2026 — ".length + 80,
    "正文摘要必须截到 80 字，不能把整段落塞进标题"
  );
  assert.strictEqual(out[1].title, "August 19, 2026 — Short fix.");
}

// —— datedSections：同一天出现两个独立日期标题（同日多条各自是独立公告）不能被误合并成一条 ——
{
  const dateRe = /^20\d\d[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/;
  const html = [
    "<h2>2026.08.20</h2>",
    "<h3>Gemini 3.2 Flash rollout</h3>",
    "<h2>2026.08.20</h2>", // 同一天第二条独立公告，不应与上面那条合并
    "<h3>Safety filter tuning</h3>",
  ].join("\n");
  const out = feed.datedSections(html, "https://gemini.test/release-notes", dateRe);
  assert.strictEqual(out.length, 2, "同日多条必须各自成条，不能被合并成一条");
  assert.deepStrictEqual(out.map((e) => e.title), [
    "2026.08.20 — Gemini 3.2 Flash rollout",
    "2026.08.20 — Safety filter tuning",
  ]);
}

// —— issueTitle：highSignal 分级——命中型号词表不标记，未命中标 /low（仍产出标题，不是丢弃条目）——
{
  const highSignal =
    /\b(gpt[-\s]?[0-9][\w.\-]*|o[0-9]+(?:-\w+)?|new model|model release|now available in chatgpt|rolling out.*model)\b/i;
  const src = { key: "openai", highSignal };
  const high = feed.issueTitle(src, { title: "Introducing GPT-5.6" });
  assert.strictEqual(high, "[release-watch] openai: Introducing GPT-5.6", "命中型号词表不应带 /low 标记");
  const low = feed.issueTitle(src, { title: "Bringing ChatGPT for Teachers to every classroom" });
  assert.strictEqual(
    low,
    "[release-watch] openai/low: Bringing ChatGPT for Teachers to every classroom",
    "未命中型号词表必须标 /low，而不是被丢弃"
  );
}

// —— issueBody：低信号条目首行给出提示，高信号条目不带提示、首行仍是原来的『条目：』——
{
  const highSignal =
    /\b(gpt[-\s]?[0-9][\w.\-]*|o[0-9]+(?:-\w+)?|new model|model release|now available in chatgpt|rolling out.*model)\b/i;
  const src = {
    key: "openai", name: "OpenAI / ChatGPT", url: "https://openai.test/rss",
    adapter: "desktop/src/site-runtime/adapters-intl.js", highSignal,
  };
  const lowBody = feed.issueBody(src, { title: "Introducing the Admin plugin for workspace owners", url: "https://openai.test/a" });
  assert.ok(
    lowBody.startsWith("低信号条目：标题未命中模型词表，多半是营销/案例文，快速扫一眼即可关闭。"),
    "低信号 issue 正文首行必须给出提示"
  );
  const highBody = feed.issueBody(src, { title: "Introducing GPT-5.6", url: "https://openai.test/b" });
  assert.ok(!highBody.startsWith("低信号"), "高信号条目不应带低信号提示");
  assert.ok(highBody.startsWith("条目："), "高信号 issueBody 首行应仍是原来的『条目：』起始");
}

// —— freshEntries：seen 集合是改格式前开的旧标题（无 /low 标记 / 纯日期无摘要）时仍要能定位，不重复开单 ——
{
  // (a) 低信号兼容：openai 旧 issue 标题没有 /low 标记（改格式前开的），这一轮同一条目会算出带 /low 的新标题
  const highSignal =
    /\b(gpt[-\s]?[0-9][\w.\-]*|o[0-9]+(?:-\w+)?|new model|model release|now available in chatgpt|rolling out.*model)\b/i;
  const src = { key: "openai", url: "https://openai.test/rss", highSignal };
  const marketing = { title: "Introducing the Admin plugin for workspace owners" };
  const entries = [{ title: "Introducing GPT-5.7" }, marketing, { title: "Stampli cuts review time" }];
  const seenLegacy = new Set([feed.legacyIssueTitle(src, marketing)]);
  const picked = feed.freshEntries(src, entries, seenLegacy);
  assert.deepStrictEqual(
    picked.map((e) => e.title),
    ["Introducing GPT-5.7"],
    "seen 里存的是改格式前（无 /low）的旧标题时，freshEntries 仍要定位到它，不能把它当新条目再开一遍"
  );
}
{
  // (b) 日期型兼容：deepseek 旧 issue 标题是纯日期（改格式前开的，无摘要），这一轮同一天会拼上摘要
  const src = { key: "deepseek", url: "https://api-docs.deepseek.test/updates" };
  const legacyEntry = { title: "Date: 2026-08-15 — Fixed a bug", date: "Date: 2026-08-15", legacyTitle: "Date: 2026-08-15" };
  const entries = [
    { title: "Date: 2026-08-21 — New release", date: "Date: 2026-08-21", legacyTitle: "Date: 2026-08-21" },
    legacyEntry,
  ];
  const seenLegacy = new Set([feed.legacyIssueTitle(src, { title: "Date: 2026-08-15", legacyTitle: "Date: 2026-08-15" })]);
  const picked = feed.freshEntries(src, entries, seenLegacy);
  assert.deepStrictEqual(
    picked.map((e) => e.title),
    ["Date: 2026-08-21 — New release"],
    "seen 里存的是改格式前（纯日期无摘要）的旧标题时，freshEntries 仍要定位到它，不能把它当新条目再开一遍"
  );
}

// —— datedSections：groupHeaderRe（第四参）堵两处坑——分组大标题被当摘要回收，及退化取正文时把它的
// 纯文字一并吃进去（support.claude.com 实测坐实："Aug 6, 2026 — July 2026" 糊涂账）——
{
  const dateRe = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s*20\d\d$/i;
  const groupHeaderRe = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+20\d\d$/i;
  const html = ["<h2>August 2026</h2>", "<h3>August 6, 2026</h3>", "<p>Security scanning beta.</p>",
    "<h2>July 2026</h2>", "<h3>July 24, 2026</h3>", "<p>Opus 5 launch.</p>"].join("\n");
  assert.ok(feed.datedSections(html, "https://x.test", dateRe)[0].title.includes("July 2026"), "回归基线：不传 groupHeaderRe 应复现糊涂账");
  const fixed = feed.datedSections(html, "https://x.test", dateRe, groupHeaderRe).map((e) => e.title);
  assert.deepStrictEqual(fixed, ["August 6, 2026 — Security scanning beta.", "July 24, 2026 — Opus 5 launch."], "传 groupHeaderRe 后月份大标题必须被整条剔除");
}

// —— parseSnapshot（kind "snapshot"，kimi）：锚点命中截 160 字，未命中/无 <article> 各自退化，正文为空返回 [] ——
{
  const html = ["<nav>帮助中心</nav>", "<article>", "<h1>怎么选</h1>", "<p>怎么选 Kimi 会自主判断是否联网。</p>",
    "<p>模型 思考强度 擅长场景 K2.6 标准/进阶 K3 标准/进阶/极致</p>", "</article>", "<footer>无关侧栏</footer>"].join("\n");
  const a = feed.parseSnapshot(html, "https://k.test", /模型\s*思考强度/);
  assert.strictEqual(a.length, 1, "snapshot 固定只产 1 条 entry");
  assert.ok(a[0].title.startsWith("模型 思考强度") && !a[0].title.includes("侧栏"), "锚点命中应从锚点截，且不带容器外内容");
  assert.ok(feed.parseSnapshot(html, "https://k.test", /永不出现ZZZ/)[0].title.startsWith("怎么选"), "锚点未命中应退化取正文最前 160 字");
  assert.ok(feed.parseSnapshot("<p>无 article 容器</p>", "https://k.test")[0].title.includes("无 article 容器"), "找不到 <article> 应退化把整篇当正文");
  assert.deepStrictEqual(feed.parseSnapshot("<article></article>", "https://k.test"), [], "正文为空必须返回 []");
}

// —— parseBailian（kind "bailian"）：<th> 表头跳过，<td> 行取[类型,日期,型号ID,描述]拼 title，缺单元格整行跳过 ——
{
  const html = ["<table><thead><tr><th>Type</th><th>Date</th><th>Model ID</th><th>Desc</th></tr></thead><tbody>",
    "<tr><td>Text</td><td>2026-08-31</td><td>ZHIPU/GLM-5.3-Flash</td><td>d</td></tr>",
    "<tr><td>Broken</td><td>2026-08-27</td></tr>", "</tbody></table>"].join("\n");
  assert.deepStrictEqual(feed.parseBailian(html, "https://b.test").map((e) => e.title), ["2026-08-31 ZHIPU/GLM-5.3-Flash"], "表头跳过、缺单元格残行跳过");
  assert.deepStrictEqual(feed.parseBailian("<p>无 table</p>", "https://b.test"), [], "找不到 <table> 应返回 []");
}

// —— issueBody：snapshot 用「UI 状态快照 diff」措辞而非「官方发了公告」；lowSignalNote 覆盖默认低信号提示 ——
{
  const snapBody = feed.issueBody({ key: "kimi", name: "Kimi", url: "https://k.test", adapter: "x", kind: "snapshot" }, { title: "摘要", url: "https://k.test" });
  assert.ok(snapBody.includes("UI 状态快照 diff") && snapBody.startsWith("摘要：") && !snapBody.includes("官方发了公告"), "snapshot 源措辞须区别于 changelog 类源");

  const lowSrc = { key: "bailian", name: "百炼", url: "https://b.test", adapter: "x", highSignal: feed.NEVER_HIGH_SIGNAL, lowSignalNote: "低信号：API 侧上线表。" };
  assert.ok(feed.issueBody(lowSrc, { title: "2026-08-31 X", url: "https://b.test/x" }).startsWith("低信号：API 侧上线表。"), "有 lowSignalNote 必须用它换掉 openai 默认措辞");
  assert.ok(feed.NEVER_HIGH_SIGNAL.test("") && !feed.NEVER_HIGH_SIGNAL.test("任意标题"), "NEVER_HIGH_SIGNAL 只应匹配空串");
}

// —— freshEntries：snapshot 单条目列表三态——首轮登基线、未变不重开、变了当新条目 ——
{
  const src = { key: "kimi", url: "https://k.test" };
  const v1 = [{ title: "K2.6 标准/进阶" }], v2 = [{ title: "K2.6 标准/进阶/极速" }];
  assert.deepStrictEqual(feed.freshEntries(src, v1, new Set()).map((e) => e.title), v1.map((e) => e.title), "首轮登基线");
  const seen = new Set([feed.issueTitle(src, v1[0])]);
  assert.deepStrictEqual(feed.freshEntries(src, v1, seen), [], "内容未变不应重复开单");
  assert.deepStrictEqual(feed.freshEntries(src, v2, seen).map((e) => e.title), v2.map((e) => e.title), "内容变化应当新条目开单");
}

console.log("release feed tests passed");
