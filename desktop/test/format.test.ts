import assert from "node:assert/strict";
import test from "node:test";

import { formatDateTime } from "../src/shared/format";

test("desktop timestamps use locale-aware Intl formatting", () => {
  const at = Date.UTC(2026, 7, 25, 8, 5);
  assert.equal(formatDateTime(at, "en-US", "UTC"), "8/25/26, 8:05 AM");
  assert.match(formatDateTime(at, "zh-CN", "UTC"), /2026\/8\/25 08:05/);
});
