#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const archiveHtml = fs.readFileSync("console/archive.html", "utf8"), composeHtml = fs.readFileSync("console/compose.html", "utf8");
assert.match(archiveHtml, /id="ar-synthesize"/);
for (const id of ["syn-panel", "syn-answers", "syn-target", "syn-tier", "syn-instruction", "syn-preview", "syn-send", "syn-status"])
  assert.match(composeHtml, new RegExp(`id="${id}"`));
assert.ok(composeHtml.indexOf("synthesis-model.js") < composeHtml.indexOf("compose-synthesis.js"));
assert.ok(composeHtml.indexOf("compose-synthesis.js") < composeHtml.indexOf("compose.js"));
const compose = fs.readFileSync("console/compose-synthesis.js", "utf8");
assert.ok(compose.includes('action: "historyAdd"') && compose.includes('action: "sendOneNewSession"'));
assert.ok(compose.includes("amsPendingSynthesis") && compose.includes("60000"));

class El {
  constructor(id = "", tag = "div") { this.id = id; this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.value = ""; this.checked = false; this.textContent = ""; }
  append(...nodes) { this.children.push(...nodes); } appendChild(node) { this.children.push(node); return node; } replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } async fire(type) { for (const fn of this.listeners[type] || []) await fn({ currentTarget: this }); }
  setAttribute(key, value) { this.attributes[key] = String(value); } removeAttribute(key) { delete this.attributes[key]; } hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
  querySelectorAll(selector) { const all = [], visit = (node) => { if (node instanceof El) { if (selector === "label" && node.tagName === "LABEL" || selector === "input:checked" && node.tagName === "INPUT" && node.checked) all.push(node); node.children.forEach(visit); } }; this.children.forEach(visit); return all; }
}
function synthesisHarness() {
  const ids = ["cmp-library", "cmp-editor", "ch-foot", "syn-panel", "syn-answers", "syn-count", "syn-target", "syn-tier", "syn-instruction", "syn-preview", "syn-send", "syn-status", "ch-close"];
  const elements = Object.fromEntries(ids.map((id) => [id, new El(id, id.includes("target") || id.includes("tier") ? "select" : id.includes("instruction") || id.includes("preview") ? "textarea" : "div")]));
  const context = { archiveId: "arc", task: "Question", source: null, results: [{ host: "a.test", label: "A", text: "One", state: "think" }, { host: "b.test", label: "B", text: "Two", state: "fast" }] };
  const messages = [], session = new Map([["amsComposeSynthesis", context]]); let closed = 0;
  const document = { getElementById: (id) => elements[id], createElement: (tag) => new El("", tag), createTextNode: (text) => ({ textContent: text }), addEventListener() {} };
  const chrome = { runtime: { lastError: null, sendMessage(message, done) { messages.push(message); done?.({ ok: true }); } }, storage: {
    session: { get(key, done) { done({ [key]: session.get(key) }); }, remove(key, done) { session.delete(key); done?.(); }, set(value, done) { for (const [key, row] of Object.entries(value)) session.set(key, row); done?.(); } },
    local: { get(_defaults, done) { done({ amsConsole: { tier: "think" } }); } },
  } };
  const copy = { syn_defaultInstruction: "Compare answers", con_mdThink: "Think", con_mdFast: "Fast", syn_unknown: "Unknown" };
  const scope = vm.createContext({ document, chrome, location: { search: "?mode=synthesis" }, URLSearchParams, SITES: [
    { host: "a.test", label: "A", url: "https://a.test/new" }, { host: "b.test", label: "B", url: "https://b.test/new" }],
  t: (key) => copy[key] || key, applyI18n() {}, window: { close() { closed++; } }, Date, Set, Promise, console });
  vm.runInContext(fs.readFileSync("console/synthesis-model.js", "utf8"), scope);
  vm.runInContext(fs.readFileSync("console/compose-synthesis.js", "utf8"), scope);
  return { elements, messages, session, closed: () => closed };
}
(async () => {
  const app = synthesisHarness(), answers = app.elements["syn-answers"], target = app.elements["syn-target"], sendButton = app.elements["syn-send"];
  assert.equal(answers.querySelectorAll("input:checked").length, 2);
  assert.equal(target.value, "", "目标 AI 必须默认留空"); assert.equal(sendButton.disabled, true);
  assert.match(app.elements["syn-preview"].value, /# Candidate answers/); assert.equal(app.messages.length, 0, "显式发送前不得发起 AI 请求");
  target.value = "a.test"; await target.fire("change"); assert.equal(sendButton.disabled, false);
  await sendButton.fire("click");
  assert.deepEqual(app.messages.slice(0, 2).map((message) => message.action), ["historyAdd", "sendOneNewSession"]);
  assert.equal(app.session.get("amsPendingSynthesis").archiveId, "arc"); assert.equal(app.closed(), 1);
  console.log("synthesis-ui tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
