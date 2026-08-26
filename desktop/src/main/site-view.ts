import { WebContentsView, type Session } from "electron";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import {
  SITE_PARTITION,
  SITE_VIEW_SECURITY,
  type DiagnosticSiteInput
} from "./diagnostics";
import { PostAuthReloadTracker } from "./auth-navigation";
import { navigationDisposition } from "./navigation";

interface SiteViewCallbacks {
  readonly onLoading: () => void;
  readonly onReady: () => void;
  readonly onFailure: (code: number) => void;
  readonly onCrash: (reason: string) => void;
}

export function diagnosticSitesForViews(
  sites: readonly SiteDefinition[],
  views: ReadonlyMap<SiteKey, WebContentsView>,
  siteSession: Session,
  attached: ReadonlySet<SiteKey>
): DiagnosticSiteInput[] {
  return sites.flatMap((site) => {
    const view = views.get(site.key);
    if (!view || view.webContents.isDestroyed()) return [];
    return [{
      site: site.key,
      webContentsId: view.webContents.id,
      partition: SITE_PARTITION,
      sameSession: view.webContents.session === siteSession,
      sandbox: SITE_VIEW_SECURITY.sandbox,
      contextIsolation: SITE_VIEW_SECURITY.contextIsolation,
      nodeIntegration: SITE_VIEW_SECURITY.nodeIntegration,
      attached: attached.has(site.key),
      bounds: view.getBounds()
    }];
  });
}

export function createSiteView(
  site: SiteDefinition,
  callbacks: SiteViewCallbacks
): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: SITE_WINDOW_PRELOAD_WEBPACK_ENTRY,
      partition: SITE_PARTITION,
      ...SITE_VIEW_SECURITY,
      backgroundThrottling: false,
      spellcheck: true
    }
  });
  const contents = view.webContents;
  const authRecovery = new PostAuthReloadTracker(site.key === "gemini");
  contents.on("did-start-loading", callbacks.onLoading);
  contents.on("did-finish-load", () => {
    if (authRecovery.shouldReload(navigationDisposition(site, contents.getURL()))) {
      contents.reload();
      return;
    }
    callbacks.onReady();
  });
  contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (code !== -3 && isMainFrame) callbacks.onFailure(code);
  });
  contents.on("render-process-gone", (_event, details) => callbacks.onCrash(details.reason));

  const guardNavigation = (event: Electron.Event<{
    readonly url: string;
    readonly isMainFrame: boolean;
  }>) => {
    const disposition = navigationDisposition(site, event.url);
    authRecovery.observe(disposition, event.isMainFrame);
    if (disposition === "external" || disposition === "block") event.preventDefault();
  };
  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.setWindowOpenHandler(({ url }) => {
    const disposition = navigationDisposition(site, url);
    authRecovery.observe(disposition, true);
    if (disposition === "site" || disposition === "auth") void contents.loadURL(url);
    return { action: "deny" };
  });
  return view;
}
