#!/usr/bin/env node
"use strict";
// scripts/capture-evidence.js — 修复流水线取证（哨兵二期，只读，人工监督下使用）。
// 用法：① `node scripts/capture-evidence.js kimi base` 抓基线；② 人工在浏览器里展开目标菜单；
//       ③ 换个 tag 再跑一次；④ `node scripts/capture-evidence.js --diff <A.json> <B.json>` 看新增/消失控件。
// 采集：composer 祖先链 + 全页可见交互控件清单（role/testid/aria/40 字截断文本/几何）。
// 隐私硬规则：会话/消息容器（denylist 按 docs/adapters.md 九站站点卡派生）里的控件整体排除、文本截 40 字；
// 包含 composer 的骨架容器豁免（四站根容器类名带 sidebar/conversation，不豁免会清空整页——审查实证）；
// 祖先链中命中 denylist 的层删 aria 并标 denied。产物仍可能含页面词语，**外发给任何模型前先人工过目，用完即删**。
// sunset：站点改版流程若不再依赖人工取证（如三期常量数据化落地）即退役本文件与 docs 对应条目。
const fs = require("node:fs");
const path = require("node:path");
const { listPages, evalInPolyAsk } = require("./lib/cdp-min.js");

// denylist 按九站站点卡派生（.ds-message/[data-message-id]/.answer-common-card/.chat-content-item-*/
// .agent-chat__conv-*/.answer-content/.font-claude-response/message-content/[data-turn] + 侧栏骨架类）
const EXPR = "(function(){" +
  'var S=window.__AMS; if(!S) return JSON.stringify({err:"no __AMS"});' +
  'var DENY="nav,aside,[class*=sidebar i],[class*=history i],[class*=session i],[class*=conversation i],[class*=chat-list i],' +
  '[data-message-id],[data-turn],[class*=message i],[class*=chat-content-item i],[class*=agent-chat__conv i],' +
  '[class*=answer-common-card i],[class*=answer-content i],[class*=font-claude-response i],message-content";' +
  "function safeText(s){return (s||\"\").replace(/\\s+/g,\" \").trim().slice(0,40);}" +
  "function box(e){var r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}" +
  "function brief(e){return {tag:e.tagName.toLowerCase(),id:e.id||undefined,testid:e.getAttribute(\"data-testid\")||undefined," +
  "role:e.getAttribute(\"role\")||undefined,cls:safeText((e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className)||\"\").split(\" \").slice(0,2).join(\" \")||undefined," +
  "aria:safeText(e.getAttribute(\"aria-label\"))||undefined,text:safeText(e.textContent)||undefined," +
  "haspopup:e.getAttribute(\"aria-haspopup\")||undefined,expanded:e.getAttribute(\"aria-expanded\")||undefined," +
  "checked:e.getAttribute(\"aria-checked\")||e.getAttribute(\"aria-pressed\")||undefined,rect:box(e)};}" +
  "var composer=null;try{composer=S.findComposer();}catch(e){}" +
  // composer 逃生阀：包住 composer 的 deny 祖先是页面骨架，不参与排除（否则 chatglm/kimi/qianwen/gemini 整页被清空）
  "var allow=new Set();for(var p=composer;p;p=p.parentElement){if(p.matches&&p.matches(DENY))allow.add(p);}" +
  "function denied(e){var d=e.closest(DENY);while(d){if(!allow.has(d))return true;d=d.parentElement?d.parentElement.closest(DENY):null;}return false;}" +
  "var chain=[];for(var q=composer,i=0;q&&i<7;i++){var row=brief(q);row.children=q.children.length;delete row.text;" +
  "if(q.matches&&q.matches(DENY)){row.denied=true;delete row.aria;}chain.push(row);q=q.parentElement;}" +
  // [aria-pressed]/[aria-haspopup] 捕获无 role 的状态控件；class 启发式捕获全裸 div 锚点——Kimi 的
  // .current-model/.send-button-container、chatglm 的 .think-mode-trigger 等既无 role 也无 aria（真机实证
  // kept=0 的根因），不加这批站上取证清单为空。可见性过滤 + denylist + 250 上限约束噪音。
  'var sel="button,[role=button],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=radio],[role=switch],[role=option],[role=tab],[aria-pressed],[aria-haspopup],' +
  '[class*=send i],[class*=model i],[class*=trigger i],[class*=toggle i],[class*=selector i],[class*=mode i]";' +
  "var all=[].slice.call(document.querySelectorAll(sel));" +
  "var visible=[],invisible=0,deniedN=0;" +
  "for(var j=0;j<all.length;j++){var e=all[j];" +
  "var r=e.getBoundingClientRect(); if(!(r.width>0&&r.height>0)){invisible++;continue;}" +
  "if(denied(e)){deniedN++;continue;}" +
  "visible.push(e);}" +
  // 超上限保留**末尾** 250 个：菜单/弹层 portal 在 body 末尾，「展开后才存在」的候选正是本工具的存在理由
  "var dropped=Math.max(0,visible.length-250);" +
  "var controls=visible.slice(-250).map(brief);" +
  "return JSON.stringify({url:location.href.split(\"?\")[0].slice(0,80),dpr:devicePixelRatio," +
  "composerChain:chain,controls:controls,scanned:all.length,invisible:invisible,denied:deniedN,droppedFromHead:dropped});" +
  "})()";

