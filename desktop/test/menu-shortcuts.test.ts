import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAccelerator } from "../src/shared/accelerators";
import { collectMenuShortcuts } from "../src/main/menu-shortcuts";
import { menuShortcutItems } from "../src/renderer/command-search";

// 真机 Electron 43.4.0 读 Menu.getApplicationMenu() 的实测形态：role 项自带 label 与 accelerator，
// 且同一个组合会有 CommandOrControl / CmdOrCtrl 两种写法。
const menu = {
  items: [
    { label: "文件", submenu: { items: [{ label: "Quit", accelerator: "CommandOrControl+Q" }] } },
    { label: "视图", submenu: { items: [
      { label: "Reload", accelerator: "CmdOrCtrl+R" },
      { type: "separator" },
      { label: "Zoom In", accelerator: "CommandOrControl+Plus" },
      { label: "无加速器的项" },
      { label: "隐藏项", accelerator: "Ctrl+9", visible: false },
      { label: "Toggle Full Screen", accelerator: "F11" }
    ] } },
    { label: "空菜单", submenu: { items: [] } }
  ]
};

test("menu shortcuts collect every accelerator the menu actually shows", () => {
  const shortcuts = collectMenuShortcuts(menu);

  assert.deepEqual(shortcuts.map((item) => item.label),
    ["Quit", "Reload", "Zoom In", "Toggle Full Screen"]);
  assert.deepEqual(shortcuts[0], { group: "文件", label: "Quit", accelerator: "CommandOrControl+Q" });
});

test("separators, hidden items and accelerator-less items are skipped", () => {
  const labels = collectMenuShortcuts(menu).map((item) => item.label);

  assert.ok(!labels.includes("无加速器的项"));
  assert.ok(!labels.includes("隐藏项"));
  assert.equal(collectMenuShortcuts(null).length, 0);
});

test("accelerator spellings normalize to one form per platform", () => {
  assert.equal(normalizeAccelerator("CommandOrControl+Q"), normalizeAccelerator("CmdOrCtrl+Q"));
  assert.equal(normalizeAccelerator("Control+C"), normalizeAccelerator("CommandOrControl+C"));
  assert.equal(normalizeAccelerator("Option+T"), "alt+t");
  assert.equal(normalizeAccelerator("CmdOrCtrl+R", true), "cmd+r");
  assert.equal(normalizeAccelerator("CmdOrCtrl+R", false), "ctrl+r");
});

test("menu shortcuts already covered by a listed command are not repeated", () => {
  const listed = [{ id: "reload", label: "重新加载", group: "app" as const,
    accelerator: "Control+R", aliases: [] }];
  const items = menuShortcutItems(collectMenuShortcuts(menu), listed);

  assert.ok(!items.some((item) => item.label === "Reload"), "写法不同但同一组合必须去重");
  assert.deepEqual(items.map((item) => item.label), ["Quit", "Zoom In", "Toggle Full Screen"]);
  assert.ok(items.every((item) => item.group === "menu" && !item.commandId),
    "菜单来源条目只作参考，不可执行");
});

test("duplicate accelerators inside the menu itself collapse to one row", () => {
  const items = menuShortcutItems([
    { group: "视图", label: "Reload", accelerator: "CmdOrCtrl+R" },
    { group: "其它", label: "重新载入", accelerator: "CommandOrControl+R" }
  ], []);

  assert.deepEqual(items.map((item) => item.label), ["Reload"]);
});
