import assert from "node:assert/strict";
import test from "node:test";
import { readSource } from "./fixtures";

const manager = readSource("src/main/view-manager.ts");
const slice = (name: string): string => {
  const start = manager.indexOf(`private ${name}(`);
  assert.ok(start > 0, `${name} 不存在`);
  return manager.slice(start, manager.indexOf("\n  }", start));
};

// 此前 `for (const site of SITES) this.createView(site)` 无条件把九个站点全部建出来并加载完整 SPA，
// 于是「少勾站点」根本不省内存（真机实测单站平均约 250MB 工作集）。
test("views are created for the selection, never for the whole catalogue", () => {
  assert.ok(!/for \(const site of SITES\) this\.createView/.test(manager),
    "构造期不得再无条件为九站建视图——那正是「少勾也不省内存」的根因");
  assert.match(manager, /this\.ensureViews\(\);/);
  assert.match(slice("ensureViews"), /for \(const key of this\.selected\)/);
  assert.match(slice("ensureViews"), /if \(this\.views\.has\(key\)\) continue;/,
    "已存在的视图不得重建，否则切页会把对话冲掉");
});

test("deselecting a site releases its view, but never one that is busy", () => {
  const release = slice("releaseUnselectedViews");

  assert.match(release, /this\.selected\.includes\(key\)/);
  assert.match(release, /siteReloadAllowed/,
    "正在发送/生成的站点不得释放——会把正在写的回答连页面一起丢掉");
  assert.match(release, /webContents\.close\(\)/);
  // 释放时要连状态一起清干净，否则重新勾选后会读到上一轮的残留状态
  for (const cleanup of ["this.detach(key)", "this.views.delete(key)", "this.pageStatus.delete(key)",
    "this.runStatus.delete(key)", "this.clearGenerationTracking(key)"]) {
    assert.ok(release.includes(cleanup), `释放时漏了 ${cleanup}`);
  }
});

test("both halves run on every reconcile so the state self-heals", () => {
  const reconcile = slice("reconcileViews");

  // 忙碌站点这一轮不释放，靠下一次 reconcile 补上——不自愈就会永远留在内存里。
  assert.match(reconcile, /this\.ensureViews\(\);/);
  assert.match(reconcile, /this\.releaseUnselectedViews\(\);/);
});

test("selection changes go through reconcile, not a bespoke path", () => {
  const selection = manager.slice(manager.indexOf("setSelection("), manager.indexOf("setPage("));

  assert.match(selection, /this\.reconcileViews\(\)/,
    "setSelection 必须经 reconcileViews，新勾选的站点才会被建出来");
});
