import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, getCopy, resolveLocale } from "../shared/copy";
import type { DisplayPreferences } from "../shared/display";
import {
  unsupportedImageSites,
  type DesktopImage,
  type ImageInputError
} from "../shared/images";
import type { LayoutState, SiteStatus } from "../shared/protocol";
import { describeStatus } from "../shared/status-copy";
import type { WorkspaceState } from "../shared/workspace";
import { CommandBar, type RunState } from "./command-bar";
import {
  loadDisplayPreferences,
  saveDisplayPreferences
} from "./display-preferences";
import { ImagePicker, readDesktopImages } from "./image-picker";
import { SiteFrames } from "./site-frames";
import { WorkspaceDrawer } from "./workspace-drawer";
import "./styles.css";

const INITIAL_LAYOUT: LayoutState = {
  mode: "overview",
  focused: "claude",
  placements: []
};

const INITIAL_DISPLAY = loadDisplayPreferences(
  window.localStorage,
  window.matchMedia("(pointer: coarse)").matches
);
const INITIAL_WORKSPACE: WorkspaceState = { selectedSites: [], groups: [], tier: null };

function applyDisplayPreferences(value: DisplayPreferences): void {
  document.documentElement.dataset.density = value.density;
  saveDisplayPreferences(window.localStorage, value);
}

applyDisplayPreferences(INITIAL_DISPLAY);

