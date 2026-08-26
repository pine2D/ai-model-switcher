#!/usr/bin/env node
"use strict";
// scripts/probe-drift.js — 机会主义真机探针（哨兵二期）：只读 chrome-dbg 里**已经开着**的站点标签，
// 采集 diagnose/state/标签原文串/composer 尺寸快照，与上次快照 diff 后分两档输出：
//   ! 警报（可操作漂移信号：检查转红、composer 消失/尺寸 ≥20% 突变、标签串→∅、登录墙出现）
//   ~ 参考（环境/使用痕迹：登录墙在场的锚点差异、手动切档导致的 state/标签变化、dpr、界面语言切换）
// 纪律（docs/verify.md「哨兵与报障」）：只读（不开菜单/不注入/不发送）；关着的站 skip 不导航；
// 默认不激活标签，后台 eval 超时（逐请求 8s）时用 --activate 重跑；--dry 只 diff 不落盘（复核用）。
// 日志逐站即时追加到 scratchpad/probe-log.jsonl（gitignored，自动建目录，超 2000 行自动轮转）。
// 命名不得改 test- 前缀（verify.sh 会强制登记进无浏览器 CI）。
// sunset：若连续多个版本没有由它先于用户发现过一次真实漂移，删掉本文件与 docs 对应条目。
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { listPages, activate, evalInPolyAsk } = require("./lib/cdp-min.js");

const ROOT = path.join(__dirname, "..");
const LOG = path.join(ROOT, "scratchpad", "probe-log.jsonl");
const ACTIVATE = process.argv.includes("--activate");
const DRY = process.argv.includes("--dry");

