import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMANDS,
  commandAliasForInput,
  commandAccelerator,
  commandById,
  type CommandId
} from "../src/shared/commands";
import { COPY } from "../src/shared/copy";
import { executeCommand } from "../src/renderer/command-dispatcher";

test("desktop commands have one unique registry entry and localized labels", () => {
  const ids = COMMANDS.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(commandById("open-command-palette")?.id, "open-command-palette");
  assert.equal(commandById("missing"), undefined);

  for (const command of COMMANDS) {
    assert.ok(COPY.en[command.labelKey]);
    assert.ok(COPY.zhCN[command.labelKey]);
    assert.ok(COPY.zhTW[command.labelKey]);
  }
});

test("desktop command accelerators reserve Alt shortcuts and platform settings keys", () => {
  assert.equal(commandAccelerator("open-command-palette", "win32"), "Alt+K");
  assert.equal(commandById("open-command-palette")?.aliases?.includes("F1"), true);
  assert.equal(commandAccelerator("open-sites", "linux"), "Alt+S");
  assert.equal(commandAccelerator("open-site-health", "win32"), "Alt+H");
  assert.equal(commandAccelerator("show-page-1", "win32"), "Alt+1");
  assert.equal(commandAccelerator("show-page-2", "win32"), "Alt+2");
  assert.equal(commandAccelerator("show-page-3", "win32"), "Alt+3");
  assert.equal(commandAccelerator("focus-prompt", "linux"), "Alt+Q");
  assert.equal(commandAccelerator("set-think", "win32"), "Alt+T");
  assert.equal(commandAccelerator("set-fast", "win32"), "Alt+Y");
  assert.equal(commandAccelerator("open-settings", "darwin"), "Command+, ".trim());
  assert.equal(commandAccelerator("open-settings", "win32"), "Control+,");
  assert.equal(commandAliasForInput({ type: "keyDown", key: "F1", alt: false, control: false, meta: false, shift: false }), "open-command-palette");
  assert.equal(commandAliasForInput({ type: "keyUp", key: "F1", alt: false, control: false, meta: false, shift: false }), undefined);
});

test("renderer command dispatch uses the shared command identifier", () => {
  const called: CommandId[] = [];
  const actions = {
    "open-sites": () => called.push("open-sites"),
    "focus-prompt": () => called.push("focus-prompt")
  };

  assert.equal(executeCommand("open-sites", actions), true);
  assert.equal(executeCommand("focus-prompt", actions), true);
  assert.equal(executeCommand("show-page-1", actions), false);
  assert.deepEqual(called, ["open-sites", "focus-prompt"]);
});
