#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class El {
  constructor() { this.events = {}; this.attributes = {}; this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false; }
  addEventListener(type, listener) { (this.events[type] ||= []).push(listener); }
  fire(type) { return Promise.all((this.events[type] || []).map((listener) => listener({ preventDefault() {}, key: "" }))); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren() {}
  appendChild() {}
  append() {}
  focus() {}
}
const tick = () => new Promise((resolve) => setTimeout(resolve));

function harness({ localSetFails = false, localGetFails = false, sessionRemoveFails = false, settings = { selected: { "claude.ai": true }, tier: "think" } } = {}) {
  const ids = ["ch-text", "cmp-list", "cmp-actions", "cmp-name", "cmp-confirm", "cmp-save-template", "cmp-delete-template", "cmp-more", "ch-close", "ch-back", "cmp-name-save", "cmp-name-cancel", "cmp-template-name", "cmp-confirm-yes", "cmp-confirm-no", "cmp-confirm-text", "ch-scope", "ch-send", "cmp-status"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()]));
  els["ch-text"].value = "question";
  const messages = [], localWrites = [], sessionWrites = [];
  let closed = 0, openConsoleDone, localGets = 0, currentSettings = settings;
  const timers = [];
  const chrome = {
    runtime: {
      lastError: null, onMessage: { addListener() {} },
      sendMessage(message, done) {
        messages.push(message);
        if (message.action === "openConsole") openConsoleDone = done;
        else done?.({ ok: true });
      },
    },
    storage: {
      local: {
        get(_keys, done) {
          const failed = localGetFails && ++localGets > 1;
          chrome.runtime.lastError = failed ? { message: "settings read failed" } : null;
          done(failed ? undefined : { amsConsole: currentSettings }); chrome.runtime.lastError = null;
        },
        set(value, done) {
          localWrites.push(value);
          chrome.runtime.lastError = localSetFails ? { message: "save failed" } : null;
          done?.(); chrome.runtime.lastError = null;
        },
      },
      session: {
        set(value, done) { sessionWrites.push(value); done?.(); },
        remove(_key, done) {
          chrome.runtime.lastError = sessionRemoveFails ? { message: "session remove failed" } : null;
          done?.(); chrome.runtime.lastError = null;
        },
      },
      onChanged: { addListener() {} },
    },
  };
  const document = {
    activeElement: null, getElementById: (id) => els[id], querySelectorAll: () => [], createElement: () => new El(),
    createTextNode: () => new El(), addEventListener() {}, hasFocus: () => false,
  };
  const context = vm.createContext({
    chrome, document,
    ComposeContext: { init: () => Promise.resolve(), payload: (task) => ({ text: `FULL:${task}`, task, source: null }) },
    t: (key) => key, applyI18n() {}, crypto: { randomUUID: () => "id" }, window: { close() { closed++; } }, console,
    setTimeout(fn) { timers.push(fn); return timers.length - 1; }, clearTimeout(id) { timers[id] = null; },
  });
  vm.runInContext(fs.readFileSync("console/sites.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("console/run-meta.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("console/compose.js", "utf8"), context);
  return {
    ...els, messages, localWrites, sessionWrites, get closed() { return closed; },
    openConsoleDone(result) { assert.ok(openConsoleDone, "应已发出 openConsole"); openConsoleDone(result); },
    timeout() { const timer = timers.find(Boolean); assert.ok(timer, "应已设置超时"); timer(); },
    setSettings(next) { currentSettings = next; },
  };
}

