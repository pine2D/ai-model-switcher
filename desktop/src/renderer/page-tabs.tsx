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
        const failed = pageStatuses.filter((status) => status.phase === "failed" || status.phase === "crashed").length;
        const label = [
          formatCopy(props.copy.sitePageLabel, { page: index + 1, range }),
          sending ? formatCopy(props.copy.sitePageSending, { count: sending }) : "",
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
            {failed ? <i className="page-tab-badge failed" aria-hidden="true">{failed}</i> : null}
          </button>
        );
      })}
    </div>
  );
}
