import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SyncStatus } from "../shared/sync";
import { ArchiveIcon, CopyIcon, NewSessionIcon, ReloadIcon, ScopeIcon, SettingsIcon, SparklesIcon } from "./icons";
import { describeSync, syncNeedsAttention } from "./sync-status";

interface WorkspaceActionsProps {
  readonly copy: DesktopCopy;
  readonly selectedCount: number;
  readonly totalSites: number;
  readonly activeCount: number;
  readonly failureCount: number;
  readonly cancelledCount: number;
  readonly drawerOpen: boolean;
  readonly disabled: boolean;
  readonly synthesisPending: boolean;
  readonly syncStatus: SyncStatus;
  readonly onToggleDrawer: () => void;
  readonly onNewSession: () => void;
  readonly onRetryFailed: () => void;
  readonly onCollectAnswers: () => void;
  readonly onOpenArchive: () => void;
  readonly onCollectSynthesis: () => void;
  readonly onOpenSettings: () => void;
}

export function WorkspaceActions(props: WorkspaceActionsProps): React.JSX.Element {
  const retryCount = props.failureCount + props.cancelledCount;
  const resultTemplate = props.failureCount > 0 && props.cancelledCount > 0
    ? props.copy.mixedFailureSummary
    : props.failureCount > 0
      ? props.copy.failedSummary
      : props.cancelledCount > 0
        ? props.copy.cancelledSummary
        : props.copy.selectedSummary;
  const summaryTemplate = props.activeCount > 0
    ? props.copy.sendingSummary
    : resultTemplate;
  const summary = formatCopy(
    summaryTemplate,
    {
      count: props.activeCount > 0 ? props.activeCount : retryCount,
      failed: props.failureCount,
      cancelled: props.cancelledCount,
      selected: props.selectedCount,
      total: props.totalSites || 9
    }
  );
  const retryTemplate = props.failureCount > 0 && props.cancelledCount > 0
    ? props.copy.retryFailedOrCancelledSites
    : props.cancelledCount > 0
      ? props.copy.retryCancelledSites
      : props.copy.retryFailedSites;
  const retryLabel = formatCopy(retryTemplate, { count: retryCount });
  const syncAttention = syncNeedsAttention(props.syncStatus);
  const settingsLabel = syncAttention
    ? `${props.copy.settings}: ${describeSync(props.copy, props.syncStatus)}`
    : props.copy.settings;
  return (
    <div className="workspace-actions priority-p0">
      <button
        type="button"
        className={props.drawerOpen ? "active" : ""}
        title={props.copy.scope}
        aria-label={props.copy.scope}
        aria-expanded={props.drawerOpen}
        aria-controls="workspace-drawer"
        onClick={props.onToggleDrawer}
      >
        <ScopeIcon /><span>{props.selectedCount}/{props.totalSites || 9}</span>
      </button>
      <button
        type="button"
        title={props.copy.newSessionSelected}
        aria-label={props.copy.newSessionSelected}
        disabled={props.disabled || props.selectedCount === 0}
        onClick={props.onNewSession}
      ><NewSessionIcon /></button>
      {retryCount > 0 ? (
        <button type="button" title={retryLabel} aria-label={retryLabel} disabled={props.disabled} onClick={props.onRetryFailed}><ReloadIcon /></button>
      ) : null}
      <button type="button" title={props.copy.collectAnswers} aria-label={props.copy.collectAnswers} disabled={props.disabled || props.selectedCount === 0} onClick={props.onCollectAnswers}><CopyIcon /></button>
      <button type="button" title={props.copy.openArchive} aria-label={props.copy.openArchive} disabled={props.disabled} onClick={props.onOpenArchive}><ArchiveIcon /></button>
      {props.synthesisPending ? <button type="button" className="active" title={props.copy.synthesisCollect} aria-label={props.copy.synthesisCollect} disabled={props.disabled} onClick={props.onCollectSynthesis}><SparklesIcon /></button> : null}
      <button
        type="button"
        className={syncAttention ? `sync-attention sync-${props.syncStatus.state}` : undefined}
        title={settingsLabel}
        aria-label={settingsLabel}
        data-sync-state={syncAttention ? props.syncStatus.state : undefined}
        disabled={props.disabled}
        onClick={props.onOpenSettings}
      ><SettingsIcon /></button>
      <span className="summary priority-p1" role="status" aria-live="polite">{summary}</span>
    </div>
  );
}
