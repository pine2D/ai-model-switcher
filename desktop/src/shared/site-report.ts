import type { SiteKey } from "./contracts";
import type { SiteStatus } from "./protocol";
import type { SiteHealth } from "./site-health";

export interface SiteReportInput {
  readonly version: string;
  readonly distribution: string;
  readonly platform: string;
  readonly scale: number;
  readonly sites: readonly { readonly key: SiteKey; readonly label: string }[];
  readonly statuses: Readonly<Partial<Record<string, SiteStatus>>>;
  readonly health: Readonly<Partial<Record<SiteKey, SiteHealth>>>;
  readonly now: number;
}

// 可直接粘贴进报障 issue 的纯文本报告：版本 / 环境 / 显示缩放，每站的 phase、code、健康结论，
// 以及每条 check 的 {name, kind, ok}。绝不包含对话内容、URL、账号信息——check.name 是本地化的
// diag_* 词条，不是页面文本；站点只写 key 与产品名，不写 host。
export function buildSiteReport(input: SiteReportInput): string {
  const lines = [
    `PolyAsk Desktop ${input.version} (${input.distribution}) · ${input.platform} · scale ${input.scale}`,
    `generated ${new Date(input.now).toISOString()}`
  ];
  for (const site of input.sites) {
    const status = input.statuses[site.key];
    const health = input.health[site.key];
    const phase = status ? `phase=${status.phase}${status.code ? ` code=${status.code}` : ""}` : "phase=unknown";
    const checked = health?.checkedAt ? ` checkedAt=${new Date(health.checkedAt).toISOString()}` : "";
    lines.push(`[${site.key}] ${site.label}: ${phase} health=${health?.state ?? "unknown"}${checked}`);
    const checks = health?.checks ?? [];
    if (!checks.length) lines.push("  - (no checks)");
    for (const check of checks) lines.push(`  - ${check.name} kind=${check.kind ?? "control"} ok=${check.ok}`);
  }
  return lines.join("\n");
}
