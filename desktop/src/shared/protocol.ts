import {
  SITE_KEYS,
  type SiteDefinition,
  type SiteKey,
  type ViewPlacement
} from "./contracts";
import type { DisplayPreferences } from "./display";
import { validateImages, type DesktopImage } from "./images";
import type { WorkspaceState } from "./workspace";

export type Tier = "think" | "fast" | null;

export interface BroadcastRequest {
  readonly text: string;
  readonly tier: Tier;
  readonly sites: readonly SiteKey[];
  readonly images: readonly DesktopImage[];
}

export interface SiteCommand {
  readonly source: "AMS";
  readonly cmd: "submitPrompt";
  readonly text: string;
  readonly tier: Tier;
  readonly deadline: number;
  readonly images: readonly DesktopImage[];
}

export interface SiteResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly reason?: string;
}

export interface SiteRunResult extends SiteResult {
  readonly site: SiteKey;
}

export type SitePhase =
  | "loading"
  | "ready"
  | "sending"
  | "submitted"
  | "warning"
  | "cancelled"
  | "failed"
  | "crashed";

export interface SiteStatus {
  readonly site: SiteKey;
  readonly phase: SitePhase;
  readonly code?: string;
}

export interface LayoutState {
  readonly mode: "overview" | "focus";
  readonly focused: SiteKey;
  readonly placements: readonly ViewPlacement[];
}

export interface BootstrapState {
  readonly sites: readonly SiteDefinition[];
  readonly statuses: readonly SiteStatus[];
  readonly layout: LayoutState;
  readonly display: DisplayPreferences;
  readonly workspace: WorkspaceState;
}

export interface SiteCommandEnvelope {
  readonly requestId: string;
  readonly command: SiteCommand;
}

export interface SiteResponseEnvelope {
  readonly requestId: string;
  readonly result: SiteResult;
}

const KNOWN_SITES = new Set<string>(SITE_KEYS);

export function parseBroadcastRequest(value: unknown): BroadcastRequest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  if (!text || text.length > 100_000) return null;
  const tier = candidate.tier == null ? null : candidate.tier;
  if (tier !== null && tier !== "think" && tier !== "fast") return null;
  if (!Array.isArray(candidate.sites) || candidate.sites.length === 0) return null;
  if (!candidate.sites.every((site) => typeof site === "string" && KNOWN_SITES.has(site))) return null;
  if (new Set(candidate.sites).size !== candidate.sites.length) return null;
  const images = validateImages(candidate.images);
  if (!images) return null;

  return { text, tier, sites: candidate.sites as SiteKey[], images };
}
