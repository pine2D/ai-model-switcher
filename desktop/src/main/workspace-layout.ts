import type { WebContentsView } from "electron";

import type { SiteKey, ViewBounds, ViewPlacement } from "../shared/contracts";
import {
  metricsForDensity,
  shellHeightForComposer,
  zoomForSite,
  type Density,
  type DisplayMetrics,
  type DisplayPreferences
} from "../shared/display";
import { computeViewLayout, resolveLayoutMode, scaleBounds } from "./layout";

interface WorkspaceLayoutInput {
  readonly width: number;
  readonly height: number;
  readonly density: Density;
  readonly composerExpanded: boolean;
  readonly drawerOpen: boolean;
  readonly requestedMode: "overview" | "focus";
  readonly focused: SiteKey;
  readonly overviewOrder: readonly SiteKey[];
  readonly focusOrder: readonly SiteKey[];
}

interface WorkspaceLayoutResult {
  readonly mode: "overview" | "focus";
  readonly placements: readonly ViewPlacement[];
  readonly metrics: DisplayMetrics;
}

interface ApplyWorkspaceLayoutInput {
  readonly views: ReadonlyMap<SiteKey, WebContentsView>;
  readonly placements: readonly ViewPlacement[];
  readonly metrics: DisplayMetrics;
  readonly zoom: number;
  readonly display: DisplayPreferences;
  readonly mode: "overview" | "focus";
  readonly focused: SiteKey;
}

export function drawerWidthForDensity(density: Density, open: boolean): number {
  if (!open) return 0;
  return density === "compact" ? 280 : 320;
}

export function reserveWorkspaceArea(area: ViewBounds, drawerWidth: number): ViewBounds {
  const reserved = Math.max(0, Math.min(Math.floor(drawerWidth), Math.max(0, area.width - 1)));
  if (reserved === 0) return area;
  return {
    x: area.x + reserved,
    y: area.y,
    width: Math.max(1, area.width - reserved),
    height: area.height
  };
}

export function computeWorkspaceLayout(input: WorkspaceLayoutInput): WorkspaceLayoutResult {
  const metrics = metricsForDensity(input.density);
  const shellHeight = shellHeightForComposer(input.density, input.composerExpanded);
  const baseArea = {
    x: metrics.edgeGap,
    y: shellHeight,
    width: Math.max(1, input.width - metrics.edgeGap * 2),
    height: Math.max(1, input.height - shellHeight - metrics.edgeGap)
  };
  const area = reserveWorkspaceArea(
    baseArea,
    drawerWidthForDensity(input.density, input.drawerOpen)
  );
  const requestedKeys = input.requestedMode === "focus" ? input.focusOrder : input.overviewOrder;
  const mode = resolveLayoutMode(input.requestedMode, area, metrics.viewGap, requestedKeys.length);
  const keys = mode === "focus" ? input.focusOrder : input.overviewOrder;
  return {
    mode,
    metrics,
    placements: computeViewLayout(keys, area, mode === "overview"
      ? { mode: "overview", gap: metrics.viewGap }
      : { mode: "focus", focused: input.focused, gap: metrics.viewGap })
  };
}

export function applyWorkspaceLayout(input: ApplyWorkspaceLayoutInput): void {
  for (const placement of input.placements) {
    const view = input.views.get(placement.key);
    if (!view) continue;
    view.setBounds(scaleBounds({
      x: placement.bounds.x + 1,
      y: placement.bounds.y + input.metrics.tileHeaderHeight,
      width: Math.max(1, placement.bounds.width - 2),
      height: Math.max(1, placement.bounds.height - input.metrics.tileHeaderHeight - 1)
    }, input.zoom));
    const siteZoom = zoomForSite(
      input.display,
      input.mode,
      placement.key === input.focused
    );
    if (Math.abs(view.webContents.getZoomFactor() - siteZoom) > 0.001) {
      view.webContents.setZoomFactor(siteZoom);
    }
  }
}
