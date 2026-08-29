import type { SiteKey } from "../shared/contracts";
import type { SiteResult, SiteStatus } from "../shared/protocol";

export function statusForResult(site: SiteKey, result: SiteResult): SiteStatus {
  if (!result.ok && result.code === "cancelled") {
    return { site, phase: "cancelled", code: "cancelled" };
  }
  if (!result.ok) {
    return { site, phase: "failed", ...(result.code ? { code: result.code } : {}) };
  }
  if (result.code) return { site, phase: "warning", code: result.code };
  return { site, phase: "submitted" };
}

export function effectiveStatus(
  runStatus: SiteStatus | undefined,
  pageStatus: SiteStatus
): SiteStatus {
  if (pageStatus.phase === "failed" || pageStatus.phase === "crashed") return pageStatus;
  return runStatus ?? pageStatus;
}

export function statusWithUnread(status: SiteStatus, visible: boolean): SiteStatus {
  const terminal = status.phase === "complete" || status.phase === "failed" || status.phase === "crashed";
  return terminal ? { ...status, unread: !visible } : status;
}

export function markStatusRead(status: SiteStatus): SiteStatus {
  return status.unread ? { ...status, unread: false } : status;
}
