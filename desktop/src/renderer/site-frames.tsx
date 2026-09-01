import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type {
  LayoutState,
  SiteHistoryState,
  SiteStatus
} from "../shared/protocol";
import { siteReloadAllowed } from "../shared/site-health";
import { describeStatus, visibleStatus } from "../shared/status-copy";
import { BackIcon, FocusIcon, ReloadIcon } from "./icons";

interface SiteFramesProps {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly statuses: Readonly<Record<string, SiteStatus>>;
  readonly layout: LayoutState;
  readonly selected: ReadonlySet<SiteKey>;
  readonly onToggle: (site: SiteKey) => void;
  readonly onFocus: (site: SiteKey) => void;
  readonly onReload: (site: SiteKey) => void;
  readonly history: Record<string, SiteHistoryState>;
  readonly onBack: (site: SiteKey) => void;
}

export function SiteFrames(props: SiteFramesProps): React.JSX.Element {
  const { copy, sites, statuses, layout, selected, onToggle, onFocus, onReload, history, onBack } = props;
  return (
    <>
      <section
        id={`site-page-panel-${layout.page}`}
        className="tile-layer"
        role="tabpanel"
        aria-label={copy.siteViews}
        aria-labelledby={layout.pageCount > 1 ? `site-page-tab-${layout.page}` : undefined}
      >
        {layout.placements.map((placement) => {
          const site = sites.find((candidate) => candidate.key === placement.key);
          const status = statuses[placement.key] ?? {
            site: placement.key,
            phase: "loading" as const
          };
          if (!site) return null;
          const statusText = describeStatus(copy, status);
          const attentionText = visibleStatus(copy, status);
          const reloadBlocked = !siteReloadAllowed(status.phase);
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
                <label className="site-select priority-p0" title={formatCopy(copy.selectSite, { site: site.label })}>
                  <input type="checkbox" name="sites" value={site.key} checked={selected.has(site.key)} onChange={() => onToggle(site.key)} />
                  <span>{site.label}</span>
                </label>
                <span className="answer-rail priority-p0" title={statusText} aria-hidden="true" />
                <span className="tile-status-sr sr-only">{statusText}</span>
                {attentionText && <span className="site-state priority-p0" title={statusText}>{attentionText}</span>}
                <span className="tile-actions priority-p2">
                  {/* 点了回答里的站内链接之后此前完全没有退路——唯一脱身办法是「新会话」，会丢掉当前对话。
                      只在该站真有历史可退时才出现，免得摆一个点了没反应的按钮。 */}
                  {history[site.key]?.back && (
                    <button type="button" title={formatCopy(copy.siteBack, { site: site.label })} aria-label={formatCopy(copy.siteBack, { site: site.label })} onClick={() => onBack(site.key)}><BackIcon /></button>
                  )}
                  <button type="button" title={formatCopy(copy.focusSite, { site: site.label })} aria-label={formatCopy(copy.focusSite, { site: site.label })} onClick={() => onFocus(site.key)}><FocusIcon /></button>
                  <button type="button" disabled={reloadBlocked} title={reloadBlocked ? copy.healthReloadBlocked : formatCopy(copy.reloadSite, { site: site.label })} aria-label={formatCopy(copy.reloadSite, { site: site.label })} onClick={() => onReload(site.key)}><ReloadIcon /></button>
                </span>
              </div>
            </article>
          );
        })}
      </section>
      {Array.from({ length: layout.pageCount }, (_value, page) => page)
        .filter((page) => page !== layout.page)
        .map((page) => (
          <section
            id={`site-page-panel-${page}`}
            role="tabpanel"
            aria-labelledby={`site-page-tab-${page}`}
            hidden
            key={page}
          />
        ))}
    </>
  );
}
