import assert from "node:assert/strict";
import test from "node:test";

import { buildSiteReport } from "../src/shared/site-report";

test("the site diagnostic report carries environment, per-site state and every check without content", () => {
  const report = buildSiteReport({
    version: "1.0.0",
    distribution: "portable",
    platform: "Win32",
    scale: 1.25,
    sites: [{ key: "claude", label: "Claude" }, { key: "kimi", label: "Kimi" }],
    statuses: { claude: { site: "claude", phase: "failed", code: "composer_not_found" } },
    health: {
      claude: {
        site: "claude", state: "error", checkedAt: Date.UTC(2026, 8, 5, 3, 0, 0),
        checks: [{ name: "输入框", ok: false, kind: "reach" }, { name: "模型入口", ok: true, kind: "control" }, { name: "当前档位", ok: false, kind: "tier" }]
      }
    },
    now: Date.UTC(2026, 8, 5, 3, 1, 0)
  });
  const lines = report.split("\n");
  assert.equal(lines[0], "PolyAsk Desktop 1.0.0 (portable) · Win32 · scale 1.25");
  assert.equal(lines[1], "generated 2026-09-05T03:01:00.000Z");
  assert.equal(lines[2], "[claude] Claude: phase=failed code=composer_not_found health=error checkedAt=2026-09-05T03:00:00.000Z");
  assert.deepEqual(lines.slice(3, 6), ["  - 输入框 kind=reach ok=false", "  - 模型入口 kind=control ok=true", "  - 当前档位 kind=tier ok=false"]);
  assert.equal(lines[6], "[kimi] Kimi: phase=unknown health=unknown");
  assert.equal(lines[7], "  - (no checks)");
  assert.doesNotMatch(report, /https?:\/\//, "报告不得包含 URL");
});
