import assert from "node:assert/strict";
import test from "node:test";

import { effectiveStatus, markStatusRead, statusForResult, statusWithUnread } from "../src/main/status";
import { getCopy } from "../src/shared/copy";
import { describeCollectionCode } from "../src/shared/status-copy";

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

test("only unseen terminal work is marked unread and visiting retains its phase", () => {
  assert.deepEqual(statusWithUnread({ site: "claude", phase: "complete" }, false), {
    site: "claude",
    phase: "complete",
    unread: true,
  });
  assert.deepEqual(statusWithUnread({ site: "claude", phase: "failed" }, true), {
    site: "claude",
    phase: "failed",
    unread: false,
  });
  assert.deepEqual(statusWithUnread({ site: "claude", phase: "generating" }, false), {
    site: "claude",
    phase: "generating",
  });
  assert.deepEqual(markStatusRead({ site: "claude", phase: "complete", unread: true }), {
    site: "claude",
    phase: "complete",
    unread: false,
  });
});

// F218：扩展↔Desktop 归档码双向对账。扩展端 no_window（尚未开窗）与 Desktop 端 no_view（视图已销毁/未打开）
// 语义相通，一份归档条目跨端同步后，两端都不能把对方的码兜底成笼统的「失败」。
test("collection code fallback recognizes both the extension's and Desktop's own window-unavailable codes", () => {
  const copy = getCopy("zh-CN");
  assert.equal(describeCollectionCode(copy, "no_view"), copy.siteUnavailable);
  assert.equal(describeCollectionCode(copy, "no_window"), copy.siteUnavailable);
});
