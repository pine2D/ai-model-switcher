import { randomUUID } from "node:crypto";

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
  SiteCommand,
  SiteResponseEnvelope,
  SiteResult,
  SiteStatus
} from "../shared/protocol";
import {
  SITE_PARTITION,
  type DiagnosticSiteInput
} from "./diagnostics";
import {
  swapFocusedSite
} from "./layout";
import { navigationDisposition } from "./navigation";
import { createSiteView, diagnosticSitesForViews } from "./site-view";
import { SITES } from "./sites";
import { effectiveStatus } from "./status";
import type { StabilityEventInput } from "./stability-monitor";
import { applyWorkspaceLayout, computeWorkspaceLayout } from "./workspace-layout";

interface PendingCommand {
  readonly contentsId: number;
  readonly resolve: (result: SiteResult) => void;
  readonly timer: NodeJS.Timeout;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

export class ViewManager {
  private readonly views = new Map<SiteKey, WebContentsView>();
  private readonly pageStatus = new Map<SiteKey, SiteStatus>();
  private readonly runStatus = new Map<SiteKey, SiteStatus>();
  private readonly pending = new Map<string, PendingCommand>();
  private mode: "overview" | "focus" = "overview";
  private renderedMode: "overview" | "focus" = "overview";
  private focused: SiteKey = "claude";
  private focusOrder: SiteKey[] = SITES.map((site) => site.key);
  private placements: readonly ViewPlacement[] = [];
  private display = DEFAULT_DISPLAY_PREFERENCES;
  private composerExpanded = false;
  private drawerOpen = false;
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

  sendCommand(site: SiteKey, command: SiteCommand, signal: AbortSignal): Promise<SiteResult> {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) {
      return Promise.resolve({ ok: false, code: "no_view" });
    }
    const definition = SITES.find((candidate) => candidate.key === site);
    if (!definition || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
      return Promise.resolve({ ok: false, code: "not_ready" });
    }
    const remaining = Math.max(0, command.deadline - Date.now());
    if (remaining === 0) return Promise.resolve({ ok: false, code: "timeout" });
    if (signal.aborted) return Promise.resolve({ ok: false, code: "cancelled" });

    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (pending) pending.signal.removeEventListener("abort", pending.onAbort);
        this.pending.delete(requestId);
        resolve({ ok: false, code: "submit_unconfirmed" });
      }, remaining);
      const onAbort = () => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        const contents = view.webContents;
        if (!contents.isDestroyed()) {
          const currentUrl = contents.getURL() || definition.url;
          this.replaceView(definition, view, currentUrl);
        }
        resolve({ ok: false, code: "cancelled" });
      };
      this.pending.set(requestId, {
        contentsId: view.webContents.id,
        resolve,
        timer,
        signal,
        onAbort
      });
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) { onAbort(); return; }
      view.webContents.send("polyask:site-command", { requestId, command });
    });
  }

  receiveResponse(sender: WebContents, envelope: SiteResponseEnvelope): void {
    if (!envelope || typeof envelope.requestId !== "string") return;
    const pending = this.pending.get(envelope.requestId);
    if (!pending || pending.contentsId !== sender.id) return;
    clearTimeout(pending.timer);
    pending.signal.removeEventListener("abort", pending.onAbort);
    this.pending.delete(envelope.requestId);
    pending.resolve(envelope.result);
  }

  private replaceView(site: SiteDefinition, view: WebContentsView, url: string): void {
    if (this.views.get(site.key) !== view || this.window.isDestroyed()) return;
    this.window.contentView.removeChildView(view);
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
    this.window.contentView.addChildView(view);
    this.updatePageStatus({ site: site.key, phase: "loading" });
    void view.webContents.loadURL(url);
  }

  private layout(): void {
    if (this.window.isDestroyed()) return;
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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.signal.removeEventListener("abort", pending.onAbort);
      pending.resolve({ ok: false, code: "cancelled" });
    }
    this.pending.clear();
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.views.clear();
  }
}
