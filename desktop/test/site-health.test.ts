import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSiteHealth,
  normalizeDiagnosticChecks,
  siteReloadAllowed,
  summarizeSiteHealth,
  type SiteHealth
} from "../src/shared/site-health";

function health(site: SiteHealth["site"], state: SiteHealth["state"]): SiteHealth {
  return { site, state, checks: [] };
}

test("health summary separates ready, sign-in, error and unknown", () => {
  assert.deepEqual(summarizeSiteHealth([
    health("claude", "ready"),
    health("gemini", "sign-in"),
    health("kimi", "error"),
    health("qianwen", "unknown")
  ]), { ready: 1, signIn: 1, error: 1, unknown: 1 });
});

test("health classification requires explicit evidence", () => {
  assert.equal(buildSiteHealth({ site: "gemini", phase: "ready", navigation: "auth" }).state, "sign-in");
  assert.equal(buildSiteHealth({ site: "claude", phase: "ready", navigation: "site" }).state, "unknown");
  assert.equal(buildSiteHealth({ site: "claude", phase: "ready", navigation: "site", checks: [{ name: "Composer", ok: true }] }).state, "ready");
  assert.equal(buildSiteHealth({ site: "claude", phase: "ready", navigation: "site", checks: [{ name: "Composer", ok: false }] }).state, "error");
  assert.equal(buildSiteHealth({ site: "claude", phase: "failed", navigation: "site", checks: [{ name: "Composer", ok: true }] }).state, "error");
});

test("diagnostic checks are bounded and discard malformed provider data", () => {
  const checks = normalizeDiagnosticChecks([
    { name: ` ${"x".repeat(180)} `, ok: true },
    { name: "Missing", ok: false },
    { name: "No boolean" },
    { name: 42, ok: true }
  ]);
  assert.equal(checks.length, 2);
  assert.equal(checks[0]?.name.length, 120);
  assert.deepEqual(checks[1], { name: "Missing", ok: false });
});

test("reload guard blocks active work without blocking completed sites", () => {
  assert.equal(siteReloadAllowed("sending"), false);
  assert.equal(siteReloadAllowed("generating"), false);
  assert.equal(siteReloadAllowed("submitted"), true);
  assert.equal(siteReloadAllowed("failed"), true);
});
