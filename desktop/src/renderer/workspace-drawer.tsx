import { useEffect } from "react";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import type { DesktopCopy } from "../shared/copy";
import type { SiteStatus } from "../shared/protocol";
import { describeStatus } from "../shared/status-copy";
import type { ActiveWorkspaceGroup } from "../shared/workspace";
import { BackIcon, CloseIcon, HealthIcon, ScopeIcon } from "./icons";
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
  readonly open: boolean;
  readonly state: OpenWorkspacePanelState;
  readonly onStateChange: (state: OpenWorkspacePanelState | null) => void;
  readonly onSelectionChange: (sites: readonly SiteKey[]) => void;
  readonly onSaveGroup: (name: string) => Promise<boolean>;
  readonly onDeleteGroup: (id: string) => void;
}

export function WorkspaceDrawer(props: WorkspaceDrawerProps): React.JSX.Element {
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
  const detailStatus = detailSite ? props.statuses[detailSite.key] : null;

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
        <button id="workspace-sites-tab" type="button" role="tab" aria-selected={props.state.tab === "sites"} aria-controls="workspace-sites-panel" tabIndex={props.state.tab === "sites" ? 0 : -1} onClick={() => props.onStateChange({ ...props.state, tab: "sites", detail: null })}><ScopeIcon />{props.copy.sitesAndGroups}</button>
        <button id="workspace-health-tab" type="button" role="tab" aria-selected={props.state.tab === "health"} aria-controls="workspace-health-panel" tabIndex={props.state.tab === "health" ? 0 : -1} onClick={() => props.onStateChange({ ...props.state, tab: "health", detail: null })}><HealthIcon />{props.copy.siteHealth}</button>
      </div>
      {props.state.tab === "sites" ? (
        <div id="workspace-sites-panel" role="tabpanel" aria-labelledby="workspace-sites-tab"><WorkspaceSites {...props} /></div>
      ) : (
        <div id="workspace-health-panel" role="tabpanel" aria-labelledby="workspace-health-tab">
          {detailSite ? (
            <section className="site-status-detail">
              <button type="button" className="detail-back" onClick={() => props.onStateChange({ ...props.state, detail: null })}><BackIcon />{props.copy.backToSiteStatus}</button>
              <h2>{detailSite.label}</h2>
              <p>{detailStatus ? describeStatus(props.copy, detailStatus) : props.copy.loading}</p>
            </section>
          ) : (
            <section className="site-status-overview" aria-label={props.copy.siteStatusSummary}>
              <p>{props.copy.siteStatusSummary}</p>
              <div className="site-status-list">
                {props.sites.map((site) => {
                  const status = props.statuses[site.key];
                  return (
                    <button type="button" key={site.key} data-phase={status?.phase ?? "loading"} onClick={() => props.onStateChange(showWorkspaceDetail(props.state, site.key))}>
                      <span>{site.label}</span><small>{status ? describeStatus(props.copy, status) : props.copy.loading}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
