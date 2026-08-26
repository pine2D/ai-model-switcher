import {
  SITE_KEYS,
  type SiteDefinition,
  type SiteKey,
  type ViewPlacement
} from "./contracts";
import type { DisplayPreferences } from "./display";
import { validateImages, type DesktopImage } from "./images";
import type { PendingSynthesis } from "./synthesis";
import type { SyncStatus } from "./sync";
import type { WorkspaceState } from "./workspace";

export type Tier = "think" | "fast" | null;
export type DesktopSurface = "sites" | "archive" | "settings";

export interface BroadcastPayload {
  readonly text: string;
  readonly tier: Tier;
  readonly sites: readonly SiteKey[];
  readonly images: readonly DesktopImage[];
}

export interface BroadcastRequest extends BroadcastPayload {
  readonly runId: string;
}

export interface NewSessionSiteResult {
  readonly site: SiteKey;
  readonly ok: boolean;
  readonly code?: "not_ready";
}

export interface SubmitSiteCommand {
  readonly source: "AMS";
  readonly cmd: "submitPrompt";
  readonly text: string;
  readonly tier: Tier;
  readonly deadline: number;
  readonly images: readonly DesktopImage[];
}

export interface CollectSiteCommand {
  readonly source: "AMS";
  readonly cmd: "collect";
  readonly deadline: number;
}

export type SiteCommand = SubmitSiteCommand | CollectSiteCommand;

export interface SiteResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly reason?: string;
}

export interface SiteRunResult extends SiteResult {
  readonly site: SiteKey;
}

export interface SiteCollectionResult {
  readonly text?: string;
  readonly state?: string;
  readonly code?: string;
}

export interface CollectedAnswer {
  readonly site: SiteKey;
  readonly host: string;
  readonly label: string;
  readonly text: string | null;
  readonly state?: string;
  readonly code?: string;
}

export type SiteCommandResponse = SiteResult | SiteCollectionResult;

export interface CollectionRequest {
  readonly sites: readonly SiteKey[];
  readonly runId: string | null;
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
  readonly page: number;
  readonly pageCount: number;
  readonly placements: readonly ViewPlacement[];
}

export interface BootstrapState {
  readonly sites: readonly SiteDefinition[];
  readonly statuses: readonly SiteStatus[];
  readonly layout: LayoutState;
  readonly display: DisplayPreferences;
  readonly workspace: WorkspaceState;
  readonly pendingSynthesis: PendingSynthesis | null;
  readonly sync: SyncStatus;
}

export interface SiteCommandEnvelope {
  readonly requestId: string;
  readonly command: SiteCommand;
}

export interface SiteResponseEnvelope {
  readonly requestId: string;
  readonly result: SiteCommandResponse;
}

const KNOWN_SITES = new Set<string>(SITE_KEYS);

function boundedId(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= 128;
}

export function parsePageIndex(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < 10_000
    ? Number(value)
    : null;
}

export function parseBroadcastRequest(value: unknown): BroadcastRequest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!boundedId(candidate.runId)) return null;
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  if (!text || text.length > 100_000) return null;
  const tier = candidate.tier == null ? null : candidate.tier;
  if (tier !== null && tier !== "think" && tier !== "fast") return null;
  if (!Array.isArray(candidate.sites) || candidate.sites.length === 0) return null;
  if (!candidate.sites.every((site) => typeof site === "string" && KNOWN_SITES.has(site))) return null;
  if (new Set(candidate.sites).size !== candidate.sites.length) return null;
  const images = validateImages(candidate.images);
  if (!images) return null;

  return { runId: candidate.runId, text, tier, sites: candidate.sites as SiteKey[], images };
}

export function parseCollectionRequest(value: unknown): CollectionRequest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.sites) || candidate.sites.length === 0) return null;
  if (!candidate.sites.every((site) => typeof site === "string" && KNOWN_SITES.has(site))) return null;
  if (new Set(candidate.sites).size !== candidate.sites.length) return null;
  const runId = candidate.runId == null ? null : candidate.runId;
  if (runId !== null && !boundedId(runId)) return null;
  return { sites: candidate.sites as SiteKey[], runId };
}
