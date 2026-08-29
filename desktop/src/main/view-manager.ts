import {
  BrowserWindow,
  WebContentsView,
  session,
  type WebContents
} from "electron";

import type { SiteDefinition, SiteKey, ViewPlacement } from "../shared/contracts";
import type { DesktopUiState } from "../shared/desktop-ui-state";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences
} from "../shared/display";
import type {
  LayoutState,
  CollectSiteCommand,
  DiagnoseSiteCommand,
  DesktopSurface,
  SiteCollectionResult,
  SiteResponseEnvelope,
  SiteResult,
  SiteStatus,
  SubmitSiteCommand
} from "../shared/protocol";
import {
  buildSiteHealth,
  siteReloadAllowed,
  type SiteHealth,
  type SiteHealthPageState,
  type SiteHealthRunPhase
} from "../shared/site-health";
import {
  paginateSiteKeys,
  resolveFocusedSite,
  resolveSitePage,
  resolveSitePageIndex
} from "../shared/site-pages";
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
import { reconcileVisibleSiteKeys } from "./view-visibility";

interface ViewManagerOptions {
  readonly initialUiState?: DesktopUiState;
  readonly selectedSites?: readonly SiteKey[];
  readonly onUiStateChange?: (state: DesktopUiState) => void;
}

export class ViewManager {
  private readonly views = new Map<SiteKey, WebContentsView>();
  private readonly attached = new Set<SiteKey>();
  private readonly pageStatus = new Map<SiteKey, SiteStatus>();
  private readonly runStatus = new Map<SiteKey, SiteStatus>();
  private readonly commands = new SiteCommandChannel();
  private mode: "overview" | "focus" = "overview";
  private renderedMode: "overview" | "focus" = "overview";
  private focused: SiteKey = "claude";
  private selected: SiteKey[] = SITES.map((site) => site.key);
  private page = 0;
  private pageCount = 3;
  private readonly focusedByPage = new Map<number, SiteKey>();
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
    private readonly onRuntimeEvent: (event: StabilityEventInput) => void = () => undefined,
    private readonly options: ViewManagerOptions = {}
  ) {
    const selectedSites = new Set(options.selectedSites ?? SITES.map((site) => site.key));
    this.selected = SITES.map((site) => site.key).filter((site) => selectedSites.has(site));
    const initial = options.initialUiState;
    if (initial) {
      this.mode = initial.layoutMode;
      this.page = initial.currentPage;
      for (const [page, site] of Object.entries(initial.focusedByPage)) {
        this.focusedByPage.set(Number(page), site);
      }
      const current = resolveSitePage(this.selected, this.page);
      this.page = current.page;
      this.pageCount = current.pageCount;
      this.focused = resolveFocusedSite(current.keys, this.focused, this.focusedByPage.get(current.page));
    }
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
    return {
      mode: this.renderedMode,
      focused: this.focused,
      page: this.page,
      pageCount: this.pageCount,
      placements: this.placements
    };
  }

  getDisplayPreferences(): DisplayPreferences {
    return this.display;
  }

  getUiState(): DesktopUiState {
    const focusedByPage: Partial<Record<number, SiteKey>> = {};
    paginateSiteKeys(this.selected).forEach((sites, page) => {
      const remembered = page === this.page ? this.focused : this.focusedByPage.get(page);
      const focused = remembered && sites.includes(remembered) ? remembered : sites[0];
      if (focused) focusedByPage[page] = focused;
    });
    return {
      windowBounds: this.window.getNormalBounds(),
      maximized: this.window.isMaximized(),
      layoutMode: this.mode,
      currentPage: this.page,
      focusedByPage: focusedByPage as Readonly<Record<number, SiteKey>>
    };
  }

  getDiagnosticSites(): DiagnosticSiteInput[] {
    return diagnosticSitesForViews(SITES, this.views, this.siteSession, this.attached);
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

  setSelection(sites: readonly SiteKey[]): void {
    const selected = new Set(sites);
    this.selected = SITES.map((site) => site.key).filter((site) => selected.has(site));
    const current = resolveSitePage(this.selected, this.page);
    this.page = current.page;
    this.pageCount = current.pageCount;
    this.focused = resolveFocusedSite(current.keys, this.focused, this.focusedByPage.get(this.page));
    this.reconcileViews();
    this.layout();
  }

  setPage(value: number): void {
    this.focusedByPage.set(this.page, this.focused);
    const next = resolveSitePage(this.selected, value);
    if (next.page === this.page) return;
    this.page = next.page;
    this.pageCount = next.pageCount;
    this.focused = resolveFocusedSite(next.keys, this.focused, this.focusedByPage.get(this.page));
    this.reconcileViews();
    this.layout();
  }

  setLayout(mode: "overview" | "focus", requestedFocus: SiteKey = this.focused): void {
    const selectedIndex = this.selected.indexOf(requestedFocus);
    if (selectedIndex >= 0) this.page = resolveSitePageIndex(this.selected, requestedFocus);
    const current = resolveSitePage(this.selected, this.page);
    const focused = resolveFocusedSite(current.keys, requestedFocus, this.focusedByPage.get(current.page));
    if (mode === "focus" && current.keys.includes(focused)) {
      this.focusOrder = swapFocusedSite(this.focusOrder, this.focused, focused);
      this.focusedByPage.set(current.page, focused);
    }
    this.mode = mode;
    this.focused = focused;
    this.reconcileViews();
    this.layout();
    if (mode === "focus" && current.keys.includes(focused)) {
      const view = this.views.get(focused);
      if (view && !view.webContents.isDestroyed()) view.webContents.focus();
    }
  }

  setSurface(value: DesktopSurface): void {
    if (this.surface === value || this.window.isDestroyed()) return;
    if (this.surface === "sites") {
      for (const site of [...this.attached]) this.detach(site);
    }
    this.surface = value;
    if (value === "sites") {
      this.reconcileViews();
      this.layout();
    }
  }

  focusRelative(offset: -1 | 1): void {
    const keys = this.selected;
    if (!keys.length) return;
    const current = keys.indexOf(this.focused);
    const next = (current + offset + keys.length) % keys.length;
    this.setLayout("focus", keys[next]);
  }

  pageRelative(offset: -1 | 1): void {
    if (this.pageCount <= 1) return;
    this.setPage((this.page + offset + this.pageCount) % this.pageCount);
  }

  pageDirect(page: number): void {
    if (!Number.isInteger(page) || page < 0 || page >= this.pageCount) return;
    this.setPage(page);
  }

  reload(site: SiteKey): boolean {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) return false;
    if (!siteReloadAllowed(this.currentStatus(site).phase)) return false;
    this.runStatus.delete(site);
    this.updatePageStatus({ site, phase: "loading" });
    view.webContents.reload();
    return true;
  }

  checkHealth(sites: readonly SiteKey[]): Promise<SiteHealth[]> {
    return Promise.all(sites.map((site) => this.checkSiteHealth(site)));
  }

  async navigate(site: SiteKey, url: string): Promise<void> {
    const definition = SITES.find((candidate) => candidate.key === site);
    const view = this.views.get(site);
    if (!definition || definition.url !== url || !view || view.webContents.isDestroyed()) {
      throw new Error("invalid_navigation");
    }
    this.runStatus.delete(site);
    this.updatePageStatus({ site, phase: "loading" });
    await view.webContents.loadURL(url);
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

  private async checkSiteHealth(site: SiteKey): Promise<SiteHealth> {
    const definition = SITES.find((candidate) => candidate.key === site);
    const view = this.views.get(site);
    const pageStatus = this.pageStatus.get(site) ?? { site, phase: "loading" as const };
    const runStatus = this.runStatus.get(site);
    const finish = (checks: unknown, navigation: ReturnType<typeof navigationDisposition>): SiteHealth => {
      const health = buildSiteHealth({ site, phase: pageStatus.phase, navigation, checks });
      const page: SiteHealthPageState = pageStatus.phase === "failed" || pageStatus.phase === "crashed"
        ? "error"
        : pageStatus.phase === "loading" || pageStatus.phase === "ready" ? pageStatus.phase : "unknown";
      const recentPhases: readonly SiteHealthRunPhase[] = ["sending", "submitted", "warning", "cancelled", "failed"];
      const recent = runStatus && recentPhases.includes(runStatus.phase as SiteHealthRunPhase)
        ? { phase: runStatus.phase as SiteHealthRunPhase, ...(runStatus.code ? { code: runStatus.code } : {}) }
        : undefined;
      return { ...health, page, ...(recent ? { recent } : {}) };
    };
    if (!definition || !view || view.webContents.isDestroyed()) {
      return finish(undefined, "block");
    }
    const navigation = navigationDisposition(definition, view.webContents.getURL());
    if (navigation !== "site" || pageStatus.phase === "loading" || ["failed", "crashed"].includes(pageStatus.phase)) {
      return finish(undefined, navigation);
    }
    const command: DiagnoseSiteCommand = {
      source: "AMS",
      cmd: "diagnose",
      deadline: Date.now() + 2_500
    };
    const response = await this.commands.send(view.webContents, command, {
      timeoutResult: { code: "not_ready" }
    });
    const checks = "checks" in response ? response.checks : undefined;
    return finish(checks, navigation);
  }

  receiveResponse(sender: WebContents, envelope: SiteResponseEnvelope): void {
    this.commands.receive(sender, envelope);
  }

  private replaceView(site: SiteDefinition, view: WebContentsView, url: string): void {
    if (this.views.get(site.key) !== view || this.window.isDestroyed()) return;
    this.detach(site.key);
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
    if (this.surface === "sites" && this.visibleSites().includes(site.key)) this.attach(site.key);
    this.updatePageStatus({ site: site.key, phase: "loading" });
    void view.webContents.loadURL(url);
  }

  private layout(): void {
    if (this.window.isDestroyed() || this.surface !== "sites") return;
    const [width, height] = this.window.getContentSize();
    const zoom = Math.max(0.25, this.window.webContents.getZoomFactor());
    const cssWidth = Math.floor(width / zoom);
    const cssHeight = Math.floor(height / zoom);
    const current = resolveSitePage(this.selected, this.page);
    this.page = current.page;
    this.pageCount = current.pageCount;
    const next = computeWorkspaceLayout({
      width: cssWidth,
      height: cssHeight,
      density: this.display.density,
      composerExpanded: this.composerExpanded,
      drawerOpen: this.drawerOpen,
      requestedMode: this.mode,
      focused: this.focused,
      overviewOrder: current.keys,
      focusOrder: this.focusOrder.filter((site) => current.keys.includes(site))
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
    this.options.onUiStateChange?.(this.getUiState());
  }

  private currentStatus(site: SiteKey): SiteStatus {
    const pageStatus = this.pageStatus.get(site) ?? { site, phase: "loading" as const };
    return effectiveStatus(this.runStatus.get(site), pageStatus);
  }

  private updatePageStatus(status: SiteStatus): void {
    this.pageStatus.set(status.site, status);
    this.onStatus(this.currentStatus(status.site));
  }

  private visibleSites(): readonly SiteKey[] {
    return resolveSitePage(this.selected, this.page).keys;
  }

  private reconcileViews(): void {
    if (this.surface !== "sites" || this.window.isDestroyed()) return;
    const changes = reconcileVisibleSiteKeys([...this.attached], this.visibleSites());
    for (const site of changes.detach) this.detach(site);
    for (const site of changes.attach) this.attach(site);
  }

  private attach(site: SiteKey): void {
    const view = this.views.get(site);
    if (!view || this.attached.has(site)) return;
    this.window.contentView.addChildView(view);
    this.attached.add(site);
  }

  private detach(site: SiteKey): void {
    const view = this.views.get(site);
    if (!view || !this.attached.has(site)) return;
    this.window.contentView.removeChildView(view);
    this.attached.delete(site);
  }

  private dispose(): void {
    this.commands.dispose();
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.attached.clear();
    this.views.clear();
  }
}
