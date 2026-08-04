#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("console/archive.html", "utf8");
assert.ok(html.includes('src="archive-detail.js"') && html.indexOf('src="archive-detail.js"') < html.indexOf('src="archive.js"'), "详情模块必须先于归档页脚本加载");

class El {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.attributes = {};
    this.className = ""; this.textContent = ""; this.value = "";
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type, event = {}) { for (const fn of this.listeners[type] || []) fn({ currentTarget: this, ...event }); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [], match = (el) => selector[0] === "#" ? el.id === selector.slice(1)
      : selector[0] === "." ? el.className.split(/\s+/).includes(selector.slice(1)) : el.tagName === selector.toUpperCase();
    const visit = (el) => { if (match(el)) out.push(el); el.children.forEach((child) => child instanceof El && visit(child)); };
    visit(this); return out;
  }
}

const root = new El();
const document = { createElement: (tag) => new El(tag), getElementById: (id) => id === "ar-detail" ? root : root.querySelector("#" + id) };
const messages = { arc_favorite: "Favorite", arc_tags: "Tags", arc_note: "Private note", arc_sites: "Sites",
  arc_question: "Question", arc_source: "Source", arc_bestAnswer: "Best answer: {0}", arc_markBest: "Mark as best answer",
  con_mdThink: "Deep think", con_mdFast: "Fast", con_errNoAnswer: "No answer" };
const t = (key, ...values) => values.reduce((text, value, index) => text.replaceAll(`{${index}}`, value), messages[key] || key);
const renderMd = (md, box) => { box.textContent = md; };
const timers = [];
const scope = vm.createContext({ document, t, renderMd, setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, console, URL });
vm.runInContext(fs.readFileSync("console/archive-detail.js", "utf8") + ";this.detail=ArchiveDetail", scope);

(async () => {
const entry = { id: "x", task: "Question", text: "Question", favorite: true, tags: ["work"], note: "private note", winnerHost: "a.test",
  results: [{ host: "a.test", label: "A", text: "Answer A", state: "think" }, { host: "b.test", label: "B", text: null, code: "no_answer" }] };
scope.detail.render(entry, { update: async () => entry, errorText: (item) => item.code });
assert.equal(root.querySelectorAll(".ar-answer").length, 2);
assert.equal(root.querySelectorAll(".ar-winner").length, 1);
assert.equal(root.querySelector("#ar-favorite").getAttribute("aria-pressed"), "true");
assert.equal(root.querySelector("#ar-tags").value, "work");
assert.equal(root.querySelector("#ar-note").value, "private note");
const markdown = scope.detail.entryMarkdown(entry);
assert.match(markdown, /Best answer: A/);
assert.doesNotMatch(markdown, /private note/);
assert.doesNotMatch(scope.detail.entryMarkdown({ ...entry, winnerHost: "b.test" }), /Best answer:/, "失败结果不能成为胜出答案");

const updates = [];
const editable = { ...entry, favorite: false, winnerHost: null,
  source: { kind: "page", title: "Source", url: "https://example.test" } };
const rejectUpdate = (id, patch) => { updates.push({ id, patch }); return Promise.reject(new Error("save failed")); };
scope.detail.render(editable, { update: rejectUpdate, errorText: (item) => item.code });
assert.equal(root.querySelectorAll(".ar-sites").length, 1, "详情应提供站点导航");
assert.equal(root.querySelector("a").getAttribute("href"), "https://example.test/");
assert.match(scope.detail.entryMarkdown(editable), /\[Source\]\(https:\/\/example\.test\/\)/);
const hostileSource = { ...editable, source: { kind: "page", title: "Bad [title]\\\nnext", url: "https://example.test/a (b)?q=hello world" } };
const safeMarkdown = scope.detail.entryMarkdown(hostileSource);
assert.match(safeMarkdown, /\[Bad \\\[title\\\]\\\\ next\]\(https:\/\/example\.test\/a%20%28b%29\?q=hello%20world\)/);
assert.doesNotMatch(safeMarkdown, /\]\(javascript:/);
scope.detail.render({ ...editable, source: { kind: "page", title: "Bad", url: "javascript:alert(1)" } }, { update: rejectUpdate, errorText: (item) => item.code });
assert.equal(root.querySelectorAll("a").length, 0, "未验证的来源 URL 不得创建链接");
scope.detail.render(editable, { update: rejectUpdate, errorText: (item) => item.code });

const favorite = root.querySelector("#ar-favorite"); favorite.fire("click");
const tags = root.querySelector("#ar-tags"); tags.value = "work, urgent"; tags.fire("keydown", { key: "Enter" });
const winner = root.querySelector(".ar-winner"); winner.fire("click");
const note = root.querySelector("#ar-note"); note.value = "unsaved draft"; note.fire("input");
assert.equal(timers.at(-1).ms, 400, "备注应防抖 400ms");
scope.detail.render({ ...editable, id: "y", task: "Other" }, { update: rejectUpdate, errorText: (item) => item.code });
timers.at(-1).fn();
await Promise.resolve();
assert.deepEqual(updates.map(({ id, patch }) => [id, JSON.stringify(patch)]), [
  ["x", JSON.stringify({ favorite: true })], ["x", JSON.stringify({ tags: ["work", "urgent"] })],
  ["x", JSON.stringify({ winnerHost: "a.test" })], ["x", JSON.stringify({ note: "unsaved draft" })],
]);
assert.equal(tags.value, "work, urgent", "标签保存失败后保留输入");
assert.equal(note.value, "unsaved draft", "备注保存失败后保留输入");
assert.equal(favorite.getAttribute("aria-pressed"), "false", "收藏失败后保留原状态");
assert.equal(winner.getAttribute("aria-pressed"), "false", "胜出答案失败后保留原状态");

console.log("archive detail tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
