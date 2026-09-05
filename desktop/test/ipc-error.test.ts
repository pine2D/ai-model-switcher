import assert from "node:assert/strict";
import test from "node:test";

import { ipcErrorCode } from "../src/shared/ipc-error";
import { readSource } from "./fixtures";

test("ipcErrorCode strips Electron's remote-method prefix down to the bare code", () => {
  assert.equal(ipcErrorCode(new Error("Error invoking remote method 'polyask:synthesis-send': Error: target_not_selected")), "target_not_selected");
  assert.equal(ipcErrorCode(new Error("Error invoking remote method 'polyask:x': TypeError: not_ready")), "not_ready");
  assert.equal(ipcErrorCode(new Error("Error invoking remote method 'polyask:sync-now': Error: sync_failed: 401")), "sync_failed: 401");
  assert.equal(ipcErrorCode(new Error("submit_unconfirmed")), "submit_unconfirmed");
});

test("ipcErrorCode tolerates non-Error input and empty messages", () => {
  assert.equal(ipcErrorCode("plain_string"), "plain_string");
  assert.equal(ipcErrorCode(undefined), "");
  assert.equal(ipcErrorCode({ message: "x" }), "");
  assert.equal(ipcErrorCode(new Error("")), "");
});

test("every preload invoke goes through the unwrapping helper", () => {
  const preload = readSource("src/preload/shell.ts");
  assert.equal((preload.match(/ipcRenderer\.invoke\(/g) ?? []).length, 1, "preload/shell.ts 只允许包装函数自己调 ipcRenderer.invoke");
  assert.match(preload, /throw new Error\(ipcErrorCode\(error\)\)/);
});