const ctrlKey = (c) => [c.tag, c.role, c.testid, c.id, c.aria, c.text].map((v) => v || "").join("|");
function diffFiles(fileA, fileB) {
  const [a, b] = [fileA, fileB].map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const keysA = new Set(a.controls.map(ctrlKey));
  const keysB = new Set(b.controls.map(ctrlKey));
  const fresh = b.controls.filter((c) => !keysA.has(ctrlKey(c)));
  const gone = a.controls.filter((c) => !keysB.has(ctrlKey(c)));
  console.log("新增控件 " + fresh.length + " 个（锚点候选）：");
  for (const c of fresh) console.log("  + " + JSON.stringify(c));
  console.log("消失控件 " + gone.length + " 个：");
  for (const c of gone) console.log("  - " + JSON.stringify(c));
}

async function main() {
  const [arg1, arg2, arg3] = process.argv.slice(2);
  if (arg1 === "--diff") {
    if (!arg2 || !arg3) { console.error("用法: node scripts/capture-evidence.js --diff <base.json> <after.json>"); process.exit(1); }
    return diffFiles(arg2, arg3);
  }
  const hostSub = arg1, tag = arg2;
  if (!hostSub) { console.error("用法: node scripts/capture-evidence.js <hostSub> [tag] | --diff <A.json> <B.json>"); process.exit(1); }
  const pages = await listPages();
  // 按 hostname 匹配（整条 URL 会误中路径里的词）；多 target（Gemini prerender/多标签）逐个探到有 __AMS 的
  const targets = pages.filter((p) => { try { return new URL(p.url).hostname.includes(hostSub); } catch (e) { return false; } });
  if (!targets.length) { console.error("未找到 hostname 含「" + hostSub + "」的已开标签（本工具只读已开标签，不导航）"); process.exit(1); }
  if (targets.length > 1) console.log("⚠ " + targets.length + " 个同站 target（prerender/多标签），逐个探测取有 __AMS 的");
  let data = null, targetId = null, reason = "no_world";
  for (const target of targets) {
    const out = await evalInPolyAsk(target, EXPR).catch((e) => ({ err: e.message }));
    if (out.err) { reason = out.err; continue; }
    data = JSON.parse(out.value); targetId = target.id;
    if (data.err) { reason = data.err; data = null; continue; }
    break;
  }
  if (!data) { console.error("取证失败：" + reason + (reason === "timeout" ? "（后台标签冻结？先激活：curl " + (process.env.CDP_BASE || "http://127.0.0.1:9222") + "/json/activate/<targetId>）" : "")); process.exit(1); }
  data.targetId = targetId;
  const host = new URL(targets.find((t) => t.id === targetId).url).hostname;
  const stamp = tag || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = path.join(__dirname, "..", "scratchpad", "evidence-" + host + "-" + stamp + ".json");
  if (fs.existsSync(out)) { console.error("已存在 " + path.relative(process.cwd(), out) + "，换个 tag（不覆盖已抓的基线）"); process.exit(1); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 1));
  console.log("已写入 " + path.relative(process.cwd(), out) + "（target " + targetId + "）");
  console.log("扫描 " + data.scanned + " · 不可见 " + data.invisible + " · 内容容器排除 " + data.denied +
    " · 保留 " + data.controls.length + " · 超上限丢弃 " + data.droppedFromHead);
  if (data.droppedFromHead > 0) console.error("⚠ 超过 250 上限：已优先保留文档末尾（弹层/菜单），文档前部 " + data.droppedFromHead + " 个控件未入清单");
  if (!data.controls.length) {
    console.error("✗ 清单为空（排除 " + data.denied + "/不可见 " + data.invisible + "）：denylist 误杀或站点控件形态超出选择子覆盖，本次清单不可用");
    process.exit(1);
  }
  if (data.denied > 5 * data.controls.length)
    console.error("⚠ 排除数远大于保留数（" + data.denied + " vs " + data.controls.length + "）：多半是会话侧栏被合法排除（隐私规则）；确认你要找的控件在清单里即可");
  console.log("对比两份清单：node scripts/capture-evidence.js --diff <base.json> <after.json>；产物外发前人工过目，用完即删。");
}
if (require.main === module) main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
module.exports = { ctrlKey };
