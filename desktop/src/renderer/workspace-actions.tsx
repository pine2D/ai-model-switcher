import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SyncStatus } from "../shared/sync";
import { MoreIcon } from "./icons";
import { describeSync, syncNeedsAttention } from "./sync-status";

interface WorkspaceActionsProps {
  readonly copy: DesktopCopy;
  readonly disabled: boolean;
  readonly failureCount: number;
  readonly cancelledCount: number;
  readonly synthesisPending: boolean;
  readonly syncStatus: SyncStatus;
  readonly onOpenMore: () => void;
}

// F166：attentionCount 此前只落进 data-attention-count（视觉），没有任何一条路径读它——可访问名和
// 悬停提示对失败/已取消站点的堆积始终静默。这里把重试相关的计数并回 aria-label/title，且按
// failureCount/cancelledCount 的组合选择更贴切的三选一文案，而不是笼统的「更多操作」。
export function WorkspaceActions(props: WorkspaceActionsProps): React.JSX.Element {
  const syncAttention = syncNeedsAttention(props.syncStatus);
  const retryCount = props.failureCount + props.cancelledCount;
  const attentionCount = retryCount + (props.synthesisPending ? 1 : 0) + (syncAttention ? 1 : 0);
  const retryLabel = !retryCount ? null
    : props.failureCount && props.cancelledCount ? formatCopy(props.copy.retryFailedOrCancelledSites, { count: retryCount })
    : props.cancelledCount ? formatCopy(props.copy.retryCancelledSites, { count: retryCount })
    : formatCopy(props.copy.retryFailedSites, { count: retryCount });
  const label = syncAttention
    ? `${props.copy.moreActions}: ${describeSync(props.copy, props.syncStatus)}`
    : retryLabel
    ? `${props.copy.moreActions}: ${retryLabel}`
    : props.copy.moreActions;
  return (
    <div className="workspace-actions priority-p0">
      <button
        type="button"
        className={syncAttention ? `more-trigger sync-attention sync-${props.syncStatus.state}` : "more-trigger"}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        data-attention-count={attentionCount || undefined}
        data-sync-state={syncAttention ? props.syncStatus.state : undefined}
        disabled={props.disabled}
        onClick={props.onOpenMore}
      ><MoreIcon /></button>
    </div>
  );
}
