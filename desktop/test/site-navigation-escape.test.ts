import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { COMMANDS, commandAccelerator } from "../src/shared/commands";
import { safeExternalUrl } from "../src/main/security";
import { SITES } from "../src/main/sites";
import { SiteNavigationPolicy } from "../src/main/navigation-guard";

const claude = SITES.find((site) => site.key === "claude")!;

// 回答里的引用链接绝大多数是外部域。此前它们是**静默无反应**：will-navigate 被拦、
// window.open 被 deny，两条路都没有任何提示，用户以为点坏了。
test("a user-initiated external link is refused by the view, not swallowed", () => {
  const policy = new SiteNavigationPolicy(claude);
  policy.commit(claude.url);

  const decision = policy.handleNavigation("https://example.com/cited", true, false);
  assert.equal(decision.disposition, "external");
  assert.equal(decision.allow, false, "外部域绝不能在格子里打开——格子里永远是这个站");

  const opened = policy.handleWindowOpen("https://example.com/cited", claude.url);
  assert.equal(opened.disposition, "external");
  assert.equal(opened.rewrite, false);
});

test("site-view hands refused external links to the browser instead of dropping them", () => {
  const source = readFileSync("src/main/site-view.ts", "utf8");

  // 两条路都要转交，漏一条就还是静默无反应；而且必须是「用户主动点出去」的那类。
  assert.match(source, /callbacks\.onExternal\(event\.url\)/);
  assert.match(source, /callbacks\.onExternal\(url\)/);
  assert.match(source, /disposition === "external" && event\.isMainFrame && !isRedirect/,
    "服务端 302 是登录链中间态，不能当成用户点击转交出去");
});

test("the external hop is validated before it reaches the OS browser", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(main, /safeExternalUrl\(url\)/);
  assert.match(main, /electronShell\.openExternal/);

  // safeExternalUrl 是那道校验本身：只放行 http/https、拒带凭据的 URL。
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("file:///etc/passwd"), null);
  assert.equal(safeExternalUrl("https://user:pw@example.com/"), null);
  assert.equal(safeExternalUrl("https://example.com/cited"), "https://example.com/cited");
});

// 站内导航之后此前完全没有退路，唯一脱身办法是「新会话」——那会丢掉当前对话。
test("in-site back and forward are registered as real commands with accelerators", () => {
  for (const id of ["site-back", "site-forward"] as const) {
    const command = COMMANDS.find((candidate) => candidate.id === id);
    assert.ok(command, `${id} 必须登记进 COMMANDS，否则菜单与快捷键速查都看不到它`);
    assert.ok(commandAccelerator(id, "win32"), `${id} 缺少快捷键`);
  }
  assert.equal(commandAccelerator("site-back", "win32"), "Alt+Left");
  assert.equal(commandAccelerator("site-forward", "win32"), "Alt+Right");
});

test("history navigation is wired end to end and gated like reload", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const ipc = readFileSync("src/main/shell-ipc.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  const renderer = readFileSync("src/renderer/index.tsx", "utf8");
  const body = manager.slice(manager.indexOf("navigateHistory("), manager.indexOf("canNavigateHistory("));

  assert.match(body, /siteReloadAllowed/,
    "群发/生成进行中不得动导航历史——会把正在写的回答连同页面一起丢掉");
  assert.match(body, /canGoBack\(\)/);
  assert.match(ipc, /polyask:step-history/);
  assert.match(preload, /polyask:step-history/);
  assert.match(renderer, /stepHistory/);
});

// 格子头部的后退按钮：只在该站真有历史可退时出现，免得摆一个点了没反应的按钮。
test("the tile back button appears only when that site can actually go back", () => {
  const frames = readFileSync("src/renderer/site-frames.tsx", "utf8");

  assert.match(frames, /history\[site\.key\]\?\.back &&/,
    "后退按钮必须按该站真实历史条件渲染，不能无条件摆着");
  assert.match(frames, /onBack\(site\.key\)/);

  const renderer = readFileSync("src/renderer/index.tsx", "utf8");
  assert.match(renderer, /stepHistory\(-1, site\)/, "格子按钮要能指定站点，不能只作用于聚焦站");
});
