import assert from "node:assert/strict";
import test from "node:test";

import { parseBroadcastRequest, parseCollectionRequest } from "../src/shared/protocol";

const png = {
  name: "x.png",
  type: "image/png",
  size: 8,
  dataUrl: "data:image/png;base64,iVBORw0KGgo="
} as const;

test("broadcast IPC accepts only a bounded request for known sites", () => {
  assert.deepEqual(
    parseBroadcastRequest({
      text: "  compare this  ",
      tier: "think",
      sites: ["claude", "gemini"],
      images: [png]
    }),
    { text: "compare this", tier: "think", sites: ["claude", "gemini"], images: [png] }
  );
  assert.equal(parseBroadcastRequest({ text: "", sites: ["claude"] }), null);
  assert.equal(parseBroadcastRequest({ text: "x", sites: ["unknown"] }), null);
  assert.equal(parseBroadcastRequest({ text: "x", sites: ["claude", "claude"] }), null);
  assert.equal(parseBroadcastRequest({ text: "x", tier: "turbo", sites: ["claude"] }), null);
  assert.equal(parseBroadcastRequest({ text: "x", sites: ["claude"], images: [{ ...png, size: 7 }] }), null);
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
  assert.equal(parseCollectionRequest({ sites: ["claude"], runId: "x".repeat(129) }), null);
});
