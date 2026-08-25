import type { DesktopCopy } from "./copy";
import type { SiteStatus } from "./protocol";

export function describeStatus(copy: DesktopCopy, status: SiteStatus): string {
  switch (status.code) {
    case "tier_unconfirmed": return copy.tierUnconfirmed;
    case "composer_not_found": return copy.composerNotFound;
    case "not_ready": return copy.siteNotReady;
    case "submit_unconfirmed": return copy.submitUnconfirmed;
    case "timeout": return copy.timedOut;
    case "cancelled": return copy.cancelledStatus;
    case "inject_failed": return copy.injectFailed;
    case "no_view": return copy.siteUnavailable;
    case "load_failed": return copy.loadFailed;
    case "renderer_crashed": return copy.crashed;
    case "image_invalid": return copy.imagePayloadInvalid;
    case "attachment_unsupported": return copy.attachmentUnsupported;
    case "attachment_failed": return copy.attachmentFailed;
    case "attachment_timeout": return copy.attachmentTimedOut;
    case "attachment_action_required": return copy.attachmentActionRequired;
  }
  switch (status.phase) {
    case "loading": return copy.loading;
    case "ready": return copy.ready;
    case "sending": return copy.sending;
    case "submitted": return copy.submitted;
    case "warning": return copy.submittedWithWarning;
    case "cancelled": return copy.cancelledStatus;
    case "failed": return copy.failed;
    case "crashed": return copy.crashed;
  }
}

export function visibleStatus(copy: DesktopCopy, status: SiteStatus): string | null {
  switch (status.phase) {
    case "warning":
    case "failed": return describeStatus(copy, status);
    case "crashed": return copy.crashed;
    default: return null;
  }
}

export function describeCollectionCode(copy: DesktopCopy, code?: string): string {
  switch (code) {
    case "no_answer": return copy.noAnswer;
    case "no_view": return copy.siteUnavailable;
    case "not_ready": return copy.siteNotReady;
    default: return copy.failed;
  }
}
