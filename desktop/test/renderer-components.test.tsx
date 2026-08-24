import assert from "node:assert/strict";
import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { CommandBar } from "../src/renderer/command-bar";
import { SiteFrames } from "../src/renderer/site-frames";
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
      layoutMode="overview"
      selectedCount={9}
      totalSites={9}
      activeCount={0}
      isMac={false}
      expanded={false}
      onTextChange={noop}
      onSubmit={noop}
      onCancel={noop}
      onTierChange={noop}
      onLayoutChange={noop}
      onExpandedChange={noop}
    />
  );

  assert.match(html, /^<header class="command-bar"/);
  assert.match(html, /aria-label="Broadcast prompt"/);
  assert.match(html, /<textarea[^>]*>Question<\/textarea>/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /<small>AI Answers<\/small>/);
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
});
