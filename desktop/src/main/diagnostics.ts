import { SITE_KEYS, type SiteKey, type ViewBounds } from "../shared/contracts";
import type { LayoutState } from "../shared/protocol";

export const SITE_PARTITION = "persist:polyask-sites";
export const SITE_VIEW_SECURITY = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true
} as const;

export interface DiagnosticSiteInput {
  readonly site: SiteKey;
  readonly webContentsId: number;
  readonly partition: string;
  readonly sameSession: boolean;
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
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
  if (input.sites.length !== SITE_KEYS.length) violations.push("site_count");

  const siteKeys = input.sites.map((site) => site.site);
  if (siteKeys.join("|") !== SITE_KEYS.join("|")) violations.push("site_order");
  const contentsIds = input.sites.map((site) => site.webContentsId);
  if (contentsIds.some((id) => !Number.isInteger(id) || id <= 0)) violations.push("site_contents_id");
  if (new Set(contentsIds).size !== contentsIds.length) violations.push("duplicate_contents_id");

  for (const site of input.sites) {
    if (site.partition !== SITE_PARTITION || !site.sameSession) {
      violations.push(`site_session:${site.site}`);
    }
    if (!site.sandbox || !site.contextIsolation || site.nodeIntegration) {
      violations.push(`insecure_site:${site.site}`);
    }
    if (site.attached && !hasPositiveBounds(site.bounds)) violations.push(`site_bounds:${site.site}`);
  }
  const attached = input.sites.filter((site) => site.attached).map((site) => site.site);
  const placed = input.layout.placements.map((placement) => placement.key);
  if (placed.length !== attached.length || placed.length > 4) violations.push("layout_count");
  if (new Set([...attached, ...placed]).size !== attached.length ||
      !attached.every((site) => placed.includes(site))) {
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
