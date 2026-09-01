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
  assert.equal(buildSiteHealth({ site: "chatgpt", phase: "ready", navigation: "external" }).state, "error");
  assert.equal(buildSiteHealth({ site: "gemini", phase: "loading", navigation: "transit" }).state, "unknown");
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
  // 缺省 kind 归一成 control：漏标只会保留「红即告警」的现状，绝不会静默降级成提示。
  assert.deepEqual(checks[1], { name: "Missing", ok: false, kind: "control" });
});

test("check kinds are whitelisted and default to the loud one", () => {
  const checks = normalizeDiagnosticChecks([
    { name: "Composer", ok: true, kind: "reach" },
    { name: "Tier", ok: false, kind: "tier" },
    { name: "Bogus", ok: false, kind: "made-up" },
    { name: "Numeric", ok: false, kind: 7 }
  ]);

  assert.deepEqual(checks.map((check) => check.kind), ["reach", "tier", "control", "control"]);
});

test("an unreadable tier never marks a working site as broken", () => {
  // 千问「Qwen3.7-千问 + 快速」、Kimi「Instant」、元宝「Expert」都是合法但不可判的档位，
  // state() 按设计返回 null。真机 2026-08-31：九站里这三站因此常态误报「发现异常」。
  const health = buildSiteHealth({
    site: "qianwen",
    phase: "ready",
    navigation: "site",
    checks: [
      { name: "Composer", ok: true, kind: "reach" },
      { name: "Model dropdown", ok: true, kind: "control" },
      { name: "Tier detected", ok: false, kind: "tier" }
    ]
  });

  assert.equal(health.state, "ready");
});

test("a failed reach, control or probe check still marks the site broken", () => {
  for (const kind of ["reach", "control", "probe"] as const) {
    const health = buildSiteHealth({
      site: "claude",
      phase: "ready",
      navigation: "site",
      checks: [{ name: "Composer", ok: true, kind: "reach" }, { name: kind, ok: false, kind }]
    });
    assert.equal(health.state, "error", `${kind} 红必须仍然判 error`);
  }
});

test("a check with no kind at all still marks the site broken", () => {
  const health = buildSiteHealth({
    site: "claude",
    phase: "ready",
    navigation: "site",
    checks: [{ name: "Unlabelled", ok: false }]
  });

  assert.equal(health.state, "error");
});

test("a site whose only check is an unreadable tier reads as ready, not unknown", () => {
  const health = buildSiteHealth({
    site: "kimi",
    phase: "ready",
    navigation: "site",
    checks: [{ name: "Tier detected", ok: false, kind: "tier" }]
  });

  assert.equal(health.state, "ready");
});

test("reload guard blocks active work without blocking completed sites", () => {
  assert.equal(siteReloadAllowed("sending"), false);
  assert.equal(siteReloadAllowed("generating"), false);
  assert.equal(siteReloadAllowed("submitted"), true);
  assert.equal(siteReloadAllowed("failed"), true);
});
