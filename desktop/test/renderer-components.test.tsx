import assert from "node:assert/strict";
import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { CommandBar } from "../src/renderer/command-bar";
import { ImagePicker } from "../src/renderer/image-picker";
import { SiteFrames } from "../src/renderer/site-frames";
import { WorkspaceDrawer } from "../src/renderer/workspace-drawer";
import { getCopy } from "../src/shared/copy";
import type { LayoutState } from "../src/shared/protocol";
import { SITES } from "../src/main/sites";

const noop = () => undefined;

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
      drawerOpen={false}
      imageControl={<span data-test="images" />}
      sendBlockedReason={null}
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
      onCollectAnswers={noop}
      onOpenArchive={noop}
      onPasteImages={noop}
    />
  );

  assert.match(html, /^<header class="command-bar"/);
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

test("workspace drawer exposes compact presets, continuous selection and bound group deletion", () => {
  const copy = getCopy("en");
  const html = renderToStaticMarkup(
    <WorkspaceDrawer
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
      onSaveGroup={noop}
      onDeleteGroup={noop}
    />
  );

  assert.match(html, /^<aside id="workspace-drawer"/);
  assert.equal([...html.matchAll(/class="scope-preset"/g)].length, 5);
  assert.equal([...html.matchAll(/type="checkbox"/g)].length, 9);
  assert.match(html, /aria-label="Delete Research"/);
  assert.match(html, /data-group-id="research"/);
  assert.match(html, /Save current selection/);
});

test("site frames keep all nine live placements and accessible actions", () => {
  const placements: LayoutState["placements"] = SITES.map((site, index) => ({
    key: site.key,
    bounds: { x: index * 10, y: index * 10, width: 100, height: 80 }
  }));
  const html = renderToStaticMarkup(
    <SiteFrames
      copy={getCopy("en")}
      sites={SITES}
      statuses={{}}
      layout={{ mode: "overview", focused: "claude", placements }}
      selected={new Set(SITES.map((site) => site.key))}
      onToggle={noop}
      onFocus={noop}
      onReload={noop}
    />
  );

  assert.equal([...html.matchAll(/<article class="tile-frame/g)].length, 9);
  assert.equal([...html.matchAll(/type="checkbox"/g)].length, 9);
  assert.match(html, /aria-label="Focus Claude"/);
  assert.match(html, /aria-label="Reload Claude"/);
  assert.match(html, /class="tile-actions priority-p2"/);
  assert.match(html, /class="site-select priority-p0"/);
});
