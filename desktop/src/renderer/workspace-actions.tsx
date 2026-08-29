import type { DesktopCopy } from "../shared/copy";
import type { SyncStatus } from "../shared/sync";
import { MoreIcon } from "./icons";
import { describeSync, syncNeedsAttention } from "./sync-status";

interface WorkspaceActionsProps {
  readonly copy: DesktopCopy;
  readonly disabled: boolean;
  readonly retryCount: number;
  readonly synthesisPending: boolean;
  readonly syncStatus: SyncStatus;
  readonly onOpenMore: () => void;
}

export function WorkspaceActions(props: WorkspaceActionsProps): React.JSX.Element {
  const syncAttention = syncNeedsAttention(props.syncStatus);
  const attentionCount = props.retryCount + (props.synthesisPending ? 1 : 0) + (syncAttention ? 1 : 0);
  const label = syncAttention
    ? `${props.copy.moreActions}: ${describeSync(props.copy, props.syncStatus)}`
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
