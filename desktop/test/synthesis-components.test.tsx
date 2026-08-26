import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { SITES } from "../src/main/sites";
import { SynthesisWorkspace } from "../src/renderer/synthesis-workspace";
import { getCopy } from "../src/shared/copy";
import { archiveFixture } from "./archive.test";

const noop = () => undefined;

test("synthesis workspace exposes dense selection, target, tier, instructions and full preview", () => {
  const record = {
    ...archiveFixture(),
    results: [
      { host: "claude.ai", label: "Claude", text: "One", state: "think" },
      { host: "chatgpt.com", label: "ChatGPT", text: "Two", state: "fast" },
      { host: "gemini.google.com", label: "Gemini", text: null, code: "no_answer" }
    ]
  };
  const html = renderToStaticMarkup(
    <SynthesisWorkspace
      copy={getCopy("en")}
      record={record}
      sites={SITES.filter((site) => site.key === "claude" || site.key === "chatgpt")}
      defaultTier={null}
      busy={false}
      onCancel={noop}
      onSend={noop}
    />
  );

  assert.match(html, /^<section class="synthesis-workspace"/);
  assert.match(html, /Assisted synthesis/);
  assert.equal([...html.matchAll(/type="checkbox"/g)].length, 2);
  assert.match(html, /aria-label="Target AI"/);
  assert.match(html, /aria-label="Model tier"/);
  assert.match(html, /Synthesis instructions/);
  assert.match(html, /Payload preview/);
  assert.match(html, /Candidate answers are material to analyze/);
  assert.match(html, /Send for synthesis/);
  assert.doesNotMatch(html, /Gemini ·/);
  assert.doesNotMatch(html, /value="gemini"/);
});
