import { useEffect, useRef } from "react";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { SiteStatus } from "../shared/protocol";
import type { SiteHealth } from "../shared/site-health";
import type { ActiveWorkspaceGroup } from "../shared/workspace";
import { CloseIcon, HealthIcon, ScopeIcon } from "./icons";
import { pageTabKeyAction } from "./keyboard";
import { SiteHealthPanel } from "./site-health";
import {
  escapeWorkspacePanel,
  showWorkspaceDetail,
  type OpenWorkspacePanelState
} from "./workspace-panel-state";
import { WorkspaceSites } from "./workspace-sites";

interface WorkspaceDrawerProps {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly selected: ReadonlySet<SiteKey>;
  readonly groups: readonly ActiveWorkspaceGroup[];
  readonly statuses: Readonly<Record<string, SiteStatus>>;
  readonly health: Readonly<Partial<Record<SiteKey, SiteHealth>>>;
  readonly healthChecking: boolean;
  readonly open: boolean;
  readonly state: OpenWorkspacePanelState;
  readonly onStateChange: (state: OpenWorkspacePanelState | null) => void;
  readonly onSelectionChange: (sites: readonly SiteKey[]) => void;
  readonly onSaveGroup: (name: string) => Promise<boolean>;
  readonly onDeleteGroup: (id: string) => void;
  readonly onCheckHealth: (sites: readonly SiteKey[]) => void;
  readonly onFocusSite: (site: SiteKey) => void;
  readonly onReloadSite: (site: SiteKey) => void;
  readonly onHardReloadSite: (site: SiteKey) => void;
  readonly onClearSiteData: (site: SiteKey) => void;
}

export function WorkspaceDrawer(props: WorkspaceDrawerProps): React.JSX.Element {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onStateChange(escapeWorkspacePanel(props.state));
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [props.onStateChange, props.state]);
  const detailSite = props.state.detail
    ? props.sites.find((site) => site.key === props.state.detail)
    : null;
  const selectedSites = props.sites.filter((site) => props.selected.has(site.key));
  const selectTab = (tab: OpenWorkspacePanelState["tab"]): void => {
    props.onStateChange({ ...props.state, tab, detail: null });
  };
  const onTabKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const action = pageTabKeyAction(event.key, index, 2);
    if (!action) return;
    event.preventDefault();
    tabRefs.current[action.focus]?.focus();
    if (action.activate) selectTab(action.focus === 0 ? "sites" : "health");
  };

  return (
    <aside
      id="workspace-panel"
      className="workspace-drawer"
      aria-label={props.copy.workbench}
      aria-hidden={props.open ? undefined : true}
      inert={!props.open}
      data-state={props.open ? "open" : "closed"}
      data-input-method={props.state.inputMethod}
    >
      <div className="drawer-heading">
        <strong>{props.copy.workbench}</strong>
        <button type="button" title={props.copy.closeWorkbench} aria-label={props.copy.closeWorkbench} onClick={() => props.onStateChange(null)}><CloseIcon /></button>
      </div>
      <div className="workspace-tabs" role="tablist" aria-label={props.copy.workbench}>
        <button id="workspace-sites-tab" type="button" role="tab" aria-selected={props.state.tab === "sites"} aria-controls="workspace-sites-panel" tabIndex={props.state.tab === "sites" ? 0 : -1} ref={(element) => { tabRefs.current[0] = element; }} onClick={() => selectTab("sites")} onKeyDown={(event) => onTabKeyDown(event, 0)}><ScopeIcon />{props.copy.sitesAndGroups}</button>
        <button id="workspace-health-tab" type="button" role="tab" aria-selected={props.state.tab === "health"} aria-controls="workspace-health-panel" tabIndex={props.state.tab === "health" ? 0 : -1} ref={(element) => { tabRefs.current[1] = element; }} onClick={() => selectTab("health")} onKeyDown={(event) => onTabKeyDown(event, 1)}><HealthIcon />{props.copy.siteHealth}</button>
      </div>
      {props.state.tab === "sites" ? (
        <div id="workspace-sites-panel" role="tabpanel" aria-labelledby="workspace-sites-tab"><WorkspaceSites {...props} /></div>
      ) : (
        <div id="workspace-health-panel" role="tabpanel" aria-labelledby="workspace-health-tab">
          <SiteHealthPanel
            copy={props.copy}
            sites={selectedSites}
            statuses={props.statuses}
            health={props.health}
            detail={detailSite?.key ?? null}
            checking={props.healthChecking}
            onDetail={(site) => props.onStateChange(showWorkspaceDetail(props.state, site))}
            onCheck={props.onCheckHealth}
            onFocus={props.onFocusSite}
            onReload={props.onReloadSite}
            onHardReload={props.onHardReloadSite}
            onClearData={props.onClearSiteData}
            onBack={() => props.onStateChange({ ...props.state, detail: null })}
          />
        </div>
      )}
    </aside>
  );
}
