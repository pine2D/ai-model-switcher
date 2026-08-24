import { randomUUID } from "node:crypto";

import {
  BrowserWindow,
  WebContentsView,
  session,
  type WebContents
} from "electron";

import type { SiteDefinition, SiteKey, ViewPlacement } from "../shared/contracts";
import type {
  LayoutState,
  SiteCommand,
  SiteResponseEnvelope,
  SiteResult,
  SiteStatus
} from "../shared/protocol";
import {
  computeViewLayout,
  resolveLayoutMode,
  scaleBounds,
  swapFocusedSite
} from "./layout";
import { navigationDisposition } from "./navigation";
import { SITES } from "./sites";
import { effectiveStatus } from "./status";

const SHELL_HEIGHT = 156;
const TILE_HEADER_HEIGHT = 32;
const EDGE_GAP = 10;

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

  constructor(
    private readonly window: BrowserWindow,
    private readonly onStatus: (status: SiteStatus) => void,
    private readonly onLayout: (layout: LayoutState) => void
  ) {
    const siteSession = session.fromPartition("persist:polyask-sites");
    siteSession.setPermissionCheckHandler(() => false);
    siteSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

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
    const view = new WebContentsView({
      webPreferences: {
        preload: SITE_WINDOW_PRELOAD_WEBPACK_ENTRY,
        partition: "persist:polyask-sites",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        spellcheck: true
      }
    });
    this.views.set(site.key, view);
    this.window.contentView.addChildView(view);
    this.updatePageStatus({ site: site.key, phase: "loading" });

    const contents = view.webContents;
    contents.on("did-start-loading", () => this.updatePageStatus({ site: site.key, phase: "loading" }));
    contents.on("did-finish-load", () => this.updatePageStatus({ site: site.key, phase: "ready" }));
    contents.on("did-fail-load", (_event, code) => {
      if (code !== -3) this.updatePageStatus({ site: site.key, phase: "failed", code: "load_failed" });
    });
    contents.on("render-process-gone", () => {
      this.updatePageStatus({ site: site.key, phase: "crashed", code: "renderer_crashed" });
    });
    const guardNavigation = (event: Electron.Event, url: string) => {
      const disposition = navigationDisposition(site, url);
      if (disposition === "external" || disposition === "block") event.preventDefault();
    };
    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);
    contents.setWindowOpenHandler(({ url }) => {
      const disposition = navigationDisposition(site, url);
      if (disposition === "site" || disposition === "auth") {
        void contents.loadURL(url);
      }
      return { action: "deny" };
    });
    void contents.loadURL(url);
  }

  private layout(): void {
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const zoom = Math.max(0.25, this.window.webContents.getZoomFactor());
    const cssWidth = Math.floor(width / zoom);
    const cssHeight = Math.floor(height / zoom);
    const area = {
      x: EDGE_GAP,
      y: SHELL_HEIGHT,
      width: Math.max(1, cssWidth - EDGE_GAP * 2),
      height: Math.max(1, cssHeight - SHELL_HEIGHT - EDGE_GAP)
    };
    this.renderedMode = resolveLayoutMode(this.mode, area, 8);
    const keys = this.renderedMode === "focus"
      ? this.focusOrder
      : SITES.map((site) => site.key);
    this.placements = computeViewLayout(
      keys,
      area,
      this.renderedMode === "overview"
        ? { mode: "overview", gap: 8 }
        : { mode: "focus", focused: this.focused, gap: 8 }
    );
    for (const placement of this.placements) {
      const view = this.views.get(placement.key);
      if (!view) continue;
      view.setBounds(scaleBounds({
        x: placement.bounds.x + 1,
        y: placement.bounds.y + TILE_HEADER_HEIGHT,
        width: Math.max(1, placement.bounds.width - 2),
        height: Math.max(1, placement.bounds.height - TILE_HEADER_HEIGHT - 1)
      }, zoom));
    }
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
