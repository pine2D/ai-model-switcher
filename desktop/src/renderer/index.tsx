import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { COMMANDS, type CommandId } from "../shared/commands";
import type { SiteDefinition } from "../shared/contracts";
import type { CommandActions } from "./command-dispatcher";
import { formatCopy, getCopy, resolveLocale } from "../shared/copy";
import type { DisplayPreferences } from "../shared/display";
import { unsupportedImageSites } from "../shared/images";
import type {
  BootstrapState,
  DesktopSurface,
  LayoutState,
  MenuShortcut,
  SiteHistoryState,
  SiteStatus
} from "../shared/protocol";
import { describeStatus } from "../shared/status-copy";
import type { SyncStatus } from "../shared/sync";
import type { RuntimeInfo } from "../shared/runtime";
import type { SiteHealth } from "../shared/site-health";
import type { PromptLibraryState } from "../shared/prompt-library";
import { ArchiveSurface } from "./archive-surface";
import { loadBootstrap, type BootstrapPhase } from "./bootstrap-model";
import { BootstrapStateView } from "./bootstrap-state";
import { ExclusiveActionLock } from "./broadcast-flow-state";
import { CommandBar } from "./command-bar";
import { ConfirmDialog } from "./confirm-dialog";
import { CommandPalette, type CommandPaletteMode } from "./command-palette";
import { executeCommand } from "./command-dispatcher";
import {
  loadCompletionNotifications,
  saveCompletionNotifications
} from "./completion-notification-preference";
import {
  applyDisplayDensity,
  applyDisplayPreferences,
  loadDisplayPreferences,
} from "./display-preferences";
import { ImagePicker } from "./image-picker";
import { PageTabs } from "./page-tabs";
import { clearDraft, loadDraft, saveDraft } from "./prompt-draft";
import { usePresence } from "./presence";
import { SiteFrames } from "./site-frames";
import { SettingsWorkspace } from "./settings-workspace";
import { nextSiteForStatus } from "./site-navigation";
import { WorkspaceDrawer } from "./workspace-drawer";
import {
  openWorkspacePanel,
  scopeDisplayName,
  type OpenWorkspacePanelState,
  type WorkspacePanelState,
  type WorkspacePanelTab
} from "./workspace-panel-state";
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
  page: 0,
  pageCount: 1,
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
const INITIAL_RUNTIME: RuntimeInfo = { version: "", distribution: "installed" };
const INITIAL_LIBRARY: PromptLibraryState = { templates: [], history: [] };
const LATEST_RELEASE_URL = "https://github.com/pine2D/polyask/releases/latest";

applyDisplayDensity(document.documentElement, INITIAL_DISPLAY);

