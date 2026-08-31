import { useEffect, useState } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import type { PendingSynthesis, SynthesisCandidate } from "../shared/synthesis";
import { formatDateTime } from "../shared/format";
import { ArchiveDetail } from "./archive-detail";
import { deleteConfirmationRemaining, deleteIntent, type ArmedArchiveDelete } from "./archive-delete";
import {
  ArchiveIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  StarIcon,
  TrashIcon
} from "./icons";

interface ArchiveWorkspaceProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly items: readonly ArchiveRecord[];
  readonly selected: ArchiveRecord | null;
  readonly tags: readonly string[];
  readonly query: string;
  readonly favoriteOnly: boolean;
  readonly selectedTag: string;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly status: string;
  readonly onClose: () => void;
  readonly onQueryChange: (value: string) => void;
  readonly onFavoriteFilterChange: (value: boolean) => void;
  readonly onTagChange: (value: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onCapture: () => void;
  readonly onCopy: () => void;
  readonly onExport: () => void;
  readonly onDelete: (id: string) => void;
  readonly onPatch: (patch: ArchivePatch) => void;
  readonly onOpenSource: (url: string) => void;
  readonly pendingSynthesis: PendingSynthesis | null;
  readonly synthesisCandidate: SynthesisCandidate | null;
  readonly detailOverride?: React.ReactNode;
  readonly onSynthesize: () => void;
  readonly onCollectSynthesis: () => void;
  readonly onSaveSynthesis: (replaceExisting: boolean) => void;
}

export function ArchiveWorkspace(props: ArchiveWorkspaceProps): React.JSX.Element {
  const { copy, selected } = props;
  const emptyText = props.query || props.favoriteOnly || props.selectedTag
    ? copy.archiveNoMatches
    : copy.archiveEmpty;
  const [armed, setArmed] = useState<ArmedArchiveDelete | null>(null);
  useEffect(() => setArmed(null), [selected?.id]);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = window.setTimeout(() => {
      setArmed((current) => current === armed ? null : current);
    }, deleteConfirmationRemaining(armed, Date.now()));
    return () => window.clearTimeout(timer);
  }, [armed]);
  const requestDelete = () => {
    if (!selected) return;
    const intent = deleteIntent(armed, selected.id, Date.now());
    setArmed(intent.armed);
    if (intent.action === "delete") props.onDelete(selected.id);
  };
  return (
    <section className="archive-workspace" aria-label={copy.archiveTitle} aria-busy={props.busy}>
      <header className="archive-toolbar">
        <strong><ArchiveIcon />{copy.archiveTitle}</strong>
        <div className="archive-filters">
          <input type="search" name="archive-search" autoComplete="off" value={props.query} placeholder={copy.archiveSearch} aria-label={copy.archiveSearch} disabled={props.busy} onChange={(event) => props.onQueryChange(event.target.value)} />
          <button type="button" className={props.favoriteOnly ? "active" : ""} title={copy.favoriteArchives} aria-label={copy.favoriteArchives} aria-pressed={props.favoriteOnly} disabled={props.busy} onClick={() => props.onFavoriteFilterChange(!props.favoriteOnly)}><StarIcon /></button>
          <select name="archive-tag-filter" value={props.selectedTag} aria-label={copy.archiveTags} disabled={props.busy} onChange={(event) => props.onTagChange(event.target.value)}>
            <option value="">{copy.allArchiveTags}</option>
            {props.tags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}
          </select>
        </div>
        <div className="archive-actions">
          <button type="button" title={copy.captureArchive} aria-label={copy.captureArchive} disabled={props.busy} onClick={props.onCapture}><ArchiveIcon /></button>
          <button type="button" title={copy.copyArchive} aria-label={copy.copyArchive} disabled={!selected || props.busy} onClick={props.onCopy}><CopyIcon /></button>
          <button type="button" title={copy.exportArchive} aria-label={copy.exportArchive} disabled={!selected || props.busy} onClick={props.onExport}><DownloadIcon /></button>
          <button type="button" className={armed?.id === selected?.id ? "danger" : ""} title={armed?.id === selected?.id ? copy.confirmDeleteArchive : copy.deleteArchive} aria-label={armed?.id === selected?.id ? copy.confirmDeleteArchive : copy.deleteArchive} disabled={!selected || props.busy} onClick={requestDelete}><TrashIcon /></button>
          <button type="button" title={copy.closeArchive} aria-label={copy.closeArchive} disabled={props.busy} onClick={props.onClose}><CloseIcon /></button>
        </div>
      </header>
      <div className="archive-body">
        <aside className="archive-list" aria-label={copy.archiveTitle}>
          {props.loading || !props.items.length ? (
            <div className="archive-empty" role="status">
              {props.loading ? copy.archiveLoading : emptyText}
            </div>
          ) : (
            props.items.map((record) => (
              <button type="button" key={record.id} aria-current={record.id === selected?.id ? "true" : undefined} disabled={props.busy} onClick={() => props.onSelect(record.id)}>
                <time dateTime={new Date(record.ts).toISOString()}>{formatDateTime(record.ts, props.locale)}</time>
                <span>{record.task || record.preview || "—"}</span>
                <small>{record.results.map((result) => result.label).join(" · ")}</small>
                {record.favorite || record.tags.length ? <span className="archive-badges">{record.favorite ? <StarIcon /> : null}{record.tags.map((tag) => <i key={tag}>{tag}</i>)}</span> : null}
              </button>
            ))
          )}
        </aside>
        <main className="archive-detail-pane">
          {props.detailOverride ?? (selected ? <ArchiveDetail copy={copy} locale={props.locale} record={selected} onPatch={props.onPatch} onOpenSource={props.onOpenSource} pendingSynthesis={props.pendingSynthesis} synthesisCandidate={props.synthesisCandidate} busy={props.busy} onSynthesize={props.onSynthesize} onCollectSynthesis={props.onCollectSynthesis} onSaveSynthesis={props.onSaveSynthesis} /> : null)}
        </main>
      </div>
      <div className="archive-status" role="status" aria-live="polite">{props.status}</div>
    </section>
  );
}
