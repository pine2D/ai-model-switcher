import type { DesktopCopy } from "../shared/copy";
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
  if (status.reason === "drive_disabled") return copy.syncReasonDriveDisabled;
  if (status.reason === "quota") return copy.syncReasonQuota;
  if (status.reason === "policy") return copy.syncReasonPolicy;
  if (status.reason === "oauth_not_configured") return copy.syncReasonOauthMissing;
  if (!status.connected && status.state === "idle") return copy.syncStateLocalOnly;
  return byState[status.state];
}

export function syncNeedsAttention(status: SyncStatus): boolean {
  return status.pending > 0 || status.state !== "idle";
}
