import {
  BrowserWindow,
  WebContentsView,
  session,
  type WebContents
} from "electron";

import type { SiteDefinition, SiteKey, ViewPlacement } from "../shared/contracts";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences
} from "../shared/display";
import type {
  LayoutState,
  CollectSiteCommand,
  DesktopSurface,
  SiteCollectionResult,
  SiteResponseEnvelope,
  SiteResult,
  SiteStatus,
  SubmitSiteCommand
} from "../shared/protocol";
import {
  SITE_PARTITION,
  type DiagnosticSiteInput
} from "./diagnostics";
import {
  swapFocusedSite
} from "./layout";
import { navigationDisposition } from "./navigation";
import { SiteCommandChannel } from "./site-command-channel";
import { createSiteView, diagnosticSitesForViews } from "./site-view";
import { SITES } from "./sites";
import { effectiveStatus } from "./status";
import type { StabilityEventInput } from "./stability-monitor";
import { applyWorkspaceLayout, computeWorkspaceLayout } from "./workspace-layout";

export class ViewManager {
  private readonly views = new Map<SiteKey, WebContentsView>();
  private readonly pageStatus = new Map<SiteKey, SiteStatus>();
  private readonly runStatus = new Map<SiteKey, SiteStatus>();
  private readonly commands = new SiteCommandChannel();
  private mode: "overview" | "focus" = "overview";
  private renderedMode: "overview" | "focus" = "overview";
  private focused: SiteKey = "claude";
  private focusOrder: SiteKey[] = SITES.map((site) => site.key);
  private placements: readonly ViewPlacement[] = [];
  private display = DEFAULT_DISPLAY_PREFERENCES;
  private composerExpanded = false;
  private drawerOpen = false;
  private surface: DesktopSurface = "sites";
  private readonly siteSession = session.fromPartition(SITE_PARTITION);

  constructor(
    private readonly window: BrowserWindow,
    private readonly onStatus: (status: SiteStatus) => void,
    private readonly onLayout: (layout: LayoutState) => void,
    private readonly onRuntimeEvent: (event: StabilityEventInput) => void = () => undefined
  ) {
    this.siteSession.setPermissionCheckHandler(() => false);
    this.siteSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

    for (const site of SITES) this.createView(site);
    this.layout();
    window.on("resize", () => this.layout());
    window.webContents.on("zoom-changed", () => setTimeout(() => this.layout(), 0));
    window.on("closed", () => this.dispose());
  }

  getStatuses(): SiteStatus[] {
    return SITES.map((site) => this.currentStatus(site.key));
  }

  getLayout(): LayoutState {
    return { mode: this.renderedMode, focused: this.focused, placements: this.placements };
  }

  getDisplayPreferences(): DisplayPreferences {
    return this.display;
  }

  getDiagnosticSites(): DiagnosticSiteInput[] {
    return diagnosticSitesForViews(SITES, this.views, this.siteSession);
  }

  setDisplayPreferences(value: DisplayPreferences): void {
    this.display = value;
    this.layout();
  }

  setComposerExpanded(value: boolean): void {
    if (this.composerExpanded === value) return;
    this.composerExpanded = value;
    this.layout();
  }

  setDrawerOpen(value: boolean): void {
    if (this.drawerOpen === value) return;
    this.drawerOpen = value;
    this.layout();
  }

  setLayout(mode: "overview" | "focus", focused: SiteKey = this.focused): void {
    if (mode === "focus") {
      this.focusOrder = swapFocusedSite(this.focusOrder, this.focused, focused);
    }
    this.mode = mode;
    this.focused = focused;
    this.layout();
    if (mode === "focus") {
      const view = this.views.get(focused);
      if (view && !view.webContents.isDestroyed()) view.webContents.focus();
    }
  }

  setSurface(value: DesktopSurface): void {
    if (this.surface === value || this.window.isDestroyed()) return;
    if (this.surface === "sites") {
      for (const view of this.views.values()) this.window.contentView.removeChildView(view);
    }
    this.surface = value;
    if (value === "sites") {
      for (const view of this.views.values()) this.window.contentView.addChildView(view);
      this.layout();
    }
  }

  focusRelative(offset: -1 | 1): void {
    const keys = SITES.map((site) => site.key);
    const current = keys.indexOf(this.focused);
    const next = (current + offset + keys.length) % keys.length;
    this.setLayout("focus", keys[next]);
  }

  reload(site: SiteKey): void {
    const view = this.views.get(site);
    if (!view) return;
    this.runStatus.delete(site);
    this.updatePageStatus({ site, phase: "loading" });
    view.webContents.reload();
  }

