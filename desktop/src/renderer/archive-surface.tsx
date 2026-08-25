import { useEffect, useRef, useState } from "react";

import type { ArchivePatch, ArchiveRecord } from "../shared/archive";
import type { SiteDefinition } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import type { PendingSynthesis, SynthesisCandidate, SynthesisSendRequest } from "../shared/synthesis";
import { ArchiveWorkspace } from "./archive-workspace";
import { SerialActions, type ActionFailure } from "./serial-actions";
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

interface ArchiveRequestEpoch {
  begin: () => number;
  invalidate: () => void;
  applyLatest: (epoch: number, apply: () => void) => void;
}

export interface ArchiveFilters {
  readonly query: string;
  readonly favorite: boolean;
  readonly tag: string;
}

interface ArchiveSearchResult {
  readonly items: readonly ArchiveRecord[];
  readonly tags: readonly string[];
}

interface ArchiveRefreshEffects {
  readonly search: (filters: ArchiveFilters) => Promise<ArchiveSearchResult>;
  readonly setLoading: (value: boolean) => void;
  readonly apply: (result: ArchiveSearchResult, preferredId?: string) => void;
  readonly fail: () => void;
}

export function createArchiveRequestEpoch(): ArchiveRequestEpoch {
  let current = 0;
  return {
    begin: () => ++current,
    invalidate: () => { current += 1; },
    applyLatest: (epoch, apply) => {
      if (epoch === current) apply();
    }
  };
}

export function createArchiveRefresh(
  requestEpoch: ArchiveRequestEpoch,
  readFilters: () => ArchiveFilters,
  effects: ArchiveRefreshEffects
): (preferredId?: string) => Promise<void> {
  return async (preferredId?: string): Promise<void> => {
    const epoch = requestEpoch.begin();
    effects.setLoading(true);
    try {
      const result = await effects.search(readFilters());
      requestEpoch.applyLatest(epoch, () => effects.apply(result, preferredId));
    } catch {
      requestEpoch.applyLatest(epoch, effects.fail);
    }
  };
}

export function startArchiveFilterIntent<T>(
  requestEpoch: ArchiveRequestEpoch,
  setFilter: (value: T) => void,
  value: T,
  setLoading: (value: boolean) => void,
  setStatus: (value: string) => void
): void {
  requestEpoch.invalidate();
  setLoading(true);
  setStatus("");
  setFilter(value);
}

export function ArchiveSurface(props: ArchiveSurfaceProps): React.JSX.Element {
  const [items, setItems] = useState<readonly ArchiveRecord[]>([]);
  const [tags, setTags] = useState<readonly string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [synthesisId, setSynthesisId] = useState<string | null>(null);
  const requestEpoch = useRef<ReturnType<typeof createArchiveRequestEpoch> | null>(null);
  const currentFilters = useRef<ArchiveFilters>({ query: "", favorite: false, tag: "" });
  const refresh = useRef<ReturnType<typeof createArchiveRefresh> | null>(null);
  const actionQueue = useRef<SerialActions | null>(null);
  if (!requestEpoch.current) requestEpoch.current = createArchiveRequestEpoch();
  if (!refresh.current) {
    refresh.current = createArchiveRefresh(
      requestEpoch.current,
      () => currentFilters.current,
      {
        search: (filters) => window.polyask.searchArchives(filters),
        setLoading,
        apply: (result, preferredId) => {
          setItems(result.items);
          setTags(result.tags);
          setSelectedId((current) => {
            const preferred = preferredId ?? current;
            return result.items.some((item) => item.id === preferred)
              ? preferred!
              : result.items[0]?.id ?? null;
          });
          setStatus("");
          setLoading(false);
        },
        fail: () => {
          setStatus(props.copy.archiveLoadFailed);
          setLoading(false);
        }
      }
    );
  }
  if (!actionQueue.current) actionQueue.current = new SerialActions(setBusy, setStatus);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const load = refresh.current;

  useEffect(() => {
    const timer = setTimeout(() => { void load(props.preferredId ?? undefined); }, query ? 180 : 0);
    return () => clearTimeout(timer);
  }, [favoriteOnly, load, props.preferredId, query, selectedTag]);

  const run = (action: () => Promise<void>, failure: ActionFailure): Promise<void> =>
    actionQueue.current!.run(action, failure);
  const changeQuery = (value: string) => {
    currentFilters.current = { ...currentFilters.current, query: value };
    startArchiveFilterIntent(requestEpoch.current!, setQuery, value, setLoading, setStatus);
  };
  const changeFavoriteOnly = (value: boolean) => {
    currentFilters.current = { ...currentFilters.current, favorite: value };
    startArchiveFilterIntent(requestEpoch.current!, setFavoriteOnly, value, setLoading, setStatus);
  };
  const changeSelectedTag = (value: string) => {
    currentFilters.current = { ...currentFilters.current, tag: value };
    startArchiveFilterIntent(requestEpoch.current!, setSelectedTag, value, setLoading, setStatus);
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
      loading={loading}
      busy={busy}
      status={status}
      onClose={props.onClose}
      onQueryChange={changeQuery}
      onFavoriteFilterChange={changeFavoriteOnly}
      onTagChange={changeSelectedTag}
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
