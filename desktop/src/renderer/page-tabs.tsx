import { useRef } from "react";

import type { SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SiteStatus } from "../shared/protocol";
import { paginateSiteKeys } from "../shared/site-pages";
import { pageTabKeyAction } from "./keyboard";

interface PageTabsProps {
  readonly copy: DesktopCopy;
  readonly selectedSites: readonly SiteKey[];
  readonly statuses: Readonly<Record<string, SiteStatus>>;
  readonly page: number;
  readonly inputMethod: "keyboard" | "pointer";
  readonly onPageChange: (page: number, inputMethod: "keyboard" | "pointer") => void;
}

export function PageTabs(props: PageTabsProps): React.JSX.Element | null {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const pages = paginateSiteKeys(props.selectedSites);
  if (pages.length <= 1) return null;
  let nextStart = 1;

  return (
    <div className="page-tabs" role="tablist" aria-label={props.copy.sitePages} data-input-method={props.inputMethod}>
      <span
        className="page-tab-indicator"
        aria-hidden="true"
        style={{ width: `${100 / pages.length}%`, transform: `translateX(${props.page * 100}%)` }}
      />
      {pages.map((sites, index) => {
        const start = nextStart;
        nextStart += sites.length;
        const range = `${start}–${start + sites.length - 1}`;
        const pageStatuses = sites.map((site) => props.statuses[site]).filter(Boolean);
        const sending = pageStatuses.filter((status) => status.phase === "sending").length;
        const generating = pageStatuses.filter((status) => status.phase === "generating").length;
        const complete = pageStatuses.filter((status) => status.phase === "complete").length;
        const failed = pageStatuses.filter((status) => status.phase === "failed" || status.phase === "crashed").length;
        const unreadComplete = pageStatuses.some((status) => status.phase === "complete" && status.unread);
        const unreadFailed = pageStatuses.some((status) =>
          (status.phase === "failed" || status.phase === "crashed") && status.unread
        );
        const label = [
          formatCopy(props.copy.sitePageLabel, { page: index + 1, range }),
          sending ? formatCopy(props.copy.sitePageSending, { count: sending }) : "",
          generating ? formatCopy(props.copy.sitePageGenerating, { count: generating }) : "",
          complete ? formatCopy(props.copy.sitePageComplete, { count: complete }) : "",
          failed ? formatCopy(props.copy.sitePageFailed, { count: failed }) : ""
        ].filter(Boolean).join(", ");
        const selected = index === props.page;
        return (
          <button
            type="button"
            id={`site-page-tab-${index}`}
            role="tab"
            aria-label={label}
            aria-selected={selected}
            aria-controls={`site-page-panel-${index}`}
            tabIndex={selected ? 0 : -1}
            data-page={index}
            key={index}
            ref={(element) => { buttons.current[index] = element; }}
            onClick={() => props.onPageChange(index, "pointer")}
            onKeyDown={(event) => {
              const action = pageTabKeyAction(event.key, index, pages.length);
              if (!action) return;
              event.preventDefault();
              buttons.current[action.focus]?.focus();
              if (action.activate) props.onPageChange(action.focus, "keyboard");
            }}
          >
            <span>{range}</span>
            {sending ? <i className="page-tab-badge sending" aria-hidden="true">{sending}</i> : null}
            {generating ? <i className="page-tab-badge generating" aria-hidden="true">{generating}</i> : null}
            {complete ? <i className={`page-tab-badge complete${unreadComplete ? " unread" : ""}`} aria-hidden="true">{complete}</i> : null}
            {failed ? <i className={`page-tab-badge failed${unreadFailed ? " unread" : ""}`} aria-hidden="true">{failed}</i> : null}
          </button>
        );
      })}
    </div>
  );
}
