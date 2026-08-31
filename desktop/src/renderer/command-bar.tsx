import type { ReactNode, RefObject } from "react";

import type { DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import type { SyncStatus } from "../shared/sync";
import { ChevronDownIcon, DeepThinkIcon, FastIcon, FocusIcon, GridIcon, HealthIcon, SendIcon, SiteSettingIcon, StopIcon } from "./icons";
import { commandKeyAction } from "./keyboard";
import type { WorkspacePanelTab } from "./workspace-panel-state";
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
  readonly failureCount: number;
  readonly cancelledCount: number;
  readonly scopeLabel: string;
  readonly healthAttention: number;
  readonly panelTab: WorkspacePanelTab | null;
  readonly pageControl?: ReactNode;
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
  readonly onOpenPanel: (tab: WorkspacePanelTab) => void;
  readonly onShowGroupMenu: () => void;
  readonly onOpenMore: () => void;
  readonly onPasteImages: (files: readonly File[]) => void;
}

export function CommandBar(props: CommandBarProps): React.JSX.Element {
  const tierOptions = [
    { value: null, label: props.copy.followSite, icon: "site-setting", glyph: <SiteSettingIcon /> },
    { value: "fast", label: props.copy.fast, icon: "fast", glyph: <FastIcon /> },
    { value: "think", label: props.copy.think, icon: "think", glyph: <DeepThinkIcon /> }
  ] as const;
  const busy = props.runState !== "idle" || props.auxiliaryBusy;

  return (
    <header className={`command-bar${props.pageControl ? " has-pages" : ""}${props.expanded ? " is-expanded" : ""}`} aria-label={props.copy.broadcastLabel}>
      <div className="workspace-entry priority-p0">
        <div className="scope-split">
          <button type="button" className="scope-main" title={props.scopeLabel} aria-label={props.scopeLabel} aria-expanded={props.panelTab === "sites"} aria-controls="workspace-panel" onClick={() => props.onOpenPanel("sites")}>
            <span className="scope-label-full">{props.scopeLabel}</span>
            <span className="scope-label-compact">{props.copy.sitesCompact} · {props.selectedCount}</span>
          </button>
          <button type="button" className="scope-menu" title={props.copy.chooseSavedGroup} aria-label={props.copy.chooseSavedGroup} aria-haspopup="menu" onClick={props.onShowGroupMenu}><ChevronDownIcon /></button>
        </div>
        <button type="button" className={props.panelTab === "health" ? "health-trigger active" : "health-trigger"} title={props.copy.siteHealth} aria-label={props.copy.siteHealth} aria-pressed={props.panelTab === "health"} aria-controls="workspace-panel" data-health-attention={props.healthAttention || undefined} onClick={() => props.onOpenPanel("health")}><HealthIcon /></button>
      </div>
      <div className="mode-switch priority-p0" aria-label={props.copy.layoutLabel}>
        <button type="button" title={props.copy.overview} aria-pressed={props.layoutMode === "overview"} className={props.layoutMode === "overview" ? "active" : ""} onClick={() => props.onLayoutChange("overview")}><GridIcon /><span className="priority-p1">{props.copy.overview}</span></button>
        <button type="button" title={props.copy.focus} aria-pressed={props.layoutMode === "focus"} className={props.layoutMode === "focus" ? "active" : ""} onClick={() => props.onLayoutChange("focus")}><FocusIcon /><span className="priority-p1">{props.copy.focus}</span></button>
      </div>
      {props.pageControl}
      <textarea
        className="priority-p0"
        name="prompt"
        autoComplete="off"
        ref={props.promptRef}
        rows={1}
        value={props.text}
        onChange={(event) => props.onTextChange(event.target.value)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
          if (files.length) props.onPasteImages(files);
        }}
        onFocus={() => props.onExpandedChange(true)}
        onBlur={() => props.onExpandedChange(false)}
        onKeyDown={(event) => {
          const action = commandKeyAction({
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            isComposing: event.nativeEvent.isComposing
          }, busy);
          if (action === "submit") {
            event.preventDefault();
            props.onSubmit();
          } else if (action === "collapse") {
            props.onExpandedChange(false);
          }
        }}
        placeholder={props.copy.promptPlaceholder}
        aria-label={props.copy.promptLabel}
      />
      <div className="tier-switch priority-p0" aria-label={props.copy.tierLabel}>
        {tierOptions.map(({ value, label, icon, glyph }) => (
          <button type="button" key={icon} title={label} aria-label={label} aria-pressed={props.tier === value} data-tier-icon={icon} className={props.tier === value ? "active" : ""} onClick={() => props.onTierChange(value)}>{glyph}</button>
        ))}
      </div>
      {props.imageControl}
      {props.runState !== "idle" ? (
        <button type="button" className="cancel primary-action priority-p0" disabled={props.runState === "cancelling"} onClick={props.onCancel}><StopIcon /><span>{props.runState === "cancelling" ? props.copy.cancelling : props.copy.cancel}</span></button>
      ) : (
        <button type="button" className="send primary-action priority-p0" title={props.sendBlockedReason ?? undefined} disabled={props.auxiliaryBusy || !props.text.trim() || props.selectedCount === 0 || !!props.sendBlockedReason} onClick={props.onSubmit}><SendIcon /><span>{props.copy.send}</span><kbd>{props.isMac ? "⌘↵" : "Ctrl+↵"}</kbd></button>
      )}
      <WorkspaceActions copy={props.copy} disabled={busy} failureCount={props.failureCount} cancelledCount={props.cancelledCount} synthesisPending={props.synthesisPending} syncStatus={props.syncStatus} onOpenMore={props.onOpenMore} />
    </header>
  );
}
