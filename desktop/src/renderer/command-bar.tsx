import type { ReactNode, RefObject } from "react";

import type { DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import type { SyncStatus } from "../shared/sync";
import { DeepThinkIcon, FastIcon, FocusIcon, GridIcon, SendIcon, SiteSettingIcon, StopIcon } from "./icons";
import { commandKeyAction } from "./keyboard";
import { WorkspaceActions } from "./workspace-actions";

export type RunState = "idle" | "sending" | "cancelling";

interface CommandBarProps {
  readonly copy: DesktopCopy;
  readonly promptRef: RefObject<HTMLTextAreaElement | null>;
  readonly text: string;
  readonly tier: Tier;
  readonly runState: RunState;
  readonly auxiliaryBusy: boolean;
  readonly layoutMode: "overview" | "focus";
  readonly selectedCount: number;
  readonly totalSites: number;
  readonly activeCount: number;
  readonly drawerOpen: boolean;
  readonly imageControl: ReactNode;
  readonly sendBlockedReason: string | null;
  readonly synthesisPending: boolean;
  readonly syncStatus: SyncStatus;
  readonly isMac: boolean;
  readonly expanded: boolean;
  readonly onTextChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly onTierChange: (value: Tier) => void;
  readonly onLayoutChange: (value: "overview" | "focus") => void;
  readonly onExpandedChange: (value: boolean) => void;
  readonly onToggleDrawer: () => void;
  readonly onNewSession: () => void;
  readonly onCollectAnswers: () => void;
  readonly onOpenArchive: () => void;
  readonly onCollectSynthesis: () => void;
  readonly onOpenSettings: () => void;
  readonly onPasteImages: (files: readonly File[]) => void;
}

export function CommandBar(props: CommandBarProps): React.JSX.Element {
  const {
    copy,
    promptRef,
    text,
    tier,
    runState,
    auxiliaryBusy,
    layoutMode,
    selectedCount,
    totalSites,
    activeCount,
    drawerOpen,
    imageControl,
    sendBlockedReason,
    synthesisPending,
    isMac,
    expanded,
    onTextChange,
    onSubmit,
    onCancel,
    onTierChange,
    onLayoutChange,
    onExpandedChange,
    onToggleDrawer,
    onNewSession,
    onCollectAnswers,
    onOpenArchive,
    onCollectSynthesis,
    onOpenSettings,
    onPasteImages
  } = props;
  const tierOptions = [
    { value: null, label: copy.followSite, icon: "site-setting", glyph: <SiteSettingIcon /> },
    { value: "fast", label: copy.fast, icon: "fast", glyph: <FastIcon /> },
    { value: "think", label: copy.think, icon: "think", glyph: <DeepThinkIcon /> }
  ] as const;

  return (
    <header className={expanded ? "command-bar is-expanded" : "command-bar"} aria-label={copy.broadcastLabel}>
      <div className="mode-switch priority-p0" aria-label={copy.layoutLabel}>
        <button type="button" title={copy.overview} aria-pressed={layoutMode === "overview"} className={layoutMode === "overview" ? "active" : ""} onClick={() => onLayoutChange("overview")}>
          <GridIcon /><span className="priority-p1">{copy.overview}</span>
        </button>
        <button type="button" title={copy.focus} aria-pressed={layoutMode === "focus"} className={layoutMode === "focus" ? "active" : ""} onClick={() => onLayoutChange("focus")}>
          <FocusIcon /><span className="priority-p1">{copy.focus}</span>
        </button>
      </div>
      <textarea
        className="priority-p0"
        name="prompt"
        autoComplete="off"
        ref={promptRef}
        rows={1}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
          if (files.length) onPasteImages(files);
        }}
        onFocus={() => onExpandedChange(true)}
        onBlur={() => onExpandedChange(false)}
        onKeyDown={(event) => {
          const action = commandKeyAction({
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            isComposing: event.nativeEvent.isComposing
          });
          if (action === "submit") {
            event.preventDefault();
            onSubmit();
          } else if (action === "collapse") {
            onExpandedChange(false);
          }
        }}
        placeholder={copy.promptPlaceholder}
        aria-label={copy.promptLabel}
      />
      <div className="tier-switch priority-p0" aria-label={copy.tierLabel}>
        {tierOptions.map(({ value, label, icon, glyph }) => (
          <button type="button" key={icon} title={label} aria-label={label} aria-pressed={tier === value} data-tier-icon={icon} className={tier === value ? "active" : ""} onClick={() => onTierChange(value)}>{glyph}</button>
        ))}
      </div>
      {imageControl}
      <WorkspaceActions
        copy={copy}
        selectedCount={selectedCount}
        totalSites={totalSites}
        activeCount={activeCount}
        drawerOpen={drawerOpen}
        disabled={runState !== "idle" || auxiliaryBusy}
        synthesisPending={synthesisPending}
        syncStatus={props.syncStatus}
        onToggleDrawer={onToggleDrawer}
        onNewSession={onNewSession}
        onCollectAnswers={onCollectAnswers}
        onOpenArchive={onOpenArchive}
        onCollectSynthesis={onCollectSynthesis}
        onOpenSettings={onOpenSettings}
      />
      {runState !== "idle" ? (
        <button type="button" className="cancel primary-action priority-p0" disabled={runState === "cancelling"} onClick={onCancel}>
          <StopIcon /><span>{runState === "cancelling" ? copy.cancelling : copy.cancel}</span>
        </button>
      ) : (
        <button type="button" className="send primary-action priority-p0" title={sendBlockedReason ?? undefined} disabled={auxiliaryBusy || !text.trim() || selectedCount === 0 || !!sendBlockedReason} onClick={onSubmit}>
          <SendIcon /><span>{copy.send}</span><kbd>{isMac ? "⌘↵" : "Ctrl+↵"}</kbd>
        </button>
      )}
    </header>
  );
}
