import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { deleteConfirmationRemaining, deleteIntent } from "../src/renderer/archive-delete";
import { ArchiveWorkspace } from "../src/renderer/archive-workspace";
import { getCopy } from "../src/shared/copy";
import { archiveFixture } from "./archive.test";

const noop = () => undefined;

test("archive workspace exposes dense search, filters, actions and answer metadata", () => {
  const record = {
    ...archiveFixture(),
    favorite: true,
    tags: ["work"],
    note: "Compare later",
    winnerHost: "claude.ai",
    source: {
      kind: "page" as const,
      title: "Reference",
      url: "https://example.com/article",
      truncated: false,
      capturedAt: 900
    }
  };
  const html = renderToStaticMarkup(
    <ArchiveWorkspace
      copy={getCopy("en")}
      locale="en"
      items={[record]}
      selected={record}
      tags={["work"]}
      query="climate"
      favoriteOnly
      selectedTag="work"
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
    />
  );

  assert.match(html, /^<section class="archive-workspace"/);
  assert.match(html, /aria-label="Result library"/);
  assert.match(html, /type="search"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-current="true"/);
  assert.match(html, /Capture current answers/);
  assert.match(html, /Copy Markdown/);
  assert.match(html, /Export Markdown/);
  assert.match(html, /Delete result/);
  assert.match(html, /maxLength="4000"/);
  assert.match(html, /aria-label="Unmark best"/);
  assert.match(html, /Rayleigh scattering/);
  assert.match(html, /No answer/);
  assert.match(html, /class="archive-source"/);
  assert.match(html, /Reference/);
});

test("archive deletion confirmation remains bound to one record id", () => {
  assert.deepEqual(deleteIntent(null, "archive-a", 1_000), {
    action: "arm",
    armed: { id: "archive-a", until: 4_000 }
  });
  assert.equal(deleteIntent({ id: "archive-a", until: 4_000 }, "archive-a", 3_000).action, "delete");
  assert.equal(deleteIntent({ id: "archive-a", until: 4_000 }, "archive-b", 3_000).action, "arm");
  assert.equal(deleteIntent({ id: "archive-a", until: 2_000 }, "archive-a", 3_000).action, "arm");
  assert.equal(deleteConfirmationRemaining({ id: "archive-a", until: 4_000 }, 3_250), 750);
  assert.equal(deleteConfirmationRemaining({ id: "archive-a", until: 4_000 }, 4_500), 0);
});
