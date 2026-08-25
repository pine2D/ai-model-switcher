import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { SiteDefinition } from "../shared/contracts";
import { formatCopy, getCopy, resolveLocale } from "../shared/copy";
import type { DisplayPreferences } from "../shared/display";
import { unsupportedImageSites } from "../shared/images";
import type { BootstrapState, DesktopSurface, LayoutState, SiteStatus } from "../shared/protocol";
import { describeStatus } from "../shared/status-copy";
import type { SyncStatus } from "../shared/sync";
import { ArchiveSurface } from "./archive-surface";
import { loadBootstrap, type BootstrapPhase } from "./bootstrap-model";
import { BootstrapStateView } from "./bootstrap-state";
import { ExclusiveActionLock } from "./broadcast-flow-state";
import { CommandBar } from "./command-bar";
import {
  applyDisplayDensity,
  applyDisplayPreferences,
  loadDisplayPreferences,
} from "./display-preferences";
import { ImagePicker } from "./image-picker";
import { SiteFrames } from "./site-frames";
import { SettingsWorkspace } from "./settings-workspace";
import { WorkspaceDrawer } from "./workspace-drawer";
import { useArchiveCapture } from "./use-archive-capture";
import { useBroadcastFlow } from "./use-broadcast-flow";
import { useImageSelection } from "./use-image-selection";
import { useSynthesisFlow } from "./use-synthesis-flow";
import { useWorkspaceFlow } from "./use-workspace-flow";
import "./styles.css";
import "./settings.css";
import "./accessibility.css";

const INITIAL_LAYOUT: LayoutState = {
  mode: "overview",
  focused: "claude",
  placements: []
};

const INITIAL_DISPLAY = loadDisplayPreferences(
  window.localStorage,
  window.matchMedia("(pointer: coarse)").matches
);
const INITIAL_SYNC: SyncStatus = {
  state: "idle", connected: false, pending: 0, errorCount: 0,
  readOnly: false, oauthConfigured: false, secureTokenStorage: true
};

applyDisplayDensity(document.documentElement, INITIAL_DISPLAY);

