import type { RefObject } from "react";

import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import { FocusIcon, GridIcon, SendIcon, StopIcon } from "./icons";

export type RunState = "idle" | "sending" | "cancelling";

interface CommandBarProps {
  readonly copy: DesktopCopy;
  readonly promptRef: RefObject<HTMLTextAreaElement | null>;
  readonly text: string;
  readonly tier: Tier;
  readonly runState: RunState;
  readonly layoutMode: "overview" | "focus";
  readonly selectedCount: number;
  readonly totalSites: number;
  readonly activeCount: number;
  readonly isMac: boolean;
  readonly expanded: boolean;
  readonly onTextChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly onTierChange: (value: Tier) => void;
  readonly onLayoutChange: (value: "overview" | "focus") => void;
  readonly onExpandedChange: (value: boolean) => void;
}

export function CommandBar(props: CommandBarProps): React.JSX.Element {
  const {
    copy,
    promptRef,
    text,
    tier,
    runState,
    layoutMode,
    selectedCount,
    totalSites,
    activeCount,
    isMac,
    expanded,
    onTextChange,
    onSubmit,
    onCancel,
    onTierChange,
    onLayoutChange,
    onExpandedChange
  } = props;
  const summary = formatCopy(activeCount > 0 ? copy.sendingSummary : copy.selectedSummary, {
    count: activeCount,
    selected: selectedCount,
    total: totalSites || 9
  });

  return (
    <header className={expanded ? "command-bar is-expanded" : "command-bar"} aria-label={copy.broadcastLabel}>
      <div className="brand" aria-label={copy.appTitle}>
        <span className="brand-mark">P</span>
        <span className="brand-name">PolyAsk</span>
      </div>
      <div className="mode-switch" aria-label={copy.layoutLabel}>
        <button type="button" title={copy.overview} aria-pressed={layoutMode === "overview"} className={layoutMode === "overview" ? "active" : ""} onClick={() => onLayoutChange("overview")}>
          <GridIcon /><span>{copy.overview}</span>
        </button>
        <button type="button" title={copy.focus} aria-pressed={layoutMode === "focus"} className={layoutMode === "focus" ? "active" : ""} onClick={() => onLayoutChange("focus")}>
          <FocusIcon /><span>{copy.focus}</span>
        </button>
      </div>
      <textarea
        ref={promptRef}
        rows={1}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onFocus={() => onExpandedChange(true)}
        onBlur={() => onExpandedChange(false)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          } else if (event.key === "Escape") {
            onExpandedChange(false);
          }
        }}
        placeholder={copy.promptPlaceholder}
        aria-label={copy.promptLabel}
      />
      <div className="tier-switch" aria-label={copy.tierLabel}>
        {([[null, copy.followSite], ["fast", copy.fast], ["think", copy.think]] as const).map(([value, label]) => (
          <button type="button" key={label} aria-pressed={tier === value} className={tier === value ? "active" : ""} onClick={() => onTierChange(value)}>{label}</button>
        ))}
      </div>
      <span className="summary" role="status" aria-live="polite">{summary}</span>
      {runState !== "idle" ? (
        <button type="button" className="cancel primary-action" disabled={runState === "cancelling"} onClick={onCancel}>
          <StopIcon /><span>{runState === "cancelling" ? copy.cancelling : copy.cancel}</span>
        </button>
      ) : (
        <button type="button" className="send primary-action" disabled={!text.trim() || selectedCount === 0} onClick={onSubmit}>
          <SendIcon /><span>{copy.send}</span><kbd>{isMac ? "⌘↵" : "Ctrl+↵"}</kbd>
        </button>
      )}
    </header>
  );
}
