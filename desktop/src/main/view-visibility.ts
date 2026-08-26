import type { SiteKey } from "../shared/contracts";

export function reconcileVisibleSiteKeys(
  attached: readonly SiteKey[],
  visible: readonly SiteKey[]
): { readonly attach: SiteKey[]; readonly detach: SiteKey[] } {
  const attachedSet = new Set(attached);
  const visibleSet = new Set(visible);
  return {
    attach: visible.filter((site) => !attachedSet.has(site)),
    detach: attached.filter((site) => !visibleSet.has(site))
  };
}
