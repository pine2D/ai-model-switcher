#!/usr/bin/env node
"use strict";
// F088 回归：extractPage 只在页面唯一命中 <article> 时才采用它，避免列表页（每条目一个
// <article>）只捞到文档顺序第一条、把导航/推荐位漏进结果。scripts/test-page-context.js 已顶格
// 300 行禁止增行，新增用例落在本文件；同一测试补一条 F087 省略标记的多命中场景兜底覆盖。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const noop = { addListener() {} };
const chrome = {
  runtime: { onInstalled: noop, onStartup: noop },
  contextMenus: { onClicked: noop },
  storage: { local: {}, onChanged: noop },
  i18n: {}, scripting: {},
};
const context = vm.createContext({ chrome, console, Date, URL });
vm.runInContext(source("bg/page-context.js"), context);
const PageContext = vm.runInContext("PageContext", context);

// 真实 DOM 语义的 querySelector/querySelectorAll 桩：article 可注册 0/1/N 个节点
function doc(articles, extra = {}) {
  const nodeFor = (selector) => (selector === "article" ? articles[0] || null : extra[selector] || null);
  return {
    querySelector: (selector) => nodeFor(selector),
    querySelectorAll: (selector) => (selector === "article" ? articles : []),
    body: extra.body || { innerText: "Body fallback" },
  };
}

function run() {
  // 列表页：多个 <article>（如信息流每条目一个）——唯一命中判定必须放弃 article，退到 main/role/body
  const feed = doc(
    [{ innerText: " First card " }, { innerText: " Second card " }, { innerText: " Third card " }],
    { main: { innerText: " Feed main " } }
  );
  assert.equal(PageContext.extractForTest(feed), "Feed main", "多个 article 时不得只捞文档顺序第一条");

  // 列表页且没有 main/[role=main] 兜底：必须落到 body，而不是继续用第一个 article
  const feedNoMain = doc([{ innerText: " Card A " }, { innerText: " Card B " }], { body: { innerText: " Page body fallback " } });
  assert.equal(PageContext.extractForTest(feedNoMain), "Page body fallback", "无 main 兜底时应落到 body，不得静默采用首个 article");

  // 单篇文章页：唯一命中 article 时行为不变（既有正确路径不受影响）
  const single = doc([{ innerText: " Only article " }], { main: { innerText: " Should not use this " } });
  assert.equal(PageContext.extractForTest(single), "Only article", "唯一 article 命中时仍应优先采用，不回退");

  // 零 article：与既有单命中语义一致，直接走 main
  const none = doc([], { main: { innerText: " Main only " } });
  assert.equal(PageContext.extractForTest(none), "Main only", "无 article 时应直接使用 main");

  // F087 兜底：多命中场景下超长正文同样要插入语言无关的省略标记，不因改走 main/body 分支而漏标记
  const longMain = " ".repeat(0) + "p".repeat(24001) + "MID" + "q".repeat(6001);
  const capped = PageContext.capText(longMain);
  assert.ok(capped.truncated, true);
  assert.ok(capped.text.startsWith("p".repeat(24000)) && capped.text.endsWith("q".repeat(6000)));
  assert.match(capped.text, /omitted \d+ characters.*已省略 \d+ 个字符/s, "截断必须带语言无关的省略标记");
  assert.doesNotMatch(capped.text, /---/, "省略标记不得使用三段短横线，避免和 activeMarker 围栏视觉混淆");

  console.log("page-context truncation/article-selection tests passed");
}

run();
