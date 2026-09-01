import {
  SITE_KEYS,
  type SiteDefinition,
  type SiteKey,
  type ViewPlacement
} from "./contracts";
import type { DisplayPreferences } from "./display";
import { validateImages, type DesktopImage } from "./images";
import type { PendingSynthesis } from "./synthesis";
import type { PromptLibraryState } from "./prompt-library";
import type { RuntimeInfo } from "./runtime";
import type { SyncStatus } from "./sync";
import type { SiteDiagnosticCheck } from "./site-health";
import type { WorkspaceState } from "./workspace";

export type Tier = "think" | "fast" | null;
export type DesktopSurface = "sites" | "archive" | "settings" | "commands";

// 应用菜单里一条带加速器的项。速查面板靠它把菜单里 role 项（重新加载/缩放/全屏/复制…）
// 的快捷键也列全——那些加速器由 Electron 给，不在 COMMANDS 表里。
export interface MenuShortcut {
  readonly group: string;
  readonly label: string;
  readonly accelerator: string;
}

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

export interface DiagnoseSiteCommand {
  readonly source: "AMS";
  readonly cmd: "diagnose";
  readonly deadline: number;
}

export type GenerationState = "idle" | "generating" | "complete" | null;

export interface GenerationSiteCommand {
  readonly source: "AMS";
  readonly cmd: "generation";
  readonly runId: string;
  readonly deadline: number;
}

export type SiteCommand = SubmitSiteCommand | CollectSiteCommand | DiagnoseSiteCommand | GenerationSiteCommand;

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

export interface SiteDiagnosticResponse {
  readonly checks?: readonly SiteDiagnosticCheck[];
  readonly code?: string;
}

export interface SiteGenerationResponse {
  readonly state: GenerationState;
}

export interface CollectedAnswer {
  readonly site: SiteKey;
  readonly host: string;
  readonly label: string;
  readonly text: string | null;
  readonly state?: string;
  readonly code?: string;
}

export type SiteCommandResponse = SiteResult | SiteCollectionResult | SiteDiagnosticResponse | SiteGenerationResponse;

export interface CollectionRequest {
  readonly sites: readonly SiteKey[];
  readonly runId: string | null;
}

export type SitePhase =
  | "loading"
  | "ready"
  | "sending"
  | "submitted"
  | "generating"
  | "complete"
  | "warning"
  | "cancelled"
  | "failed"
  | "crashed";

export interface SiteStatus {
  readonly site: SiteKey;
  readonly phase: SitePhase;
  readonly code?: string;
  readonly unread?: boolean;
}

// 某个站点视图此刻能否后退/前进。群发或生成进行中一律 false——动历史会把正在写的回答一起丢掉。
export interface SiteHistoryState {
  readonly back: boolean;
  readonly forward: boolean;
}

export interface LayoutState {
  readonly mode: "overview" | "focus";
  readonly focused: SiteKey;
  readonly page: number;
  readonly pageCount: number;
  readonly placements: readonly ViewPlacement[];
}

export interface BootstrapState {
  readonly runtime: RuntimeInfo;
  readonly sites: readonly SiteDefinition[];
  readonly statuses: readonly SiteStatus[];
  readonly layout: LayoutState;
  readonly display: DisplayPreferences;
  readonly workspace: WorkspaceState;
  readonly promptLibrary: PromptLibraryState;
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

export function parseGenerationState(value: unknown): GenerationState {
  return value === "idle" || value === "generating" || value === "complete" ? value : null;
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