  navigate(site: SiteKey, url: string): void {
    const definition = SITES.find((candidate) => candidate.key === site);
    const view = this.views.get(site);
    if (!definition || definition.url !== url || !view || view.webContents.isDestroyed()) {
      throw new Error("invalid_navigation");
    }
    this.runStatus.delete(site);
    this.updatePageStatus({ site, phase: "loading" });
    void view.webContents.loadURL(url);
  }

  markStatus(status: SiteStatus): void {
    this.runStatus.set(status.site, status);
    this.onStatus(this.currentStatus(status.site));
  }

  owns(contents: WebContents): SiteKey | null {
    for (const [key, view] of this.views) {
      if (view.webContents.id === contents.id) return key;
    }
    return null;
  }

  sendCommand(site: SiteKey, command: SubmitSiteCommand, signal: AbortSignal): Promise<SiteResult> {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) {
      return Promise.resolve({ ok: false, code: "no_view" });
    }
    const definition = SITES.find((candidate) => candidate.key === site);
    if (!definition || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
      return Promise.resolve({ ok: false, code: "not_ready" });
    }
    return this.commands.send(view.webContents, command, {
      signal,
      timeoutResult: { ok: false, code: "submit_unconfirmed" },
      onAbort: () => {
        if (view.webContents.isDestroyed()) return;
        this.replaceView(definition, view, view.webContents.getURL() || definition.url);
      }
    }).then((result) => "ok" in result ? result : { ok: false, code: "invalid_response" });
  }

  collect(site: SiteKey, deadline: number): Promise<SiteCollectionResult> {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) return Promise.resolve({ code: "no_view" });
    const definition = SITES.find((candidate) => candidate.key === site);
    if (!definition || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
      return Promise.resolve({ code: "not_ready" });
    }
    const command: CollectSiteCommand = { source: "AMS", cmd: "collect", deadline };
    return this.commands.send(view.webContents, command, {
      timeoutResult: { code: "not_ready" }
    }).then((result) => "ok" in result ? { code: "not_ready" } : result);
  }

  receiveResponse(sender: WebContents, envelope: SiteResponseEnvelope): void {
    this.commands.receive(sender, envelope);
  }

  private replaceView(site: SiteDefinition, view: WebContentsView, url: string): void {
    if (this.views.get(site.key) !== view || this.window.isDestroyed()) return;
    if (this.surface === "sites") this.window.contentView.removeChildView(view);
    this.views.delete(site.key);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.createView(site, url);
    this.layout();
  }

  private createView(site: SiteDefinition, url: string = site.url): void {
    const view = createSiteView(site, {
      onLoading: () => this.updatePageStatus({ site: site.key, phase: "loading" }),
      onReady: () => this.updatePageStatus({ site: site.key, phase: "ready" }),
      onFailure: (code) => {
        this.updatePageStatus({ site: site.key, phase: "failed", code: "load_failed" });
        this.onRuntimeEvent({ type: "did-fail-load", site: site.key, code: String(code) });
      },
      onCrash: (reason) => {
        this.updatePageStatus({ site: site.key, phase: "crashed", code: "renderer_crashed" });
        this.onRuntimeEvent({ type: "render-process-gone", site: site.key, code: reason });
      }
    });
    this.views.set(site.key, view);
    if (this.surface === "sites") this.window.contentView.addChildView(view);
    this.updatePageStatus({ site: site.key, phase: "loading" });
    void view.webContents.loadURL(url);
  }

  private layout(): void {
    if (this.window.isDestroyed() || this.surface !== "sites") return;
    const [width, height] = this.window.getContentSize();
    const zoom = Math.max(0.25, this.window.webContents.getZoomFactor());
    const cssWidth = Math.floor(width / zoom);
    const cssHeight = Math.floor(height / zoom);
    const next = computeWorkspaceLayout({
      width: cssWidth,
      height: cssHeight,
      density: this.display.density,
      composerExpanded: this.composerExpanded,
      drawerOpen: this.drawerOpen,
      requestedMode: this.mode,
      focused: this.focused,
      overviewOrder: SITES.map((site) => site.key),
      focusOrder: this.focusOrder
    });
    this.renderedMode = next.mode;
    this.placements = next.placements;
    const metrics = next.metrics;
    applyWorkspaceLayout({
      views: this.views,
      placements: this.placements,
      metrics,
      zoom,
      display: this.display,
      mode: this.renderedMode,
      focused: this.focused
    });
    const layout = this.getLayout();
    this.onLayout(layout);
  }

  private currentStatus(site: SiteKey): SiteStatus {
    const pageStatus = this.pageStatus.get(site) ?? { site, phase: "loading" as const };
    return effectiveStatus(this.runStatus.get(site), pageStatus);
  }

  private updatePageStatus(status: SiteStatus): void {
    this.pageStatus.set(status.site, status);
    this.onStatus(this.currentStatus(status.site));
  }

  private dispose(): void {
    this.commands.dispose();
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.views.clear();
  }
}
