#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class El {
  constructor() { this.events = {}; this.attributes = {}; this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false; this.focused = 0; this.children = []; }
  addEventListener(type, listener) { (this.events[type] ||= []).push(listener); }
  fire(type, event) { return Promise.all((this.events[type] || []).map((listener) => listener({ preventDefault() {}, key: "", ...event }))); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren(...children) { this.children = children; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  focus() { this.focused++; }
}
const tick = () => new Promise((resolve) => setTimeout(resolve));

function harness({ localSetFails = false, localGetFails = false, initialLocalGetFails = false, sessionRemoveFails = false, delayHistory = false, settings = { selected: { "claude.ai": true }, tier: "think" } } = {}) {
  const ids = ["ch-text", "cmp-list", "cmp-actions", "cmp-name", "cmp-confirm", "cmp-save-template", "cmp-delete-template", "cmp-more", "ch-close", "ch-back", "cmp-name-save", "cmp-name-cancel", "cmp-template-name", "cmp-confirm-yes", "cmp-confirm-no", "cmp-confirm-text", "ch-scope", "ch-send", "cmp-status"];
  const els = Object.fromEntries(ids.map((id) => [id, new El()]));
  els["ch-text"].value = "question";
  const messages = [], localWrites = [], sessionWrites = [];
  let closed = 0, openConsoleDone, historyDone, localGets = 0, currentSettings = settings;
  const timers = [];
  const chrome = {
    runtime: {
      lastError: null, onMessage: { addListener() {} },
      sendMessage(message, done) {
        messages.push(message);
        if (message.action === "openConsole") openConsoleDone = done;
        else if (message.action === "historyAdd" && delayHistory) historyDone = done;
        else done?.({ ok: true });
      },
    },
    storage: {
      local: {
        get(_keys, done) {
          const failed = initialLocalGetFails ? localGets++ === 0 : localGetFails && ++localGets > 1;
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
  let uid = 0;
  const context = vm.createContext({
    chrome, document,
    ComposeContext: { init: () => Promise.resolve(), payload: (task) => ({ text: `FULL:${task}`, task, source: null }) },
    t: (key) => key, applyI18n() {}, crypto: { randomUUID: () => `id-${++uid}` }, window: { close() { closed++; } }, console,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length - 1; }, clearTimeout(id) { if (timers[id]) timers[id] = null; },
  });
  vm.runInContext(fs.readFileSync("console/sites.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("console/run-meta.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("console/compose.js", "utf8"), context);
  return {
    ...els, messages, localWrites, sessionWrites, get closed() { return closed; },
    openConsoleDone(result) { assert.ok(openConsoleDone, "应已发出 openConsole"); openConsoleDone(result); },
    historyDone(result) { assert.ok(historyDone, "应已发出 historyAdd"); historyDone(result); },
    timeout() { const timer = timers.find(Boolean); assert.ok(timer, "应已设置超时"); timer.fn(); },
    armedTimers() { return timers.filter(Boolean); },
    setSettings(next) { currentSettings = next; },
    setActive(el) { document.activeElement = el; },
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
  assert.ok(Number(sending.sessionWrites[0]?.amsComposeDispatchUntil) > Date.now(), "聚焦控制台前必须建立跨窗口发送锁");
  await sending["ch-send"].fire("click");
  assert.equal(sending.messages.filter((msg) => msg.action === "openConsole").length, 1, "重复点击不得启动第二轮");
  sending.openConsoleDone({ ok: true }); await sendTask;
  assert.deepEqual(sending.messages.filter((msg) => ["openConsole", "historyAdd", "sendAll"].includes(msg.action)).map((msg) => msg.action), ["openConsole", "historyAdd", "sendAll"]);

  const nonblockingHistory = harness({ delayHistory: true }); const nonblockingTask = nonblockingHistory["ch-send"].fire("click");
  await tick(); nonblockingHistory.openConsoleDone({ ok: true }); await nonblockingTask;
  assert.equal(nonblockingHistory.messages.some((msg) => msg.action === "sendAll"), true, "历史落盘不得延迟实际群发");
  nonblockingHistory.historyDone({ ok: true });

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

  const failedInitialSettings = harness({ initialLocalGetFails: true });
  assert.equal(failedInitialSettings["cmp-status"].textContent, "cmp_settingsLoadFailed");
  assert.equal(failedInitialSettings.localWrites.some((value) => value.amsConsole), false, "首次读取失败不得写入默认 amsConsole");

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
  // 命名行/删除确认行收尾必须把焦点还给打开它的按钮（迁移进 compose.js 时曾整体丢失）
  const focusBack = harness();
  const saveOpener = focusBack["cmp-save-template"], nameInput = focusBack["cmp-template-name"];
  const openName = async () => { focusBack.setActive(saveOpener); await saveOpener.fire("click"); focusBack.setActive(nameInput); };
  await openName();
  assert.equal(focusBack["cmp-name"].hidden, false, "点「保存为模板…」应展开命名行");
  await focusBack["cmp-name-cancel"].fire("click");
  assert.equal(saveOpener.focused, 1, "取消命名后焦点应回到打开它的按钮");
  assert.equal(focusBack["cmp-actions"].hidden, false, "取消后应还原动作行");
  await openName();
  await nameInput.fire("keydown", { key: "Escape" });
  assert.equal(saveOpener.focused, 2, "Escape 关闭命名行后焦点应回到打开它的按钮");

  await openName();
  nameInput.value = "tpl";
  const beforeSaveFocus = saveOpener.focused + focusBack["ch-text"].focused;
  await focusBack["cmp-name-save"].fire("click");            // 存一条模板，删除按钮才可用
  assert.ok(saveOpener.focused + focusBack["ch-text"].focused > beforeSaveFocus,
    "保存成功后焦点必须收回 opener 或正文框，不能掉回 body");
  const delOpener = focusBack["cmp-delete-template"];
  focusBack.setActive(delOpener); await delOpener.fire("click");
  assert.equal(focusBack["cmp-confirm"].hidden, false, "删除应先展开二次确认行");
  assert.equal(focusBack["cmp-confirm-no"].focused, 1, "删除确认默认焦点必须落在「取消」");
  focusBack.setActive(focusBack["cmp-confirm-no"]);
  await focusBack["cmp-confirm-no"].fire("click");
  assert.equal(delOpener.focused, 1, "取消删除后焦点应回到「删除模板」");

  // opener 置灰时（保存/删除成功后的真实状态）focus() 静默失效，必须退回正文框
  await openName();
  saveOpener.disabled = true;
  const openerFocusBefore = saveOpener.focused, textFocusBefore = focusBack["ch-text"].focused;
  await focusBack["cmp-name-cancel"].fire("click");
  assert.equal(saveOpener.focused, openerFocusBefore, "opener 已置灰就不该再 focus 它（静默失效＝焦点掉 body）");
  assert.equal(focusBack["ch-text"].focused, textFocusBefore + 1, "opener 置灰时焦点应退回正文框");
  saveOpener.disabled = false;

  // 确认行的 Escape 关闭（迁移时丢失）
  focusBack.setActive(delOpener); await delOpener.fire("click");
  await focusBack["cmp-confirm"].fire("keydown", { key: "Escape" });
  assert.equal(focusBack["cmp-confirm"].hidden, true, "确认行应可 Escape 关闭");
  assert.equal(delOpener.focused, 2, "Escape 关闭确认行后焦点应回到「删除模板」");

  // F113：删除确认必须绑定模板 id 而非下标——确认期间切换选中条目应撤销确认，不得错删/静默不删
  const drift = harness();
  await tick(); // 让初始化那次异步 renderLibrary()（等 composeContextReady）先跑完，别在建模板途中插队覆盖 templates
  const addTemplate = async (h, text) => {
    h["ch-text"].value = text;
    h.setActive(h["cmp-save-template"]); await h["cmp-save-template"].fire("click");
    h.setActive(h["cmp-template-name"]); h["cmp-template-name"].value = "";
    await h["cmp-name-save"].fire("click");
  };
  await addTemplate(drift, "first template text");
  await addTemplate(drift, "second template text");
  const driftItems = drift["cmp-list"].children.slice();
  assert.equal(driftItems.length, 2, "应渲染两条模板");
  // F123：列表项不再是伪 listbox 的 option（没有方向键导航/aria-activedescendant 实现），改用朴素按钮 + aria-current
  for (const item of driftItems) {
    assert.equal(item.attributes.role, undefined, "列表项不应再声明 role=option");
    assert.notEqual(item.attributes["aria-current"], undefined, "列表项应改用 aria-current 标记当前选中项");
  }
  assert.match(fs.readFileSync("console/compose.js", "utf8"), /elList\.removeAttribute\("role"\)/,
    "列表容器应在运行时去掉静态 role=listbox（compose.html 不在本次改动范围内，靠 JS 收尾）");
  await driftItems[0].fire("click"); // 选中「first」
  drift.setActive(drift["cmp-delete-template"]);
  await drift["cmp-delete-template"].fire("click");
  assert.equal(drift["cmp-confirm"].hidden, false, "应展开删除确认行");
  await driftItems[1].fire("click"); // 确认开着时改选「second」
  assert.equal(drift["cmp-confirm"].hidden, true, "切换选中条目应撤销确认态，不得让确认停留在旧目标上");
  assert.equal(drift["cmp-actions"].hidden, false, "撤销确认后应回到操作行");
  await drift["cmp-confirm-yes"].fire("click"); // 即便旧监听仍挂着，撤销后再点也不该删任何东西
  assert.equal(drift["cmp-list"].children.length, 2, "确认已撤销后再点确认不得删除任何模板");

  // 正常路径：确认行开着且目标未漂移，点确认应且只应删除绑定的那一条，并设有 3.1s 自动撤销
  const dropped = harness();
  await tick();
  await addTemplate(dropped, "keep me");
  await addTemplate(dropped, "drop me");
  await dropped["cmp-list"].children[1].fire("click"); // 选中「drop me」
  dropped.setActive(dropped["cmp-delete-template"]);
  await dropped["cmp-delete-template"].fire("click");
  assert.equal(dropped.armedTimers().at(-1)?.ms, 3100, "删除确认应设置 3.1s 自动撤销，避免无限期挂着（跨设备漂移窗口）");
  await dropped["cmp-confirm-yes"].fire("click");
  assert.equal(dropped["cmp-list"].children.length, 1, "确认未漂移时点确认应正常删除");
  assert.equal(dropped["cmp-list"].children[0].children[0].textContent, "keep me", "删除应只影响绑定的那一条，不影响其余模板");

  console.log("compose-handoff tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
