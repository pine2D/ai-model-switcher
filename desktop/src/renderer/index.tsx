import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, getCopy, resolveLocale } from "../shared/copy";
import type { DisplayPreferences } from "../shared/display";
import type { LayoutState, SiteStatus, Tier } from "../shared/protocol";
import { describeStatus } from "../shared/status-copy";
import {
  loadDisplayPreferences,
  saveDisplayPreferences
} from "./display-preferences";
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
  const [runState, setRunState] = useState<"idle" | "sending" | "cancelling">("idle");
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><span>PolyAsk</span><small>{copy.brandSub}</small></div>
        <div className="mode-switch" aria-label={copy.layoutLabel}>
          <button aria-pressed={layout.mode === "overview"} className={layout.mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>{copy.overview}</button>
          <button aria-pressed={layout.mode === "focus"} className={layout.mode === "focus" ? "active" : ""} onClick={() => setMode("focus")}>{copy.focus}</button>
        </div>
        <div className="summary" role="status" aria-live="polite">
          {formatCopy(activeCount > 0 ? copy.sendingSummary : copy.selectedSummary, {
            count: activeCount,
            selected: selected.size,
            total: sites.length || 9
          })}
        </div>
      </header>

      <section className="composer" aria-label={copy.broadcastLabel}>
        <textarea
          ref={promptRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={copy.promptPlaceholder}
          aria-label={copy.promptLabel}
        />
        <div className="tier-switch" aria-label={copy.tierLabel}>
          {([[null, copy.followSite], ["fast", copy.fast], ["think", copy.think]] as const).map(([value, label]) => (
            <button key={label} aria-pressed={tier === value} className={tier === value ? "active" : ""} onClick={() => setTier(value)}>{label}</button>
          ))}
        </div>
        {runState !== "idle"
          ? <button className="cancel" disabled={runState === "cancelling"} onClick={() => { setRunState("cancelling"); window.polyask.cancel(); }}>{runState === "cancelling" ? copy.cancelling : copy.cancel}</button>
          : <button className="send" disabled={!text.trim() || selected.size === 0} onClick={() => void submit()}>{copy.send} <kbd>{navigator.userAgent.includes("Mac") ? "⌘↵" : "Ctrl+↵"}</kbd></button>}
      </section>
      <div className="sr-only" aria-live="polite">{announcement}</div>

      <section className="tile-layer" aria-label={copy.siteViews}>
        {layout.placements.map((placement) => {
          const site = sites.find((candidate) => candidate.key === placement.key);
          const status = statuses[placement.key] ?? { site: placement.key, phase: "loading" as const };
          if (!site) return null;
          return (
            <article
              className={`tile-frame phase-${status.phase}`}
              key={site.key}
              style={{
                left: placement.bounds.x,
                top: placement.bounds.y,
                width: placement.bounds.width,
                height: placement.bounds.height
              }}
            >
              <div className="tile-header">
                <label className="site-select" title={formatCopy(copy.selectSite, { site: site.label })}>
                  <input type="checkbox" checked={selected.has(site.key)} onChange={() => toggleSite(site.key)} />
                  <span>{site.label}</span>
                </label>
                <span className="answer-rail" aria-hidden="true" />
                <span className="site-state">{describeStatus(copy, status)}</span>
                <button title={formatCopy(copy.focusSite, { site: site.label })} aria-label={formatCopy(copy.focusSite, { site: site.label })} onClick={() => setMode("focus", site.key)}>⌗</button>
                <button title={formatCopy(copy.reloadSite, { site: site.label })} aria-label={formatCopy(copy.reloadSite, { site: site.label })} onClick={() => window.polyask.reloadSite(site.key)}>↻</button>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

document.documentElement.lang = resolveLocale(navigator.language) === "zhCN"
  ? "zh-CN"
  : resolveLocale(navigator.language) === "zhTW" ? "zh-TW" : "en";
document.title = getCopy(navigator.language).appTitle;
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