(async () => {
  const expectedRun = { text: "FULL:question", task: "question", source: null };
  const closing = harness();
  await closing["ch-close"].fire("click");
  assert.equal(closing.closed, 1);
  assert.equal(closing.sessionWrites.length, 0);
  assert.equal(closing.messages.some((msg) => msg.action === "openConsole" || msg.action === "sendAll"), false);

  const returning = harness();
  const returnTask = returning["ch-back"].fire("click");
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(returning.sessionWrites.at(-1).amsPendingRun)), expectedRun);
  assert.equal(returning.messages.at(-1).action, "openConsole");
  assert.equal(returning.closed, 0, "控制台就绪前不得关闭");
  returning.openConsoleDone({ ok: true }); await returnTask;
  assert.equal(returning.closed, 1);

  const sending = harness();
  const sendTask = sending["ch-send"].fire("click");
  await tick();
  assert.equal(sending.messages.some((msg) => msg.action === "historyAdd" || msg.action === "sendAll"), false);
  assert.equal(sending["ch-send"].disabled, true); assert.equal(sending["ch-back"].disabled, true); assert.equal(sending["ch-close"].disabled, true);
  await sending["ch-send"].fire("click");
  assert.equal(sending.messages.filter((msg) => msg.action === "openConsole").length, 1, "重复点击不得启动第二轮");
  sending.openConsoleDone({ ok: true }); await sendTask;
  assert.deepEqual(sending.messages.filter((msg) => ["openConsole", "historyAdd", "sendAll"].includes(msg.action)).map((msg) => msg.action), ["openConsole", "historyAdd", "sendAll"]);

  const rejected = harness();
  const rejectedTask = rejected["ch-send"].fire("click");
  await tick(); rejected.openConsoleDone({ ok: false }); await rejectedTask;
  assert.equal(rejected.closed, 0); assert.equal(rejected["ch-send"].disabled, false);
  assert.equal(rejected["cmp-status"].textContent, "cmp_consoleOpenFailed");
  assert.equal(rejected.messages.some((msg) => msg.action === "historyAdd" || msg.action === "sendAll"), false);

  const failedSave = harness({ localSetFails: true });
  await failedSave["ch-send"].fire("click");
  assert.equal(failedSave.messages.some((msg) => ["openConsole", "historyAdd", "sendAll"].includes(msg.action)), false);
  assert.equal(failedSave["cmp-status"].textContent, "cmp_pendingSaveFailed");

  const failedSettings = harness({ localGetFails: true });
  const failedSettingsTask = failedSettings["ch-send"].fire("click");
  await tick();
  assert.equal(failedSettings["ch-send"].disabled, false);
  assert.equal(failedSettings["cmp-status"].textContent, "cmp_settingsLoadFailed");
  assert.equal(failedSettings.messages.some((msg) => ["openConsole", "historyAdd", "sendAll"].includes(msg.action)), false);
  await failedSettingsTask;

  const timingOut = harness();
  const timeoutTask = timingOut["ch-send"].fire("click");
  await tick(); timingOut.timeout(); await timeoutTask;
  assert.equal(timingOut.closed, 0); assert.equal(timingOut["ch-send"].disabled, false);
  assert.equal(timingOut["cmp-status"].textContent, "cmp_consoleOpenFailed");
  timingOut.openConsoleDone({ ok: true }); await tick();
  assert.equal(timingOut.messages.some((msg) => msg.action === "historyAdd" || msg.action === "sendAll"), false);

  const frozen = harness({ settings: { selected: { "claude.ai": true }, tier: "think" } });
  const frozenTask = frozen["ch-send"].fire("click");
  await tick(); frozen.setSettings({ selected: { "chatgpt.com": true }, tier: "fast" });
  frozen.openConsoleDone({ ok: true }); await frozenTask;
  const frozenSend = frozen.messages.find((msg) => msg.action === "sendAll");
  assert.deepEqual(JSON.parse(JSON.stringify(frozenSend.sites.map((site) => site.host))), ["claude.ai"]); assert.equal(frozenSend.tier, "think");

  const defaults = harness({ settings: { tier: "fast" } });
  const defaultsTask = defaults["ch-send"].fire("click");
  await tick(); defaults.openConsoleDone({ ok: true }); await defaultsTask;
  assert.deepEqual(JSON.parse(JSON.stringify(defaults.messages.find((msg) => msg.action === "sendAll").sites.map((site) => site.host))), ["claude.ai", "chatgpt.com", "gemini.google.com"]);

  const clearFailure = harness({ sessionRemoveFails: true });
  const clearTask = clearFailure["ch-send"].fire("click");
  await tick(); clearFailure.openConsoleDone({ ok: true }); await clearTask;
  assert.equal(clearFailure["ch-send"].disabled, false); assert.equal(clearFailure["cmp-status"].textContent, "cmp_pendingSaveFailed");
  assert.equal(clearFailure.messages.some((msg) => msg.action === "historyAdd" || msg.action === "sendAll"), false);
  console.log("compose-handoff tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
