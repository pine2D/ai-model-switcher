import { WebContentsView, type Session, type WebContents } from "electron";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import {
  SITE_PARTITION,
  SITE_VIEW_SECURITY,
  type DiagnosticSiteInput
} from "./diagnostics";
import { PostAuthReloadTracker } from "./auth-navigation";
import { navigationDisposition } from "./navigation";
import { SiteNavigationPolicy } from "./navigation-guard";

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

  const policy = new SiteNavigationPolicy(site);
  const guardNavigation = (isRedirect: boolean) => (event: Electron.Event<{
    readonly url: string;
    readonly isMainFrame: boolean;
  }>) => {
    const decision = policy.handleNavigation(event.url, event.isMainFrame, isRedirect);
    authRecovery.observe(decision.disposition, event.isMainFrame);
    if (!decision.allow) event.preventDefault();
  };
  // will-navigate 是渲染端意图（恒主帧，程序化 loadURL/reload 不触发）；will-redirect 是
  // 服务端 302（任意帧）。两者对 external 的放行规则不同，故分别标记来源。
  contents.on("will-navigate", guardNavigation(false));
  contents.on("will-redirect", guardNavigation(true));
  // did-navigate 是主帧实际提交（loadURL/reload/window.open 改写的加载都会触发），是唯一
  // 可靠的「auth 流进入/退出」信号——按意图武装会给钓鱼跳板留缝。
  contents.on("did-navigate", (_event, url) => policy.commit(url));
  // window.open carries no originating frame, so it can come from any embedded
  // third-party frame. It is never allowed to raise a real window; the policy
  // only decides whether the target may replace the guarded view (same-site
  // pages, and login domains while on the site or inside an active auth flow).
  contents.setWindowOpenHandler(({ url }) => {
    const decision = policy.handleWindowOpen(url, contents.getURL());
    const rewrite = decision.rewrite;
    // Account only for the navigation we perform ourselves; a claim of
    // "main frame" from the opener would be worth nothing here.
    authRecovery.observe(decision.disposition, rewrite);
    if (rewrite) void contents.loadURL(url);
    return { action: "deny" };
  });
  return view;
}
