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

export interface SiteDiagnosticCheck {
  readonly name: string;
  readonly ok: boolean;
}

export interface SiteHealth {
  readonly site: SiteKey;
  readonly state: SiteHealthState;
  readonly checks: readonly SiteDiagnosticCheck[];
  readonly page?: SiteHealthPageState;
  readonly recent?: { readonly phase: SiteHealthRunPhase; readonly code?: string };
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
    return name ? [{ name, ok: candidate.ok }] : [];
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
    state = checks.every((check) => check.ok) ? "ready" : "error";
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
