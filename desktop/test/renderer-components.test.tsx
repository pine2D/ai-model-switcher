import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import * as archiveSurface from "../src/renderer/archive-surface";
import { ArchiveWorkspace } from "../src/renderer/archive-workspace";
import { BootstrapStateView } from "../src/renderer/bootstrap-state";
import { CommandBar } from "../src/renderer/command-bar";
import { CommandPalette } from "../src/renderer/command-palette";
import { ImagePicker } from "../src/renderer/image-picker";
import { PageTabs } from "../src/renderer/page-tabs";
import { SiteFrames } from "../src/renderer/site-frames";
import { SiteHealthPanel } from "../src/renderer/site-health";
import { imageSelectionBlockedMessage } from "../src/renderer/use-image-selection";
import { WorkspaceDrawer } from "../src/renderer/workspace-drawer";
import { WorkspaceActions } from "../src/renderer/workspace-actions";
import { CompletionNotifier } from "../src/main/completion-notifier";
import { getCopy } from "../src/shared/copy";
import { COMMANDS } from "../src/shared/commands";
import type { LayoutState } from "../src/shared/protocol";
import { SITES } from "../src/main/sites";
import { archiveFixture } from "./archive.test";

const noop = () => undefined;

test("command palette is a keyboard-first full surface", () => {
  const html = renderToStaticMarkup(
    <CommandPalette
      copy={getCopy("en")}
      commands={COMMANDS}
      groups={[]}
      library={{ templates: [], history: [] }}
      draft=""
      isMac={false}
      mode="commands"
      onModeChange={noop}
      onExecute={noop}
      onApplyGroup={noop}
      onInsertPrompt={noop}
      onSaveTemplate={noop}
      onDeleteTemplate={noop}
      onClose={noop}
    />
  );

  assert.match(html, /^<main class="command-surface"/);
  assert.match(html, /aria-label="Command palette"/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-controls="command-results"/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /aria-keyshortcuts="Escape"/);
  assert.doesNotMatch(html, /command-overlay/);
});

test("shortcut reference lists registered accelerators and aliases", () => {
  const html = renderToStaticMarkup(
    <CommandPalette
      copy={getCopy("zh-CN")}
      commands={COMMANDS}
      groups={[]}
      library={{ templates: [], history: [] }}
      draft=""
      isMac={false}
      mode="shortcuts"
      onModeChange={noop}
      onExecute={noop}
      onApplyGroup={noop}
      onInsertPrompt={noop}
      onSaveTemplate={noop}
      onDeleteTemplate={noop}
      onClose={noop}
    />
  );

  assert.match(html, /快捷键速查/);
  assert.match(html, /Alt\+K/);
  assert.match(html, /F1/);
  assert.match(html, /Alt\+1/);
});

test("command palette exposes the prompt library without motion", () => {
  const html = renderToStaticMarkup(
    <CommandPalette
      copy={getCopy("zh-CN")}
      commands={COMMANDS}
      groups={[]}
      library={{
        templates: [{ id: "one", name: "审校", text: "Review this", updatedAt: 1, deviceId: "a" }],
        history: []
      }}
      draft="Draft"
      isMac={false}
      mode="library"
      onModeChange={noop}
      onExecute={noop}
      onApplyGroup={noop}
      onInsertPrompt={noop}
      onSaveTemplate={noop}
      onDeleteTemplate={noop}
      onClose={noop}
    />
  );
  assert.match(html, /提问库/);
  assert.match(html, /审校/);
  assert.doesNotMatch(html, /<div id="command-results"/);
});

