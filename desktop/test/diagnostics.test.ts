import assert from "node:assert/strict";
import test from "node:test";

import { SITE_KEYS } from "../src/shared/contracts";
import { buildDiagnosticSnapshot, type DiagnosticInput } from "../src/main/diagnostics";

const visibleKeys = SITE_KEYS.slice(0, 4);
const placements = visibleKeys.map((key, index) => ({
  key,
  bounds: { x: (index % 2) * 600, y: Math.floor(index / 2) * 240, width: 596, height: 236 }
}));

function diagnosticInput(): DiagnosticInput {
  return {
    shellId: 1,
    layout: { mode: "overview", focused: "claude", page: 0, pageCount: 3, placements },
    sites: SITE_KEYS.map((site, index) => ({
      site,
      webContentsId: index + 2,
      partition: "persist:polyask-sites",
      sameSession: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      attached: index < visibleKeys.length,
      bounds: placements[index]?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
    }))
  };
}

test("diagnostic snapshot proves one shell and nine secure site views", () => {
  const snapshot = buildDiagnosticSnapshot(diagnosticInput());

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.shellCount, 1);
  assert.equal(snapshot.sites.length, 9);
  assert.deepEqual(snapshot.sites.map((site) => site.site), SITE_KEYS);
  assert.ok(snapshot.sites.every((site) => site.partition === "persist:polyask-sites"));
  assert.ok(snapshot.sites.every((site) => site.sameSession));
  assert.ok(snapshot.sites.every((site) => site.sandbox && site.contextIsolation && !site.nodeIntegration));
  assert.deepEqual(snapshot.sites.filter((site) => site.attached).map((site) => site.site), visibleKeys);
  assert.ok(snapshot.sites.filter((site) => site.attached).every((site) => site.bounds.width > 0 && site.bounds.height > 0));
  assert.deepEqual(snapshot.violations, []);
});

test("diagnostics reject attached views that do not match the active layout page", () => {
  const input = diagnosticInput();
  const snapshot = buildDiagnosticSnapshot({
    ...input,
    sites: input.sites.map((site) => site.site === "chatglm" ? { ...site, attached: true } : site)
  });

  assert.equal(snapshot.ok, false);
  assert.ok(snapshot.violations.includes("attached_layout"));
  assert.ok(snapshot.violations.includes("site_bounds:chatglm"));
});

test("diagnostic snapshot exposes missing or insecure views", () => {
  const input = diagnosticInput();
  const snapshot = buildDiagnosticSnapshot({
    ...input,
    sites: input.sites.slice(0, 8).map((site, index) => index === 0 ? { ...site, sandbox: false } : site)
  });

  assert.equal(snapshot.ok, false);
  assert.ok(snapshot.violations.includes("site_count"));
  assert.ok(snapshot.violations.includes("insecure_site:claude"));
});
