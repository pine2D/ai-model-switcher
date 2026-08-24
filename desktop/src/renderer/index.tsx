import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { getCopy, resolveLocale } from "../shared/copy";
import type { DisplayPreferences } from "../shared/display";
import type { LayoutState, SiteStatus, Tier } from "../shared/protocol";
import { describeStatus } from "../shared/status-copy";
import { CommandBar, type RunState } from "./command-bar";
import {
  loadDisplayPreferences,
  saveDisplayPreferences
} from "./display-preferences";
import { SiteFrames } from "./site-frames";
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
  const [selected, setSelected] = useState<Set<SiteKey>>(new Set());
  const [text, setText] = useState("");
  const [tier, setTier] = useState<Tier>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let active = true;
    void window.polyask.bootstrap().then((state) => {
      if (!active) return;
      setSites(state.sites);
      setStatuses(Object.fromEntries(state.statuses.map((status) => [status.site, status])));
      setLayout(state.layout);
      setSelected(new Set(state.sites.map((site) => site.key)));
    });
    const offStatus = window.polyask.onStatus((status) => {
      setStatuses((current) => ({ ...current, [status.site]: status }));
      setAnnouncement(`${status.site}: ${describeStatus(copy, status)}`);
    });
    const offLayout = window.polyask.onLayout(setLayout);
    const offDisplay = window.polyask.onDisplayPreferences(applyDisplayPreferences);
    const offFocusPrompt = window.polyask.onFocusPrompt(() => promptRef.current?.focus());
    void window.polyask.setDisplayPreferences(INITIAL_DISPLAY).then(applyDisplayPreferences);
    return () => {
      active = false;
      offStatus();
      offLayout();
      offDisplay();
      offFocusPrompt();
    };
  }, [copy]);

  const activeCount = useMemo(
    () => Object.values(statuses).filter((status) => status.phase === "sending").length,
    [statuses]
  );

  const submit = async (): Promise<void> => {
    const prompt = text.trim();
    if (!prompt || selected.size === 0 || runState !== "idle") return;
    setRunState("sending");
    try {
      await window.polyask.broadcast({ text: prompt, tier, sites: [...selected] });
    } finally {
      setRunState("idle");
    }
  };

  const setMode = (mode: "overview" | "focus", focused = layout.focused): void => {
    window.polyask.setLayout(mode, focused);
  };

  const toggleSite = (site: SiteKey): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(site)) next.delete(site);
      else next.add(site);
      return next;
    });
  };

  const changeComposerExpanded = (value: boolean): void => {
    setComposerExpanded(value);
    window.polyask.setComposerExpanded(value);
  };

  return (
    <main className="app-shell">
      <CommandBar
        copy={copy}
        promptRef={promptRef}
        text={text}
        tier={tier}
        runState={runState}
        layoutMode={layout.mode}
        selectedCount={selected.size}
        totalSites={sites.length || 9}
        activeCount={activeCount}
        isMac={navigator.userAgent.includes("Mac")}
        expanded={composerExpanded}
        onTextChange={setText}
        onSubmit={() => void submit()}
        onCancel={() => { setRunState("cancelling"); window.polyask.cancel(); }}
        onTierChange={setTier}
        onLayoutChange={setMode}
        onExpandedChange={changeComposerExpanded}
      />
      <div className="sr-only" aria-live="polite">{announcement}</div>
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