test("site health summarizes only the selected scope and keeps detail actions explicit", () => {
  const copy = getCopy("zh-CN");
  const html = renderToStaticMarkup(
    <SiteHealthPanel
      copy={copy}
      sites={SITES.slice(0, 2)}
      statuses={{
        claude: { site: "claude", phase: "ready" },
        chatgpt: { site: "chatgpt", phase: "failed", code: "load_failed" }
      }}
      health={{
        claude: { site: "claude", state: "ready", checks: [{ name: "输入框", ok: true }] },
        chatgpt: {
          site: "chatgpt",
          state: "error",
          page: "error",
          recent: { phase: "failed", code: "load_failed" },
          checks: [{ name: "输入框", ok: false }]
        }
      }}
      detail="chatgpt"
      checking={false}
      onDetail={noop}
      onCheck={noop}
      onFocus={noop}
      onReload={noop}
      onHardReload={noop}
      onClearData={noop}
      onBack={noop}
    />
  );
  assert.match(html, /页面加载失败/);
  assert.match(html, /输入框/);
  assert.match(html, /重新检查/);
  assert.match(html, /聚焦站点/);
  assert.match(html, /重新加载 ChatGPT/);
  assert.match(html, /强制重新加载 ChatGPT（忽略缓存）/);
  assert.match(html, /清除缓存并重新加载 ChatGPT/);
  assert.match(html, /清除该站点的缓存与 Service Worker 后重新加载，登录状态会保留/);
});

test("bootstrap loading is a polite busy state without a retry action", () => {
  const copy = getCopy("en");
  const html = renderToStaticMarkup(
    <BootstrapStateView copy={copy} phase="loading" announcement="" onRetry={noop} />
  );

  assert.match(html, /^<main class="shell-bootstrap" aria-busy="true">/);
  assert.equal([...html.matchAll(/role="status"/g)].length, 1);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, />Starting PolyAsk…</);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /Try again/);
});

test("bootstrap failure exposes one alert and one consistently named retry button", () => {
  const copy = getCopy("en");
  const html = renderToStaticMarkup(
    <BootstrapStateView copy={copy} phase="failed" announcement="" onRetry={noop} />
  );

  assert.equal([...html.matchAll(/role="alert"/g)].length, 1);
  assert.match(html, />PolyAsk could not load the workspace\.</);
  assert.equal([...html.matchAll(/<button/g)].length, 1);
  assert.match(
    html,
    /<button type="button" title="Try again" aria-label="Try again">Try again<\/button>/
  );
  assert.doesNotMatch(html, /aria-busy="true"/);
});

test("bootstrap states keep non-blocking announcements available to assistive technology", () => {
  const copy = getCopy("en");
  for (const phase of ["loading", "failed"] as const) {
    const html = renderToStaticMarkup(
      <BootstrapStateView
        copy={copy}
        phase={phase}
        announcement={copy.displayPreferencesFailed}
        onRetry={noop}
      />
    );

    assert.equal([...html.matchAll(/aria-live="polite"/g)].length, phase === "loading" ? 2 : 1);
    assert.match(
      html,
      /<div class="sr-only" aria-live="polite">Could not apply display preferences<\/div>/
    );
  }
});

