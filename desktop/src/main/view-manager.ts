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
import { parseGenerationState } from "../shared/protocol";
import type {
  LayoutState,
  CollectSiteCommand,
  DiagnoseSiteCommand,
  DesktopSurface,
  GenerationSiteCommand,
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
import { GenerationMonitor } from "./generation-monitor";
import { navigationDisposition } from "./navigation";
import { SiteCommandChannel } from "./site-command-channel";
import { createSiteView, diagnosticSitesForViews } from "./site-view";
import { SITES } from "./sites";
import { effectiveStatus, markStatusRead, statusWithUnread } from "./status";
import type { StabilityEventInput } from "./stability-monitor";
import { applyWorkspaceLayout, computeWorkspaceLayout } from "./workspace-layout";
import { reconcileVisibleSiteKeys, stackOrder } from "./view-visibility";

// Consecutive probes that read no state (renderer busy, adapter without a
// generation hook, view momentarily off-site) before monitoring gives up. A
// single miss must never end the watch: that stranded whole runs on "submitted".
const GENERATION_MISS_LIMIT = 5;
const GENERATION_PROBE_INTERVAL = 900;
// Permissions the nine site views may use. Everything else — camera, microphone,
// geolocation, MIDI, notifications, clipboard-read, window-management — stays
// denied. Keep docs/desktop-m0.md in step with this list.
const SITE_PERMISSION_ALLOWLIST = new Set<string>([
  "clipboard-sanitized-write",
  "fullscreen",
  "pointerLock"
]);

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
  private readonly generation = new GenerationMonitor();
  private readonly generationTimers = new Map<SiteKey, NodeJS.Timeout>();
  private readonly generationDeadlines = new Map<SiteKey, number>();
  private readonly generationObserved = new Set<SiteKey>();
  private readonly generationMisses = new Map<SiteKey, number>();
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
      // Restoring: the remembered site wins. `this.focused` is still the field
      // default here, so passing it as `current` would always shadow the memory.
      this.focused = resolveFocusedSite(
        current.keys,
        this.focusedByPage.get(current.page) ?? this.focused,
        this.focused
      );
    }
    this.siteSession.setPermissionCheckHandler(
      (_contents, permission) => SITE_PERMISSION_ALLOWLIST.has(permission)
    );
    this.siteSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(SITE_PERMISSION_ALLOWLIST.has(permission)));

    for (const site of SITES) this.createView(site);
    this.reconcileViews();
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
    this.clearVisibleUnread();
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
    this.clearVisibleUnread();
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
    this.clearVisibleUnread();
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
      this.clearVisibleUnread();
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

  reload(site: SiteKey, ignoreCache = false): boolean {
    const view = this.views.get(site);
    if (!view || view.webContents.isDestroyed()) return false;
    if (!siteReloadAllowed(this.currentStatus(site).phase)) return false;
    this.runStatus.delete(site);
    this.updatePageStatus({ site, phase: "loading" });
    if (ignoreCache) view.webContents.reloadIgnoringCache();
    else view.webContents.reload();
    return true;
  }

  // Clears only Service Worker registrations and CacheStorage for the site's own
  // origin — never cookies (keeps the sign-in) or localStorage/IndexedDB (keeps
  // the site's own client-side preferences). Meant for a stuck/blank page whose
  // service worker is serving a stale asset that a normal reload() cannot evict
  // because reload() itself is served from that same cache.
  async clearSiteData(site: SiteKey): Promise<boolean> {
    const view = this.views.get(site);
    const definition = SITES.find((candidate) => candidate.key === site);
    if (!view || view.webContents.isDestroyed() || !definition) return false;
    if (!siteReloadAllowed(this.currentStatus(site).phase)) return false;
    await this.siteSession.clearStorageData({
      origin: `https://${definition.host}`,
      storages: ["cachestorage", "serviceworkers"]
    });
    this.runStatus.delete(site);
    this.updatePageStatus({ site, phase: "loading" });
    view.webContents.reloadIgnoringCache();
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
    this.invalidateGeneration(site);
    this.runStatus.delete(site);
    this.updatePageStatus({ site, phase: "loading" });
    await view.webContents.loadURL(url);
  }

  markStatus(status: SiteStatus): void {
    this.runStatus.set(status.site, statusWithUnread(status, this.isSiteVisible(status.site)));
    this.onStatus(this.currentStatus(status.site));
  }

  // A retry reuses the run id, so only the resubmitted sites are rearmed and the
  // sites still streaming keep their timer, deadline and observed flag. A new run
  // id (or a retry after cancel) resets every site.
  beginGenerationRun(runId: string, sites: readonly SiteKey[]): void {
    const resumed = this.generation.begin(runId, sites);
    if (resumed) for (const site of sites) this.clearGenerationTracking(site);
    else this.clearGenerationTracking();
  }

  watchGeneration(runId: string, site: SiteKey): void {
    if (!this.generation.accepts(runId, site) || this.generationDeadlines.has(site)) return;
    this.generationDeadlines.set(site, Date.now() + 45_000);
    void this.probeGeneration(runId, site);
  }

  invalidateGeneration(site: SiteKey): void {
    this.generation.forget(site);
    this.clearGenerationTracking(site);
  }

  cancelGenerationRun(): void {
    this.generation.invalidate();
    this.clearGenerationTracking();
  }

  private clearGenerationTracking(site?: SiteKey): void {
    if (site === undefined) {
      for (const timer of this.generationTimers.values()) clearTimeout(timer);
      this.generationTimers.clear();
      this.generationDeadlines.clear();
      this.generationObserved.clear();
      this.generationMisses.clear();
      return;
    }
    const timer = this.generationTimers.get(site);
    if (timer) clearTimeout(timer);
    this.generationTimers.delete(site);
    this.generationDeadlines.delete(site);
    this.generationObserved.delete(site);
    this.generationMisses.delete(site);
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
    // A crashed or failed page has no preload left to answer, so the request
    // would burn the whole budget and land on submit_unconfirmed — "maybe sent".
    // It was never dispatched, so report the certain failure instead. Never
    // reload and resend here: automatic resends are forbidden.
    const pageFailure = this.pageFailureCode(site);
    if (pageFailure) return Promise.resolve({ ok: false, code: pageFailure });
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
    const pageFailure = this.pageFailureCode(site);
    if (pageFailure) return Promise.resolve({ code: pageFailure });
    const definition = SITES.find((candidate) => candidate.key === site);
    if (!definition || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
      return Promise.resolve({ code: "not_ready" });
    }
    const command: CollectSiteCommand = { source: "AMS", cmd: "collect", deadline };
    return this.commands.send(view.webContents, command, {
      timeoutResult: { code: "not_ready" }
    }).then((result): SiteCollectionResult =>
      "ok" in result ? { code: "not_ready" } : result as SiteCollectionResult);
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
      const recentPhases: readonly SiteHealthRunPhase[] = ["sending", "submitted", "generating", "complete", "warning", "cancelled", "failed"];
      const recent = runStatus && recentPhases.includes(runStatus.phase as SiteHealthRunPhase)
        ? { phase: runStatus.phase as SiteHealthRunPhase, ...(runStatus.code ? { code: runStatus.code } : {}) }
        : undefined;
      return { ...health, page, checkedAt: Date.now(), ...(recent ? { recent } : {}) };
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

  private async probeGeneration(runId: string, site: SiteKey): Promise<void> {
    if (!this.generation.accepts(runId, site)) return;
    const view = this.views.get(site);
    const definition = SITES.find((candidate) => candidate.key === site);
    const reachable = !!view && !view.webContents.isDestroyed() && !!definition &&
      navigationDisposition(definition, view.webContents.getURL()) === "site";
    if (!reachable || !view) {
      this.scheduleGenerationProbe(runId, site, false);
      return;
    }
    const command: GenerationSiteCommand = {
      source: "AMS",
      cmd: "generation",
      runId,
      deadline: Date.now() + 2_500
    };
    const response = await this.commands.send(view.webContents, command, {
      timeoutResult: { state: null }
    });
    if (!this.generation.accepts(runId, site)) return;
    const state = "state" in response ? parseGenerationState(response.state) : null;
    const phase = this.generation.accept(runId, site, state);
    if (!phase) return;
    // No state this round: keep polling until the miss budget runs out, so one
    // busy renderer cannot freeze the site on "submitted" for the whole run.
    if (state === null) {
      this.scheduleGenerationProbe(runId, site, false);
      return;
    }
    if (phase === "generating" && !this.generationObserved.has(site)) {
      this.generationObserved.add(site);
      this.generationDeadlines.set(site, Date.now() + 15 * 60_000);
    }
    if ((phase === "generating" || phase === "complete") && this.currentStatus(site).phase !== phase) {
      this.markStatus({ site, phase });
    }
    // Only the settled terminal phase stops the watch — the debounce window
    // inside GenerationMonitor still reports "generating" and must keep polling.
    if (phase === "complete") return;
    this.scheduleGenerationProbe(runId, site, true);
  }

  private scheduleGenerationProbe(runId: string, site: SiteKey, observed: boolean): void {
    if (observed) this.generationMisses.delete(site);
    else {
      const misses = (this.generationMisses.get(site) ?? 0) + 1;
      this.generationMisses.set(site, misses);
      if (misses >= GENERATION_MISS_LIMIT) return;
    }
    if (Date.now() >= (this.generationDeadlines.get(site) ?? 0)) return;
    const timer = setTimeout(() => {
      this.generationTimers.delete(site);
      void this.probeGeneration(runId, site);
    }, GENERATION_PROBE_INTERVAL);
    timer.unref?.();
    this.generationTimers.set(site, timer);
  }

  private replaceView(site: SiteDefinition, view: WebContentsView, url: string): void {
    if (this.views.get(site.key) !== view || this.window.isDestroyed()) return;
    this.detach(site.key);
    this.views.delete(site.key);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.createView(site, url);
    this.reconcileViews();
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
    // 已勾选即挂载（不再只挂当前页）：replaceView 后重建的后台视图若不回到视图树，
    // 下一轮群发又会打进 0×0 视口。层序由调用方随后的 reconcileViews 归位。
    if (this.surface === "sites" && this.selected.includes(site.key)) this.attach(site.key);
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
    // this.placements 只含当前页——渲染层的 tile 表头靠它，绝不能混进后台视图。
    // 但后台视图也必须落格：视图树里尺寸为 0 的视图，页面 innerWidth/innerHeight 就是 0。
    // 用与当前页第一格**完全相同**的矩形（而不是窗口外偏移——移出边界是否触发遮挡剔除未实测），
    // 配合 reconcileViews 的层序，它们被第一格完全盖住，不漏出也不抢事件。
    const cover = next.placements[0];
    const background = cover
      ? this.selected
        .filter((site) => !current.keys.includes(site))
        .map((key) => ({ key, bounds: cover.bounds }))
      : [];
    applyWorkspaceLayout({
      views: this.views,
      placements: [...background, ...this.placements],
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

  private pageFailureCode(site: SiteKey): "renderer_crashed" | "load_failed" | null {
    const phase = this.pageStatus.get(site)?.phase;
    if (phase === "crashed") return "renderer_crashed";
    if (phase === "failed") return "load_failed";
    return null;
  }

  private updatePageStatus(status: SiteStatus): void {
    this.pageStatus.set(status.site, statusWithUnread(status, this.isSiteVisible(status.site)));
    this.onStatus(this.currentStatus(status.site));
  }

  private clearVisibleUnread(): void {
    // Mirror isSiteVisible: paging or reselecting while the archive, settings or
    // command surface is up must not mark hidden site badges as read.
    if (this.surface !== "sites") return;
    for (const site of this.visibleSites()) {
      for (const statuses of [this.pageStatus, this.runStatus]) {
        const status = statuses.get(site);
        if (status?.unread) statuses.set(site, markStatusRead(status));
      }
      this.onStatus(this.currentStatus(site));
    }
  }

  private isSiteVisible(site: SiteKey): boolean {
    return this.surface === "sites" && this.visibleSites().includes(site);
  }

  private visibleSites(): readonly SiteKey[] {
    return resolveSitePage(this.selected, this.page).keys;
  }

  // 挂载的是**全部已勾选站点**（不只当前页）：未挂进视图树的 WebContentsView 视口恒 0×0，
  // findComposer 恒 null，群发对后台页站点必然 composer_not_found（理由与实测见 view-visibility.ts）。
  // 顺序由 stackOrder 决定，后加的盖在上面，所以当前页永远压住后台页。
  private reconcileViews(): void {
    if (this.surface !== "sites" || this.window.isDestroyed()) return;
    const changes = reconcileVisibleSiteKeys([...this.attached], this.selected);
    for (const site of changes.detach) this.detach(site);
    // 按 stackOrder 依次 attach：后台页在前（底层），当前页在后（顶层）。
    for (const site of stackOrder(this.selected, this.visibleSites())) this.attach(site);
  }

  private attach(site: SiteKey): void {
    const view = this.views.get(site);
    if (!view) return;
    // 对**已在视图树里**的子视图，addChildView 是「原地提升到最顶层」而不是重复插入
    // （Electron 43.4.0 实测：幂等、children 不增长）——当前页正是靠重挂来盖住后台页，
    // 所以这里不做 has() 短路。**绝不要改成先 detach 再 attach**：全拆重挂会让被聚焦站点的
    // 渲染进程真的丢焦点并触发 blur（实测），而重挂本身不会。
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
    this.cancelGenerationRun();
    this.commands.dispose();
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.attached.clear();
    this.views.clear();
  }
}
