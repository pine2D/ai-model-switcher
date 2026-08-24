import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { SiteDefinition } from "../shared/contracts";
import { formatCopy, getCopy, resolveLocale } from "../shared/copy";
import type { DisplayPreferences } from "../shared/display";
import { unsupportedImageSites } from "../shared/images";
import type { DesktopSurface, LayoutState, SiteStatus } from "../shared/protocol";
import { describeStatus } from "../shared/status-copy";
import type { SyncStatus } from "../shared/sync";
import { ArchiveSurface } from "./archive-surface";
import { CommandBar, type RunState } from "./command-bar";
import {
  loadDisplayPreferences,
  saveDisplayPreferences
} from "./display-preferences";
import { ImagePicker } from "./image-picker";
import { SiteFrames } from "./site-frames";
import { SettingsWorkspace } from "./settings-workspace";
import { WorkspaceDrawer } from "./workspace-drawer";
import { useArchiveCapture } from "./use-archive-capture";
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

function applyDisplayPreferences(value: DisplayPreferences): void {
  document.documentElement.dataset.density = value.density;
  saveDisplayPreferences(window.localStorage, value);
}

applyDisplayPreferences(INITIAL_DISPLAY);

function App(): React.JSX.Element {
  const copy = useMemo(() => getCopy(navigator.language), []);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [sites, setSites] = useState<readonly SiteDefinition[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SiteStatus>>({});
  const [layout, setLayout] = useState<LayoutState>(INITIAL_LAYOUT);
  const [text, setText] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
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
  const imageSelection = useImageSelection(copy, runState === "idle", setAnnouncement);
  const synthesis = useSynthesisFlow();
  const { images, open: imageTrayOpen } = imageSelection;

  useEffect(() => {
    let active = true;
    void window.polyask.bootstrap().then((state) => {
      if (!active) return;
      setSites(state.sites);
      setStatuses(Object.fromEntries(state.statuses.map((status) => [status.site, status])));
      setLayout(state.layout);
      workspaceFlow.accept(state.workspace);
      synthesis.acceptPending(state.pendingSynthesis);
      setSyncStatus(state.sync);
    });
    const offStatus = window.polyask.onStatus((status) => {
      setStatuses((current) => ({ ...current, [status.site]: status }));
      setAnnouncement(`${status.site}: ${describeStatus(copy, status)}`);
    });
    const offLayout = window.polyask.onLayout(setLayout);
    const offDisplay = window.polyask.onDisplayPreferences(applyDisplayPreferences);
    const offFocusPrompt = window.polyask.onFocusPrompt(() => promptRef.current?.focus());
    const offWorkspace = window.polyask.onWorkspaceState(workspaceFlow.accept);
    const offSync = window.polyask.onSyncStatus(setSyncStatus);
    void window.polyask.setDisplayPreferences(INITIAL_DISPLAY).then(applyDisplayPreferences);
    return () => {
      active = false;
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
  const archiveCapture = useArchiveCapture({ sites, selected, prompt: text });
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
    if (imageWarning) {
      setAnnouncement(imageWarning);
      imageSelection.setOpen(false);
      changeDrawerOpen(true);
      return;
    }
    imageSelection.invalidateAndClose();
    setRunState("sending");
    try {
      const request = {
        text: prompt,
        tier: workspace.tier,
        sites: [...selected],
        images
      };
      const results = await window.polyask.broadcast(request);
      archiveCapture.remember(request, results);
    } catch {
      setAnnouncement(copy.failed);
    } finally {
      setRunState("idle");
    }
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
  const collectAndCopy = async (): Promise<void> => {
    if (auxiliaryBusy || runState !== "idle") return;
    setAuxiliaryBusy(true);
    try {
      const record = await archiveCapture.capture();
      const markdown = await window.polyask.archiveMarkdown(record.id, navigator.language);
      await navigator.clipboard.writeText(markdown);
      setAnnouncement(copy.archiveCollected);
    } catch {
      setAnnouncement(copy.archiveCollectFailed);
    } finally {
      setAuxiliaryBusy(false);
    }
  };
  const collectSynthesis = async (): Promise<void> => {
    if (auxiliaryBusy || runState !== "idle") return;
    setAuxiliaryBusy(true);
    try {
      await synthesis.collect();
      changeSurface("archive");
    } catch { setAnnouncement(copy.synthesisCollectFailed); }
    finally { setAuxiliaryBusy(false); }
  };

  if (surface === "archive") {
    return <ArchiveSurface copy={copy} locale={navigator.language} sites={sites} defaultTier={workspace.tier} preferredId={synthesis.pending?.archiveId ?? null} pendingSynthesis={synthesis.pending} synthesisCandidate={synthesis.candidate} onClose={() => changeSurface("sites")} onCapture={archiveCapture.capture} onSendSynthesis={async (request) => { await synthesis.send(request); setAnnouncement(copy.synthesisSent); changeSurface("sites"); }} onCollectSynthesis={async () => { await synthesis.collect(); }} onSaveSynthesis={synthesis.save} />;
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
        onCancel={() => { setRunState("cancelling"); window.polyask.cancel(); }}
        onTierChange={workspaceFlow.changeTier}
        onLayoutChange={setMode}
        onExpandedChange={setPromptExpanded}
        onToggleDrawer={() => {
          changeDrawerOpen(!drawerOpen);
        }}
        onNewSession={() => { void window.polyask.newSession([...selected]).catch(workspaceFlow.recover); }}
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
