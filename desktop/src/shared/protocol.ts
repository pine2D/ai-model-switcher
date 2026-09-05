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

// 只读确认：问站点「这段文字是不是已经作为末条用户消息发出去了」。只有实现了 adapter.submitted() 的站
// （目前仅 Kimi）会答 supported:true；其余站答 supported:false，主进程对它们绝不自动重发。
export interface WasSubmittedSiteCommand {
  readonly source: "AMS";
  readonly cmd: "wasSubmitted";
  readonly text: string;
  readonly deadline: number;
}

export type SiteCommand = SubmitSiteCommand | CollectSiteCommand | DiagnoseSiteCommand | GenerationSiteCommand | WasSubmittedSiteCommand;

export interface SiteSubmittedResponse {
  readonly supported: boolean;
  readonly ok: boolean;
}

// fail-closed：任何非预期形状（非对象 / 缺 supported / ok 不是 boolean）都当作「站点不支持只读确认」，
// 绝不能落到「支持且未提交」——那是唯一会触发自动重发的组合。也不能走 normalizeResult：它只保留 {ok, code}，
// supported 会被静默丢掉，「没实现 submitted()」与「实现了且确认未提交」会塌成同一个 {ok:false}。
export function normalizeSubmitted(value: unknown): SiteSubmittedResponse {
  if (!value || typeof value !== "object") return { supported: false, ok: false };
  const candidate = value as Record<string, unknown>;
  if (candidate.supported !== true || typeof candidate.ok !== "boolean") return { supported: false, ok: false };
  return { supported: true, ok: candidate.ok };
}

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

export type SiteCommandResponse = SiteResult | SiteCollectionResult | SiteDiagnosticResponse | SiteGenerationResponse | SiteSubmittedResponse;

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

// 站点状态通道（SiteResult.code → SiteStatus.code）会出现的全部码。字段类型仍是 string——适配器是 JS，
// 类型收不了口；但 describeStatus 用 Record<SiteCode, …> 查表，这里加一条码而没配文案，typecheck 阶段就红。
// 反向（源码产出的码必须在这里）由 test/status-copy-coverage.test.ts 守着。
export const SITE_CODES = [
  "tier_unconfirmed",
  "composer_not_found",
  "not_ready",
  "submit_unconfirmed",
  "timeout",
  "cancelled",
  "inject_failed",
  "no_view",
  "load_failed",
  "renderer_crashed",
  "image_invalid",
  "attachment_unsupported",
  "attachment_failed",
  "attachment_timeout",
  "attachment_action_required",
  "invalid_response",
  "error",
  "adapter_unavailable"
] as const;
export type SiteCode = (typeof SITE_CODES)[number];

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
