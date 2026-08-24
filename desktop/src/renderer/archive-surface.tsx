import { useCallback, useEffect, useRef, useState } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import type { SiteDefinition } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import type { PendingSynthesis, SynthesisCandidate, SynthesisSendRequest } from "../shared/synthesis";
import { ArchiveWorkspace } from "./archive-workspace";
import { SynthesisWorkspace } from "./synthesis-workspace";

interface ArchiveSurfaceProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly onClose: () => void;
  readonly onCapture: () => Promise<ArchiveRecord>;
  readonly sites: readonly SiteDefinition[];
  readonly defaultTier: Tier;
  readonly preferredId: string | null;
  readonly pendingSynthesis: PendingSynthesis | null;
  readonly synthesisCandidate: SynthesisCandidate | null;
  readonly onSendSynthesis: (request: SynthesisSendRequest) => Promise<void>;
  readonly onCollectSynthesis: () => Promise<void>;
  readonly onSaveSynthesis: (replaceExisting: boolean) => Promise<ArchiveRecord>;
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
  const [synthesisId, setSynthesisId] = useState<string | null>(null);
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
    const timer = setTimeout(() => { void load(props.preferredId ?? undefined); }, query ? 180 : 0);
    return () => clearTimeout(timer);
  }, [load, props.preferredId, query]);

  const run = async (action: () => Promise<void>, failure: string | ((error: unknown) => string)): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (error) { setStatus(typeof failure === "function" ? failure(error) : failure); }
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
      pendingSynthesis={props.pendingSynthesis}
      synthesisCandidate={props.synthesisCandidate}
      detailOverride={synthesisId && selected?.id === synthesisId ? <SynthesisWorkspace copy={props.copy} record={selected} sites={props.sites} defaultTier={props.defaultTier} busy={busy} onCancel={() => { if (busy) window.polyask.cancel(); else setSynthesisId(null); }} onSend={(request) => { void run(() => props.onSendSynthesis(request), (error) => synthesisSendError(props.copy, error)); }} /> : undefined}
      onSynthesize={() => { if (selected) setSynthesisId(selected.id); }}
      onCollectSynthesis={() => { void run(props.onCollectSynthesis, props.copy.synthesisCollectFailed); }}
      onSaveSynthesis={(replaceExisting) => { void run(async () => {
        const record = await props.onSaveSynthesis(replaceExisting);
        await load(record.id);
        setStatus(props.copy.synthesisSavedDone);
      }, props.copy.archiveSaveFailed); }}
    />
  );
}

function synthesisSendError(copy: DesktopCopy, error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "submit_unconfirmed") return copy.submitUnconfirmed;
  if (code === "tier_unconfirmed") return copy.tierUnconfirmed;
  if (code === "composer_not_found") return copy.composerNotFound;
  if (code === "not_ready") return copy.siteNotReady;
  if (code === "timeout") return copy.timedOut;
  if (code === "cancelled") return copy.cancelledStatus;
  if (code === "inject_failed") return copy.injectFailed;
  return copy.synthesisSendFailed;
}
