import assert from "node:assert/strict";
import test from "node:test";

import { SITE_KEYS, type SiteKey } from "../src/shared/contracts";
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
      // 全部已勾选站点都挂在视图树里（未挂载 = 视口 0×0 = 群发打空，见 view-visibility.ts）；
      // 非当前页的用与第一格完全相同的矩形压在其下。
      attached: true,
      bounds: placements[index]?.bounds ?? placements[0].bounds
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
  assert.deepEqual(snapshot.sites.filter((site) => site.attached).map((site) => site.site), [...SITE_KEYS]);
  assert.ok(snapshot.sites.every((site) => site.bounds.width > 0 && site.bounds.height > 0));
  assert.deepEqual(snapshot.violations, []);
});

test("diagnostics reject an attached view left without positive bounds", () => {
  const input = diagnosticInput();
  const snapshot = buildDiagnosticSnapshot({
    ...input,
    sites: input.sites.map((site) => site.site === "chatglm"
      ? { ...site, bounds: { x: 0, y: 0, width: 0, height: 0 } }
      : site)
  });

  assert.equal(snapshot.ok, false);
  assert.ok(snapshot.violations.includes("site_bounds:chatglm"));
});

test("diagnostics reject a layout placement whose view is not attached", () => {
  const input = diagnosticInput();
  const snapshot = buildDiagnosticSnapshot({
    ...input,
    sites: input.sites.map((site) => site.site === visibleKeys[0] ? { ...site, attached: false } : site)
  });

  assert.equal(snapshot.ok, false);
  assert.ok(snapshot.violations.includes("attached_layout"));
});

test("diagnostics reject more layout placements than one page can hold", () => {
  const input = diagnosticInput();
  const extra = { key: SITE_KEYS[5], bounds: placements[0].bounds };
  const snapshot = buildDiagnosticSnapshot({
    ...input,
    layout: { ...input.layout, placements: [...placements, extra] }
  });

  assert.equal(snapshot.ok, false);
  assert.ok(snapshot.violations.includes("layout_count"));
});

test("diagnostics accept background views attached outside the active layout page", () => {
  const snapshot = buildDiagnosticSnapshot(diagnosticInput());

  const background = snapshot.sites.filter((site) => !visibleKeys.includes(site.site as never));
  assert.equal(background.length, SITE_KEYS.length - visibleKeys.length);
  assert.ok(background.every((site) => site.attached && site.bounds.width > 0));
  assert.ok(!snapshot.violations.includes("attached_layout"));
});

test("diagnostic snapshot exposes insecure views", () => {
  const input = diagnosticInput();
  const snapshot = buildDiagnosticSnapshot({
    ...input,
    sites: input.sites.map((site, index) => index === 0 ? { ...site, sandbox: false } : site)
  });

  assert.equal(snapshot.ok, false);
  assert.ok(snapshot.violations.includes("insecure_site:claude"));
});

// 视图按勾选懒建，少几个站是合法状态；守的是结构不变量而不是「恰好九个」。
test("a partial selection is not a violation as long as product order holds", () => {
  const input = diagnosticInput();
  const kept = new Set<SiteKey>([SITE_KEYS[0], SITE_KEYS[2], SITE_KEYS[5]]);
  const snapshot = buildDiagnosticSnapshot({
    ...input,
    layout: { ...input.layout, placements: placements.filter((placement) => kept.has(placement.key)) },
    sites: input.sites.filter((site) => kept.has(site.site))
  });

  assert.deepEqual(snapshot.violations, []);
  assert.equal(snapshot.ok, true);
});

test("an empty or out-of-order site list is still a violation", () => {
  const input = diagnosticInput();

  const empty = buildDiagnosticSnapshot({ ...input, layout: { ...input.layout, placements: [] }, sites: [] });
  assert.ok(empty.violations.includes("site_count"));

  const scrambled = buildDiagnosticSnapshot({
    ...input,
    sites: [input.sites[3], input.sites[1]],
    layout: { ...input.layout, placements: [] }
  });
  assert.ok(scrambled.violations.includes("site_order"), "产品顺序乱了仍必须报警");
});
