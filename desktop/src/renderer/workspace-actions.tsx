import { formatCopy, type DesktopCopy } from "../shared/copy";
import { ArchiveIcon, CopyIcon, NewSessionIcon, ScopeIcon } from "./icons";

interface WorkspaceActionsProps {
  readonly copy: DesktopCopy;
  readonly selectedCount: number;
  readonly totalSites: number;
  readonly activeCount: number;
  readonly drawerOpen: boolean;
  readonly disabled: boolean;
  readonly onToggleDrawer: () => void;
  readonly onNewSession: () => void;
  readonly onCollectAnswers: () => void;
  readonly onOpenArchive: () => void;
}

export function WorkspaceActions(props: WorkspaceActionsProps): React.JSX.Element {
  const summary = formatCopy(
    props.activeCount > 0 ? props.copy.sendingSummary : props.copy.selectedSummary,
    { count: props.activeCount, selected: props.selectedCount, total: props.totalSites || 9 }
  );
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
      <button type="button" title={props.copy.collectAnswers} aria-label={props.copy.collectAnswers} disabled={props.disabled || props.selectedCount === 0} onClick={props.onCollectAnswers}><CopyIcon /></button>
      <button type="button" title={props.copy.openArchive} aria-label={props.copy.openArchive} disabled={props.disabled} onClick={props.onOpenArchive}><ArchiveIcon /></button>
      <span className="summary priority-p1" role="status" aria-live="polite">{summary}</span>
    </div>
  );
}
