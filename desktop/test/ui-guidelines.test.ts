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
