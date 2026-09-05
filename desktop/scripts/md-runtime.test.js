#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.join(__dirname, "../src/site-runtime");

function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }

// ---- 极简 DOM 桩：只覆盖 site-runtime/md.js 遍历用到的 API，仓库无 jsdom/linkedom ----
class TextNode {
  constructor(value) { this.nodeType = 3; this.nodeValue = value; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
}
class El {
  constructor(tag, attrs, kids) {
    this.nodeType = 1; this.tagName = tag.toUpperCase();
    this.attrs = attrs || {}; this.className = this.attrs.class || "";
    this.childNodes = []; this.parentNode = null;
    for (const kid of kids || []) this.append(kid);
  }
  append(kid) {
    const node = typeof kid === "string" ? new TextNode(kid) : kid;
    node.parentNode = this; this.childNodes.push(node); return this;
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.children, i = sibs.indexOf(this);
    return i >= 0 && i + 1 < sibs.length ? sibs[i + 1] : null;
  }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  get innerText() { return this.textContent; } // 桩：不做可见性折叠，够用于本文件的断言
  contains(node) { let p = node; while (p) { if (p === this) return true; p = p.parentNode; } return false; }
  _walk(out) { for (const c of this.children) { out.push(c); c._walk(out); } return out; }
  querySelector(sel) { return this._walk([]).find((e) => e.tagName === sel.toUpperCase()) || null; }
  querySelectorAll(sel) { return this._walk([]).filter((e) => e.tagName === sel.toUpperCase()); }
}
function el(tag, attrs, ...kids) { return new El(tag, attrs, kids); }
function md(root) {
  const document = {
    createTreeWalker(walkRoot) {
      const collected = [];
      (function rec(n) { for (const c of n.childNodes || []) (c.nodeType === 3 ? collected.push(c) : rec(c)); })(walkRoot);
      let i = 0; return { nextNode: () => (i < collected.length ? collected[i++] : null) };
    },
  };
  const getComputedStyle = () => ({ display: "block", visibility: "visible" });
  const context = vm.createContext({
    window: { __AMS: {} }, __AMS_I18N__: { t: (key) => `desktop:${key}` }, document, getComputedStyle, NodeFilter: { SHOW_TEXT: 4 },
    location: { href: "https://chatgpt.com/c/1" }, URL, console,
  });
  vm.runInContext(read("md.js"), context);
  return context.window.__AMS.toMarkdown(root);
}

// F#101 系列既有规则 ①：文本节点转义 \ ` * _ [ ]，防止被下游渲染器解析成强调/链接/代码
function escapesSpecialCharsInText() {
  const root = el("p", null, "a\\b`c*d_e[f]g");
  assert.equal(md(root), "a\\\\b\\`c\\*d\\_e\\[f\\]g");
}

// 既有规则 ⑤：围栏代码内容自带三个反引号时，围栏必须升级到四反引号，否则提前截断
function upgradesFenceWhenContentHasTripleBacktick() {
  const root = el("pre", null, el("code", null, "x = ```already```"));
  assert.equal(md(root), "````\nx = ```already```\n````");
}

// 表格必须转 GFM 管道表，含分隔行，列数与表头一致
function tableBecomesGfmPipeTable() {
  const root = el("table", null,
    el("tr", null, el("th", null, "A"), el("th", null, "B")),
    el("tr", null, el("td", null, "1"), el("td", null, "2")));
  assert.equal(md(root), "| A | B |\n| --- | --- |\n| 1 | 2 |");
}

// safeHref 只放行 http(s)/mailto/tel；非法协议（如 javascript:）必须剥离成纯文本，不留链接语法
function stripsNonHttpProtocolLinks() {
  const root = el("p", null, "click ", el("a", { href: "javascript:alert(1)" }, "here"));
  assert.equal(md(root), "click here");
}

// F096 回归：语言头前瞻绝不吸收语义标签，h3 直邻 pre 不能被吞成代码块语言名
function headingBeforeCodeIsNotSwallowed() {
  const root = el("div", null, el("h3", null, "Example"), el("pre", null, el("code", null, "print(1)")));
  assert.equal(md(root), "### Example\n\n```\nprint(1)\n```");
}

// F097 回归：img 不再被静默丢弃，保留 alt（无 alt 给占位），保证纯图回答 text 非空、不触发 no_answer 误报
function imagePreservesAltAsPlaceholder() {
  assert.equal(md(el("div", null, el("img", { src: "https://cdn.ex/a.png", alt: "柱状图" }))), "[柱状图]");
  assert.equal(md(el("div", null, el("img", { src: "https://cdn.ex/a.png" }))), "[desktop:md_image]", "无 alt 的图片占位必须走 i18n（md_image），不能写死中文");
}

// F090 回归：href 中的圆括号必须百分号编码，否则 CommonMark 括号配平规则会把链接目标截断
function encodesParensInLinkTarget() {
  const root = el("p", null, "来源 ", el("a", { href: "https://s.ex/q?s=f(x)&p=1)" }, "src"));
  assert.equal(md(root), "来源 [src](https://s.ex/q?s=f%28x%29&p=1%29)");
}

// F083 回归：site-runtime/upload.js 的错误 alert 指纹必须独立于 token()（后者对普通提示 DIV 塌缩成
// 同一个 ""），否则上传后新出现的、文案不同的错误会被误判成"已见过"而漏检，一路等到 deadline。
async function distinctUploadErrorsFailFastNotAtDeadline() {
  let now = 0, revealed = false;
  const alertNode = (text) => ({
    tagName: "DIV", className: "warn", textContent: text,
    getAttribute: () => "",
    getBoundingClientRect: () => ({ left: 150, right: 350, top: 460, bottom: 500, width: 200, height: 40 }),
  });
  const before = alertNode("图片格式不支持");
  const after = alertNode("图片过大，请压缩后重试");
  const context = vm.createContext({
    window: { __AMS: {} }, console,
    document: { querySelectorAll: (sel) => (/role="alert"/.test(sel) ? [before, ...(revealed ? [after] : [])] : []) },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1", backgroundImage: "none" }),
    Date: { now: () => now },
    DataTransfer: class { constructor() { this.items = { add() {} }; this.files = []; } },
    Event: class { constructor(type) { this.type = type; } },
    createImageBitmap: async () => ({ close() {} }), File: class {},
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
  });
  context.window.__AMS.sleep = async (ms) => { now += Math.max(1, ms || 1); };
  vm.runInContext(read("upload.js"), context);
  const S = context.window.__AMS;
  const composer = { getBoundingClientRect: () => ({ left: 100, right: 500, top: 500, bottom: 540, width: 400, height: 40 }) };
  const input = { files: [], dispatchEvent: () => { revealed = true; } };
  const ok = await S.setInputFiles(input, [{ name: "probe.png" }], composer, 30000);
  assert.equal(ok, false, "上传后新出现的不同文案错误必须导致附件确认失败");
  assert.ok(now < 5000, `独立指纹应立即识别新错误，不应一路等到 deadline 附近（实得 now=${now}）`);
}

(async () => {
  escapesSpecialCharsInText();
  console.log("✓ 文本节点转义 \\ ` * _ [ ]");
  upgradesFenceWhenContentHasTripleBacktick();
  console.log("✓ 围栏代码含三反引号时升级为四反引号");
  tableBecomesGfmPipeTable();
  console.log("✓ 表格转 GFM 管道表且含分隔行");
  stripsNonHttpProtocolLinks();
  console.log("✓ 非 http(s)/mailto/tel 协议链接被剥离成纯文本");
  headingBeforeCodeIsNotSwallowed();
  console.log("✓ h3 直邻代码块不被吞成语言名");
  imagePreservesAltAsPlaceholder();
  console.log("✓ img 保留 alt 占位，纯图回答 text 非空");
  encodesParensInLinkTarget();
  console.log("✓ 链接目标中的圆括号被百分号编码");
  await distinctUploadErrorsFailFastNotAtDeadline();
  console.log("✓ 附件错误提示使用独立指纹，不同文案的新错误立即判失败");
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
