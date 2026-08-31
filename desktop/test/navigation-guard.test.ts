import assert from "node:assert/strict";
import test from "node:test";

import { SiteNavigationPolicy } from "../src/main/navigation-guard";
import { SITES } from "../src/main/sites";
import type { SiteDefinition } from "../src/shared/contracts";

const site = (key: string): SiteDefinition => SITES.find((s) => s.key === key)!;
const nav = (p: SiteNavigationPolicy, url: string, main = true, redirect = false) =>
  p.handleNavigation(url, main, redirect).allow;

// —— 症状③：豆包点「登录」无反应（v0.23.0 纯 deny 同站弹窗）——
test("doubao login: a same-site window.open from the site is rewritten", () => {
  const p = new SiteNavigationPolicy(site("doubao"));
  assert.equal(p.handleWindowOpen("https://www.doubao.com/passport/login", "https://www.doubao.com/chat/").rewrite, true);
});
test("doubao login: a passport window.open from the site is rewritten, then its 302 chain flows", () => {
  const p = new SiteNavigationPolicy(site("doubao"));
  assert.equal(p.handleWindowOpen("https://passport.douyin.com/login", "https://www.doubao.com/chat/").rewrite, true);
  // 改写加载 passport 后 did-navigate 提交武装流；passport 的服务端 302 到未登记外部域获放行
  p.commit("https://passport.douyin.com/login");
  assert.equal(nav(p, "https://sso.douyin.com/verify", true, true), true);
});

// —— 症状②：Gemini 两步验证「下一步」无反应 ——
test("gemini 2FA: registered federation hosts and in-flight server redirects are allowed", () => {
  const p = new SiteNavigationPolicy(site("gemini"));
  assert.equal(nav(p, "https://accounts.google.com/v3/signin"), true);
  p.commit("https://accounts.google.com/v3/signin"); // 提交进 auth 流
  assert.equal(nav(p, "https://accounts.youtube.com/accounts/SetSID"), true, "登记的联邦域=auth，直接放行");
  assert.equal(nav(p, "https://cdn.gstatic.example/setcookie", true, true), true, "未登记外部域的服务端 302 在流中放行");
  assert.equal(nav(p, "https://gemini.google.com/app"), true);
  p.commit("https://gemini.google.com/app"); // 回本站，流退出
  assert.equal(nav(p, "https://evil.example.com/", true, true), false, "流退出后连服务端 302 也拦");
});

// —— 症状①：ChatGPT 输密码「继续」无反应 ——
test("chatgpt continue: auth chain hops flow, renderer-initiated external is always blocked", () => {
  const p = new SiteNavigationPolicy(site("chatgpt"));
  assert.equal(nav(p, "https://auth.openai.com/authorize"), true);
  p.commit("https://auth.openai.com/authorize");
  assert.equal(nav(p, "https://auth0.openai.com/u/login/password"), true, "auth0 已登记=auth");
  assert.equal(nav(p, "https://openai-api.arkoselabs.example/fc", true, true), true, "验证码域服务端 302 在流中放行");
  // 关键安全不变量：即便在 auth 流中，渲染端发起(will-navigate)的 external 一律拦
  assert.equal(nav(p, "https://evil.example.com/", true, false), false, "流中渲染端 external 仍拦（堵两步跳板）");
});

// —— M1：按提交武装，两步跳板失效 ——
test("two-hop phishing via renderer navigation cannot arm the flow", () => {
  const p = new SiteNavigationPolicy(site("chatgpt"));
  // 站内脚本 location.href 到 auth（will-navigate）：放行但未提交，流未武装
  assert.equal(nav(p, "https://accounts.google.com/"), true);
  assert.equal(p.authFlowActive, false, "will-navigate 到 auth 不武装流（只有 did-navigate 提交才武装）");
  // 紧接着第二跳到 evil（will-navigate external）：流未武装 → 拦
  assert.equal(nav(p, "https://evil.example.com/", true, false), false);
});

// —— M1：新会话 loadURL 提交回本站，清零卡住的流 ——
test("returning to the site via a committed load clears a stuck auth flow", () => {
  const p = new SiteNavigationPolicy(site("chatgpt"));
  p.commit("https://auth.openai.com/authorize");
  assert.equal(p.authFlowActive, true);
  p.commit("https://chatgpt.com/"); // Alt+N 新会话的 loadURL 触发 did-navigate
  assert.equal(p.authFlowActive, false, "回本站提交清零流，external 恢复严格");
  assert.equal(nav(p, "https://evil.example.com/", true, true), false);
});

// —— 安全负向 ——
test("outside an auth flow, external navigation and popups stay blocked", () => {
  const p = new SiteNavigationPolicy(site("chatgpt"));
  assert.equal(nav(p, "https://evil.example.com/", true, true), false);
  assert.equal(nav(p, "https://evil.example.com/", true, false), false);
  assert.equal(p.handleWindowOpen("https://evil.example.com/", "https://chatgpt.com/").rewrite, false);
  assert.equal(p.handleWindowOpen("https://accounts.google.com/o/oauth2", "https://evil.example.com/").rewrite, false);
});
test("S2: same-site window.open is not rewritten when the top level is off-site", () => {
  const p = new SiteNavigationPolicy(site("chatgpt"));
  assert.equal(p.handleWindowOpen("https://chatgpt.com/logout", "https://evil.example.com/").rewrite, false);
});
test("window.open to external is never rewritten, even inside an auth flow", () => {
  const p = new SiteNavigationPolicy(site("chatgpt"));
  p.commit("https://auth.openai.com/authorize");
  assert.equal(p.handleWindowOpen("https://evil.example.com/", "https://auth.openai.com/x").rewrite, false);
});
test("an SSO popup during an auth flow (window.open to a login domain) is rewritten", () => {
  const p = new SiteNavigationPolicy(site("chatgpt"));
  p.commit("https://auth.openai.com/authorize");
  assert.equal(p.handleWindowOpen("https://accounts.google.com/o/oauth2/v2/auth", "https://auth.openai.com/x").rewrite, true);
});

