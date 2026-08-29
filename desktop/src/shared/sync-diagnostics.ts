import type { RuntimeInfo } from "./runtime";
import type { SyncState, SyncStatus } from "./sync";

export type SyncDiagnosticStageId =
  | "oauth-config"
  | "browser-auth"
  | "token-exchange"
  | "token-storage"
  | "drive-access"
  | "last-sync";
export type SyncDiagnosticStageState = "ok" | "checking" | "warning" | "failed" | "unknown";

export interface SyncDiagnosticStage {
  readonly id: SyncDiagnosticStageId;
  readonly state: SyncDiagnosticStageState;
  readonly code?: string;
}

export interface SyncDiagnosticSnapshot {
  readonly schema: 1;
  readonly generatedAt: number;
  readonly appVersion: string;
  readonly distribution: RuntimeInfo["distribution"];
  readonly connected: boolean;
  readonly syncState: SyncState;
  readonly pending: number;
  readonly errorCount: number;
  readonly lastSuccessAt?: number;
  readonly reason?: string;
  readonly diagnostic?: string;
  readonly oauthConfigured: boolean;
  readonly secureTokenStorage: boolean;
  readonly stages: readonly SyncDiagnosticStage[];
}

const STAGE_IDS: readonly SyncDiagnosticStageId[] = [
  "oauth-config", "browser-auth", "token-exchange",
  "token-storage", "drive-access", "last-sync"
];
const SYNC_STATES = new Set<SyncState>([
  "idle", "syncing", "offline", "auth", "blocked", "waiting", "schema", "error"
]);
const SAFE_REASONS = new Set([
  "oauth", "drive_check", "drive_disabled", "quota", "policy", "oauth_not_configured",
  "oauth_callback_timeout", "oauth_network_timeout", "oauth_network", "oauth_invalid_grant",
  "oauth_invalid_client", "oauth_redirect_mismatch", "oauth_refresh_missing",
  "oauth_provider_error", "oauth_rejected", "oauth_response", "token_storage",
  "drive_network_timeout", "drive_network", "drive_response", "drive_unauthorized",
  "network_timeout", "revoke_failed"
]);
const BROWSER_FAILURES = new Set(["oauth_callback_timeout", "oauth_rejected"]);
const TOKEN_FAILURES = new Set([
  "oauth_network_timeout", "oauth_network", "oauth_invalid_grant", "oauth_invalid_client",
  "oauth_redirect_mismatch", "oauth_refresh_missing", "oauth_provider_error", "oauth_response"
]);
const DRIVE_FAILURES = new Set([
  "drive_disabled", "quota", "policy", "drive_network_timeout", "drive_network",
  "drive_response", "drive_unauthorized"
]);
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, 999_999) : 0;
}

function time(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_DATE_TIMESTAMP
    ? value : undefined;
}

function safeReason(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_REASONS.has(value) ? value : undefined;
}

function safeDiagnostic(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}( \/ [a-z][a-z0-9_]{0,63})?$/.test(value)
    ? value : undefined;
}

function stage(id: SyncDiagnosticStageId, state: SyncDiagnosticStageState, code?: string): SyncDiagnosticStage {
  return { id, state, ...(code ? { code } : {}) };
}

function deriveStages(status: SyncStatus): SyncDiagnosticStage[] {
  const stages = new Map<SyncDiagnosticStageId, SyncDiagnosticStage>(
    STAGE_IDS.map((id) => [id, stage(id, "unknown")])
  );
  const set = (id: SyncDiagnosticStageId, state: SyncDiagnosticStageState, code?: string) => {
    stages.set(id, stage(id, state, code));
  };
  if (!status.oauthConfigured) {
    set("oauth-config", "failed", "oauth_not_configured");
    return STAGE_IDS.map((id) => stages.get(id)!);
  }
  set("oauth-config", "ok");
  const storageState = status.secureTokenStorage ? "ok" : "warning";
  const passAuthorization = () => {
    set("browser-auth", "ok");
    set("token-exchange", "ok");
    set("token-storage", storageState, status.secureTokenStorage ? undefined : "memory_only");
  };

  if (status.connected) {
    passAuthorization();
    set("drive-access", "ok");
  }
  const reason = safeReason(status.reason);
  if (reason === "oauth") set("browser-auth", "checking");
  else if (reason === "drive_check") {
    passAuthorization();
    set("drive-access", "checking");
  } else if (reason && BROWSER_FAILURES.has(reason)) {
    set("browser-auth", "failed", reason);
  } else if (reason && TOKEN_FAILURES.has(reason)) {
    set("browser-auth", "ok");
    set("token-exchange", "failed", reason);
  } else if (reason === "token_storage") {
    set("browser-auth", "ok");
    set("token-exchange", "ok");
    set("token-storage", "failed", reason);
  } else if (reason && DRIVE_FAILURES.has(reason)) {
    passAuthorization();
    set("drive-access", "failed", reason);
  }

  if (status.state === "syncing" && reason !== "oauth" && reason !== "drive_check") {
    set("last-sync", "checking");
  } else if (["offline", "auth", "blocked", "error"].includes(status.state) && reason) {
    set("last-sync", "failed", reason);
  } else if (status.state === "waiting" || status.state === "schema") {
    set("last-sync", "warning", status.state);
  } else if (status.lastSuccessAt) {
    set("last-sync", "ok");
  }
  return STAGE_IDS.map((id) => stages.get(id)!);
}

