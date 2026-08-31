import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { deleteConfirmationRemaining, deleteIntent } from "../src/renderer/archive-delete";
import * as archiveSurface from "../src/renderer/archive-surface";
import { ArchiveWorkspace } from "../src/renderer/archive-workspace";
import { MarkdownPreview } from "../src/renderer/markdown-preview";
import { getCopy } from "../src/shared/copy";
import { archiveFixture } from "./archive.test";

const noop = () => undefined;

type WorkspaceProps = React.ComponentProps<typeof ArchiveWorkspace> & { readonly loading: boolean };

function renderArchive(overrides: Partial<WorkspaceProps> = {}): string {
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

function occurrences(value: string, text: string): number {
  return value.split(text).length - 1;
}

test("markdown preview groups consecutive bullets and separates bullet blocks around paragraphs", () => {
  const html = renderToStaticMarkup(
    <MarkdownPreview value={"- Alpha\n* **Beta** and `code`\n\nParagraph\n\n- Gamma"} />
  );
  const firstList = html.indexOf("<ul>");
  const paragraph = html.indexOf("<p>Paragraph</p>");
  const secondList = html.indexOf("<ul>", firstList + 1);

  assert.equal(occurrences(html, "<ul>"), 2);
  assert.equal(occurrences(html, "<li>"), 3);
  assert.equal(html.includes("md-list-item"), false);
  assert.ok(firstList >= 0 && firstList < paragraph && paragraph < secondList);
  assert.ok(html.includes("<li><strong>Beta</strong> and <code>code</code></li>"));
});

test("markdown preview flushes bullet lists at block boundaries without parsing fenced code bullets", () => {
  const html = renderToStaticMarkup(
    <MarkdownPreview value={[
      "- Before blank",
      "",
      "- Before paragraph",
      "Paragraph",
      "- Before heading",
      "# Heading",
      "- Before quote",
      "> Quote",
      "- Before code",
      "```",
      "- Code bullet",
      "```",
      "- At end"
    ].join("\n")} />
  );
  const expectedOrder = [
    "<ul><li>Before blank</li></ul>",
    "<ul><li>Before paragraph</li></ul>",
    "<p>Paragraph</p>",
    "<ul><li>Before heading</li></ul>",
    "<h3>Heading</h3>",
    "<ul><li>Before quote</li></ul>",
    "<blockquote>Quote</blockquote>",
    "<ul><li>Before code</li></ul>",
    "<pre><code>- Code bullet</code></pre>",
    "<ul><li>At end</li></ul>"
  ];
  let previous = -1;

  assert.equal(occurrences(html, "<ul>"), 6);
  assert.equal(occurrences(html, "<li>"), 6);
  assert.equal(occurrences(html, "- Code bullet"), 1);
  for (const fragment of expectedOrder) {
    const position = html.indexOf(fragment);
    assert.ok(position > previous, `${fragment} should follow the previous block`);
    previous = position;
  }
});

test("archive workspace renders one loading state without empty-state copy", () => {
  const record = archiveFixture();
  const html = renderArchive({
    loading: true,
    items: [record],
    selected: record,
    detailOverride: <p>Stale detail</p>
  });

  assert.equal(occurrences(html, "Loading results…"), 1);
  assert.equal(occurrences(html, "No saved results yet"), 0);
  assert.equal(occurrences(html, "No matching results"), 0);
  assert.equal(occurrences(html, "class=\"archive-empty\""), 1);
  assert.equal(occurrences(html, "Why is the sky blue?"), 0);
  assert.equal(occurrences(html, "Stale detail"), 1);
  assert.equal(occurrences(html, "class=\"archive-list\""), 1);
  assert.equal(occurrences(html, "class=\"archive-detail-pane\""), 1);
});

test("archive workspace renders one unfiltered empty state across the body", () => {
  const html = renderArchive();

  assert.equal(occurrences(html, "No saved results yet"), 1);
  assert.equal(occurrences(html, "No matching results"), 0);
  assert.equal(occurrences(html, "class=\"archive-empty\""), 1);
});

test("archive workspace renders one no-match state for any active filter", () => {
  for (const filter of [
    { query: "climate" },
    { favoriteOnly: true },
    { selectedTag: "work" }
  ]) {
    const html = renderArchive(filter);
    assert.equal(occurrences(html, "No matching results"), 1);
    assert.equal(occurrences(html, "No saved results yet"), 0);
    assert.equal(occurrences(html, "class=\"archive-empty\""), 1);
  }
});

test("archive workspace disables close while a serial action is busy", () => {
  const record = archiveFixture();
  const html = renderArchive({ busy: true, items: [record], selected: record });

  assert.match(html, /title="Close result library" aria-label="Close result library" disabled=""/);
  assert.match(html, /type="search"[^>]*disabled=""/);
  assert.match(html, /name="archive-tag-filter"[^>]*disabled=""/);
  assert.match(html, /aria-current="true" disabled=""/);
});

test("archive filter intent invalidates the in-flight request before committing the new filter", () => {
  type RequestEpoch = {
    begin: () => number;
    applyLatest: (epoch: number, apply: () => void) => void;
  };
  type StartFilterIntent = (
    requestEpoch: RequestEpoch,
    setFilter: (value: string) => void,
    value: string,
    setLoading: (value: boolean) => void,
    setStatus: (value: string) => void
  ) => void;
  const module = archiveSurface as typeof archiveSurface & {
    createArchiveRequestEpoch?: () => RequestEpoch;
    startArchiveFilterIntent?: StartFilterIntent;
  };
  const createRequestEpoch = module.createArchiveRequestEpoch;
  const startFilterIntent = module.startArchiveFilterIntent;
  assert.equal(typeof createRequestEpoch, "function");
  assert.equal(typeof startFilterIntent, "function");
  const requestEpoch = createRequestEpoch!();
  let state = { items: ["result-a"], loading: false, status: "Previous load failed", query: "A" };
  let stateWhenFilterCommitted: typeof state | null = null;
  const first = requestEpoch.begin();

  startFilterIntent!(
    requestEpoch,
    (query) => {
      stateWhenFilterCommitted = { ...state, query };
      state = { ...state, query };
      requestEpoch.applyLatest(first, () => {
        state = { items: ["stale-success"], loading: false, status: "", query };
      });
    },
    "B",
    (loading) => { state = { ...state, loading }; },
    (status) => { state = { ...state, status }; }
  );

  assert.deepEqual(stateWhenFilterCommitted, {
    items: ["result-a"],
    loading: false,
    status: "",
    query: "B"
  });
  assert.deepEqual(state, stateWhenFilterCommitted);

  requestEpoch.applyLatest(first, () => {
    state = { items: ["result-a"], loading: false, status: "Late success", query: "B" };
  });
  requestEpoch.applyLatest(first, () => {
    state = { ...state, loading: false, status: "Late failure" };
  });
  assert.deepEqual(state, stateWhenFilterCommitted);

  const second = requestEpoch.begin();
  requestEpoch.applyLatest(second, () => {
    state = { items: ["result-b"], loading: false, status: "", query: "B" };
  });

  assert.deepEqual(state, { items: ["result-b"], loading: false, status: "", query: "B" });
});

test("a resumed archive action refreshes the latest completed filter instead of its old render", async () => {
  type Filters = { readonly query: string; readonly favorite: boolean; readonly tag: string };
  const searched: Filters[] = [];
  const applied: Array<{ readonly query: string; readonly preferredId?: string }> = [];
  let filters: Filters = { query: "A", favorite: false, tag: "" };
  const refresh = archiveSurface.createArchiveRefresh(
    archiveSurface.createArchiveRequestEpoch(),
    () => filters,
    {
      search: async (snapshot) => {
        searched.push(snapshot);
        return { items: [], tags: [snapshot.query] };
      },
      setLoading: () => undefined,
      apply: (result, preferredId) => {
        applied.push({ query: result.tags[0], preferredId });
      },
      fail: () => assert.fail("refresh should not fail")
    }
  );
  let releaseAction!: () => void;
  const actionBlocker = new Promise<void>((resolve) => { releaseAction = resolve; });
  const actionA = (async () => {
    await actionBlocker;
    await refresh("archive-a");
  })();

  filters = { query: "B", favorite: true, tag: "work" };
  await refresh();
  releaseAction();
  await actionA;

  assert.deepEqual(searched, [
    { query: "B", favorite: true, tag: "work" },
    { query: "B", favorite: true, tag: "work" }
  ]);
  assert.deepEqual(applied, [
    { query: "B", preferredId: undefined },
    { query: "B", preferredId: "archive-a" }
  ]);
});

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
