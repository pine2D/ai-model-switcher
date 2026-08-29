import type { SiteKey } from "../shared/contracts";
import type { SiteStatus } from "../shared/protocol";

export type StatusNavigationTarget = "unfinished" | "failed";

export function nextSiteForStatus(
  sites: readonly SiteKey[],
  current: SiteKey,
  statuses: Partial<Record<SiteKey, SiteStatus>>,
  target: StatusNavigationTarget
): SiteKey | null {
  if (!sites.length) return null;
  const matches = (site: SiteKey) => {
    const phase = statuses[site]?.phase;
    return target === "failed"
      ? phase === "failed" || phase === "crashed"
      : !!phase && ["sending", "submitted", "generating", "warning", "cancelled"].includes(phase);
  };
  const start = Math.max(-1, sites.indexOf(current));
  for (let offset = 1; offset <= sites.length; offset += 1) {
    const site = sites[(start + offset) % sites.length];
    if (matches(site)) return site;
  }
  return null;
}
