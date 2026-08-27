import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { BootstrapStateView } from "../src/renderer/bootstrap-state";
import { CommandBar } from "../src/renderer/command-bar";
import { ImagePicker } from "../src/renderer/image-picker";
import { PageTabs } from "../src/renderer/page-tabs";
import { SiteFrames } from "../src/renderer/site-frames";
import { WorkspaceDrawer } from "../src/renderer/workspace-drawer";
import { WorkspaceActions } from "../src/renderer/workspace-actions";
import { getCopy } from "../src/shared/copy";
import type { LayoutState } from "../src/shared/protocol";
import { SITES } from "../src/main/sites";

const noop = () => undefined;

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
      totalSites={9}
      activeCount={0}
      failureCount={0}
      cancelledCount={0}
      drawerOpen={false}
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
      onToggleDrawer={noop}
      onNewSession={noop}
      onRetryFailed={noop}
      onCollectAnswers={noop}
      onOpenArchive={noop}
      onCollectSynthesis={noop}
      onOpenSettings={noop}
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
  assert.match(html, /aria-controls="workspace-drawer"/);
  assert.match(html, /aria-label="New session for selected sites"/);
  assert.match(html, /aria-label="Collect and copy selected answers"/);
  assert.match(html, /aria-label="Open result library"/);
  assert.match(html, /data-test="images"/);
  assert.match(html, /data-test="pages"/);
  assert.doesNotMatch(html, /sync-attention/);
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
      totalSites={9}
      activeCount={0}
      failureCount={0}
      cancelledCount={0}
      drawerOpen={false}
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
      onToggleDrawer={noop}
      onNewSession={noop}
      onRetryFailed={noop}
      onCollectAnswers={noop}
      onOpenArchive={noop}
      onCollectSynthesis={noop}
      onOpenSettings={noop}
      onPasteImages={noop}
    />
  );

  assert.match(html, /class="sync-attention sync-auth"/);
  assert.match(html, /aria-label="Settings: Sign in again to continue"/);
  assert.match(html, /data-sync-state="auth"/);
});

test("workspace actions distinguish failed, cancelled and mixed retry summaries", () => {
  const copy = getCopy("en");
  const base = {
    copy,
    selectedCount: 5,
    totalSites: 9,
    activeCount: 0,
    drawerOpen: false,
    disabled: false,
    synthesisPending: false,
    syncStatus: { state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true } as const,
    onToggleDrawer: noop,
    onNewSession: noop,
    onRetryFailed: noop,
    onCollectAnswers: noop,
    onOpenArchive: noop,
    onCollectSynthesis: noop,
    onOpenSettings: noop
  };
  const failedHtml = renderToStaticMarkup(
    <WorkspaceActions {...base} failureCount={2} cancelledCount={0} />
  );
  const cancelledHtml = renderToStaticMarkup(
    <WorkspaceActions {...base} failureCount={0} cancelledCount={2} />
  );
  const mixedHtml = renderToStaticMarkup(
    <WorkspaceActions {...base} failureCount={2} cancelledCount={1} />
  );
  const recoveredHtml = renderToStaticMarkup(
    <WorkspaceActions {...base} failureCount={0} cancelledCount={0} />
  );

  assert.match(failedHtml, /2 selected sites failed/);
  assert.equal([...failedHtml.matchAll(/title="Retry 2 failed sites"/g)].length, 1);
  assert.equal([...failedHtml.matchAll(/aria-label="Retry 2 failed sites"/g)].length, 1);
  assert.match(cancelledHtml, /Sending was cancelled for 2 selected sites/);
  assert.equal([...cancelledHtml.matchAll(/title="Retry 2 cancelled sites"/g)].length, 1);
  assert.equal([...cancelledHtml.matchAll(/aria-label="Retry 2 cancelled sites"/g)].length, 1);
  assert.match(mixedHtml, /Selected sites: 2 failed, 1 cancelled/);
  assert.equal([...mixedHtml.matchAll(/title="Retry 3 failed or cancelled sites"/g)].length, 1);
  assert.equal([...mixedHtml.matchAll(/aria-label="Retry 3 failed or cancelled sites"/g)].length, 1);
  assert.doesNotMatch(recoveredHtml, /Retry [0-9]+ (?:failed|cancelled)/);
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
      onClose={noop}
      onSelectionChange={noop}
      onSaveGroup={async () => true}
      onDeleteGroup={noop}
    />
  );

  assert.match(html, /^<aside id="workspace-drawer"/);
  assert.equal([...html.matchAll(/class="scope-preset"/g)].length, 5);
  assert.equal([...html.matchAll(/type="checkbox"/g)].length, 9);
  assert.match(html, /aria-label="Delete Research"/);
  assert.match(html, /data-group-id="research"/);
  assert.match(html, /Save current selection/);
  assert.match(html, /name="group-name"/);
  assert.doesNotMatch(html, /name="group-name"[^>]*disabled/);
  assert.match(html, /group-save-hint/);
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
