import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const renderer = (file: string) => readFileSync(`src/renderer/${file}`, "utf8");

test("desktop forms expose stable names and disable browser autofill where it is noise", () => {
  const files = [
    renderer("command-bar.tsx"),
    renderer("archive-workspace.tsx"),
    renderer("archive-detail.tsx"),
    renderer("synthesis-workspace.tsx"),
    renderer("settings-workspace.tsx"),
    renderer("workspace-drawer.tsx")
  ].join("\n");
  for (const name of ["prompt", "archive-search", "archive-tags", "archive-note", "synthesis-target", "synthesis-tier", "synthesis-instruction", "synthesis-preview", "clear-cloud-confirmation", "group-name"]) {
    assert.match(files, new RegExp(`name="${name}"`));
  }
  assert.ok([...files.matchAll(/autoComplete="off"/g)].length >= 7);
});

test("image previews reserve geometry and dense long lists skip offscreen rendering", () => {
  const picker = renderer("image-picker.tsx");
  const css = renderer("styles.css");
  assert.match(picker, /<img[^>]+width=\{52\}[^>]+height=\{40\}/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(css, /contain-intrinsic-size:\s*68px/);
});

test("desktop focus, reduced motion and Windows high contrast remain explicit", () => {
  const css = renderer("styles.css") + renderer("settings.css") + renderer("accessibility.css");
  assert.doesNotMatch(css, /outline:\s*none/);
  assert.doesNotMatch(css, /transition:\s*all/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /touch-action:\s*manipulation/);
});

test("desktop motion uses shared curves, explicit properties, and input-aware page feedback", () => {
  const css = renderer("styles.css") + renderer("settings.css") + renderer("accessibility.css");
  assert.match(css, /--ease-out:\s*cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/);
  assert.match(css, /--ease-in-out:\s*cubic-bezier\(0\.77,\s*0,\s*0\.175,\s*1\)/);
  assert.match(css, /--ease-drawer:\s*cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)/);
  assert.match(css, /\.page-tab-indicator[\s\S]*transition:\s*transform 180ms var\(--ease-in-out\)/);
  assert.match(css, /\.page-tabs\[data-input-method="keyboard"\] \.page-tab-indicator[\s\S]*transition-duration:\s*0ms/);
  assert.match(renderer("index.tsx"), /requestedPage\.current\?\.page === next\.page[\s\S]*request\?\.inputMethod \?\? "keyboard"/);
  assert.match(css, /@media \(hover:\s*hover\) and \(pointer:\s*fine\)/);
  assert.match(css, /button:not\(:disabled\):active[\s\S]*transform:\s*scale\(\.97\)/);
  assert.doesNotMatch(css, /button,\s*\.tile-actions\s*\{\s*transition:\s*none/);
});

test("main-menu page changes are announced while renderer-requested changes stay deduplicated", () => {
  const app = renderer("index.tsx");
  assert.match(app, /const request = requestedPage\.current\?\.page === next\.page[\s\S]*if \(!request\)[\s\S]*sitePageChanged/);
  assert.match(app, /requestedPage\.current = null/);
});

test("anchored overlays retain a closing state long enough for interruptible transitions", () => {
  const app = renderer("index.tsx");
  const drawer = renderer("workspace-drawer.tsx");
  const picker = renderer("image-picker.tsx");
  assert.match(app, /usePresence\(drawerOpen/);
  assert.match(drawer, /data-state=\{props\.open \? "open" : "closed"\}/);
  assert.match(picker, /usePresence\(trayOpen, 140\)/);
  assert.match(picker, /data-state=\{trayOpen \? "open" : "closed"\}/);
});

test("occasional full-workspace surfaces enter without animating native site bounds", () => {
  const app = renderer("index.tsx");
  const css = renderer("styles.css");
  assert.match(app, /className="surface-stage"/);
  assert.match(app, /className={`app-shell\$\{/);
  assert.doesNotMatch(app, /app-shell surface-stage/);
  assert.match(css, /\.surface-stage[\s\S]*transition:\s*opacity 180ms var\(--ease-out\), transform 220ms var\(--ease-out\)/);
  assert.match(css, /@starting-style\s*{\s*\.surface-stage/);
  assert.doesNotMatch(css, /webcontents|web-contents/i);
});

test("Drive idle success color requires an active connection", () => {
  const css = renderer("settings.css");
  assert.match(css, /\.sync-state\[data-connected="true"\]\[data-state="idle"\] i\s*\{\s*background:\s*var\(--success\);\s*\}/);
  assert.doesNotMatch(css, /\.sync-state\[data-state="idle"\] i\s*\{/);
});
