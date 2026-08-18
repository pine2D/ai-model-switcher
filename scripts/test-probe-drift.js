#!/usr/bin/env node
"use strict";
// probe-drift.js 离线回归：diff 双轨语义（警报/参考）、阈值边界、LABEL_PROBES 登记对账、buildExpr 字段对齐。
// probe-drift.js 顶层无副作用（main 有 require.main 守卫），直接 require 拿导出。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { diffSnapshots, buildExpr, LABEL_PROBES, manifestHosts } = require("./probe-drift.js");

const base = () => ({
  composer: { w: 600, h: 40 }, dpr: 1.5, state: "fast", loginWall: false,
  checks: [{ name: "输入框", ok: true }, { name: "模型入口", ok: true }],
});

test("无上次快照 / 无变化 → 双轨皆空", () => {
  assert.deepEqual(diffSnapshots(null, base()), { alerts: [], info: [] });
  assert.deepEqual(diffSnapshots(base(), base()), { alerts: [], info: [] });
});

test("检查转红入警报；数量变化单列并报出当前红项", () => {
  const flip = diffSnapshots(base(), { ...base(), checks: [{ name: "输入框", ok: false }, { name: "模型入口", ok: true }] });
  assert.ok(flip.alerts.some((n) => n.includes("检查转红: 输入框")));
  const grow = diffSnapshots(base(), { ...base(), checks: [...base().checks, { name: "发送键", ok: false }] });
  assert.ok(grow.alerts.some((n) => n.includes("检查项数量变化: 2 → 3") && n.includes("发送键")));
});

test("界面语言切换（名字整包换、ok 不变）→ 零警报，只留参考说明", () => {
  const zh = base();
  const en = { ...base(), checks: [{ name: "Composer", ok: true }, { name: "Model entry", ok: true }] };
  const r = diffSnapshots(zh, en);
  assert.deepEqual(r.alerts, []);
  assert.ok(r.info.some((n) => n.includes("界面语言切换")));
});

test("state/标签变化是使用痕迹入参考；标签有值→∅ 升警报（方法改名/站点改版）", () => {
  const used = diffSnapshots({ ...base(), label: "GPT-5.6 Sol" }, { ...base(), state: "think", label: "Instant" });
  assert.deepEqual(used.alerts, []);
  assert.ok(used.info.some((n) => n.includes("state: fast → think")));
  assert.ok(used.info.some((n) => n.includes("标签串")));
  const broke = diffSnapshots({ ...base(), label: "K3 / Max" }, { ...base(), label: null });
  assert.ok(broke.alerts.some((n) => n.includes("标签串 → ∅")));
});

test("composer 阈值：≥20% 必报（20→16 v0.15.2 教训）、不足 20% 不报、恰 20% 边界防放宽", () => {
  const small = { ...base(), composer: { w: 600, h: 20 } };
  assert.ok(diffSnapshots(small, { ...base(), composer: { w: 600, h: 16 } }).alerts.some((n) => n.includes("composer h: 20 → 16")));
  assert.deepEqual(diffSnapshots(base(), { ...base(), composer: { w: 660, h: 44 } }).alerts, []); // +10%
  assert.ok(diffSnapshots(base(), { ...base(), composer: { w: 600, h: 32 } }).alerts.some((n) => n.includes("composer h: 40 → 32"))); // 恰 -20%：把 0.2 改大即红
  assert.ok(diffSnapshots(base(), { ...base(), composer: null }).alerts.some((n) => n.includes("composer 消失")));
});

test("登录墙：出现是警报；在场时锚点差异降级为参考，composer 类仍是警报", () => {
  const walled = { ...base(), loginWall: true, composer: null,
    checks: [{ name: "输入框", ok: false }, { name: "模型入口", ok: false }] };
  const r = diffSnapshots(base(), walled);
  assert.ok(r.alerts.some((n) => n.includes("疑似出现登录墙")));
  assert.ok(r.alerts.some((n) => n.includes("composer 消失")));
  assert.ok(!r.alerts.some((n) => n.includes("检查转红")), "登录墙在场时检查转红不得计入警报");
  assert.ok(r.info.some((n) => n.includes("检查转红")));
  // 持续登出（无变化）不再每轮重播提醒
  assert.deepEqual(diffSnapshots(walled, walled), { alerts: [], info: [] });
});

test("dpr 变化是环境参考，不入警报", () => {
  const r = diffSnapshots(base(), { ...base(), dpr: 1 });
  assert.deepEqual(r.alerts, []);
  assert.ok(r.info.some((n) => n.includes("环境变化")));
});

test("LABEL_PROBES 登记对账：九站 host 全覆盖，探针方法名在适配器源码里真实存在", () => {
  for (const host of manifestHosts())
    assert.ok(Object.keys(LABEL_PROBES).some((k) => host.includes(k)), host + " 没有标签探针（加站要同步 LABEL_PROBES）");
  const adapters = ["content/adapters-intl.js", "content/adapters-cn.js", "content/adapters-cn2.js"]
    .map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const [key, snippet] of Object.entries(LABEL_PROBES))
    for (const m of snippet.matchAll(/a\.(_[A-Za-z]+)\(/g))
      assert.ok(adapters.includes(m[1] + ":"), key + " 的探针引用了不存在的适配器方法 " + m[1]);
});

test("buildExpr 字段名与 diff 读取的键对齐，且各站注入了自己的标签探针片段", () => {
  for (const host of manifestHosts()) {
    const expr = buildExpr(host);
    for (const field of ["composer:", "dpr:", "state:", "checks:", "label:", "loginWall:"])
      assert.ok(expr.includes(field), host + " 的表达式缺字段 " + field);
    const key = Object.keys(LABEL_PROBES).find((k) => host.includes(k));
    assert.ok(expr.includes(LABEL_PROBES[key]), host + " 的表达式未注入标签探针片段");
  }
});
