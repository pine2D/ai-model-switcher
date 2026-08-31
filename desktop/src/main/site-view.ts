import { WebContentsView, type Session, type WebContents } from "electron";

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

interface WebPreferencesReadback {
  readonly sandbox?: boolean;
  readonly contextIsolation?: boolean;
  readonly nodeIntegration?: boolean;
  readonly webSecurity?: boolean;
}

// getLastWebPreferences exists in the Electron runtime but not in its typings.
// Missing values fail closed: the snapshot then reports an insecure view rather
// than quietly trusting the constant we were trying to verify.
function lastWebPreferences(contents: WebContents): WebPreferencesReadback {
  const readback = (contents as unknown as {
    getLastWebPreferences?: () => WebPreferencesReadback | null;
  }).getLastWebPreferences;
  return (typeof readback === "function" ? readback.call(contents) : null) ?? {};
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
    // Read the values the view was actually created with instead of echoing the
    // constant back: copying SITE_VIEW_SECURITY into the snapshot made the smoke
    // assertion pass even if createSiteView stopped spreading it.
    const prefs = lastWebPreferences(view.webContents);
    return [{
      site: site.key,
      webContentsId: view.webContents.id,
      partition: SITE_PARTITION,
      sameSession: view.webContents.session === siteSession,
      sandbox: prefs.sandbox === true,
      contextIsolation: prefs.contextIsolation === true,
      nodeIntegration: prefs.nodeIntegration === true,
      webSecurity: prefs.webSecurity !== false,
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
  // window.open carries no originating frame, so it can come from any embedded
  // third-party frame. Never account for it as a main-frame navigation, and only
  // rewrite it into a top-level load for a login domain while the top level is
  // still on this site — otherwise a hostile frame could raise a real OAuth
  // consent page inside a chrome-less window.
  contents.setWindowOpenHandler(({ url }) => {
    const disposition = navigationDisposition(site, url);
    const onSite = navigationDisposition(site, contents.getURL()) === "site";
    const rewrite = disposition === "auth" && onSite;
    // Account only for the navigation we perform ourselves; a claim of
    // "main frame" from the opener would be worth nothing here.
    authRecovery.observe(disposition, rewrite);
    if (rewrite) void contents.loadURL(url);
    return { action: "deny" };
  });
  return view;
}
