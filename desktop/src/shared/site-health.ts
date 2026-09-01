import type { SiteKey } from "./contracts";

export type SiteHealthState = "ready" | "sign-in" | "error" | "unknown";
export type SiteHealthPageState = "loading" | "ready" | "error" | "unknown";
export type SiteHealthRunPhase =
  | "sending"
  | "submitted"
  | "generating"
  | "complete"
  | "warning"
  | "cancelled"
  | "failed";

// 检查项的机器语义。**不能按 name 分类**——name 在源头就已本地化（i18n 的 diag_* 词条），
// 按显示名匹配在非英文界面下必然失效，也撞 CLAUDE.md「绝不正则匹配文案」。
//   reach   = 站点可达性（输入框在不在）——红了群发必然打空
//   control = 切档控件在不在——红了多半是站点改版
//   tier    = 当前档位读不读得出——**这条红不代表站点坏了**
//   probe   = 探测本身出错（适配器缺席 / diagnose 抛异常）
export type SiteCheckKind = "reach" | "control" | "tier" | "probe";

export interface SiteDiagnosticCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly kind?: SiteCheckKind;
}

const CHECK_KINDS: readonly SiteCheckKind[] = ["reach", "control", "tier", "probe"];

// 缺省与未知值一律按 control 处理：新写的检查忘了标 kind 时仍然会告警（fail-loud），
// 而不是被静默降级成提示——降级的方向必须是「保留现状」，绝不能制造假绿。
function checkKind(value: unknown): SiteCheckKind {
  return CHECK_KINDS.includes(value as SiteCheckKind) ? value as SiteCheckKind : "control";
}

export interface SiteHealth {
  readonly site: SiteKey;
  readonly state: SiteHealthState;
  readonly checks: readonly SiteDiagnosticCheck[];
  readonly page?: SiteHealthPageState;
  readonly recent?: { readonly phase: SiteHealthRunPhase; readonly code?: string };
  // 本次结论的采集时刻。健康结论会过期——站点自己跳到登录墙、被 302 到外部页之后，
  // 面板上那条旧的「可提问」不再成立，用户需要看到它有多旧。
  readonly checkedAt?: number;
}

export interface SiteHealthSummary {
  readonly ready: number;
  readonly signIn: number;
  readonly error: number;
  readonly unknown: number;
}

interface HealthInput {
  readonly site: SiteKey;
  readonly phase: string;
  readonly navigation: "site" | "auth" | "transit" | "external" | "block";
  readonly checks?: unknown;
}

export function normalizeDiagnosticChecks(value: unknown): SiteDiagnosticCheck[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.name !== "string" || typeof candidate.ok !== "boolean") return [];
    const name = candidate.name.trim().slice(0, 120);
    return name ? [{ name, ok: candidate.ok, kind: checkKind(candidate.kind) }] : [];
  });
}

export function buildSiteHealth(input: HealthInput): SiteHealth {
  const checks = normalizeDiagnosticChecks(input.checks);
  let state: SiteHealthState = "unknown";
  if (input.navigation === "auth") state = "sign-in";
  // 主帧停在既非本站、也非登记登录域的外部源：登录流早已是毫秒级 302 中间态，持久停在这里
  // 属异常（站点异常跳转，或——见 navigation-guard——auth 流中被导到外部页）。标 error 让它
  // 进健康检查告警与工作台注意力清单，堵住「外部页却显示一切正常」这个钓鱼放大器。
  else if (input.navigation === "external") state = "error";
  else if (input.phase === "failed" || input.phase === "crashed") state = "error";
  else if (input.navigation === "site" && checks.length) {
    // 只有「拦路」的检查才决定可用性。档位读不读得出（kind:"tier"）与站点能不能群发无关：
    // 各站 state() 是刻意的偏函数，只认自己 think()/fast() 能产出的那两档，用户手动停在
    // 任何其它合法档位（千问 Qwen3.7+快速、Kimi Instant、元宝 Expert）都返回 null——
    // 那是设计如此，不是故障。旧实现「任一项红即 error」让这三站在完全正常时常态误报，
    // 反而把真正的改版信号淹掉了。tier 项仍在详情页以「提示」显示，也仍进哨兵的逐项比对。
    const blocking = checks.filter((check) => check.kind !== "tier");
    state = blocking.length
      ? (blocking.every((check) => check.ok) ? "ready" : "error")
      : "ready";
  }
  return { site: input.site, state, checks };
}

export function summarizeSiteHealth(items: readonly SiteHealth[]): SiteHealthSummary {
  const summary = { ready: 0, signIn: 0, error: 0, unknown: 0 };
  for (const item of items) {
    const key = item.state === "sign-in" ? "signIn" : item.state;
    summary[key] += 1;
  }
  return summary;
}

export function siteReloadAllowed(phase: string): boolean {
  return !["sending", "generating"].includes(phase);
}
