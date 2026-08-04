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
const document = { documentElement: { lang: "en" }, createElement: (tag) => new El(tag), getElementById: (id) => id === "ar-detail" ? root : root.querySelector("#" + id) };
const messages = { arc_favorites: "Favorites", arc_tags: "Tags", arc_note: "Note", arc_sites: "Sites",
  arc_question: "Question", arc_source: "Source", arc_bestAnswer: "Best answer: {0}", arc_best: "Mark as best", arc_unmarkBest: "Clear best answer",
  arc_capturedAt: "Captured: {0}", con_mdThink: "Deep think", con_mdFast: "Fast", con_errNoAnswer: "No answer" };
const t = (key, ...values) => values.reduce((text, value, index) => text.replaceAll(`{${index}}`, value), messages[key] || key);
const renderMd = (md, box) => { box.textContent = md; };
const timers = [];
const scope = vm.createContext({ document, t, renderMd,
  setTimeout(fn, ms) { timers.push({ fn, ms, cancelled: false }); return timers.length; },
  clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cancelled = true; }, console, URL });
vm.runInContext(fs.readFileSync("console/archive-detail.js", "utf8") + ";this.detail=ArchiveDetail", scope);

(async () => {
const entry = { id: "x", ts: 1700000000000, task: "Question", text: "Question", favorite: true, tags: ["work"], note: "private note", winnerHost: "a.test",
  results: [{ host: "a.test", label: "A", text: "Answer A", state: "think" }, { host: "b.test", label: "B", text: null, code: "no_answer" }] };
scope.detail.render(entry, { update: async () => entry, errorText: (item) => item.code });
assert.equal(root.querySelectorAll(".ar-answer").length, 2);
assert.equal(root.querySelectorAll(".ar-winner").length, 1);
assert.equal(root.querySelector(".ar-winner").textContent, "Clear best answer");
assert.equal(root.querySelector("#ar-favorite").getAttribute("aria-pressed"), "true");
assert.equal(root.querySelector("#ar-tags").value, "work");
assert.equal(root.querySelector("#ar-note").value, "private note");
assert.match(root.querySelector(".ar-captured")?.textContent || "", /^Captured: /, "详情应显示采集时间");
assert.equal(root.querySelector(".ar-captured")?.getAttribute("datetime"), new Date(entry.ts).toISOString());
assert.doesNotThrow(() => scope.detail.render({ ...entry, ts: 1e100 }, { update: async () => entry, errorText: (item) => item.code }),
  "超出 Date 范围的采集时间不得中断详情渲染");
assert.equal(root.querySelector(".ar-captured"), null, "无效采集时间不应渲染 time");
scope.detail.render(entry, { update: async () => entry, errorText: (item) => item.code });
const markdown = scope.detail.entryMarkdown(entry);
assert.match(markdown, /Best answer: A/);
assert.doesNotMatch(markdown, /private note/);
assert.doesNotMatch(scope.detail.entryMarkdown({ ...entry, winnerHost: "b.test" }), /Best answer:/, "失败结果不能成为胜出答案");

const updates = [];
const drafts = new Map();
const editable = { ...entry, favorite: false, winnerHost: null,
  source: { kind: "page", title: "Source", url: "https://example.test" } };
const rejectUpdate = (id, patch) => { updates.push({ id, patch }); return Promise.reject(new Error("save failed")); };
const rememberDraft = (id, patch) => drafts.set(id, { ...(drafts.get(id) || {}), ...patch });
const renderEditable = (value) => scope.detail.render(value, { update: rejectUpdate, errorText: (item) => item.code,
  draft: drafts.get(value.id), onDraft: rememberDraft });
renderEditable(editable);
assert.equal(root.querySelectorAll(".ar-sites").length, 1, "详情应提供站点导航");
assert.equal(root.querySelector(".ar-winner").textContent, "Mark as best");
assert.equal(root.querySelector("a").getAttribute("href"), "https://example.test/");
assert.match(scope.detail.entryMarkdown(editable), /\[Source\]\(https:\/\/example\.test\/\)/);
const hostileSource = { ...editable, source: { kind: "page", title: "Bad [title]\\\nnext", url: "https://example.test/a (b)?q=hello world" } };
const safeMarkdown = scope.detail.entryMarkdown(hostileSource);
assert.match(safeMarkdown, /\[Bad \\\[title\\\]\\\\ next\]\(https:\/\/example\.test\/a%20%28b%29\?q=hello%20world\)/);
assert.doesNotMatch(safeMarkdown, /\]\(javascript:/);
scope.detail.render({ ...editable, source: { kind: "page", title: "Bad", url: "javascript:alert(1)" } }, { update: rejectUpdate, errorText: (item) => item.code });
assert.equal(root.querySelectorAll("a").length, 0, "未验证的来源 URL 不得创建链接");
renderEditable(editable);
root.querySelector("#ar-note").fire("blur");
await Promise.resolve();
assert.equal(updates.length, 0, "无草稿且内容未变化时 blur 不应写入");

const favorite = root.querySelector("#ar-favorite"); favorite.fire("click");
const tags = root.querySelector("#ar-tags"); tags.value = "work, urgent"; tags.fire("input"); tags.fire("keydown", { key: "Enter" });
const winner = root.querySelector(".ar-winner"); winner.fire("click");
const note = root.querySelector("#ar-note"); note.value = "unsaved draft"; note.fire("input");
assert.equal(timers.at(-1).ms, 400, "备注应防抖 400ms");
const scheduledNote = timers.at(-1); note.fire("blur");
renderEditable({ ...editable, id: "y", task: "Other" });
if (!scheduledNote.cancelled) scheduledNote.fn();
await Promise.resolve(); await Promise.resolve();
assert.deepEqual(updates.map(({ id, patch }) => [id, JSON.stringify(patch)]), [
  ["x", JSON.stringify({ favorite: true })], ["x", JSON.stringify({ tags: ["work", "urgent"] })],
  ["x", JSON.stringify({ winnerHost: "a.test" })], ["x", JSON.stringify({ note: "unsaved draft" })],
]);
renderEditable(editable);
assert.equal(root.querySelector("#ar-tags").value, "work, urgent", "重新渲染原记录后仍应恢复标签草稿");
assert.equal(root.querySelector("#ar-note").value, "unsaved draft", "重新渲染原记录后仍应恢复备注草稿");
const restoredNote = root.querySelector("#ar-note"); restoredNote.fire("blur"); restoredNote.fire("blur");
await Promise.resolve(); await Promise.resolve();
assert.equal(updates.filter(({ patch }) => patch.note === "unsaved draft").length, 2, "恢复的备注草稿应可通过真实 blur 事件重试且同次失焦不重复写入");
assert.equal(favorite.getAttribute("aria-pressed"), "false", "收藏失败后保留原状态");
assert.equal(winner.getAttribute("aria-pressed"), "false", "胜出答案失败后保留原状态");

const raceUpdates = [], raceDrafts = new Map(), raceEntry = { ...editable, id: "race", note: "" };
const renderRace = () => scope.detail.render(raceEntry, { update(id, patch) { raceUpdates.push({ id, patch }); return Promise.resolve(); },
  errorText: (item) => item.code, draft: raceDrafts.get("race"), onDraft(id, patch) { raceDrafts.set(id, { ...(raceDrafts.get(id) || {}), ...patch }); } });
renderRace();
const oldNote = root.querySelector("#ar-note"); oldNote.value = "old"; oldNote.fire("input"); const oldTimer = timers.at(-1);
renderRace();
const newNote = root.querySelector("#ar-note"); newNote.value = "new"; newNote.fire("input"); newNote.fire("blur");
assert.equal(oldTimer.cancelled, true, "下一次 render 应显式取消旧备注定时器");
if (!oldTimer.cancelled) oldTimer.fn();
await Promise.resolve(); await Promise.resolve();
assert.deepEqual(raceUpdates.map(({ patch }) => JSON.stringify(patch)), [JSON.stringify({ note: "new" })], "旧定时器不得在新备注后提交旧值");

const ownerDrafts = new Map(), ownerUpdates = []; let finishOld;
const renderOwner = () => scope.detail.render({ ...raceEntry, id: "owner" }, { update(id, patch) {
  ownerUpdates.push({ id, patch }); return patch.note === "old-1" ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve();
}, errorText: (item) => item.code, draft: ownerDrafts.get("owner"), onDraft(id, patch) { ownerDrafts.set(id, { ...(ownerDrafts.get(id) || {}), ...patch }); } });
renderOwner();
const ownerOld = root.querySelector("#ar-note"); ownerOld.value = "old-1"; ownerOld.fire("input"); ownerOld.fire("blur"); await Promise.resolve();
ownerOld.value = "old-2"; ownerOld.fire("input"); renderOwner();
const ownerNew = root.querySelector("#ar-note"); ownerNew.value = "new"; ownerNew.fire("input"); const ownerNewTimer = timers.at(-1);
finishOld(); await new Promise((resolve) => setImmediate(resolve));
assert.equal(ownerNewTimer.cancelled, false, "旧 render 的在途回调不得取消新 render 的备注定时器");
if (!ownerNewTimer.cancelled) ownerNewTimer.fn(); await Promise.resolve(); await Promise.resolve();
assert.equal(ownerUpdates.at(-1).patch.note, "new", "新 render 的定时保存仍应正常执行");

console.log("archive detail tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
