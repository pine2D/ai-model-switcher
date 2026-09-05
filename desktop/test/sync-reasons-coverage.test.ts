import assert from "node:assert/strict";
import test from "node:test";

import { classifySyncFailure, type FailureStage } from "../src/main/sync-failures";
import { readSource } from "./fixtures";

// sync 失败码三联表对账：主进程产出的 reason ⊆ 诊断报告放行的 SAFE_REASONS ⊆ 渲染层 describeSync 认得的 reason，
// 三张表互相覆盖。任一锚点抽不到就 fail，别让「表被改名」变成静默全绿。

function producedReasons(): Set<string> {
  const failures = readSource("src/main/sync-failures.ts");
  const codes = [...new Set([...failures.matchAll(/code === "([a-z_]+)"/g)].map((m) => m[1]))];
  assert.ok(codes.length >= 10, "sync-failures.ts 的 code 字面量抽取失效");
  const reasons = new Set<string>();
  const note = (error: unknown, stage: FailureStage) => {
    const reason = classifySyncFailure(error, stage).reason;
    if (reason) reasons.add(reason);
  };
  for (const stage of ["oauth", "drive", "sync"] as const) {
    for (const code of codes) note({ code }, stage);
    note(new TypeError("fetch failed"), stage);
    for (const detail of ["notConfigured", "userRateLimitExceeded", "insufficientPermissions"]) note({ code: "forbidden", reason: detail }, stage);
    note({ code: "oauth_provider_error", providerCode: "invalid_request" }, stage);
  }
  // 引擎自己写进 status.reason 的字面量：setStatus 的 reason: "x"，以及 run("x") 的阶段名（drive_check）。
  // syncNow("manual"/"periodic"/…) 的触发原因只在 syncing 期间短暂出现，刻意不进表，也不在这里抽。
  const engine = readSource("src/main/sync-engine.ts");
  const literals = [...engine.matchAll(/(?:reason: [^"\n]*|this\.run\()"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(literals.length >= 3, "sync-engine.ts 的 reason 字面量抽取失效");
  for (const reason of literals) reasons.add(reason);
  return reasons;
}

function safeReasons(): Set<string> {
  const source = readSource("src/shared/sync-diagnostics.ts");
  const block = source.match(/const SAFE_REASONS = new Set\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(block, "sync-diagnostics.ts 找不到 SAFE_REASONS（被改名了就同步这段抽取）");
  return new Set([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
}

function describedReasons(): Set<string> {
  const source = readSource("src/renderer/sync-status.ts");
  const reasons = new Set([...source.matchAll(/status\.reason === "([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(reasons.size >= 10, "sync-status.ts 的 reason 分支抽取失效");
  return reasons;
}

test("every sync reason the main process produces is diagnosable and translatable", () => {
  const safe = safeReasons();
  const described = describedReasons();
  for (const reason of producedReasons()) {
    assert.ok(safe.has(reason), `sync-failures/sync-engine 产出 reason ${reason}，但 sync-diagnostics.ts 的 SAFE_REASONS 没有它——诊断报告会把它抹掉`);
    assert.ok(described.has(reason), `sync-failures/sync-engine 产出 reason ${reason}，但 renderer/sync-status.ts 不认得它——设置页只会显示笼统状态`);
  }
});

test("the diagnostic and renderer reason tables carry no dead entries", () => {
  const produced = producedReasons();
  for (const reason of safeReasons()) assert.ok(produced.has(reason), `SAFE_REASONS 里的 ${reason} 没有任何产出方`);
  for (const reason of describedReasons()) assert.ok(produced.has(reason), `sync-status.ts 翻译的 ${reason} 没有任何产出方`);
});
