#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
class El {
  constructor(tag = "div", id = "") { this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.listeners = {}; this.attributes = {}; this.hidden = false; this.textContent = ""; this.className = ""; }
  append(...nodes) { this.children.push(...nodes); } appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; } setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type) { for (const fn of this.listeners[type] || []) await fn({ currentTarget: this }); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { const out = [], match = (node) => selector.startsWith(".") ? node.className.split(/\s+/).includes(selector.slice(1)) : selector.startsWith("#") ? node.id === selector.slice(1) : node.tagName === selector.toUpperCase();
    const visit = (node) => { if (match(node)) out.push(node); for (const child of node.children) if (child instanceof El) visit(child); }; visit(this); return out; }
}
const root = new El("div", "ar-detail"), button = new El("button", "ar-synthesize"), status = new El("span", "ar-status");
const nodes = new Map([[root.id, root], [button.id, button], [status.id, status]]), session = new Map(), messages = [], updates = [];
const document = { getElementById: (id) => nodes.get(id), createElement: (tag) => new El(tag), createTextNode: (text) => ({ textContent: text }) };
const chrome = { runtime: { lastError: null, sendMessage(message, done) { messages.push(message); done?.(message.action === "collect" ? { results: [{ host: "a.test", text: "Combined", state: "fast" }] } : {}); } }, storage: { session: {
  get(key, done) { done({ [key]: session.get(key) }); }, set(value, done) { for (const [key, row] of Object.entries(value)) session.set(key, row); done?.(); },
  remove(key, done) { for (const item of Array.isArray(key) ? key : [key]) session.delete(item); done?.(); },
} } };
const scope = vm.createContext({ document, chrome, SITES: [{ host: "a.test", label: "A", url: "https://a.test/new" }],
  t: (key) => key, renderMd: (text, box) => { box.textContent = text; }, savePatch: async (id, patch) => { updates.push({ id, patch }); return { id, ...patch }; }, Date, Promise });
vm.runInContext(fs.readFileSync("console/archive-synthesis.js", "utf8") + ";this.module=ArchiveSynthesis", scope);
const entry = { id: "arc", task: "Question", source: null, results: [{ host: "a.test", label: "A", text: "One", state: "think" }, { host: "b.test", label: "B", text: "Two", state: "fast" }], synthesis: null };

(async () => {
  scope.module.render({ ...entry, results: entry.results.slice(0, 1) }); assert.equal(button.hidden, true);
  scope.module.render(entry); assert.equal(button.hidden, false); await button.fire("click");
  assert.equal(session.get("amsComposeSynthesis").archiveId, "arc");
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), { source: "AMS_CONSOLE", action: "openCompose", mode: "synthesis" });
  session.set("amsPendingSynthesis", { archiveId: "arc", targetHost: "a.test", instruction: "Compare", sentAt: 1 });
  scope.module.render(entry); await root.querySelector(".syn-collect").fire("click");
  assert.equal(root.querySelector(".syn-collected").textContent, "Combined"); await root.querySelector(".syn-save").fire("click");
  assert.equal(updates.at(-1).patch.synthesis.text, "Combined"); assert.equal(session.has("amsPendingSynthesis"), false);
  root.replaceChildren();
  scope.module.render({ ...entry, synthesis: { host: "a.test", text: "Old", state: "think", instruction: "Compare", createdAt: 2 } });
  await root.querySelector(".syn-remove").fire("click"); await root.querySelector(".syn-confirm-yes").fire("click");
  assert.equal(updates.at(-1).patch.synthesis, null);
  console.log("archive-synthesis tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
