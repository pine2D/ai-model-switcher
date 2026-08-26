import assert from "node:assert/strict";
import test from "node:test";

import { parseBroadcastRequest, parseCollectionRequest, parsePageIndex } from "../src/shared/protocol";

const png = {
  name: "x.png",
  type: "image/png",
  size: 8,
  dataUrl: "data:image/png;base64,iVBORw0KGgo="
} as const;

test("broadcast IPC requires a bounded run ID for one, two, five, and nine known sites", () => {
  assert.deepEqual(
    parseBroadcastRequest({
      runId: "run-1",
      text: "  compare this  ",
      tier: "think",
      sites: ["gemini"],
      images: []
    }),
    { runId: "run-1", text: "compare this", tier: "think", sites: ["gemini"], images: [] }
  );
  assert.deepEqual(
    parseBroadcastRequest({
      runId: "run-2",
      text: "compare",
      tier: "fast",
      sites: ["claude", "kimi"],
      images: []
    }),
    { runId: "run-2", text: "compare", tier: "fast", sites: ["claude", "kimi"], images: [] }
  );
  assert.deepEqual(
    parseBroadcastRequest({
      runId: "run-5",
      text: "compare",
      tier: null,
      sites: ["claude", "chatgpt", "gemini", "kimi", "deepseek"],
      images: []
    }),
    {
      runId: "run-5",
      text: "compare",
      tier: null,
      sites: ["claude", "chatgpt", "gemini", "kimi", "deepseek"],
      images: []
    }
  );
  assert.deepEqual(
    parseBroadcastRequest({
      runId: "run-9",
      text: "compare",
      tier: "fast",
      sites: ["yuanbao", "chatglm", "qianwen", "deepseek", "doubao", "kimi", "gemini", "chatgpt", "claude"],
      images: []
    }),
    {
      runId: "run-9",
      text: "compare",
      tier: "fast",
      sites: ["yuanbao", "chatglm", "qianwen", "deepseek", "doubao", "kimi", "gemini", "chatgpt", "claude"],
      images: []
    }
  );
  assert.equal(parseBroadcastRequest({ text: "x", tier: null, sites: ["claude"], images: [] }), null);
  assert.equal(parseBroadcastRequest({ runId: "", text: "x", tier: null, sites: ["claude"], images: [] }), null);
  assert.equal(parseBroadcastRequest({ runId: "x".repeat(129), text: "x", tier: null, sites: ["claude"], images: [] }), null);
  assert.equal(parseBroadcastRequest({ runId: "run", text: "x", tier: null, sites: ["claude", "claude"], images: [] }), null);
  assert.equal(parseBroadcastRequest({ runId: "run", text: "x", tier: null, sites: ["unknown"], images: [] }), null);
  assert.equal(parseBroadcastRequest({ runId: "run", text: "", sites: ["claude"] }), null);
  assert.equal(parseBroadcastRequest({ runId: "run", text: "x", tier: "turbo", sites: ["claude"] }), null);
  assert.equal(parseBroadcastRequest({ runId: "run", text: "x", sites: ["claude"], images: [{ ...png, size: 7 }] }), null);
});

test("collection IPC accepts product sites and a bounded optional run id", () => {
  assert.deepEqual(
    parseCollectionRequest({ sites: ["kimi", "claude"], runId: "run-1" }),
    { sites: ["kimi", "claude"], runId: "run-1" }
  );
  assert.deepEqual(parseCollectionRequest({ sites: ["claude"], runId: null }), {
    sites: ["claude"],
    runId: null
  });
  assert.equal(parseCollectionRequest({ sites: [] }), null);
  assert.equal(parseCollectionRequest({ sites: ["unknown"] }), null);
  assert.equal(parseCollectionRequest({ sites: ["claude", "claude"] }), null);
  assert.equal(parseCollectionRequest({ sites: ["claude"], runId: " " }), null);
  assert.equal(parseCollectionRequest({ sites: ["claude"], runId: "x".repeat(129) }), null);
});

test("page IPC accepts only bounded non-negative integers", () => {
  assert.equal(parsePageIndex(0), 0);
  assert.equal(parsePageIndex(8), 8);
  assert.equal(parsePageIndex(-1), null);
  assert.equal(parsePageIndex(1.5), null);
  assert.equal(parsePageIndex("1"), null);
  assert.equal(parsePageIndex(10_000), null);
});
