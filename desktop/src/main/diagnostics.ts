import { SITE_KEYS, type SiteKey, type ViewBounds } from "../shared/contracts";
import type { LayoutState } from "../shared/protocol";

export const SITE_PARTITION = "persist:polyask-sites";
export const SITE_VIEW_SECURITY = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  // Rate-limit JavaScript dialogs so a page cannot lock the shared window with a
  // loop of alert()/confirm(). Not disableDialogs: sites still need their own
  // confirmations, and turning them off needs on-device verification first.
  safeDialogs: true
} as const;

export interface DiagnosticSiteInput {
  readonly site: SiteKey;
  readonly webContentsId: number;
  readonly partition: string;
  readonly sameSession: boolean;
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
  // Optional so older snapshots stay readable; only an explicit false is a
  // violation, matching "webSecurity was never turned off".
  readonly webSecurity?: boolean;
  readonly attached: boolean;
  readonly bounds: ViewBounds;
}

export interface DiagnosticInput {
  readonly shellId: number;
  readonly sites: readonly DiagnosticSiteInput[];
  readonly layout: LayoutState;
}

export interface DiagnosticSnapshot extends DiagnosticInput {
  readonly schema: 1;
  readonly generatedAt: number;
  readonly shellCount: number;
  readonly ok: boolean;
  readonly violations: readonly string[];
}

function hasPositiveBounds(bounds: ViewBounds): boolean {
  return bounds.width > 0 && bounds.height > 0;
}

export function buildDiagnosticSnapshot(input: DiagnosticInput): DiagnosticSnapshot {
  const violations: string[] = [];
  const shellCount = Number.isInteger(input.shellId) && input.shellId > 0 ? 1 : 0;
  if (shellCount !== 1) violations.push("shell_count");
  // 视图是**按勾选懒建**的，所以上报数量不再恒等于九——只要求「非空、不超过全站数」。
  // 完整性由 smoke 在默认全选下断言（默认九站全建），这里守的是结构不变量。
  if (!input.sites.length || input.sites.length > SITE_KEYS.length) violations.push("site_count");

  const siteKeys = input.sites.map((site) => site.site);
  // 顺序必须仍是 SITE_KEYS 的**子序列**（产品顺序不能乱），而不是恒等于全表。
  const order = siteKeys.map((key) => SITE_KEYS.indexOf(key));
  if (order.some((index, position) => index < 0 || (position > 0 && index <= order[position - 1]))) {
    violations.push("site_order");
  }
  const contentsIds = input.sites.map((site) => site.webContentsId);
  if (contentsIds.some((id) => !Number.isInteger(id) || id <= 0)) violations.push("site_contents_id");
  if (new Set(contentsIds).size !== contentsIds.length) violations.push("duplicate_contents_id");

  for (const site of input.sites) {
    if (site.partition !== SITE_PARTITION || !site.sameSession) {
      violations.push(`site_session:${site.site}`);
    }
    if (!site.sandbox || !site.contextIsolation || site.nodeIntegration || site.webSecurity === false) {
      violations.push(`insecure_site:${site.site}`);
    }
    if (site.attached && !hasPositiveBounds(site.bounds)) violations.push(`site_bounds:${site.site}`);
  }
  const attached = input.sites.filter((site) => site.attached).map((site) => site.site);
  const placed = input.layout.placements.map((placement) => placement.key);
  // 挂载数 ≥ 落格数：所有已勾选站点都挂在视图树里（否则视口 0×0，见 view-visibility.ts），
  // 而 layout.placements 只描述当前页最多 4 格。旧断言要求两者集合相等，与该不变量正相反。
  if (placed.length > 4 || attached.length > SITE_KEYS.length) violations.push("layout_count");
  if (new Set(attached).size !== attached.length ||
      !placed.every((site) => attached.includes(site))) {
    violations.push("attached_layout");
  }
  for (const placement of input.layout.placements) {
    if (!hasPositiveBounds(placement.bounds)) violations.push(`layout_bounds:${placement.key}`);
  }

  return {
    schema: 1,
    generatedAt: Date.now(),
    shellCount,
    shellId: input.shellId,
    layout: input.layout,
    sites: input.sites.map((site) => ({ ...site, bounds: { ...site.bounds } })),
    ok: violations.length === 0,
    violations
  };
}
