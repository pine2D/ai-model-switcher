import type { SiteDefinition } from "../shared/contracts";
import { navigationDisposition, type NavigationDisposition } from "./navigation";

export interface NavigationDecision {
  readonly disposition: NavigationDisposition;
  readonly allow: boolean;
}

export interface WindowOpenDecision {
  readonly disposition: NavigationDisposition;
  readonly rewrite: boolean;
}

// 登录流状态机。两条不对称的放行规则，配合 Electron 的事件语义把「真实登录链」与
// 「站内脚本钓鱼」分开：
//   - will-navigate（渲染端 location.href/链接/表单，恒主帧）→ isRedirect=false：
//     external 一律拦，即使在 auth 流中——站内被攻陷脚本只能走这条，堵死两步跳板。
//   - will-redirect（服务端 302，任意帧）→ isRedirect=true：external 在 auth 流中放行。
//     真机三症状（Google SetSID、OpenAI auth0/验证码域跳转）全是服务端 302，攻击者
//     无法凭空制造，所以这条兜底安全。
// authFlow 只由 did-navigate（实际提交，loadURL/reload 也触发）经 commit() 翻转——
// 「发起 auth 导航但永不提交」的钓鱼跳板因此拿不到 authFlow=true；新会话/重载 loadURL
// 回本站会提交 site → 自动清零，杜绝标志位卡死。
export class SiteNavigationPolicy {
  private authFlow = false;

  constructor(private readonly site: SiteDefinition) {}

  get authFlowActive(): boolean {
    return this.authFlow;
  }

  handleNavigation(url: string, isMainFrame: boolean, isRedirect: boolean): NavigationDecision {
    const disposition = navigationDisposition(this.site, url);
    if (disposition === "block") return { disposition, allow: false };
    // 子帧只拦非 https：第三方验证码/嵌入登录 iframe 的服务端重定向属正常网页行为，
    // webSecurity 与站点 CSP 才是子帧主防线；子帧从不改变主帧流状态。
    // （注意：子帧的「初次」导航只触发 will-frame-navigate，本视图未监听，本就无守卫；
    //  这里能看到的 isMainFrame=false 仅来自子帧的服务端 will-redirect。）
    if (!isMainFrame) return { disposition, allow: true };
    if (disposition === "site" || disposition === "auth") return { disposition, allow: true };
    // transit 主帧（一方反滥用/同意中转域）：只作为服务端 302 的中间跳板放行——攻击者无法凭空
    // 制造服务端重定向；渲染端主动导航过去(will-navigate)一律拦，避免把用户格子导到 google.com
    // 首页一类。不进 auth 流、不改流状态（commit 里同样不动）。这是 Gemini 首屏 www.google.com/sorry
    // 反滥用页被拦→白屏的修复。
    if (disposition === "transit") return { disposition, allow: isRedirect };
    // external 主帧：仅服务端重定向且处于 auth 流时放行；渲染端发起或流外一律拦。
    return { disposition, allow: isRedirect && this.authFlow };
  }

  // did-navigate：主帧实际提交了某个文档（程序化 loadURL/reload 同样触发）。
  commit(url: string): void {
    const disposition = navigationDisposition(this.site, url);
    if (disposition === "auth") this.authFlow = true;
    else if (disposition === "site" || disposition === "block") this.authFlow = false;
    // external 提交：登录链中间态，保持流状态不动。
  }

  handleWindowOpen(url: string, currentUrl: string): WindowOpenDecision {
    const disposition = navigationDisposition(this.site, url);
    const current = navigationDisposition(this.site, currentUrl);
    // 新窗口一律不放真窗口；只决定目标能否改写进本受管视图。
    // 同站目标要求「顶层也在本站」（豆包登录按钮场景成立）；登录域目标要求
    // 「顶层在本站 或 auth 流进行中」（SSO 弹窗链）。
    if (disposition === "site" && current === "site") return { disposition, rewrite: true };
    if (disposition === "auth" && (current === "site" || this.authFlow)) {
      return { disposition, rewrite: true };
    }
    return { disposition, rewrite: false };
  }
}
