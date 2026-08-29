import type { DesktopCopy } from "../shared/copy";
import type {
  SyncDiagnosticSnapshot,
  SyncDiagnosticStageId,
  SyncDiagnosticStageState
} from "../shared/sync-diagnostics";

interface SyncDiagnosticsPanelProps {
  readonly copy: DesktopCopy;
  readonly snapshot: SyncDiagnosticSnapshot;
  readonly open: boolean;
  readonly busy: boolean;
  readonly canSync: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCopy: () => void;
  readonly onRefresh: () => void;
  readonly onSync: () => void;
}

const STAGE_LABELS: Readonly<Record<SyncDiagnosticStageId, keyof DesktopCopy>> = {
  "oauth-config": "syncStageOauthConfig",
  "browser-auth": "syncStageBrowserAuth",
  "token-exchange": "syncStageTokenExchange",
  "token-storage": "syncStageTokenStorage",
  "drive-access": "syncStageDriveAccess",
  "last-sync": "syncStageLastSync"
};
const STATE_LABELS: Readonly<Record<SyncDiagnosticStageState, keyof DesktopCopy>> = {
  ok: "syncDiagnosticOk",
  checking: "syncDiagnosticChecking",
  warning: "syncDiagnosticWarning",
  failed: "syncDiagnosticFailed",
  unknown: "syncDiagnosticUnknown"
};

export function SyncDiagnosticsPanel(props: SyncDiagnosticsPanelProps): React.JSX.Element {
  return (
    <section className="sync-diagnostics" aria-labelledby="sync-diagnostics-title">
      <div className="sync-diagnostics-heading">
        <div>
          <h2 id="sync-diagnostics-title">{props.copy.syncDiagnosticsTitle}</h2>
          <p>{props.copy.syncDiagnosticsDescription}</p>
        </div>
        <button
          id="sync-diagnostics-toggle"
          type="button"
          aria-controls="sync-diagnostic-stages"
          aria-expanded={props.open}
          onClick={() => props.onOpenChange(!props.open)}
        >{props.open ? props.copy.syncDiagnosticsHide : props.copy.syncDiagnosticsShow}</button>
      </div>
      {props.open ? (
        <div id="sync-diagnostic-stages" tabIndex={-1}>
          <ol className="sync-stage-list">
            {props.snapshot.stages.map((stage) => (
              <li
                id={`sync-stage-${stage.id}`}
                data-diagnostic-stage={stage.id}
                data-stage-state={stage.state}
                tabIndex={-1}
                key={stage.id}
              >
                <i aria-hidden="true" />
                <span><strong>{props.copy[STAGE_LABELS[stage.id]]}</strong>{stage.code ? <code>{stage.code}</code> : null}</span>
                <small>{props.copy[STATE_LABELS[stage.state]]}</small>
              </li>
            ))}
          </ol>
          <div className="sync-diagnostic-actions">
            <button type="button" disabled={props.busy} onClick={props.onCopy}>{props.copy.syncDiagnosticsCopy}</button>
            <button type="button" disabled={props.busy} onClick={props.onRefresh}>{props.copy.checkAgain}</button>
            <button type="button" disabled={props.busy || !props.canSync} onClick={props.onSync}>{props.copy.syncNow}</button>
          </div>
          <p className="sync-diagnostic-privacy">{props.copy.syncDiagnosticsPrivacy}</p>
        </div>
      ) : null}
    </section>
  );
}
