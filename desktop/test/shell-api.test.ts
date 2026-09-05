import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { PolyAskDesktopApi } from "../src/preload/shell";
import { setShellApi, shell } from "../src/renderer/shell-api";
import { readSource } from "./fixtures";

test("renderer code reaches the preload API only through the shell facade", () => {
  const offenders = readdirSync(path.join(__dirname, "..", "src", "renderer"))
    .filter((name) => /\.tsx?$/.test(name) && name !== "shell-api.ts")
    .filter((name) => /window\.polyask/.test(readSource(`src/renderer/${name}`)));
  assert.deepEqual(offenders, [], "renderer 下只有 shell-api.ts 可以直接读 window.polyask");
});

test("the shell facade resolves lazily so tests can inject a stub without a global window", () => {
  const calls: number[] = [];
  setShellApi({ stepPage: (delta: 1 | -1) => { calls.push(delta); } } as unknown as PolyAskDesktopApi);
  try {
    shell.stepPage(-1);
    assert.deepEqual(calls, [-1]);
  } finally {
    setShellApi(null);
  }
});