// —— 帧与协议 ——
test("non-https targets are always blocked, in every frame and flow state", () => {
  const p = new SiteNavigationPolicy(site("gemini"));
  p.commit("https://accounts.google.com/v3/signin");
  assert.equal(nav(p, "http://accounts.google.com/", true, true), false);
  assert.equal(nav(p, "javascript:alert(1)", true), false);
  assert.equal(nav(p, "http://tracker.example.com/", false, true), false);
});
test("subframe server redirects to external https are not strangled; subframes never arm the flow", () => {
  const p = new SiteNavigationPolicy(site("chatgpt"));
  assert.equal(nav(p, "https://challenges.cloudflare.example/turnstile", false, true), true);
  p.commit("https://challenges.cloudflare.example/turnstile"); // commit 只由主帧 did-navigate 调，但即便误传 external 也不武装
  assert.equal(nav(p, "https://evil.example.com/", true, false), false);
});

// —— authHost 后缀混淆钉子 ——
test("authHost lookalikes are external, not auth", () => {
  const p = new SiteNavigationPolicy(site("chatgpt"));
  assert.equal(p.handleWindowOpen("https://accounts.google.com.evil.com/", "https://chatgpt.com/").rewrite, false);
  assert.equal(nav(p, "https://accounts.google.com.evil.com/", true, true), false);
});

// —— 根因回归：Gemini 首屏 www.google.com/sorry 反滥用中转页 ——
const SORRY = "https://www.google.com/sorry/index?continue=https://gemini.google.com/app&q=abc";
test("google anti-abuse transit (server 302) is allowed on first screen, before any auth flow", () => {
  const p = new SiteNavigationPolicy(site("gemini"));
  assert.equal(p.handleNavigation("https://gemini.google.com/app", true, false).disposition, "site");
  p.commit("https://gemini.google.com/app");
  assert.equal(p.authFlowActive, false, "首屏还没进登录流");
  const d = p.handleNavigation(SORRY, true, true);
  assert.equal(d.disposition, "transit");
  assert.equal(d.allow, true, "服务端 302 到反滥用中转页必须放行，否则 Gemini 白屏");
  // sorry 302 回本站后一切照常
  assert.equal(p.handleNavigation("https://gemini.google.com/app", true, true).allow, true);
});
test("transit is a server-redirect-only bridge: renderer navigation and popups are refused", () => {
  const p = new SiteNavigationPolicy(site("gemini"));
  assert.equal(p.handleNavigation(SORRY, true, false).allow, false, "渲染端主动导航到中转域一律拦");
  assert.equal(p.handleWindowOpen(SORRY, "https://gemini.google.com/app").rewrite, false, "中转域不作为 window.open 目标改写");
});
test("transit opens NO path to external: a following external 302 stays blocked", () => {
  const p = new SiteNavigationPolicy(site("gemini"));
  p.commit("https://gemini.google.com/app");
  assert.equal(p.handleNavigation(SORRY, true, true).allow, true, "sorry 放行");
  p.commit("https://www.google.com/sorry/index");
  assert.equal(p.authFlowActive, false, "transit 不武装登录流");
  // 核心不变量：transit 没有打开 external 闸门——紧跟的 external 服务端 302 仍被拦
  assert.equal(p.handleNavigation("https://evil.example.com/", true, true).allow, false);
  // 停在 transit 页时 window.open 一律不改写（同站要 current==site、登录域要 current==site||流中，均不满足）
  assert.equal(p.handleWindowOpen("https://www.google.com/anything", "https://www.google.com/sorry/index").rewrite, false);
  assert.equal(p.handleWindowOpen("https://gemini.google.com/x", "https://www.google.com/sorry/index").rewrite, false);
});

test("transit does not arm or clear the auth flow", () => {
  const p = new SiteNavigationPolicy(site("gemini"));
  p.commit("https://accounts.google.com/v3/signin"); // 进流
  assert.equal(p.authFlowActive, true);
  p.commit("https://www.google.com/sorry/index"); // transit 提交不改流状态
  assert.equal(p.authFlowActive, true, "中转不清流；流内 external 服务端 302 仍受流保护");
});
test("transit hosts are registered for the google-login sites", () => {
  for (const key of ["gemini", "claude", "chatgpt"]) {
    assert.ok(site(key).transitHosts?.includes("www.google.com"), `${key} 缺 www.google.com 中转`);
    assert.ok(site(key).transitHosts?.includes("consent.google.com"), `${key} 缺 consent.google.com 中转`);
  }
});

test("federation hosts are registered for the google-auth sites", () => {
  for (const key of ["claude", "chatgpt", "gemini"]) {
    assert.ok(site(key).authHosts.includes("accounts.youtube.com"), `${key} 缺 accounts.youtube.com`);
  }
  assert.ok(site("chatgpt").authHosts.includes("auth0.openai.com"));
});