function App(): React.JSX.Element {
  const copy = useMemo(() => getCopy(navigator.language), []);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const bootstrapStarted = useRef(false);
  const sitesRef = useRef<readonly SiteDefinition[]>([]);
  const layoutPage = useRef(0);
  const requestedPage = useRef<{ readonly page: number; readonly inputMethod: "keyboard" | "pointer" } | null>(null);
  const actionLock = useRef<ExclusiveActionLock | null>(null);
  const commandActions = useRef<CommandActions>({});
  const healthRequest = useRef(0);
  const lastOpenPanel = useRef<OpenWorkspacePanelState>(openWorkspacePanel("sites", "pointer"));
  if (!actionLock.current) actionLock.current = new ExclusiveActionLock();
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>("loading");
  const [sites, setSites] = useState<readonly SiteDefinition[]>([]);
  const [menuShortcuts, setMenuShortcuts] = useState<readonly MenuShortcut[]>([]);
  const [siteHistory, setSiteHistory] = useState<Record<string, SiteHistoryState>>({});
  // Alt+N 的确认改用应用内弹层（原生 dialog.showMessageBox 与本应用外观格格不入）。
  // 存 resolve 而不是布尔：调用方仍是 `await` 的形态，业务逻辑不必改写成回调。
  const [pendingNewSession, setPendingNewSession] = useState<
    { readonly count: number; readonly decide: (ok: boolean) => void } | null>(null);
  const [statuses, setStatuses] = useState<Record<string, SiteStatus>>({});
  const [health, setHealth] = useState<Partial<Record<string, SiteHealth>>>({});
  const [healthChecking, setHealthChecking] = useState(false);
  const [layout, setLayout] = useState<LayoutState>(INITIAL_LAYOUT);
  const [text, setText] = useState(() => loadDraft(window.localStorage).text);
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [panelState, setPanelState] = useState<WorkspacePanelState>(null);
  const [surface, setSurface] = useState<DesktopSurface>("sites");
  const [settingsSection, setSettingsSection] = useState<"overview" | "drive-diagnostics">("overview");
  const [commandMode, setCommandMode] = useState<CommandPaletteMode>("commands");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(INITIAL_SYNC);
  const [runtime, setRuntime] = useState<RuntimeInfo>(INITIAL_RUNTIME);
  const [promptLibrary, setPromptLibrary] = useState<PromptLibraryState>(INITIAL_LIBRARY);
  const [completionNotifications, setCompletionNotifications] = useState(() =>
    loadCompletionNotifications(window.localStorage)
  );
  const [announcement, setAnnouncement] = useState("");
  const [pageInputMethod, setPageInputMethod] = useState<"keyboard" | "pointer">("pointer");
  const drawerOpen = panelState !== null;
  if (panelState) lastOpenPanel.current = panelState;
  const drawerPresent = usePresence(drawerOpen, 200);
  const workspaceFlow = useWorkspaceFlow(sites, copy.workspaceActionFailed, setAnnouncement);
  const { workspace, selected } = workspaceFlow;
  const changePanelState = (value: WorkspacePanelState): void => {
    setPanelState(value);
    window.polyask.setDrawerOpen(value !== null);
  };
  const openPanel = (tab: WorkspacePanelTab, inputMethod: "pointer" | "keyboard"): void => {
    changeSurface("sites");
    changePanelState(openWorkspacePanel(tab, inputMethod));
    if (tab === "health") void refreshSiteHealth(workspace.selectedSites);
  };
  const changeDrawerOpen = (value: boolean): void => {
    changePanelState(value ? openWorkspacePanel("sites", "pointer") : null);
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
    setRuntime(state.runtime);
    setSites(state.sites);
    sitesRef.current = state.sites;
    setStatuses(Object.fromEntries(state.statuses.map((status) => [status.site, status])));
    layoutPage.current = state.layout.page;
    setLayout(state.layout);
    workspaceFlow.accept(state.workspace);
    setPromptLibrary(state.promptLibrary);
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
      // 站点自己发起的主帧导航（点登录跳 auth、被 302 到外部页）会把阶段打回 loading。
      // 此时旧的健康结论已不成立，必须失效——否则面板会长期展示一个过期的「可提问」。
      // 失效信号已经在这条 status 里，不需要新 IPC 通道。
      if (status.phase === "loading") {
        setHealth((current) => {
          if (!current[status.site]) return current;
          const next = { ...current };
          delete next[status.site];
          return next;
        });
      }
      const label = sitesRef.current.find((site) => site.key === status.site)?.label ?? status.site;
      setAnnouncement(`${label}: ${describeStatus(copy, status)}`);
    });
    const offLayout = window.polyask.onLayout((next) => {
      if (next.page !== layoutPage.current) {
        const request = requestedPage.current?.page === next.page ? requestedPage.current : null;
        setPageInputMethod(request?.inputMethod ?? "keyboard");
        if (!request) {
          setAnnouncement(formatCopy(copy.sitePageChanged, { page: next.page + 1, total: next.pageCount }));
        }
        requestedPage.current = null;
        layoutPage.current = next.page;
      }
      setLayout(next);
    });
    const offDisplay = window.polyask.onDisplayPreferences(acceptDisplayPreferences);
    const offCommand = window.polyask.onCommand((id) => executeCommand(id, commandActions.current));
    const offWorkspace = window.polyask.onWorkspaceState(workspaceFlow.accept);
    const offPromptLibrary = window.polyask.onPromptLibrary(setPromptLibrary);
    const offSync = window.polyask.onSyncStatus(setSyncStatus);
    return () => {
      offStatus();
      offLayout();
      offDisplay();
      offCommand();
      offWorkspace();
      offPromptLibrary();
      offSync();
    };
  }, [copy]);

  const composerExpanded = promptExpanded || imageTrayOpen;
  useEffect(() => window.polyask.setComposerExpanded(composerExpanded), [composerExpanded]);
  useEffect(() => { saveDraft(window.localStorage, text); }, [text]);
  useEffect(() => {
    saveCompletionNotifications(window.localStorage, completionNotifications);
    window.polyask.setCompletionNotifications(completionNotifications);
  }, [completionNotifications]);

  const scopeLabel = useMemo(
    () => scopeDisplayName(workspace.selectedSites, workspace.groups, copy),
    [copy, workspace.groups, workspace.selectedSites]
  );
  const refreshSiteHealth = async (keys: readonly SiteHealth["site"][]): Promise<void> => {
    if (!keys.length) return;
    const request = ++healthRequest.current;
    setHealthChecking(true);
    try {
      const results = await window.polyask.checkSiteHealth(keys);
      if (request !== healthRequest.current) return;
      setHealth((current) => ({
        ...current,
        ...Object.fromEntries(results.map((result) => [result.site, result]))
      }));
    } catch {
      if (request === healthRequest.current) setAnnouncement(copy.healthRequestFailed);
    } finally {
      if (request === healthRequest.current) setHealthChecking(false);
    }
  };
  const healthAttention = useMemo(
    () => new Set([
      ...Object.values(statuses).filter((status) => selected.has(status.site) && ["warning", "failed", "crashed"].includes(status.phase)).map((status) => status.site),
      ...Object.values(health).filter((item) => item && selected.has(item.site) && ["sign-in", "error"].includes(item.state)).map((item) => item!.site)
    ]).size,
    [health, selected, statuses]
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
      const completed = await broadcast.send({
        text: prompt,
        tier: workspace.tier,
        sites: [...selected],
        images
      });
      if (completed && [...completed.results.values()].some((result) => result.ok)) {
        clearDraft(window.localStorage);
        setText("");
      }
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
  const startNewSession = async (): Promise<void> => {
    const selectedSites = [...selected];
    if (!selectedSites.length) return;
    const approved = await new Promise<boolean>((resolve) => {
      setPendingNewSession({ count: selectedSites.length, decide: resolve });
    });
    if (!approved) return;
    await runAuxiliary(async () => {
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
  };
  const showGroupMenu = async (): Promise<void> => {
    try {
      const id = await window.polyask.showGroupMenu();
      const group = workspace.groups.find((candidate) => candidate.id === id);
      if (group) workspaceFlow.changeSelection(group.sites);
    } catch {
      setAnnouncement(copy.workspaceActionFailed);
    }
  };
  const showMoreMenu = async (): Promise<void> => {
    const moreIds: readonly CommandId[] = [
      "retry-failed", "collect-answers", "open-archive", "collect-synthesis",
      "next-unfinished", "next-failed", "new-session", "check-updates",
      "open-command-palette", "open-shortcuts", "open-settings"
    ];
    const commands = moreIds.filter((id) => !!commandActions.current[id]);
    try {
      const command = await window.polyask.showCommandMenu(commands);
      if (command) executeCommand(command, commandActions.current);
    } catch {
      setAnnouncement(copy.workspaceActionFailed);
    }
  };

  const openCommandSurface = (mode: CommandPaletteMode): void => {
    setCommandMode(mode);
    changeSurface("commands");
  };
  const showPage = (page: number): void => {
    changeSurface("sites");
    requestedPage.current = { page, inputMethod: "keyboard" };
    setPageInputMethod("keyboard");
    setAnnouncement(formatCopy(copy.sitePageChanged, { page: page + 1, total: layout.pageCount }));
    window.polyask.setPage(page);
  };
  const nextUnfinished = nextSiteForStatus(
    workspace.selectedSites, layout.focused, statuses, "unfinished"
  );
  const nextFailed = nextSiteForStatus(
    workspace.selectedSites, layout.focused, statuses, "failed"
  );
  const focusSite = (site: SiteDefinition["key"]): void => {
    changeSurface("sites");
    if (drawerOpen) changeDrawerOpen(false);
    setMode("focus", site);
  };
  const openLatestReleasePage = (): Promise<void> => window.polyask.openExternal(LATEST_RELEASE_URL);
  const checkForUpdates = (): void => {
    changeSurface("sites");
    void openLatestReleasePage()
      .then(() => setAnnouncement(copy.updatePageOpened))
      .catch(() => setAnnouncement(copy.updatePageFailed));
  };

  commandActions.current = {
    "open-command-palette": () => openCommandSurface("commands"),
    "open-sites": () => {
      openPanel("sites", "keyboard");
    },
    "open-site-health": () => {
      openPanel("health", "keyboard");
    },
    ...(layout.pageCount >= 1 ? { "show-page-1": () => showPage(0) } : {}),
    ...(layout.pageCount >= 2 ? { "show-page-2": () => showPage(1) } : {}),
    ...(layout.pageCount >= 3 ? { "show-page-3": () => showPage(2) } : {}),
    // 翻页/换焦点交给主进程的 ViewManager，渲染层不重算（重算必与主进程漂开）
    ...(layout.pageCount > 1 ? {
      "next-page": () => { changeSurface("sites"); window.polyask.stepPage(1); },
      "previous-page": () => { changeSurface("sites"); window.polyask.stepPage(-1); }
    } : {}),
    ...(selected.size > 1 ? {
      "next-site": () => { changeSurface("sites"); window.polyask.stepSite(1); },
      "previous-site": () => { changeSurface("sites"); window.polyask.stepSite(-1); }
    } : {}),
    // 站内后退/前进作用于当前聚焦的站点；能不能退由主进程按真实导航历史判定。
    ...(siteHistory[layout.focused]?.back ? { "site-back": () => { changeSurface("sites"); window.polyask.stepHistory(-1); } } : {}),
    ...(siteHistory[layout.focused]?.forward ? { "site-forward": () => { changeSurface("sites"); window.polyask.stepHistory(1); } } : {}),
    "focus-prompt": () => {
      changeSurface("sites");
      if (drawerOpen) changeDrawerOpen(false);
      queueMicrotask(() => promptRef.current?.focus());
    },
    "set-think": () => { changeSurface("sites"); void workspaceFlow.changeTier("think"); },
    "set-fast": () => { changeSurface("sites"); void workspaceFlow.changeTier("fast"); },
    ...(selected.size > 0 ? { "collect-answers": () => { changeSurface("sites"); void collectAndCopy(); } } : {}),
    "open-archive": () => changeSurface("archive"),
    ...(synthesis.pending ? { "collect-synthesis": () => { changeSurface("sites"); void collectSynthesis(); } } : {}),
    ...(broadcast.failureCount + broadcast.cancelledCount > 0 ? {
      "retry-failed": () => { changeSurface("sites"); void actionLock.current!.run(broadcast.retry); }
    } : {}),
    ...(nextUnfinished ? { "next-unfinished": () => focusSite(nextUnfinished) } : {}),
    ...(nextFailed ? { "next-failed": () => focusSite(nextFailed) } : {}),
    ...(selected.size > 0 ? { "new-session": () => { changeSurface("sites"); void startNewSession(); } } : {}),
    "open-settings": () => {
      setSettingsSection("overview");
      changeSurface("settings");
    },
    "open-drive-diagnostics": () => {
      setSettingsSection("drive-diagnostics");
      changeSurface("settings");
    },
    "open-shortcuts": () => openCommandSurface("shortcuts"),
    "check-updates": checkForUpdates
  };
  const availableCommands = COMMANDS.filter((command) => !!commandActions.current[command.id]);
  // 站内后退/前进的可用性来自主进程的真实导航历史。聚焦站点变了、或该站页面阶段变了
  // （= 刚导航过），都要重算——否则命令面板里这两条的可用状态会停在上一次。
  useEffect(() => {
    let cancelled = false;
    void window.polyask.siteHistoryState()
      .then((state) => { if (!cancelled) setSiteHistory(state); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [layout.focused, statuses, surface]);
  // 菜单会随显示偏好重建，每次进速查都重新读一次真实菜单——速查因此不可能与菜单漂开。
  useEffect(() => {
    if (surface !== "commands") return;
    let cancelled = false;
    void window.polyask.menuShortcuts()
      .then((items) => { if (!cancelled) setMenuShortcuts(items); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [surface]);

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
    return <div className="surface-stage"><ArchiveSurface copy={copy} locale={navigator.language} sites={sites} synthesisSites={sites.filter((site) => selected.has(site.key))} defaultTier={workspace.tier} preferredId={synthesis.pending?.archiveId ?? null} pendingSynthesis={synthesis.pending} synthesisCandidate={synthesis.candidate} onClose={() => changeSurface("sites")} onCapture={archiveCapture.capture} onSendSynthesis={async (request) => { broadcast.invalidate(); archiveCapture.invalidate(); await synthesis.send(request); setAnnouncement(copy.synthesisSent); changeSurface("sites"); }} onCollectSynthesis={async () => { await synthesis.collect(); }} onSaveSynthesis={synthesis.save} /></div>;
  }
  if (surface === "settings") {
    return <div className="surface-stage"><SettingsWorkspace copy={copy} locale={navigator.language} runtime={runtime} status={syncStatus} initialSection={settingsSection} completionNotifications={completionNotifications} onCompletionNotificationsChange={setCompletionNotifications} onCheckUpdates={openLatestReleasePage} onStatus={setSyncStatus} onAnnounce={setAnnouncement} onClose={() => changeSurface("sites")} /></div>;
  }
  if (surface === "commands") {
    return (
      <CommandPalette
        copy={copy}
        commands={availableCommands}
            menuShortcuts={menuShortcuts}
        groups={workspace.groups}
        library={promptLibrary}
        draft={text}
        isMac={navigator.userAgent.includes("Mac")}
        mode={commandMode}
        onModeChange={setCommandMode}
        onExecute={(id) => executeCommand(id, commandActions.current)}
        onApplyGroup={(id) => {
          const group = workspace.groups.find((candidate) => candidate.id === id);
          if (!group) return;
          workspaceFlow.changeSelection(group.sites);
          changeSurface("sites");
        }}
        onInsertPrompt={(value) => {
          setText(value);
          changeSurface("sites");
          queueMicrotask(() => promptRef.current?.focus());
        }}
        onSaveTemplate={(input) => {
          void window.polyask.savePromptTemplate(input)
            .then(setPromptLibrary)
            .catch(() => setAnnouncement(copy.promptLibrarySaveFailed));
        }}
        onDeleteTemplate={(id) => {
          void window.polyask.deletePromptTemplate(id)
            .then(setPromptLibrary)
            .catch(() => setAnnouncement(copy.promptLibraryDeleteFailed));
        }}
        onClose={() => changeSurface("sites")}
      />
    );
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
        failureCount={broadcast.failureCount}
        cancelledCount={broadcast.cancelledCount}
        scopeLabel={scopeLabel}
        healthAttention={healthAttention}
        panelTab={panelState?.tab ?? null}
        pageControl={layout.pageCount > 1 ? (
          <PageTabs
            copy={copy}
            selectedSites={workspace.selectedSites}
            statuses={statuses}
            page={layout.page}
            inputMethod={pageInputMethod}
            onPageChange={(page, inputMethod) => {
              requestedPage.current = { page, inputMethod };
              setPageInputMethod(inputMethod);
              setAnnouncement(formatCopy(copy.sitePageChanged, { page: page + 1, total: layout.pageCount }));
              window.polyask.setPage(page);
            }}
          />
        ) : null}
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
        onOpenPanel={(tab) => openPanel(tab, "pointer")}
        onShowGroupMenu={() => { void showGroupMenu(); }}
        onOpenMore={() => { void showMoreMenu(); }}
        onPasteImages={(files) => { void imageSelection.choose(files); }}
      />
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {drawerPresent ? (
        <WorkspaceDrawer
          copy={copy}
          sites={sites}
          selected={selected}
          groups={workspace.groups}
          statuses={statuses}
          health={health}
          healthChecking={healthChecking}
          open={drawerOpen}
          state={panelState ?? lastOpenPanel.current}
          onStateChange={changePanelState}
          onSelectionChange={workspaceFlow.changeSelection}
          onSaveGroup={workspaceFlow.saveGroup}
          onDeleteGroup={workspaceFlow.deleteGroup}
          onCheckHealth={(keys) => { void refreshSiteHealth(keys); }}
          onFocusSite={(site) => {
            changePanelState(null);
            setMode("focus", site);
          }}
          onReloadSite={(site) => {
            void window.polyask.reloadSite(site).then((ok) => {
              const definition = sites.find((candidate) => candidate.key === site);
              setAnnouncement(ok
                ? formatCopy(copy.healthReloaded, { site: definition?.label ?? site })
                : formatCopy(copy.healthReloadRejected, { site: definition?.label ?? site }));
              if (ok) setHealth((current) => ({ ...current, [site]: { site, state: "unknown", checks: [] } }));
            }).catch(() => setAnnouncement(copy.workspaceActionFailed));
          }}
          onHardReloadSite={(site) => {
            void window.polyask.reloadSite(site, true).then((ok) => {
              const definition = sites.find((candidate) => candidate.key === site);
              setAnnouncement(ok
                ? formatCopy(copy.healthReloaded, { site: definition?.label ?? site })
                : formatCopy(copy.healthReloadRejected, { site: definition?.label ?? site }));
              if (ok) setHealth((current) => ({ ...current, [site]: { site, state: "unknown", checks: [] } }));
            }).catch(() => setAnnouncement(copy.workspaceActionFailed));
          }}
          onClearSiteData={(site) => {
            void window.polyask.clearSiteData(site).then((ok) => {
              const definition = sites.find((candidate) => candidate.key === site);
              setAnnouncement(ok
                ? formatCopy(copy.healthReloaded, { site: definition?.label ?? site })
                : formatCopy(copy.healthReloadRejected, { site: definition?.label ?? site }));
              if (ok) setHealth((current) => ({ ...current, [site]: { site, state: "unknown", checks: [] } }));
            }).catch(() => setAnnouncement(copy.workspaceActionFailed));
          }}
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
        onReload={(site) => { void window.polyask.reloadSite(site); }}
        history={siteHistory}
        onBack={(site) => window.polyask.stepHistory(-1, site)}
      />
      {pendingNewSession && (
        <ConfirmDialog
          copy={copy}
          title={copy.newSessionConfirmTitle}
          message={formatCopy(copy.newSessionConfirmMessage, { count: pendingNewSession.count })}
          confirmLabel={copy.newSessionConfirmAction}
          cancelLabel={copy.newSessionKeepCurrent}
          onConfirm={() => { pendingNewSession.decide(true); setPendingNewSession(null); }}
          onCancel={() => { pendingNewSession.decide(false); setPendingNewSession(null); }}
        />
      )}
    </main>
  );
}

document.documentElement.lang = resolveLocale(navigator.language) === "zhCN"
  ? "zh-CN"
  : resolveLocale(navigator.language) === "zhTW" ? "zh-TW" : "en";
document.title = getCopy(navigator.language).appTitle;
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
