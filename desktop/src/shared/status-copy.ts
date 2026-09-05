import type { DesktopCopy } from "./copy";
import type { SiteCode, SitePhase, SiteStatus } from "./protocol";

const STATUS_COPY_KEY: Record<SiteCode, keyof DesktopCopy> = {
  tier_unconfirmed: "tierUnconfirmed",
  composer_not_found: "composerNotFound",
  not_ready: "siteNotReady",
  submit_unconfirmed: "submitUnconfirmed",
  timeout: "timedOut",
  cancelled: "cancelledStatus",
  inject_failed: "injectFailed",
  no_view: "siteUnavailable",
  load_failed: "loadFailed",
  renderer_crashed: "crashed",
  image_invalid: "imagePayloadInvalid",
  attachment_unsupported: "attachmentUnsupported",
  attachment_failed: "attachmentFailed",
  attachment_timeout: "attachmentTimedOut",
  attachment_action_required: "attachmentActionRequired",
  invalid_response: "invalidResponse",
  error: "siteError",
  adapter_unavailable: "adapterUnavailable"
};

const PHASE_COPY_KEY: Record<SitePhase, keyof DesktopCopy> = {
  loading: "loading",
  ready: "ready",
  sending: "sending",
  submitted: "submitted",
  generating: "generating",
  complete: "answerComplete",
  warning: "submittedWithWarning",
  cancelled: "cancelledStatus",
  failed: "failed",
  crashed: "crashed"
};

// 不做运行时白名单校验：站点码会随适配器演进，认不得的码按 phase 兜底，宁可笼统也不丢消息。
export function describeStatus(copy: DesktopCopy, status: SiteStatus): string {
  const code = status.code;
  const key = code && Object.hasOwn(STATUS_COPY_KEY, code) ? STATUS_COPY_KEY[code as SiteCode] : PHASE_COPY_KEY[status.phase];
  return copy[key];
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
    // no_window 是扩展端产的码（尚未开窗）；跨端同步的归档条目可能带这个码（F218），
    // 语义与 no_view（视图已销毁/未打开）相通，复用同一条文案。
    case "no_window": return copy.siteUnavailable;
    case "not_ready": return copy.siteNotReady;
    // 回答过长被截断：正常随文本一起返回（archive-service 另行追加提示），只有文本缺席时才走到这里。
    case "answer_truncated": return copy.answerTruncated;
    default: return copy.failed;
  }
}

export function describeSynthesisSendCode(copy: DesktopCopy, code?: string): string {
  switch (code) {
    case "submit_unconfirmed": return copy.submitUnconfirmed;
    case "tier_unconfirmed": return copy.tierUnconfirmed;
    case "composer_not_found": return copy.composerNotFound;
    case "not_ready": return copy.siteNotReady;
    case "timeout": return copy.timedOut;
    case "cancelled": return copy.cancelledStatus;
    case "inject_failed": return copy.injectFailed;
    case "target_not_selected": return copy.synthesisTargetNotSelected;
    default: return copy.synthesisSendFailed;
  }
}

export function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "";
}