export function createSyncDiagnosticSnapshot(
  status: SyncStatus,
  runtime: RuntimeInfo,
  generatedAt = Date.now()
): SyncDiagnosticSnapshot {
  const syncState = SYNC_STATES.has(status.state) ? status.state : "error";
  const safeStatus: SyncStatus = {
    state: syncState,
    connected: status.connected === true,
    pending: count(status.pending),
    errorCount: count(status.errorCount),
    readOnly: status.readOnly === true,
    oauthConfigured: status.oauthConfigured === true,
    secureTokenStorage: status.secureTokenStorage === true,
    ...(time(status.lastSuccessAt) ? { lastSuccessAt: time(status.lastSuccessAt) } : {}),
    ...(safeReason(status.reason) ? { reason: safeReason(status.reason) } : {}),
    ...(safeDiagnostic(status.diagnostic) ? { diagnostic: safeDiagnostic(status.diagnostic) } : {})
  };
  const version = typeof runtime.version === "string" && /^[0-9A-Za-z.+_-]{1,32}$/.test(runtime.version)
    ? runtime.version : "unknown";
  const distribution = runtime.distribution === "portable" ? "portable" : "installed";
  return {
    schema: 1,
    generatedAt: time(generatedAt) ?? Date.now(),
    appVersion: version,
    distribution,
    connected: safeStatus.connected,
    syncState: safeStatus.state,
    pending: safeStatus.pending,
    errorCount: safeStatus.errorCount,
    ...(safeStatus.lastSuccessAt ? { lastSuccessAt: safeStatus.lastSuccessAt } : {}),
    ...(safeStatus.reason ? { reason: safeStatus.reason } : {}),
    ...(safeStatus.diagnostic ? { diagnostic: safeStatus.diagnostic } : {}),
    oauthConfigured: safeStatus.oauthConfigured,
    secureTokenStorage: safeStatus.secureTokenStorage,
    stages: deriveStages(safeStatus)
  };
}

export function firstFailedSyncStage(snapshot: SyncDiagnosticSnapshot): SyncDiagnosticStage | null {
  return snapshot.stages.find((item) => item.state === "failed") ?? null;
}

export function buildSyncDiagnosticReport(snapshot: SyncDiagnosticSnapshot): string {
  const safe = createSyncDiagnosticSnapshot({
    state: snapshot.syncState,
    connected: snapshot.connected,
    pending: snapshot.pending,
    errorCount: snapshot.errorCount,
    lastSuccessAt: snapshot.lastSuccessAt,
    reason: snapshot.reason,
    diagnostic: snapshot.diagnostic,
    readOnly: false,
    oauthConfigured: snapshot.oauthConfigured,
    secureTokenStorage: snapshot.secureTokenStorage
  }, { version: snapshot.appVersion, distribution: snapshot.distribution }, snapshot.generatedAt);
  const lines = [
    "PolyAsk Drive diagnostics",
    `schema=${safe.schema}`,
    `generated=${new Date(safe.generatedAt).toISOString()}`,
    `app_version=${safe.appVersion}`,
    `distribution=${safe.distribution}`,
    `connection=${safe.connected ? "connected" : "disconnected"}`,
    `sync_state=${safe.syncState}`,
    `pending=${safe.pending}`,
    `error_count=${safe.errorCount}`,
    `last_success=${safe.lastSuccessAt ? new Date(safe.lastSuccessAt).toISOString() : "never"}`,
    ...(safe.reason ? [`reason=${safe.reason}`] : []),
    ...(safe.diagnostic ? [`provider_diagnostic=${safe.diagnostic}`] : []),
    "stages:",
    ...safe.stages.map((item) => `- ${item.id}: ${item.state}${item.code ? ` (${item.code})` : ""}`)
  ];
  return `${lines.join("\n")}\n`;
}
