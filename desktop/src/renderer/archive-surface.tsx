import { useCallback, useEffect, useRef, useState } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import { ArchiveWorkspace } from "./archive-workspace";

interface ArchiveSurfaceProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly onClose: () => void;
  readonly onCapture: () => Promise<ArchiveRecord>;
}

function downloadMarkdown(markdown: string, createdAt: number): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  const stamp = new Date(createdAt).toISOString().slice(0, 16).replace(/[T:]/g, "-");
  link.download = `polyask-${stamp}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5_000);
}

export function ArchiveSurface(props: ArchiveSurfaceProps): React.JSX.Element {
  const [items, setItems] = useState<readonly ArchiveRecord[]>([]);
  const [tags, setTags] = useState<readonly string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const requestEpoch = useRef(0);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  const load = useCallback(async (preferredId?: string): Promise<void> => {
    const epoch = ++requestEpoch.current;
    try {
      const result = await window.polyask.searchArchives({ query, favorite: favoriteOnly, tag: selectedTag });
      if (epoch !== requestEpoch.current) return;
      setItems(result.items);
      setTags(result.tags);
      setSelectedId((current) => {
        const preferred = preferredId ?? current;
        return result.items.some((item) => item.id === preferred) ? preferred! : result.items[0]?.id ?? null;
      });
      setStatus("");
    } catch {
      if (epoch === requestEpoch.current) setStatus(props.copy.archiveLoadFailed);
    }
  }, [favoriteOnly, props.copy.archiveLoadFailed, query, selectedTag]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, query ? 180 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const run = async (action: () => Promise<void>, failure: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch { setStatus(failure); }
    finally { setBusy(false); }
  };
  const markdown = async (): Promise<string> => {
    if (!selected) throw new Error("no_archive");
    return window.polyask.archiveMarkdown(selected.id, props.locale);
  };
  const patch = (value: ArchivePatch) => { void run(async () => {
    if (!selected) return;
    const record = await window.polyask.updateArchive(selected.id, value);
    await load(record.id);
  }, props.copy.archiveSaveFailed); };

  return (
    <ArchiveWorkspace
      copy={props.copy}
      locale={props.locale}
      items={items}
      selected={selected}
      tags={tags}
      query={query}
      favoriteOnly={favoriteOnly}
      selectedTag={selectedTag}
      busy={busy}
      status={status}
      onClose={props.onClose}
      onQueryChange={setQuery}
      onFavoriteFilterChange={setFavoriteOnly}
      onTagChange={setSelectedTag}
      onSelect={setSelectedId}
      onCapture={() => { void run(async () => {
        const record = await props.onCapture();
        await load(record.id);
        setStatus(props.copy.archiveSaved);
      }, props.copy.archiveCollectFailed); }}
      onCopy={() => { void run(async () => {
        await navigator.clipboard.writeText(await markdown());
        setStatus(props.copy.archiveCopied);
      }, props.copy.archiveSaveFailed); }}
      onExport={() => { void run(async () => {
        if (!selected) return;
        downloadMarkdown(await markdown(), selected.ts);
        setStatus(props.copy.archiveExported);
      }, props.copy.archiveSaveFailed); }}
      onDelete={(id) => { void run(async () => {
        await window.polyask.deleteArchive(id);
        await load();
      }, props.copy.archiveSaveFailed); }}
      onPatch={patch}
      onOpenSource={(url) => { void run(() => window.polyask.openExternal(url), props.copy.archiveLoadFailed); }}
    />
  );
}
