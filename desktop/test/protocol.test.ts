import assert from "node:assert/strict";
import test from "node:test";

import { parseBroadcastRequest } from "../src/shared/protocol";

test("broadcast IPC accepts only a bounded request for known sites", () => {
  assert.deepEqual(
    parseBroadcastRequest({
      text: "  compare this  ",
      tier: "think",
      sites: ["claude", "gemini"]
    }),
    { text: "compare this", tier: "think", sites: ["claude", "gemini"] }
  );
  assert.equal(parseBroadcastRequest({ text: "", sites: ["claude"] }), null);
  assert.equal(parseBroadcastRequest({ text: "x", sites: ["unknown"] }), null);
  assert.equal(parseBroadcastRequest({ text: "x", sites: ["claude", "claude"] }), null);
  assert.equal(parseBroadcastRequest({ text: "x", tier: "turbo", sites: ["claude"] }), null);
});
