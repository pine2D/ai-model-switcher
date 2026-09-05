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

// 视图树里的挂载顺序：**所有已勾选站点都必须挂着**，非当前页的排在前面（= 底层）。
// WebContentsView 只有挂进视图树才有非零视口——从未挂载的视图 innerWidth/innerHeight 恒 0，
// 且「只 setBounds 不 addChildView」同样是 0（Electron 43.4.0 实测），于是 site-runtime/core.js 的
// findComposer（要求 r.top < innerHeight）恒返回 null，群发对后台页站点必然 composer_not_found。
// 后台视图与当前页第一格用同一个矩形、压在其下 → 被完全遮住，不占屏幕也不抢鼠标事件。
export function stackOrder(
  selected: readonly SiteKey[],
  visible: readonly SiteKey[]
): SiteKey[] {
  const front = new Set(visible);
  return [...selected.filter((site) => !front.has(site)), ...selected.filter((site) => front.has(site))];
}
