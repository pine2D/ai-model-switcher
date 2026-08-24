import assert from "node:assert/strict";
import test from "node:test";

import { effectiveStatus, statusForResult } from "../src/main/status";

test("successful submit with an unconfirmed tier remains a visible warning", () => {
  assert.deepEqual(
    statusForResult("claude", { ok: true, code: "tier_unconfirmed" }),
    { site: "claude", phase: "warning", code: "tier_unconfirmed" }
  );
  assert.deepEqual(
    statusForResult("claude", { ok: true }),
    { site: "claude", phase: "submitted" }
  );
});

test("user cancellation is neutral rather than a send failure", () => {
  assert.deepEqual(
    statusForResult("claude", { ok: false, code: "cancelled" }),
    { site: "claude", phase: "cancelled", code: "cancelled" }
  );
});

test("page loading does not overwrite an active or completed send", () => {
  assert.deepEqual(
    effectiveStatus(
      { site: "claude", phase: "sending" },
      { site: "claude", phase: "loading" }
    ),
    { site: "claude", phase: "sending" }
  );
  assert.deepEqual(
    effectiveStatus(
      { site: "claude", phase: "warning", code: "tier_unconfirmed" },
      { site: "claude", phase: "ready" }
    ),
    { site: "claude", phase: "warning", code: "tier_unconfirmed" }
  );
});

test("a page crash overrides stale send state", () => {
  assert.deepEqual(
    effectiveStatus(
      { site: "claude", phase: "submitted" },
      { site: "claude", phase: "crashed", code: "renderer_crashed" }
    ),
    { site: "claude", phase: "crashed", code: "renderer_crashed" }
  );
});
