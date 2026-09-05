import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SiteStatus } from "../shared/protocol";
import { siteReloadAllowed, summarizeSiteHealth, type SiteHealth, type SiteHealthState } from "../shared/site-health";
import { describeStatus } from "../shared/status-copy";
import { BackIcon, FocusIcon, ReloadIcon, TrashIcon } from "./icons";

interface SiteHealthPanelProps {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly statuses: Readonly<Record<string, SiteStatus>>;
  readonly health: Readonly<Partial<Record<SiteKey, SiteHealth>>>;
  readonly detail: SiteKey | null;
  readonly checking: boolean;
  readonly onDetail: (site: SiteKey) => void;
  readonly onCheck: (sites: readonly SiteKey[]) => void;
  readonly onFocus: (site: SiteKey) => void;
  readonly onReload: (site: SiteKey) => void;
  readonly onHardReload: (site: SiteKey) => void;
  readonly onClearData: (site: SiteKey) => void;
  readonly onCopyReport: () => void;
  readonly onBack: () => void;
}

function stateLabel(copy: DesktopCopy, state: SiteHealthState): string {
  return copy[{ ready: "healthReady", "sign-in": "healthSignIn", error: "healthError", unknown: "healthUnknown" }[state] as keyof DesktopCopy];
}

function pageLabel(copy: DesktopCopy, current: SiteHealth, fallback: SiteStatus): string {
  switch (current.page) {
    case "loading": return copy.loading;
    case "ready": return copy.ready;
    case "error": return describeStatus(copy, fallback);
    default: return copy.healthUnknown;
  }
}

function recentLabel(copy: DesktopCopy, current: SiteHealth): string {
  return current.recent
    ? describeStatus(copy, { site: current.site, phase: current.recent.phase, code: current.recent.code })
    : copy.healthNoRecentSend;
}

export function SiteHealthPanel(props: SiteHealthPanelProps): React.JSX.Element {
  const items = props.sites.map((site) => props.health[site.key] ?? {
    site: site.key,
    state: "unknown" as const,
    checks: []
  });
  const summary = summarizeSiteHealth(items);
  const detailSite = props.detail
    ? props.sites.find((site) => site.key === props.detail) ?? null
    : null;

  if (detailSite) {
    const status = props.statuses[detailSite.key] ?? { site: detailSite.key, phase: "loading" as const };
    const current = props.health[detailSite.key] ?? { site: detailSite.key, state: "unknown" as const, checks: [] };
    const reloadBlocked = !siteReloadAllowed(status.phase);
    return (
      <section className="site-status-detail">
        <button type="button" className="detail-back" onClick={props.onBack}><BackIcon />{props.copy.backToSiteStatus}</button>
        <h2>{detailSite.label}</h2>
        <dl className="health-facts">
          <div><dt>{props.copy.healthPageStatus}</dt><dd>{pageLabel(props.copy, current, status)}</dd></div>
          <div><dt>{props.copy.healthAvailability}</dt><dd data-health-state={current.state}>{stateLabel(props.copy, current.state)}</dd></div>
          <div><dt>{props.copy.healthLatestSend}</dt><dd>{recentLabel(props.copy, current)}</dd></div>
          <div><dt>{props.copy.healthCheckedAt}</dt><dd>{current.checkedAt ? new Date(current.checkedAt).toLocaleTimeString() : props.copy.healthNeverChecked}</dd></div>
        </dl>
        <h3>{props.copy.healthAdapterChecks}</h3>
        {current.checks.length ? (
          <ul className="health-checks">
            {current.checks.map((check, index) => (
              <li data-ok={check.ok ? "true" : check.kind === "tier" ? "advisory" : "false"} key={`${check.name}-${index}`}><span>{check.name}</span><small>{check.ok ? props.copy.healthCheckPassed : check.kind === "tier" ? props.copy.healthCheckAdvisory : props.copy.healthCheckFailed}</small></li>
            ))}
          </ul>
        ) : <p>{props.copy.healthNoChecks}</p>}
        <div className="health-actions">
          <button type="button" disabled={props.checking} onClick={() => props.onCheck([detailSite.key])}>{props.checking ? props.copy.checkingSiteHealth : props.copy.checkAgain}</button>
          <button type="button" onClick={() => props.onFocus(detailSite.key)}><FocusIcon />{props.copy.healthFocusSite}</button>
          <button type="button" disabled={reloadBlocked} title={reloadBlocked ? props.copy.healthReloadBlocked : formatCopy(props.copy.reloadSite, { site: detailSite.label })} onClick={() => props.onReload(detailSite.key)}><ReloadIcon />{formatCopy(props.copy.reloadSite, { site: detailSite.label })}</button>
          <button type="button" disabled={reloadBlocked} title={reloadBlocked ? props.copy.healthReloadBlocked : formatCopy(props.copy.hardReloadSite, { site: detailSite.label })} onClick={() => props.onHardReload(detailSite.key)}><ReloadIcon />{formatCopy(props.copy.hardReloadSite, { site: detailSite.label })}</button>
          <button type="button" disabled={reloadBlocked} title={reloadBlocked ? props.copy.healthReloadBlocked : props.copy.clearSiteCacheHint} aria-label={reloadBlocked ? props.copy.healthReloadBlocked : props.copy.clearSiteCacheHint} onClick={() => props.onClearData(detailSite.key)}><TrashIcon />{formatCopy(props.copy.clearSiteCache, { site: detailSite.label })}</button>
          <button type="button" onClick={props.onCopyReport}>{props.copy.healthCopyReport}</button>
        </div>
        {reloadBlocked ? <p className="health-blocked">{props.copy.healthReloadBlocked}</p> : null}
      </section>
    );
  }

  return (
    <section className="site-status-overview" aria-label={props.copy.siteStatusSummary}>
      <div className="health-summary">
        <p>{formatCopy(props.copy.healthScopeSummary, { ...summary })}</p>
        <button type="button" disabled={props.checking || !props.sites.length} onClick={() => props.onCheck(props.sites.map((site) => site.key))}>{props.checking ? props.copy.checkingSiteHealth : props.copy.checkAgain}</button>
        <button type="button" disabled={!props.sites.length} onClick={props.onCopyReport}>{props.copy.healthCopyReport}</button>
      </div>
      {props.sites.length ? (
        <div className="site-status-list">
          {props.sites.map((site) => {
            const current = props.health[site.key] ?? { site: site.key, state: "unknown" as const, checks: [] };
            return (
              <button type="button" key={site.key} data-health-state={current.state} onClick={() => props.onDetail(site.key)}>
                <span><strong>{site.label}</strong><small>{props.copy.healthLatestSend}：{recentLabel(props.copy, current)}</small></span>
                <em>{stateLabel(props.copy, current.state)}</em>
              </button>
            );
          })}
        </div>
      ) : <p className="health-empty">{props.copy.healthEmptyScope}</p>}
    </section>
  );
}
