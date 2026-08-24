import { useEffect, useState } from "react";

import type { DesktopCopy } from "../shared/copy";
import { formatCopy } from "../shared/copy";
import { CLEAR_REMOTE_CONFIRMATION, type SyncStatus } from "../shared/sync";
import { CloseIcon } from "./icons";
import { describeSync } from "./sync-status";

interface SettingsWorkspaceProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly status: SyncStatus;
  readonly onStatus: (value: SyncStatus) => void;
  readonly onAnnounce: (value: string) => void;
  readonly onClose: () => void;
}

type SyncAction = () => Promise<SyncStatus>;

export function SettingsWorkspace(props: SettingsWorkspaceProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState("");
  const statusText = describeSync(props.copy, props.status);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) props.onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, props.onClose]);
  const lastSuccess = props.status.lastSuccessAt
    ? formatCopy(props.copy.syncLastSuccess, {
      time: new Intl.DateTimeFormat(props.locale, { dateStyle: "short", timeStyle: "short" })
        .format(props.status.lastSuccessAt)
    })
    : props.copy.syncNever;
  const run = async (action: SyncAction): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await action();
      props.onStatus(next);
      const message = describeSync(props.copy, next);
      setFeedback(message);
      props.onAnnounce(message);
    } catch {
      setFeedback(props.copy.syncActionFailed);
      props.onAnnounce(props.copy.syncActionFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="settings-workspace" aria-busy={busy}>
      <header className="settings-toolbar">
        <strong>{props.copy.settings}</strong>
        <button type="button" title={props.copy.closeArchive} aria-label={props.copy.closeArchive} onClick={props.onClose}><CloseIcon /></button>
      </header>
      <div className="settings-body">
        <section className="settings-card sync-overview" aria-labelledby="sync-title">
          <div>
            <h1 id="sync-title">{props.copy.syncTitle}</h1>
            <p>{props.copy.syncDescription}</p>
          </div>
          <div className="sync-state" data-state={props.status.state} role="status" aria-live="polite">
            <i aria-hidden="true" />
            <strong>{props.status.connected ? props.copy.syncConnected : props.copy.syncDisconnected}</strong>
            <span>{statusText}</span>
          </div>
          <dl className="sync-facts">
            <div><dt>{formatCopy(props.copy.syncPending, { count: props.status.pending })}</dt><dd>{lastSuccess}</dd></div>
          </dl>
          {!props.status.oauthConfigured ? <p className="settings-notice danger" role="alert">{props.copy.syncOauthMissing}</p> : null}
          {props.status.oauthConfigured && !props.status.secureTokenStorage ? <p className="settings-notice warning">{props.copy.syncStorageWarning}</p> : null}
          {props.status.readOnly ? <p className="settings-notice warning">{props.copy.syncReadOnly}</p> : null}
          <div className="settings-actions">
            {!props.status.connected || props.status.state === "auth" ? (
              <button type="button" className="primary" disabled={busy || !props.status.oauthConfigured} onClick={() => void run(() => window.polyask.connectSync())}>{props.copy.syncConnect}</button>
            ) : <button type="button" className="primary" disabled={busy} onClick={() => void run(() => window.polyask.syncNow())}>{props.copy.syncNow}</button>}
            {props.status.connected ? <button type="button" disabled={busy} onClick={() => void run(() => window.polyask.disconnectSync())}>{props.copy.syncDisconnect}</button> : null}
          </div>
          <p className="sync-privacy">{props.copy.syncPrivacy}</p>
        </section>
        <section className="settings-card danger-zone" aria-labelledby="clear-sync-title">
          <h2 id="clear-sync-title">{props.copy.syncClearTitle}</h2>
          <p>{props.copy.syncClearDescription}</p>
          <label>
            <span>{props.copy.syncClearInstruction}</span>
            <input name="clear-cloud-confirmation" value={confirmation} autoComplete="off" spellCheck={false} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          <button
            type="button"
            disabled={busy || !props.status.connected || confirmation !== CLEAR_REMOTE_CONFIRMATION}
            onClick={() => void run(async () => {
              const next = await window.polyask.clearRemoteSync(confirmation);
              setConfirmation("");
              return next;
            })}
          >{props.copy.syncClear}</button>
        </section>
      </div>
      <footer className="archive-status" role="status" aria-live="polite">{feedback || statusText}</footer>
    </main>
  );
}
