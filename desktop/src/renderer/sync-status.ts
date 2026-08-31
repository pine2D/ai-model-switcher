import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SyncStatus } from "../shared/sync";

export function describeSync(copy: DesktopCopy, status: SyncStatus): string {
  const byState: Record<SyncStatus["state"], string> = {
    idle: copy.syncStateIdle,
    syncing: copy.syncStateSyncing,
    offline: copy.syncStateOffline,
    auth: copy.syncStateAuth,
    blocked: copy.syncStateBlocked,
    waiting: copy.syncStateWaiting,
    schema: copy.syncStateSchema,
    error: copy.syncStateError
  };
  if (status.reason === "oauth") return copy.syncStateAuthorizing;
  if (status.reason === "drive_check") return copy.syncStateConnecting;
  if (status.reason === "drive_disabled") return copy.syncReasonDriveDisabled;
  if (status.reason === "quota") return copy.syncReasonQuota;
  if (status.reason === "policy") return copy.syncReasonPolicy;
  if (status.reason === "oauth_not_configured") return copy.syncReasonOauthMissing;
  if (status.reason === "oauth_callback_timeout") return copy.syncReasonOauthCallbackTimeout;
  if (status.reason === "oauth_network_timeout") return copy.syncReasonOauthNetworkTimeout;
  if (status.reason === "oauth_network") return copy.syncReasonOauthNetwork;
  if (status.reason === "oauth_invalid_grant") return copy.syncReasonOauthInvalidGrant;
  if (status.reason === "oauth_invalid_client") return copy.syncReasonOauthInvalidClient;
  if (status.reason === "oauth_redirect_mismatch") return copy.syncReasonOauthRedirectMismatch;
  if (status.reason === "oauth_refresh_missing") return copy.syncReasonOauthRefreshMissing;
  if (status.reason === "oauth_provider_error" && status.diagnostic) {
    return formatCopy(copy.syncReasonOauthProvider, { code: status.diagnostic });
  }
  if (status.reason === "oauth_rejected") return copy.syncReasonOauthRejected;
  if (status.reason === "oauth_response") return copy.syncReasonOauthResponse;
  if (status.reason === "token_storage") return copy.syncReasonTokenStorage;
  if (status.reason === "drive_network_timeout") return copy.syncReasonDriveNetworkTimeout;
  if (status.reason === "drive_network") return copy.syncReasonDriveNetwork;
  if (status.reason === "drive_response") return copy.syncReasonDriveResponse;
  if (status.reason === "drive_unauthorized") return copy.syncReasonDriveUnauthorized;
  if (status.reason === "network_timeout") return copy.syncReasonTimeout;
  if (status.reason === "clear_pending") return copy.syncReasonClearPending;
  if (status.reason === "revoke_failed") return copy.syncReasonRevokeFailed;
  if (!status.connected && status.state === "idle") return copy.syncStateLocalOnly;
  return byState[status.state];
}

export function syncNeedsAttention(status: SyncStatus): boolean {
  return status.pending > 0 || status.state !== "idle";
}