function manifestHosts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  return manifest.content_scripts[0].matches.map((m) => m.replace(/^https:\/\//, "").replace(/\/\*$/, ""));
}
// 各站「标签原文串」只读探针（表达式内 a=适配器对象）：调用适配器内部只读方法（_label/_anchor/…）。
// 方法改名时该站 label 变 ∅ → diff 出警报；scripts/test-probe-drift.js 另有静态对账（host 全覆盖 + 方法名存在）。
const LABEL_PROBES = {
  "claude.ai": 'a._label()',
  "chatgpt.com": '((a._anchor()||{}).textContent||"").trim()',
  "gemini.google.com": '(function(){var b=a._modelBtn();return b?b.getAttribute("aria-label"):null})()',
  "deepseek.com": '(function(){var d=a._deepThink();return d?d.textContent.trim()+" pressed="+d.getAttribute("aria-pressed"):null})()',
  "doubao.com": '((a._modeBtn()||{}).textContent||"").trim()',
  "qianwen.com": '(function(){var m=a._trigger(),b=a._thinkBtn();return (m?m.textContent.trim():"∅")+" | "+(b?((b.getAttribute("aria-label")||b.textContent)||"").trim():"∅")})()',
  "kimi.com": 'a._model()+" / "+a._effort()',
  "yuanbao.tencent.com": '(function(){var m=a._mode();if(m)return m;var g=a._toggle();return g?"deepthink="+a._isOn():null})()',
  "chatglm.cn": '(function(){var g=a._trigger();return g?g.textContent.trim():null})()',
};

// —— diff 纯函数（scripts/test-probe-drift.js 离线回归）——
function namesAllDiffer(pc, cc) {
  if (!pc.length || !cc.length) return false;
  const set = new Set(pc.map((c) => c.name));
  return cc.every((c) => !set.has(c.name));
}
function diffSnapshots(prev, cur) {
  const alerts = [], info = [];
  if (!prev) return { alerts, info };
  const wall = !!cur.loginWall;
  const anchor = wall ? info : alerts; // 登录墙在场：锚点类差异降级为参考，不计入漂移（Kimi 误判教训）
  if (!!prev.loginWall !== wall) alerts.push(wall ? "疑似出现登录墙（可见登录按钮文本）：锚点差异降级为参考" : "登录墙消失");
  const pc = prev.checks || [], cc = cur.checks || [];
  // 检查项按下标对齐：name 是 t() 界面语言串，切语言会整包改名，按 name 对齐会把真信号淹进几十条改名噪音
  if (pc.length === cc.length) {
    for (let i = 0; i < cc.length; i++) if (!!pc[i].ok !== !!cc[i].ok)
      anchor.push((cc[i].ok ? "检查转绿: " : "检查转红: ") + cc[i].name);
  } else {
    anchor.push("检查项数量变化: " + pc.length + " → " + cc.length + "（扩展升级或站点改版；本轮红项: " +
      (cc.filter((c) => !c.ok).map((c) => c.name).join("/") || "无") + "）");
  }
  if (namesAllDiffer(pc, cc)) info.push("检查项名整包变化：疑似界面语言切换，非站点改版");
  // state/标签串在日常使用（手动切档/换模型）中本就会变 → 参考；唯一例外：标签有值→∅ = 探针或站点坏了
  if ((prev.state || null) !== (cur.state || null)) info.push("state: " + (prev.state || "null") + " → " + (cur.state || "null"));
  if ((prev.label || null) !== (cur.label || null)) {
    if (prev.label && cur.label == null) anchor.push("标签串 → ∅（适配器只读方法改名或站点改版）");
    else info.push("标签串: 「" + (prev.label || "∅") + "」→「" + (cur.label || "∅") + "」");
  }
  const a = prev.composer, b = cur.composer;
  if (!!a !== !!b) alerts.push(b ? "composer 出现" : "composer 消失");
  else if (a && b) for (const dim of ["w", "h"]) {
    // 变化 ≥20% 即警报；2px 地板只压亚像素抖动，不吞小 composer 的真实回归（20→16 必须报，v0.15.2 教训）
    if (Math.abs(b[dim] - a[dim]) >= Math.max(2, a[dim] * 0.2)) alerts.push("composer " + dim + ": " + a[dim] + " → " + b[dim] + "（变化 ≥20%）");
  }
  if (prev.dpr !== cur.dpr) info.push("dpr: " + prev.dpr + " → " + cur.dpr + "（环境变化，非站点改版）");
  return { alerts, info };
}

function runMeta() {
  const git = (cmd) => { try { return execSync(cmd, { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (e) { return null; } };
  const head = git("git rev-parse --short HEAD");
  const status = git("git status --porcelain");
  return { head: head || "?", dirty: status == null ? null : !!status, // null=git 不可用（三态，别把不可用报成脏）
    ver: JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version };
}

function buildExpr(host) {
  const key = Object.keys(LABEL_PROBES).find((k) => host.includes(k));
  const labelSnippet = key ? LABEL_PROBES[key] : "null";
  return "(function(){" +
    'var S=window.__AMS; if(!S) return JSON.stringify({err:"no __AMS"});' +
    "var key=Object.keys(S.adapters).find(function(k){return location.hostname.indexOf(k)>=0;});" +
    "var a=key?S.adapters[key]:null;" +
    "var el=null; try{el=S.findComposer();}catch(e){}" +
    "var r=el?el.getBoundingClientRect():null;" +
    "var label=null; try{label=a?(" + labelSnippet + "):null;}catch(e){}" +
    // 登录墙强证据：可见的登录/注册按钮文本（前缀式，覆盖 登入/註冊/Sign in with…）；弱类名匹配不算数
    'var login=false; try{login=[].some.call(document.querySelectorAll("button,a,[role=button]"),function(e){' +
    'var t=(e.textContent||"").trim(); if(!/^(登录|登入|立即登录|注册|註冊|(sign|log)\\s?in\\b)/i.test(t)) return false;' +
    "var b=e.getBoundingClientRect(); return b.width>0&&b.height>0;});}catch(e){}" +
    "var checks=[]; try{checks=S.diagnose();}catch(e){}" +
    "var state=null; try{state=S.getState();}catch(e){}" +
    "return JSON.stringify({composer:r?{w:Math.round(r.width),h:Math.round(r.height*10)/10}:null," +
    "dpr:devicePixelRatio,state:state,checks:checks,label:label==null?null:String(label).slice(0,120),loginWall:login});" +
    "})()";
}

// 读全量日志：每站最后一整行（含 ts/meta 供提醒上下文）；顺带轮转与坏行统计
function lastSnapshots() {
  const map = new Map();
  if (!fs.existsSync(LOG)) return { map, broken: 0 };
  const lines = fs.readFileSync(LOG, "utf8").split("\n").filter((l) => l.trim());
  let broken = 0;
  for (const line of lines) {
    try { const row = JSON.parse(line); map.set(row.host, row); } catch (e) { broken++; }
  }
  if (lines.length > 2000 && !DRY) {
    fs.writeFileSync(LOG, lines.slice(-1000).join("\n") + "\n");
    console.log("（probe-log 超 2000 行，已轮转保留最近 1000 行）");
  }
  if (broken) console.log("（跳过 " + broken + " 行损坏日志记录）");
  return { map, broken };
}

async function main() {
  const hosts = manifestHosts();
  let pages;
  try { pages = await listPages(); }
  catch (e) { console.error("chrome-dbg 不在线：探针只读已开标签，请先手动开 chrome-dbg。"); process.exit(1); }
  const { map: prev } = lastSnapshots();
  const meta = runMeta();
  if (meta.dirty === true) console.log("⚠ 工作区有未提交改动：本次结果不代表任何已发布版本（HEAD " + meta.head + "）");
  if (meta.dirty === null) console.log("（git 不可用，无法判断工作区状态）");
  const covered = [], skipped = [], failed = [];
  let alertCount = 0;
  for (const host of hosts) {
    const targets = pages.filter((p) => { try { return new URL(p.url).hostname === host; } catch (e) { return false; } });
    if (!targets.length) { skipped.push(host); console.log("· " + host + ": skip（未开标签）"); continue; }
    if (targets.length > 1) console.log("⚠ " + host + ": " + targets.length + " 个同站 target（prerender/多标签），逐个探测取有 __AMS 的");
    let snap = null, reason = "no_world";
    for (const target of targets) {
      if (ACTIVATE) await activate(target.id);
      try {
        const out = await evalInPolyAsk(target, buildExpr(host));
        if (out.err) { reason = out.err; continue; }
        snap = JSON.parse(out.value);
        if (snap.err) { reason = snap.err; snap = null; continue; }
        break;
      } catch (e) { reason = e.message === "timeout" ? "eval 超时（后台标签冻结？用 --activate 重跑）" : e.message; }
    }
    if (!snap) {
      failed.push(host);
      console.log("✗ " + host + ": " + (reason === "no_world" ? "content 未注入（扩展刚重载？刷新该标签后重试）" : reason));
      continue;
    }
    covered.push(host);
    const bad = (snap.checks || []).filter((c) => !c.ok).map((c) => c.name);
    console.log((bad.length ? "△ " : "✓ ") + host + ": state=" + (snap.state || "null") +
      (bad.length ? " 红[" + bad.join("/") + "]" : "") + (snap.loginWall ? " ⚠登录墙?" : "") +
      " 标签「" + (snap.label == null ? "∅" : snap.label.slice(0, 48)) + "」");
    const prevRow = prev.get(host);
    const { alerts, info } = diffSnapshots(prevRow && prevRow.snap, snap);
    const baseline = prevRow ? "（基线 " + (prevRow.ts || "?").slice(0, 16) + " @ " + ((prevRow.meta || {}).head || "?") + "）" : "";
    if (prevRow && (prevRow.meta || {}).head !== meta.head && (alerts.length || info.length))
      console.log("  ~ 基线来自其它提交" + baseline + "，差异可能是本仓改动所致");
    for (const note of alerts) { console.log("  ! " + note + baseline); alertCount++; }
    for (const note of info) console.log("  ~ " + note);
    if (!DRY) {
      fs.mkdirSync(path.dirname(LOG), { recursive: true }); // 逐站即时落盘：中途挂死不丢整轮
      fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), host, meta, snap }) + "\n");
    }
  }
  const coverage = "覆盖 " + covered.length + "/" + hosts.length + " 站" +
    (skipped.length ? "（skip: " + skipped.join(",") + "）" : "") +
    (failed.length ? "（失败: " + failed.join(",") + "）" : "");
  console.log(coverage + " · " + (prev.size === 0 ? "首轮基线已建立" : alertCount ? "警报 " + alertCount + " 条" : "无漂移警报") + (DRY ? "（--dry 未落盘）" : ""));
}
if (require.main === module) main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
module.exports = { diffSnapshots, buildExpr, LABEL_PROBES, manifestHosts };