function App(): React.JSX.Element {
  const copy = useMemo(() => getCopy(navigator.language), []);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const bootstrapStarted = useRef(false);
  const actionLock = useRef<ExclusiveActionLock | null>(null);
  if (!actionLock.current) actionLock.current = new ExclusiveActionLock();
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>("loading");
  const [sites, setSites] = useState<readonly SiteDefinition[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SiteStatus>>({});
  const [layout, setLayout] = useState<LayoutState>(INITIAL_LAYOUT);
  const [text, setText] = useState("");
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [surface, setSurface] = useState<DesktopSurface>("sites");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(INITIAL_SYNC);
  const [announcement, setAnnouncement] = useState("");
  const workspaceFlow = useWorkspaceFlow(sites, copy.workspaceActionFailed, setAnnouncement);
  const { workspace, selected } = workspaceFlow;
  const changeDrawerOpen = (value: boolean): void => {
    setDrawerOpen(value);
    window.polyask.setDrawerOpen(value);
  };
  const synthesis = useSynthesisFlow();
  const archiveCapture = useArchiveCapture({ sites, selected, prompt: text });
  const broadcast = useBroadcastFlow(
    () => setAnnouncement(copy.failed),
    archiveCapture.remember,
    archiveCapture.invalidate
  );
  const { runState } = broadcast;
  const imageSelection = useImageSelection(copy, runState === "idle", setAnnouncement);
  const { images, open: imageTrayOpen } = imageSelection;
  const acceptDisplayPreferences = (value: DisplayPreferences): void => {
    applyDisplayPreferences(
      document.documentElement,
      window.localStorage,
      value,
      () => setAnnouncement(copy.displayPreferencesFailed)
    );
  };

  const acceptBootstrap = (state: BootstrapState): void => {
    setSites(state.sites);
    setStatuses(Object.fromEntries(state.statuses.map((status) => [status.site, status])));
    setLayout(state.layout);
    workspaceFlow.accept(state.workspace);
    synthesis.acceptPending(state.pendingSynthesis);
    setSyncStatus(state.sync);
  };
  const bootstrap = async (): Promise<void> => {
    setBootstrapPhase("loading");
    setBootstrapPhase(await loadBootstrap(window.polyask.bootstrap, acceptBootstrap));
  };

  useEffect(() => {
    if (!bootstrapStarted.current) {
      bootstrapStarted.current = true;
      void bootstrap();
      void window.polyask.setDisplayPreferences(INITIAL_DISPLAY)
        .then(acceptDisplayPreferences)
        .catch(() => setAnnouncement(copy.displayPreferencesFailed));
    }
    const offStatus = window.polyask.onStatus((status) => {
      setStatuses((current) => ({ ...current, [status.site]: status }));
      setAnnouncement(`${status.site}: ${describeStatus(copy, status)}`);
    });
    const offLayout = window.polyask.onLayout(setLayout);
    const offDisplay = window.polyask.onDisplayPreferences(acceptDisplayPreferences);
    const offFocusPrompt = window.polyask.onFocusPrompt(() => promptRef.current?.focus());
    const offWorkspace = window.polyask.onWorkspaceState(workspaceFlow.accept);
    const offSync = window.polyask.onSyncStatus(setSyncStatus);
    return () => {
      offStatus();
      offLayout();
      offDisplay();
      offFocusPrompt();
      offWorkspace();
      offSync();
    };
  }, [copy]);

  const composerExpanded = promptExpanded || imageTrayOpen;
  useEffect(() => window.polyask.setComposerExpanded(composerExpanded), [composerExpanded]);

  const activeCount = useMemo(
    () => Object.values(statuses).filter((status) => status.phase === "sending").length,
    [statuses]
  );
  const unsupportedSites = useMemo(() => {
    if (!images.length) return [];
    const unsupported = new Set(unsupportedImageSites([...selected], sites));
    return sites.filter((site) => unsupported.has(site.key));
  }, [images.length, selected, sites]);
  const imageWarning = unsupportedSites.length
    ? formatCopy(copy.imageUnsupported, {
      sites: new Intl.ListFormat(navigator.language, { style: "short", type: "conjunction" })
        .format(unsupportedSites.map((site) => site.label))
    })
    : null;

  const submit = async (): Promise<void> => {
    const prompt = text.trim();
    if (!prompt || selected.size === 0 || runState !== "idle") return;
    await actionLock.current!.run(async () => {
      if (imageWarning) {
        setAnnouncement(imageWarning);
        imageSelection.setOpen(false);
        changeDrawerOpen(true);
        return;
      }
      imageSelection.invalidateAndClose();
      await broadcast.send({
        text: prompt,
        tier: workspace.tier,
        sites: [...selected],
        images
      });
    });
  };

  const setMode = (mode: "overview" | "focus", focused = layout.focused): void => {
    window.polyask.setLayout(mode, focused);
  };

  const changeSurface = (value: DesktopSurface): void => {
    if (value !== "sites") {
      imageSelection.invalidateAndClose();
      setPromptExpanded(false);
      if (drawerOpen) changeDrawerOpen(false);
    }
    setSurface(value);
    window.polyask.setSurface(value);
  };
  const runAuxiliary = async (action: () => Promise<void>): Promise<void> => {
    if (runState !== "idle") return;
    await actionLock.current!.run(async () => {
      setAuxiliaryBusy(true);
      try {
        await action();
      } finally {
        setAuxiliaryBusy(false);
      }
    });
  };
  const collectAndCopy = async (): Promise<void> => runAuxiliary(async () => {
    try {
      const record = await archiveCapture.capture();
      const markdown = await window.polyask.archiveMarkdown(record.id, navigator.language);
      await navigator.clipboard.writeText(markdown);
      setAnnouncement(copy.archiveCollected);
    } catch {
      setAnnouncement(copy.archiveCollectFailed);
    }
  });
  const collectSynthesis = async (): Promise<void> => runAuxiliary(async () => {
    try {
      await synthesis.collect();
      changeSurface("archive");
    } catch { setAnnouncement(copy.synthesisCollectFailed); }
  });
  const startNewSession = async (): Promise<void> => runAuxiliary(async () => {
    const selectedSites = [...selected];
    broadcast.invalidate();
    archiveCapture.invalidate();
    try {
      const results = await window.polyask.newSession(selectedSites);
      const failed = results.filter((result) => !result.ok).length;
      setAnnouncement(failed
        ? formatCopy(copy.newSessionPartial, { ok: results.length - failed, failed })
        : formatCopy(copy.newSessionDone, { count: results.length }));
    } catch {
      workspaceFlow.recover();
    }
  });

  if (bootstrapPhase !== "ready") {
    return (
      <BootstrapStateView
        copy={copy}
        phase={bootstrapPhase}
        announcement={announcement}
        onRetry={() => { void bootstrap(); }}
      />
    );
  }

  if (surface === "archive") {
    return <ArchiveSurface copy={copy} locale={navigator.language} sites={sites} defaultTier={workspace.tier} preferredId={synthesis.pending?.archiveId ?? null} pendingSynthesis={synthesis.pending} synthesisCandidate={synthesis.candidate} onClose={() => changeSurface("sites")} onCapture={archiveCapture.capture} onSendSynthesis={async (request) => { broadcast.invalidate(); archiveCapture.invalidate(); await synthesis.send(request); setAnnouncement(copy.synthesisSent); changeSurface("sites"); }} onCollectSynthesis={async () => { await synthesis.collect(); }} onSaveSynthesis={synthesis.save} />;
  }
  if (surface === "settings") {
    return <SettingsWorkspace copy={copy} locale={navigator.language} status={syncStatus} onStatus={setSyncStatus} onAnnounce={setAnnouncement} onClose={() => changeSurface("sites")} />;
  }

  return (
    <main className={`app-shell${composerExpanded ? " is-composer-expanded" : ""}${drawerOpen ? " has-drawer" : ""}`}>
      <CommandBar
        copy={copy}
        promptRef={promptRef}
        text={text}
        tier={workspace.tier}
        runState={runState}
        auxiliaryBusy={auxiliaryBusy}
        layoutMode={layout.mode}
        selectedCount={selected.size}
        totalSites={sites.length || 9}
        activeCount={activeCount}
        failureCount={broadcast.failureCount}
        cancelledCount={broadcast.cancelledCount}
        drawerOpen={drawerOpen}
        imageControl={(
          <ImagePicker
            copy={copy}
            images={images}
            open={imageTrayOpen}
            disabled={runState !== "idle"}
            warning={imageWarning}
            warningCount={unsupportedSites.length}
            error={imageSelection.error}
            onOpenChange={imageSelection.setOpen}
            onFiles={(files) => { void imageSelection.choose(files); }}
            onRemove={imageSelection.remove}
            onAdjustScope={() => { imageSelection.setOpen(false); changeDrawerOpen(true); }}
          />
        )}
        sendBlockedReason={imageWarning}
        synthesisPending={!!synthesis.pending}
        syncStatus={syncStatus}
        isMac={navigator.userAgent.includes("Mac")}
        expanded={composerExpanded}
        onTextChange={setText}
        onSubmit={() => void submit()}
        onCancel={broadcast.cancel}
        onTierChange={workspaceFlow.changeTier}
        onLayoutChange={setMode}
        onExpandedChange={setPromptExpanded}
        onToggleDrawer={() => {
          changeDrawerOpen(!drawerOpen);
        }}
        onNewSession={() => { void startNewSession(); }}
        onRetryFailed={() => { void actionLock.current!.run(broadcast.retry); }}
        onCollectAnswers={() => { void collectAndCopy(); }}
        onOpenArchive={() => changeSurface("archive")}
        onCollectSynthesis={() => { void collectSynthesis(); }}
        onOpenSettings={() => changeSurface("settings")}
        onPasteImages={(files) => { void imageSelection.choose(files); }}
      />
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {drawerOpen ? (
        <WorkspaceDrawer
          copy={copy}
          sites={sites}
          selected={selected}
          groups={workspace.groups}
          onClose={() => changeDrawerOpen(false)}
          onSelectionChange={workspaceFlow.changeSelection}
          onSaveGroup={workspaceFlow.saveGroup}
          onDeleteGroup={workspaceFlow.deleteGroup}
        />
      ) : null}
      <SiteFrames
        copy={copy}
        sites={sites}
        statuses={statuses}
        layout={layout}
        selected={selected}
        onToggle={workspaceFlow.toggleSite}
        onFocus={(site) => setMode("focus", site)}
        onReload={(site) => window.polyask.reloadSite(site)}
      />
    </main>
  );
}

document.documentElement.lang = resolveLocale(navigator.language) === "zhCN"
  ? "zh-CN"
  : resolveLocale(navigator.language) === "zhTW" ? "zh-TW" : "en";
document.title = getCopy(navigator.language).appTitle;
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