test("command bar renders one compact command surface with stateful controls", () => {
  const html = renderToStaticMarkup(
    <CommandBar
      copy={getCopy("en")}
      promptRef={createRef<HTMLTextAreaElement>()}
      text="Question"
      tier={null}
      runState="idle"
      auxiliaryBusy={false}
      layoutMode="overview"
      selectedCount={9}
      failureCount={0}
      cancelledCount={0}
      scopeLabel="Custom · 9"
      healthAttention={0}
      panelTab={null}
      pageControl={<span data-test="pages" />}
      imageControl={<span data-test="images" />}
      sendBlockedReason={null}
      synthesisPending={false}
      syncStatus={{ state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true }}
      isMac={false}
      expanded={false}
      onTextChange={noop}
      onSubmit={noop}
      onCancel={noop}
      onTierChange={noop}
      onLayoutChange={noop}
      onExpandedChange={noop}
      onOpenPanel={noop}
      onShowGroupMenu={noop}
      onOpenMore={noop}
      onPasteImages={noop}
    />
  );

  assert.match(html, /^<header class="command-bar has-pages"/);
  assert.match(html, /aria-label="Broadcast prompt"/);
  assert.match(html, /<textarea[^>]*>Question<\/textarea>/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /priority-p0/);
  assert.match(html, /priority-p1/);
  assert.doesNotMatch(html, /class="brand/);
  assert.doesNotMatch(html, />PolyAsk</);
  assert.equal([...html.matchAll(/data-tier-icon=/g)].length, 3);
  for (const label of ["Use site setting", "Fast", "Deep thinking"]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
    assert.match(html, new RegExp(`title="${label}"`));
    assert.equal([...html.matchAll(new RegExp(label, "g"))].length, 2);
  }
  assert.doesNotMatch(html, /<small>AI Answers<\/small>/);
  assert.match(html, /aria-controls="workspace-panel"/);
  assert.match(html, /aria-label="Custom · 9"/);
  assert.match(html, /aria-label="More actions"/);
  assert.doesNotMatch(html, /aria-label="New session for selected sites"/);
  assert.match(html, /data-test="images"/);
  assert.match(html, /data-test="pages"/);
  assert.doesNotMatch(html, /sync-attention/);
});

test("command bar begins with adjacent workspace and health entries", () => {
  const html = renderToStaticMarkup(React.createElement(CommandBar as React.ComponentType<any>, {
    copy: getCopy("en"),
    promptRef: createRef<HTMLTextAreaElement>(),
    text: "Question",
    tier: null,
    runState: "idle",
    auxiliaryBusy: false,
    layoutMode: "overview",
    selectedCount: 3,
    totalSites: 9,
    activeCount: 0,
    failureCount: 0,
    cancelledCount: 0,
    drawerOpen: false,
    scopeLabel: "Writing · 3",
    healthAttention: 2,
    panelTab: null,
    imageControl: null,
    sendBlockedReason: null,
    synthesisPending: false,
    syncStatus: { state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true },
    isMac: false,
    expanded: false,
    onTextChange: noop,
    onSubmit: noop,
    onCancel: noop,
    onTierChange: noop,
    onLayoutChange: noop,
    onExpandedChange: noop,
    onOpenPanel: noop,
    onShowGroupMenu: noop,
    onOpenMore: noop,
    onPasteImages: noop
  }));

  assert.match(html, /^<header[^>]*><div class="workspace-entry/);
  assert.match(html, /aria-controls="workspace-panel"/);
  assert.match(html, /data-health-attention="2"/);
  assert.match(html, />Writing · 3</);
  assert.ok(html.indexOf("workspace-entry") < html.indexOf("mode-switch"));
});

test("command bar surfaces actionable sync state without consuming toolbar width", () => {
  const html = renderToStaticMarkup(
    <CommandBar
      copy={getCopy("en")}
      promptRef={createRef<HTMLTextAreaElement>()}
      text=""
      tier={null}
      runState="idle"
      auxiliaryBusy={false}
      layoutMode="overview"
      selectedCount={9}
      failureCount={0}
      cancelledCount={0}
      scopeLabel="Custom · 9"
      healthAttention={0}
      panelTab={null}
      imageControl={null}
      sendBlockedReason={null}
      synthesisPending={false}
      syncStatus={{ state: "auth", connected: false, pending: 2, errorCount: 1, readOnly: false, oauthConfigured: true, secureTokenStorage: true }}
      isMac={false}
      expanded={false}
      onTextChange={noop}
      onSubmit={noop}
      onCancel={noop}
      onTierChange={noop}
      onLayoutChange={noop}
      onExpandedChange={noop}
      onOpenPanel={noop}
      onShowGroupMenu={noop}
      onOpenMore={noop}
      onPasteImages={noop}
    />
  );

  assert.match(html, /class="more-trigger sync-attention sync-auth"/);
  assert.match(html, /aria-label="More actions: Sign in again to continue"/);
  assert.match(html, /data-sync-state="auth"/);
});

test("workspace actions summarize pending attention on one More entry", () => {
  const copy = getCopy("en");
  const base = {
    copy,
    disabled: false,
    synthesisPending: false,
    syncStatus: { state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true } as const,
    onOpenMore: noop
  };
  const attentionHtml = renderToStaticMarkup(
    <WorkspaceActions {...base} failureCount={1} cancelledCount={1} synthesisPending />
  );
  const idleHtml = renderToStaticMarkup(
    <WorkspaceActions {...base} failureCount={0} cancelledCount={0} />
  );

  assert.match(attentionHtml, /data-attention-count="3"/);
  assert.equal([...attentionHtml.matchAll(/aria-label="/g)].length, 1, "唯一一个 More 入口不应重复渲染 aria-label");
  assert.match(attentionHtml, /aria-label="More actions: Retry 2 failed or cancelled sites"/, "attentionCount 必须并入 aria-label（F166），不能只落进不可访问的 data 属性");
  assert.doesNotMatch(idleHtml, /data-attention-count/);
});

// F166：attentionCount 此前没有并入可访问名——补齐三选一的重试文案覆盖（纯失败/纯取消/两者混合）
test("workspace actions retry label switches with failure/cancelled mix", () => {
  const copy = getCopy("en");
  const base = {
    copy,
    disabled: false,
    synthesisPending: false,
    syncStatus: { state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true } as const,
    onOpenMore: noop
  };
  const failedOnly = renderToStaticMarkup(<WorkspaceActions {...base} failureCount={2} cancelledCount={0} />);
  const cancelledOnly = renderToStaticMarkup(<WorkspaceActions {...base} failureCount={0} cancelledCount={3} />);
  const mixed = renderToStaticMarkup(<WorkspaceActions {...base} failureCount={1} cancelledCount={2} />);

  assert.match(failedOnly, /aria-label="More actions: Retry 2 failed sites"/);
  assert.match(cancelledOnly, /aria-label="More actions: Retry 3 cancelled sites"/);
  assert.match(mixed, /aria-label="More actions: Retry 3 failed or cancelled sites"/);
});

test("image picker stays icon-first and exposes removable previews and scope warning", () => {
  const html = renderToStaticMarkup(
    <ImagePicker
      copy={getCopy("en")}
      images={[
        { name: "one.png", type: "image/png", size: 8, dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
        { name: "two.jpg", type: "image/jpeg", size: 3, dataUrl: "data:image/jpeg;base64,/9j/" }
      ]}
      open
      disabled={false}
      warning="Gemini does not support image broadcasts; adjust site scope"
      warningCount={1}
      error={null}
      onOpenChange={noop}
      onFiles={noop}
      onRemove={noop}
      onAdjustScope={noop}
    />
  );

  assert.match(html, /data-image-count="2"/);
  assert.match(html, /aria-label="Manage 2 images"/);
  assert.equal([...html.matchAll(/class="image-preview"/g)].length, 2);
  assert.match(html, /aria-label="Remove one.png"/);
  assert.match(html, /aria-label="Adjust site scope: 1 unsupported"/);
  assert.match(html, /role="alert"/);
});

test("a closing image tray is removed from focus and the accessibility tree", () => {
  const source = readFileSync("src/renderer/image-picker.tsx", "utf8");
  assert.match(source, /aria-hidden=\{trayOpen \? undefined : true\}/);
  assert.match(source, /inert=\{!trayOpen\}/);
});

test("workspace drawer exposes compact presets, continuous selection and bound group deletion", () => {
  const copy = getCopy("en");
  const html = renderToStaticMarkup(
    <WorkspaceDrawer
      open={true}
      state={{ tab: "sites", detail: null, inputMethod: "pointer" }}
      copy={copy}
      sites={SITES}
      selected={new Set(["claude", "kimi"])}
      groups={[{
        id: "research",
        name: "Research",
        sites: ["claude", "kimi"],
        updatedAt: 1_000,
        deviceId: "device-a"
      }]}
      statuses={{}}
      health={{}}
      healthChecking={false}
      onStateChange={noop}
      onSelectionChange={noop}
      onSaveGroup={async () => true}
      onDeleteGroup={noop}
      onCheckHealth={noop}
      onFocusSite={noop}
      onReloadSite={noop}
      onHardReloadSite={noop}
      onClearSiteData={noop}
    />
  );

  assert.match(html, /^<aside id="workspace-panel"/);
  assert.equal([...html.matchAll(/role="tab"/g)].length, 2);
  assert.equal([...html.matchAll(/role="tabpanel"/g)].length, 1);
  assert.equal([...html.matchAll(/class="scope-preset"/g)].length, 5);
  assert.equal([...html.matchAll(/type="checkbox"/g)].length, 9);
  assert.match(html, /aria-label="Delete Research"/);
  assert.match(html, /data-group-id="research"/);
  assert.match(html, /Save current selection/);
  assert.match(html, /name="group-name"/);
  assert.doesNotMatch(html, /name="group-name"[^>]*disabled/);
  assert.match(html, /group-save-hint/);
});

test("workspace health lists only sites in the current scope", () => {
  const html = renderToStaticMarkup(
    <WorkspaceDrawer
      open={true}
      state={{ tab: "health", detail: null, inputMethod: "keyboard" }}
      copy={getCopy("en")}
      sites={SITES}
      selected={new Set(["claude", "gemini"])}
      groups={[]}
      statuses={{}}
      health={{}}
      healthChecking={false}
      onStateChange={noop}
      onSelectionChange={noop}
      onSaveGroup={async () => true}
      onDeleteGroup={noop}
      onCheckHealth={noop}
      onFocusSite={noop}
      onReloadSite={noop}
      onHardReloadSite={noop}
      onClearSiteData={noop}
    />
  );
  assert.equal([...html.matchAll(/data-health-state="unknown"/g)].length, 2);
  assert.match(html, />Claude</);
  assert.match(html, />Gemini</);
  assert.doesNotMatch(html, />ChatGPT</);
});

test("site reload is disabled while a send is active", () => {
  const site = SITES[0]!;
  const html = renderToStaticMarkup(
    <SiteFrames
      copy={getCopy("en")}
      sites={[site]}
      statuses={{ [site.key]: { site: site.key, phase: "sending" } }}
      layout={{ mode: "overview", focused: site.key, page: 0, pageCount: 1, placements: [{ key: site.key, bounds: { x: 0, y: 0, width: 100, height: 80 } }] }}
      selected={new Set([site.key])}
      onToggle={noop}
      onFocus={noop}
      onReload={noop}
    />
  );
  assert.match(html, /<button type="button" disabled=""[^>]*aria-label="Reload Claude"/);
  assert.match(html, /title="Reload is unavailable while this site is working"/);
});

test("site frames render only the active selected page with accessible actions", () => {
  const placements: LayoutState["placements"] = SITES.slice(0, 4).map((site, index) => ({
    key: site.key,
    bounds: { x: index * 10, y: index * 10, width: 100, height: 80 }
  }));
  const html = renderToStaticMarkup(
    <SiteFrames
      copy={getCopy("en")}
      sites={SITES}
      statuses={{}}
      layout={{ mode: "overview", focused: "claude", page: 0, pageCount: 3, placements }}
      selected={new Set(SITES.map((site) => site.key))}
      onToggle={noop}
      onFocus={noop}
      onReload={noop}
    />
  );

  assert.equal([...html.matchAll(/<article class="tile-frame/g)].length, 4);
  assert.match(html, /^<section id="site-page-panel-0" class="tile-layer" role="tabpanel"/);
  assert.match(html, /aria-labelledby="site-page-tab-0"/);
  assert.match(html, /<section id="site-page-panel-1" role="tabpanel" aria-labelledby="site-page-tab-1" hidden=""><\/section>/);
  assert.match(html, /<section id="site-page-panel-2" role="tabpanel" aria-labelledby="site-page-tab-2" hidden=""><\/section>$/);
  assert.equal([...html.matchAll(/type="checkbox"/g)].length, 4);
  assert.match(html, /aria-label="Focus Claude"/);
  assert.match(html, /aria-label="Reload Claude"/);
  assert.match(html, /class="tile-actions priority-p2"/);
  assert.match(html, /class="site-select priority-p0"/);
});

test("site frames visibly distinguish stable failure codes and retain full titles", () => {
  const sites = SITES.filter((site) => site.key === "claude" || site.key === "gemini");
  const placements: LayoutState["placements"] = sites.map((site, index) => ({
    key: site.key,
    bounds: { x: index * 100, y: 0, width: 100, height: 80 }
  }));
  const html = renderToStaticMarkup(
    <SiteFrames
      copy={getCopy("en")}
      sites={sites}
      statuses={{
        claude: { site: "claude", phase: "failed", code: "submit_unconfirmed" },
        gemini: { site: "gemini", phase: "failed", code: "composer_not_found" }
      }}
      layout={{ mode: "overview", focused: "claude", page: 0, pageCount: 1, placements }}
      selected={new Set(["claude", "gemini"])}
      onToggle={noop}
      onFocus={noop}
      onReload={noop}
    />
  );

  assert.equal([...html.matchAll(/<article class="tile-frame/g)].length, 2);
  assert.match(
    html,
    /<span class="site-state priority-p0" title="Whether it was sent is unconfirmed">Whether it was sent is unconfirmed<\/span>/
  );
  assert.match(
    html,
    /<span class="site-state priority-p0" title="Prompt box not found">Prompt box not found<\/span>/
  );
});

test("page tabs expose compact ranges, manual activation, and off-page status", () => {
  const html = renderToStaticMarkup(
    <PageTabs
      copy={getCopy("en")}
      selectedSites={SITES.slice(0, 8).map((site) => site.key)}
      statuses={{
        gemini: { site: "gemini", phase: "sending" },
        yuanbao: { site: "yuanbao", phase: "failed", code: "submit_unconfirmed" }
      }}
      page={0}
      inputMethod="pointer"
      onPageChange={noop}
    />
  );

  assert.match(html, /^<div class="page-tabs" role="tablist" aria-label="Site pages"[^>]*>/);
  assert.equal([...html.matchAll(/role="tab"/g)].length, 2);
  assert.match(html, /aria-label="Page 1, sites 1–4, 1 sending"/);
  assert.match(html, /aria-label="Page 2, sites 5–8, 1 failed"/);
  assert.match(html, /aria-selected="true"[^>]*tabindex="0"/);
  assert.match(html, /aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(html, /data-input-method="pointer"/);
  assert.match(html, />1–4</);
  assert.match(html, />5–8</);
});

test("page tabs distinguish generating, completed, and failed background work without taking focus", () => {
  const html = renderToStaticMarkup(
    <PageTabs
      copy={getCopy("zh-CN")}
      selectedSites={SITES.slice(0, 8).map((site) => site.key)}
      statuses={{
        claude: { site: "claude", phase: "generating" },
        gemini: { site: "gemini", phase: "complete", unread: true },
        yuanbao: { site: "yuanbao", phase: "failed", code: "submit_unconfirmed", unread: true }
      }}
      page={0}
      inputMethod="keyboard"
      onPageChange={noop}
    />
  );
  assert.match(html, /aria-label="第 1 页，站点 1–4, 1 个正在回答, 1 个已完成"/);
  assert.match(html, /aria-label="第 2 页，站点 5–8, 1 个失败"/);
  assert.match(html, /class="page-tab-badge generating"/);
  assert.match(html, /class="page-tab-badge complete unread"/);
  assert.match(html, /class="page-tab-badge failed unread"/);
  assert.match(html, /data-input-method="keyboard"/);
  assert.match(html, /aria-selected="true"[^>]*tabindex="0"/);
});

test("site frames expose answer-generation terminal states without verbose chrome", () => {
  const sites = SITES.slice(0, 2);
  const placements: LayoutState["placements"] = sites.map((site, index) => ({
    key: site.key,
    bounds: { x: index * 100, y: 0, width: 100, height: 80 }
  }));
  const html = renderToStaticMarkup(
    <SiteFrames
      copy={getCopy("en")}
      sites={sites}
      statuses={{
        claude: { site: "claude", phase: "generating" },
        chatgpt: { site: "chatgpt", phase: "complete" }
      }}
      layout={{ mode: "overview", focused: "claude", page: 0, pageCount: 1, placements }}
      selected={new Set(sites.map((site) => site.key))}
      onToggle={noop}
      onFocus={noop}
      onReload={noop}
    />
  );
  assert.match(html, /class="tile-frame phase-generating"/);
  assert.match(html, /class="tile-frame phase-complete"/);
  assert.match(html, /class="answer-rail priority-p0" title="Answering"/);
  assert.match(html, /class="answer-rail priority-p0" title="Answer complete"/);
  assert.doesNotMatch(html, /class="site-state priority-p0"[^>]*>Answer/);
});

test("page tabs stay hidden while selected-site state catches up with layout state", () => {
  const html = renderToStaticMarkup(
    <PageTabs
      copy={getCopy("en")}
      selectedSites={[]}
      statuses={{}}
      page={0}
      inputMethod="pointer"
      onPageChange={noop}
    />
  );
  assert.equal(html, "");
});

test("archive filter refresh consumes a preferred id exactly once", () => {
  // F167: props.preferredId (a just-sent synthesis' archive id) must only pull the
  // selection back on the render where it first appears — not on every later filter
  // change while the pending synthesis stays outstanding.
  const first = archiveSurface.resolveFilterRefreshTarget("archive-a", null);
  assert.deepEqual(first, { target: "archive-a", consumed: "archive-a" });

  const repeatedFilterChange = archiveSurface.resolveFilterRefreshTarget("archive-a", "archive-a");
  assert.deepEqual(repeatedFilterChange, { target: undefined, consumed: "archive-a" });

  const pendingCleared = archiveSurface.resolveFilterRefreshTarget(null, "archive-a");
  assert.deepEqual(pendingCleared, { target: undefined, consumed: "archive-a" });

  const newPending = archiveSurface.resolveFilterRefreshTarget("archive-b", "archive-a");
  assert.deepEqual(newPending, { target: "archive-b", consumed: "archive-b" });
});

test("archive filter intent invalidates and clears status without flipping loading on every keystroke", () => {
  // F168 (root cause half): loading must not flip synchronously per keystroke — it is
  // owned by createArchiveRefresh once the debounced search actually starts, so a fast
  // typist does not see the whole body flash to a loading placeholder on every key.
  const requestEpoch = archiveSurface.createArchiveRequestEpoch();
  let loading = false;
  let status = "stale error";
  let invalidated = false;
  const originalInvalidate = requestEpoch.invalidate;
  requestEpoch.invalidate = () => { invalidated = true; originalInvalidate(); };

  archiveSurface.startArchiveFilterIntent(
    requestEpoch,
    () => undefined,
    "B",
    (value) => { loading = value; },
    (value) => { status = value; }
  );

  assert.equal(invalidated, true);
  assert.equal(status, "");
  assert.equal(loading, false);
});

function renderArchiveWorkspace(overrides: Partial<React.ComponentProps<typeof ArchiveWorkspace>> = {}): string {
  return renderToStaticMarkup(
    <ArchiveWorkspace
      copy={getCopy("en")}
      locale="en"
      items={[]}
      selected={null}
      tags={[]}
      query=""
      favoriteOnly={false}
      selectedTag=""
      loading={false}
      busy={false}
      status=""
      onClose={noop}
      onQueryChange={noop}
      onFavoriteFilterChange={noop}
      onTagChange={noop}
      onSelect={noop}
      onCapture={noop}
      onCopy={noop}
      onExport={noop}
      onDelete={noop}
      onPatch={noop}
      onOpenSource={noop}
      pendingSynthesis={null}
      synthesisCandidate={null}
      onSynthesize={noop}
      onCollectSynthesis={noop}
      onSaveSynthesis={noop}
      {...overrides}
    />
  );
}

test("archive workspace keeps the detail pane mounted while the list column loads", () => {
  // F168 (structural half): a loading placeholder must only cover the list column —
  // the detail pane (and any in-progress SynthesisWorkspace form inside detailOverride)
  // stays mounted so typing in the search box does not discard unsaved form state.
  const record = archiveFixture();
  const html = renderArchiveWorkspace({
    loading: true,
    items: [record],
    selected: record,
    detailOverride: <p>Synthesis draft in progress</p>
  });

  assert.equal([...html.matchAll(/Loading results…/g)].length, 1);
  assert.equal([...html.matchAll(/class="archive-list"/g)].length, 1);
  assert.equal([...html.matchAll(/class="archive-detail-pane"/g)].length, 1);
  assert.match(html, /Synthesis draft in progress/);
});

test("completion notifier fires for a background window even when the site page is currently visible", () => {
  // F157: unread only tracks the page-badge (whether the site tab is showing), not
  // window focus. The most common "PolyAsk is in the background" posture is: window
  // unfocused, but still parked on some site page, so unread is false for that site.
  const shown: { title: string; body: string }[] = [];
  const notifier = new CompletionNotifier({
    copy: { title: "PolyAsk", complete: (site) => `${site} finished`, failed: (site) => `${site} failed` },
    focused: () => false,
    show: (notification) => { shown.push(notification); }
  });
  notifier.setEnabled(true);

  notifier.accept({ site: "claude", phase: "complete", unread: false }, "Claude");

  assert.deepEqual(shown, [{ title: "PolyAsk", body: "Claude finished" }]);
});

test("image selection announces a busy message instead of silently dropping a paste mid-broadcast", () => {
  // F171: pasting/dropping images while a broadcast is running must not vanish without
  // feedback — idle=false now returns copy.imagesBusy instead of null.
  const copy = getCopy("en");
  assert.equal(imageSelectionBlockedMessage(copy, true), null);
  assert.equal(imageSelectionBlockedMessage(copy, false), copy.imagesBusy);
  assert.ok(copy.imagesBusy.length > 0);
});

test("collected answer text is bounded with a non-silent truncation code", () => {
  // F131: preload/site.ts cannot be imported outside Electron (it pulls in `electron`
  // at module scope), so this is a source-string regression like the ones in
  // shell-contract.test.ts — it only guards against the cap or the code disappearing.
  const preload = readFileSync("src/preload/site.ts", "utf8");
  assert.match(preload, /TEXT_LIMIT\s*=\s*1_000_000/);
  assert.match(preload, /"answer_truncated"/);
  assert.match(preload, /points\.length > TEXT_LIMIT/);
});

test("the dead polyask:focus-prompt IPC channel stays removed", () => {
  // F134: this channel was declared and subscribed but never sent from the main
  // process — the real focus path is the "focus-prompt" command in executeCommand.
  const shellPreload = readFileSync("src/preload/shell.ts", "utf8");
  const app = readFileSync("src/renderer/index.tsx", "utf8");
  assert.doesNotMatch(shellPreload, /focus-prompt/);
  assert.doesNotMatch(app, /onFocusPrompt/);
  assert.match(app, /"focus-prompt":\s*\(\)\s*=>\s*\{/);
});

test("status announcements use the site label, and command-palette page jumps announce too", () => {
  // F169: the onStatus live-region text must resolve through the bootstrap site list
  // (label), not the raw SiteKey, once sites have loaded — via a ref, not a new
  // effect dependency (re-subscribing eight IPC listeners on every bootstrap tick).
  // F172: showPage (the command-palette / renderer-requested page jump) must announce
  // like the toolbar PageTabs does, since onLayout suppresses its own announcement
  // whenever requestedPage.current is set.
  // Windows CI 用 autocrlf checkout，源文件是 CRLF；下面的抽取标记内嵌 \n，必须先归一化换行
  const app = readFileSync("src/renderer/index.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /sitesRef\.current\.find\(\(site\) => site\.key === status\.site\)\?\.label \?\? status\.site/);
  const subscribeEffect = app.slice(app.indexOf("useEffect(() => {\n    if (!bootstrapStarted"), app.indexOf("}, [copy]);") + "}, [copy]);".length);
  assert.match(subscribeEffect, /const offStatus = window\.polyask\.onStatus/);
  assert.match(subscribeEffect, /\}, \[copy\]\);$/);
  const showPage = app.slice(app.indexOf("const showPage = "), app.indexOf("const nextUnfinished ="));
  assert.match(showPage, /requestedPage\.current = \{ page, inputMethod: "keyboard" \};[\s\S]*setAnnouncement\(/);
});

test("the preference switch respects reduced motion", () => {
  // F170: the settings toggle's thumb transition must be neutralized under
  // prefers-reduced-motion, matching the rest of the workbench's motion contract.
  const css = readFileSync("src/renderer/settings.css", "utf8");
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.preference-switch span::after \{ transition: none; \}/
  );
});

test("the packaged renderer CSP adds base-uri and form-action without breaking dev HMR", () => {
  // F231: base-uri/form-action do not fall back to default-src per the CSP spec, so
  // they were silently absent. connect-src keeps a scoped ws://localhost:* (webpack
  // dev server's HMR socket) instead of a bare ws: that would accept any host.
  const html = readFileSync("src/renderer/index.html", "utf8");
  assert.match(html, /base-uri 'self'/);
  assert.match(html, /form-action 'self'/);
  assert.match(html, /connect-src 'self' ws:\/\/localhost:\*/);
  assert.doesNotMatch(html, /connect-src[^"]*\sws:(?!\/\/)/);
});
