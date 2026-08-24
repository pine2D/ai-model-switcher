export type Density = "compact" | "comfortable";
export type SiteScale = 0.9 | 1;

export interface DisplayPreferences {
  readonly density: Density;
  readonly siteScale: SiteScale;
}

export interface DisplayMetrics {
  readonly shellHeight: number;
  readonly tileHeaderHeight: number;
  readonly edgeGap: number;
  readonly viewGap: number;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  density: "compact",
  siteScale: 0.9
};

export function parseDisplayPreferences(value: unknown): DisplayPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.density !== "compact" && candidate.density !== "comfortable") return null;
  if (candidate.siteScale !== 0.9 && candidate.siteScale !== 1) return null;
  return { density: candidate.density, siteScale: candidate.siteScale };
}

export function metricsForDensity(density: Density): DisplayMetrics {
  return density === "compact"
    ? { shellHeight: 52, tileHeaderHeight: 24, edgeGap: 4, viewGap: 4 }
    : { shellHeight: 64, tileHeaderHeight: 32, edgeGap: 8, viewGap: 8 };
}

export function shellHeightForComposer(density: Density, expanded: boolean): number {
  if (expanded) return density === "compact" ? 120 : 144;
  return metricsForDensity(density).shellHeight;
}

export function zoomForSite(
  preferences: DisplayPreferences,
  mode: "overview" | "focus",
  isFocused: boolean
): SiteScale {
  if (preferences.siteScale === 1 || (mode === "focus" && isFocused)) return 1;
  return 0.9;
}
