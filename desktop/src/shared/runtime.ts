export type DesktopDistribution = "installed" | "portable";

export interface RuntimeInfo {
  readonly version: string;
  readonly distribution: DesktopDistribution;
}
