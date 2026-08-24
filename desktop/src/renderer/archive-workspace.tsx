import { useEffect, useState } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import { ArchiveDetail } from "./archive-detail";
import { deleteIntent, type ArmedArchiveDelete } from "./archive-delete";
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
}

export function ArchiveWorkspace(props: ArchiveWorkspaceProps): React.JSX.Element {
  const { copy, selected } = props;
  const [armed, setArmed] = useState<ArmedArchiveDelete | null>(null);
  useEffect(() => setArmed(null), [selected?.id]);
  const requestDelete = () => {
    if (!selected) return;
    const intent = deleteIntent(armed, selected.id, Date.now());
    setArmed(intent.armed);
    if (intent.action === "delete") props.onDelete(selected.id);
  };
  return (
    <section className="archive-workspace" aria-label={copy.archiveTitle}>
      <header className="archive-toolbar">
        <strong><ArchiveIcon />{copy.archiveTitle}</strong>
        <div className="archive-filters">
          <input type="search" value={props.query} placeholder={copy.archiveSearch} aria-label={copy.archiveSearch} onChange={(event) => props.onQueryChange(event.target.value)} />
          <button type="button" className={props.favoriteOnly ? "active" : ""} title={copy.favoriteArchives} aria-label={copy.favoriteArchives} aria-pressed={props.favoriteOnly} onClick={() => props.onFavoriteFilterChange(!props.favoriteOnly)}><StarIcon /></button>
          <select value={props.selectedTag} aria-label={copy.archiveTags} onChange={(event) => props.onTagChange(event.target.value)}>
            <option value="">{copy.allArchiveTags}</option>
            {props.tags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}
          </select>
        </div>
        <div className="archive-actions">
          <button type="button" title={copy.captureArchive} aria-label={copy.captureArchive} disabled={props.busy} onClick={props.onCapture}><ArchiveIcon /></button>
          <button type="button" title={copy.copyArchive} aria-label={copy.copyArchive} disabled={!selected || props.busy} onClick={props.onCopy}><CopyIcon /></button>
          <button type="button" title={copy.exportArchive} aria-label={copy.exportArchive} disabled={!selected || props.busy} onClick={props.onExport}><DownloadIcon /></button>
          <button type="button" className={armed?.id === selected?.id ? "danger" : ""} title={armed?.id === selected?.id ? copy.confirmDeleteArchive : copy.deleteArchive} aria-label={armed?.id === selected?.id ? copy.confirmDeleteArchive : copy.deleteArchive} disabled={!selected || props.busy} onClick={requestDelete}><TrashIcon /></button>
          <button type="button" title={copy.closeArchive} aria-label={copy.closeArchive} onClick={props.onClose}><CloseIcon /></button>
        </div>
      </header>
      <div className="archive-body">
        <aside className="archive-list" aria-label={copy.archiveTitle}>
          {props.items.map((record) => (
            <button type="button" key={record.id} aria-current={record.id === selected?.id ? "true" : undefined} onClick={() => props.onSelect(record.id)}>
              <time>{new Date(record.ts).toLocaleString(props.locale)}</time>
              <span>{record.task || record.preview || "—"}</span>
              <small>{record.results.map((result) => result.label).join(" · ")}</small>
              {record.favorite || record.tags.length ? <span className="archive-badges">{record.favorite ? <StarIcon /> : null}{record.tags.map((tag) => <i key={tag}>{tag}</i>)}</span> : null}
            </button>
          ))}
          {!props.items.length ? <p>{props.query || props.favoriteOnly || props.selectedTag ? copy.archiveNoMatches : copy.archiveEmpty}</p> : null}
        </aside>
        <main className="archive-detail-pane">
          {selected ? <ArchiveDetail copy={copy} locale={props.locale} record={selected} onPatch={props.onPatch} onOpenSource={props.onOpenSource} /> : <p>{copy.archiveEmpty}</p>}
        </main>
      </div>
      <div className="archive-status" role="status" aria-live="polite">{props.status}</div>
    </section>
  );
}