function App(): React.JSX.Element {
  const copy = useMemo(() => getCopy(navigator.language), []);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<readonly SiteKey[]>([]);
  const imageReadEpoch = useRef(0);
  const [sites, setSites] = useState<readonly SiteDefinition[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SiteStatus>>({});
  const [layout, setLayout] = useState<LayoutState>(INITIAL_LAYOUT);
  const [workspace, setWorkspace] = useState<WorkspaceState>(INITIAL_WORKSPACE);
  const [text, setText] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [imageTrayOpen, setImageTrayOpen] = useState(false);
  const [images, setImages] = useState<readonly DesktopImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const acceptWorkspace = (value: WorkspaceState): void => {
    selectionRef.current = value.selectedSites;
    setWorkspace(value);
  };
  const recoverWorkspace = (): void => {
    setAnnouncement(copy.workspaceActionFailed);
    void window.polyask.bootstrap()
      .then((state) => acceptWorkspace(state.workspace))
      .catch(() => undefined);
  };
  const changeSelection = (value: readonly SiteKey[]): void => {
    const ordered = sites.map((site) => site.key).filter((key) => value.includes(key));
    selectionRef.current = ordered;
    setWorkspace((current) => ({ ...current, selectedSites: ordered }));
    void window.polyask.setSelection(ordered).then(acceptWorkspace).catch(recoverWorkspace);
  };
  const changeDrawerOpen = (value: boolean): void => {
    setDrawerOpen(value);
    window.polyask.setDrawerOpen(value);
  };
  const imageErrorText = (code: ImageInputError): string => ({
    image_count: copy.imageCountError,
    image_type: copy.imageTypeError,
    image_size: copy.imageSizeError,
    image_invalid: copy.imageInvalid
  })[code];
  const chooseImages = async (files: readonly File[]): Promise<void> => {
    if (runState !== "idle") return;
    const epoch = ++imageReadEpoch.current;
    const result = await readDesktopImages(files);
    if (epoch !== imageReadEpoch.current) return;
    if (!result.ok) {
      const message = imageErrorText(result.code);
      setImageError(message);
      setAnnouncement(message);
      return;
    }
    setImages(result.images);
    setImageError(null);
    setImageTrayOpen(true);
    setAnnouncement(formatCopy(copy.imagesReady, { count: result.images.length }));
  };

  useEffect(() => {
    let active = true;
    void window.polyask.bootstrap().then((state) => {
      if (!active) return;
      setSites(state.sites);
      setStatuses(Object.fromEntries(state.statuses.map((status) => [status.site, status])));
      setLayout(state.layout);
      acceptWorkspace(state.workspace);
    });
    const offStatus = window.polyask.onStatus((status) => {
      setStatuses((current) => ({ ...current, [status.site]: status }));
      setAnnouncement(`${status.site}: ${describeStatus(copy, status)}`);
    });
    const offLayout = window.polyask.onLayout(setLayout);
    const offDisplay = window.polyask.onDisplayPreferences(applyDisplayPreferences);
    const offFocusPrompt = window.polyask.onFocusPrompt(() => promptRef.current?.focus());
    const offWorkspace = window.polyask.onWorkspaceState(acceptWorkspace);
    void window.polyask.setDisplayPreferences(INITIAL_DISPLAY).then(applyDisplayPreferences);
    return () => {
      active = false;
      offStatus();
      offLayout();
      offDisplay();
      offFocusPrompt();
      offWorkspace();
    };
  }, [copy]);

  const composerExpanded = promptExpanded || imageTrayOpen;
  useEffect(() => window.polyask.setComposerExpanded(composerExpanded), [composerExpanded]);

  const activeCount = useMemo(
    () => Object.values(statuses).filter((status) => status.phase === "sending").length,
    [statuses]
  );
  const selected = useMemo(() => new Set(workspace.selectedSites), [workspace.selectedSites]);
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
      setImageTrayOpen(false);
      changeDrawerOpen(true);
      return;
    }
    imageReadEpoch.current += 1;
    setImageTrayOpen(false);
    setRunState("sending");
    try {
      await window.polyask.broadcast({
        text: prompt,
        tier: workspace.tier,
        sites: [...selected],
        images
      });
    } catch {
      setAnnouncement(copy.failed);
    } finally {
      setRunState("idle");
    }
  };

  const setMode = (mode: "overview" | "focus", focused = layout.focused): void => {
    window.polyask.setLayout(mode, focused);
  };

  const toggleSite = (site: SiteKey): void => {
    const next = new Set(selectionRef.current);
    if (next.has(site)) next.delete(site);
    else next.add(site);
    changeSelection(sites.map((item) => item.key).filter((key) => next.has(key)));
  };

  return (
    <main className={`app-shell${composerExpanded ? " is-composer-expanded" : ""}${drawerOpen ? " has-drawer" : ""}`}>
      <CommandBar
        copy={copy}
        promptRef={promptRef}
        text={text}
        tier={workspace.tier}
        runState={runState}
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
            error={imageError}
            onOpenChange={setImageTrayOpen}
            onFiles={(files) => { void chooseImages(files); }}
            onRemove={(index) => {
              imageReadEpoch.current += 1;
              const next = images.filter((_image, current) => current !== index);
              setImages(next);
              setImageError(null);
              if (!next.length) setImageTrayOpen(false);
              setAnnouncement(formatCopy(copy.imagesReady, { count: next.length }));
            }}
            onAdjustScope={() => { setImageTrayOpen(false); changeDrawerOpen(true); }}
          />
        )}
        sendBlockedReason={imageWarning}
        isMac={navigator.userAgent.includes("Mac")}
        expanded={composerExpanded}
        onTextChange={setText}
        onSubmit={() => void submit()}
        onCancel={() => { setRunState("cancelling"); window.polyask.cancel(); }}
        onTierChange={(value) => {
          setWorkspace((current) => ({ ...current, tier: value }));
          void window.polyask.setTier(value).then(acceptWorkspace).catch(recoverWorkspace);
        }}
        onLayoutChange={setMode}
        onExpandedChange={setPromptExpanded}
        onToggleDrawer={() => {
          changeDrawerOpen(!drawerOpen);
        }}
        onNewSession={() => { void window.polyask.newSession([...selected]).catch(recoverWorkspace); }}
        onPasteImages={(files) => { void chooseImages(files); }}
      />
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {drawerOpen ? (
        <WorkspaceDrawer
          copy={copy}
          sites={sites}
          selected={selected}
          groups={workspace.groups}
          onClose={() => changeDrawerOpen(false)}
          onSelectionChange={changeSelection}
          onSaveGroup={(name) => {
            void window.polyask.saveGroup({ name, sites: [...selected] }).then(acceptWorkspace).catch(recoverWorkspace);
          }}
          onDeleteGroup={(id) => { void window.polyask.deleteGroup(id).then(acceptWorkspace).catch(recoverWorkspace); }}
        />
      ) : null}
      <SiteFrames
        copy={copy}
        sites={sites}
        statuses={statuses}
        layout={layout}
        selected={selected}
        onToggle={toggleSite}
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
