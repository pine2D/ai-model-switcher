import type { SyncState } from "../shared/sync";

/** Which step of the connection produced the error; the same code means different things per stage. */
export type FailureStage = "oauth" | "drive" | "sync";

export interface SyncFailure {
  readonly state: SyncState;
  readonly reason?: string;
  readonly diagnostic?: string;
}

/**
 * Maps a thrown error onto the persisted `{state, reason}` pair. Reasons are codes,
 * never user-visible text: the renderer translates them (see shared/sync-copy.ts).
 * Every reason returned here must also be listed in shared/sync-diagnostics.ts
 * SAFE_REASONS and handled by renderer/sync-status.ts describeSync.
 */
export function classifySyncFailure(error: unknown, stage: FailureStage): SyncFailure {
  const code = (error as { code?: string; message?: string }).code ?? (error as { message?: string }).message;
  if (code === "oauth_timeout") return { state: "offline", reason: "oauth_callback_timeout" };
  if (code === "network_timeout") {
    return { state: "offline", reason: stage === "oauth" ? "oauth_network_timeout" : stage === "drive" ? "drive_network_timeout" : "network_timeout" };
  }
  if (code === "network_error" || error instanceof TypeError) {
    return { state: "offline", ...(stage === "oauth" ? { reason: "oauth_network" } : stage === "drive" ? { reason: "drive_network" } : {}) };
  }
  if (code === "token_store_failed") return { state: "error", reason: "token_storage" };
  if (code === "oauth_token_failed" || code === "oauth_invalid_response") return { state: "error", reason: "oauth_response" };
  if (code === "invalid_response" && stage === "drive") return { state: "error", reason: "drive_response" };
  if (code === "oauth_invalid_client" || code === "oauth_redirect_mismatch") return { state: "blocked", reason: code };
  if (code === "oauth_provider_error") {
    const diagnostic = oauthProviderDiagnostic(error);
    return diagnostic ? { state: "auth", reason: code, diagnostic } : { state: "auth", reason: "oauth_rejected" };
  }
  if (code === "oauth_invalid_grant") return { state: "auth", reason: code };
  if (code === "refresh_token_missing") return { state: "auth", reason: "oauth_refresh_missing" };
  if (code === "unauthorized" && stage === "drive") return { state: "auth", reason: "drive_unauthorized" };
  // The loopback handler rejects with these bare codes; they are user-visible cancellations,
  // not internal errors, so they reuse the existing oauth_rejected copy.
  if (code === "oauth_denied" || code === "oauth_state_mismatch" || code === "oauth_code_missing") {
    return { state: "auth", reason: "oauth_rejected" };
  }
  if (code === "unauthorized" || code === "auth_failed") {
    return { state: "auth", ...(stage === "oauth" || stage === "drive" ? { reason: "oauth_rejected" } : {}) };
  }
  if (code === "oauth_not_configured") return { state: "blocked", reason: code };
  if (code === "forbidden") {
    const detail = String((error as { reason?: string }).reason ?? "").toLowerCase();
    return {
      state: "blocked",
      reason: /notconfigured|disabled/.test(detail) ? "drive_disabled" : /quota|limit|rate/.test(detail) ? "quota" : "policy"
    };
  }
  if (code === "rate_limited" || code === "server_error") return { state: "waiting" };
  return { state: "error" };
}

function oauthProviderDiagnostic(error: unknown): string | null {
  const failure = error as { providerCode?: unknown; providerDetail?: unknown };
  if (typeof failure.providerCode !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(failure.providerCode)) return null;
  const detail = typeof failure.providerDetail === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(failure.providerDetail)
    ? ` / ${failure.providerDetail}` : "";
  return `${failure.providerCode}${detail}`;
}
