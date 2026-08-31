const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class El {
  constructor(id) { this.id = id; this.disabled = this.hidden = false; this.dataset = {}; this.textContent = ""; this.label = { textContent: "" }; this.listeners = {}; this.style = {}; this.classList = { add() {}, remove() {} }; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  focus() {}
  setAttribute() {}
  removeAttribute() {}
  replaceChildren() {}
  appendChild() {}
  append() {}
  querySelector(selector) { return selector === "span" ? this.label : null; }
}
function syncPage(config, status, clearReply = Promise.resolve({ ok: true })) {
  const ids = ["connect", "sync-now", "disconnect", "export", "import-file", "clear-remote", "clear-confirmation", "clear-continue", "status-title", "status-detail"];
  const els = Object.fromEntries(ids.map((id) => [id, new El(id)]));
  const controls = ["connect", "sync-now", "disconnect", "export", "clear-remote", "clear-continue"].map((id) => els[id]);
  let clearCalls = 0, storageChanged;
  const chrome = { runtime: { sendMessage(message) {
    if (message.source === "AMS_SYNC" && message.action === "status") return Promise.resolve({ ok: true, value: status });
    if (message.source === "AMS_SYNC" && message.action === "clearRemote") return typeof clearReply === "function" ? clearReply(++clearCalls) : (++clearCalls, clearReply);
    return Promise.resolve({ ok: true });
  } }, storage: { local: { get: () => Promise.resolve({ amsSyncConfig: config }), set() {} },
    onChanged: { addListener(fn) { storageChanged = fn; } } } };
  const context = { chrome, document: { title: "", documentElement: {}, getElementById: (id) => els[id], querySelectorAll: () => controls, addEventListener() {} },
    applyI18n() {}, t: (key, value) => value == null ? key : `${key}:${value}`, Intl, TextDecoderStream, window: {}, setInterval() {}, clearInterval() {}, setTimeout() {}, console };
  vm.runInNewContext(fs.readFileSync("options/sync.js", "utf8") + "\nglobalThis.testApi={renderStatus,run,setState:(c,s)=>{config=c;status=s;busy=false;notice='';renderStatus();}};", context);
  return new Promise((resolve) => setImmediate(() => resolve({ els, clearCalls: () => clearCalls, api: context.testApi,
    changeStatus(next) { status = next; storageChanged?.({ amsSyncStatus: { newValue: next } }, "local"); } })));
}

async function syncStatusTracksStorage() {
  const page = await syncPage({ connected: true }, { state: "syncing", lastSuccessAt: 1 });
  assert.equal(page.els["status-title"].textContent, "sync_syncing");
  page.changeStatus({ state: "idle", lastSuccessAt: 2 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.els["status-title"].textContent, "sync_idle", "后台同步完成后设置页必须实时退出同步中");
}

async function clearRunningFeedback() {
  let release;
  const page = await syncPage({ connected: true, clearRunning: true, clearProgress: 3 }, { state: "auth" }, (count) => count === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.reject(new Error("retry")));
  assert.equal(page.els["clear-continue"].hidden, false, "续跑按钮在清云端暂停时必须可见");
  assert.equal(page.els["clear-continue"].disabled, false, "续跑按钮在空闲时必须可用");
  assert.equal(page.els.export.disabled, true, "迁移操作必须在续跑期间禁用");
  const pending = page.api.run("clearRemote");
  assert.equal(page.els["clear-continue"].disabled, true, "实际续跑期间必须禁用继续按钮");
  release({ ok: true }); await pending;
  await page.api.run("clearRemote");
  assert.equal(page.clearCalls(), 2, "失败后必须允许再次续跑");
  assert.equal(page.els["clear-continue"].disabled, false, "失败后继续按钮必须恢复可用");
}

async function clearAuthFeedback() {
  const page = await syncPage({ connected: true, clearRunning: true, clearProgress: 3 }, { state: "auth" });
  assert.equal(page.els["status-title"].textContent, "sync_auth", "清理暂停于鉴权时必须明确显示需重新授权");
  assert.equal(page.els["clear-continue"].hidden, false, "鉴权暂停时必须显示继续清理按钮");
  assert.equal(page.els["clear-continue"].disabled, false, "鉴权暂停时继续按钮必须可用");
}

async function blockedFeedback() {
  const page = await syncPage({ connected: true }, { state: "blocked", reason: "quota", errorCount: 2 });
  assert.match(page.els["status-detail"].textContent, /sync_blockedQuota/, "配额阻断原因必须呈现");
  assert.match(page.els["status-detail"].textContent, /sync_errorCount:2/, "损坏记录数必须呈现");
}

function historyRejects() {
  const group = new El("group");
  const context = { chrome: { runtime: { lastError: null, sendMessage(_message, done) { done({ ok: false }); } } }, document: { getElementById: () => group },
    t: (key) => key, chosen: () => [], SITES: [], elTier: new El("tier"), elTierButtons: [], Event, flashNote() {} };
  vm.runInNewContext(fs.readFileSync("console/library.js", "utf8") + "\nglobalThis.testApi={pushHistory,getHistory:()=>history};", context);
  context.loadHistory = () => context.testApi.getHistory().splice(0);
  context.testApi.pushHistory("not saved");
  assert.equal(context.testApi.getHistory().length, 0, "持久化历史失败时不得写入内存快捷缓存");
}

function historyRace() {
  const callbacks = [], group = new El("group"), persisted = ["old"];
  const context = { chrome: { runtime: { lastError: null, sendMessage(_message, done) { callbacks.push(done); } } }, document: { getElementById: () => group },
    t: (key) => key, chosen: () => [], SITES: [], elTier: new El("tier"), elTierButtons: [], Event, flashNote() {} };
  vm.runInNewContext(fs.readFileSync("console/library.js", "utf8") + "\nglobalThis.testApi={pushHistory,getHistory:()=>history,replace:(next)=>history=next};", context);
  context.loadHistory = () => context.testApi.replace(persisted);
  context.testApi.replace(persisted);
  context.testApi.pushHistory("A");
  context.testApi.pushHistory("B");
  persisted.unshift("B"); callbacks[1]({ ok: true }); callbacks[0]({ ok: false });
  assert.equal(context.testApi.getHistory().join(","), "B,old", "A 失败不得抹掉随后成功的 B 或原有顺序");
}

async function composeHistoryRejects() {
  const ids = ["ch-text", "cmp-list", "cmp-actions", "cmp-name", "cmp-confirm", "cmp-save-template", "cmp-delete-template", "cmp-more", "ch-close", "ch-back", "cmp-name-save", "cmp-name-cancel", "cmp-template-name", "cmp-confirm-yes", "cmp-confirm-no", "cmp-confirm-text", "ch-scope", "ch-send", "cmp-status"];
  const els = Object.fromEntries(ids.map((id) => [id, new El(id)]));
  els["ch-text"].value = "question";
  const messages = []; let historyDone, feedbackDone, closed = 0;
  const chrome = { runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
    messages.push(message);
    if (message.source === "AMS_DATA") { historyDone = done; return; }
    if (message.from === "AMS_COMPOSE") { feedbackDone = done; return; }
    if (done) done({ ok: true });
  } }, storage: {
    local: { get(_keys, done) { done({ amsConsole: { selected: { a: true } } }); }, set(_value, done) { if (done) done(); } },
    session: { set(_value, done) { done?.(); }, remove(_key, done) { done?.(); } },
    onChanged: { addListener() {} },
  } };
  const context = { chrome, document: { getElementById: (id) => els[id], querySelectorAll: () => [], createElement: () => new El("new"), createTextNode: () => new El("text"), addEventListener() {}, hasFocus: () => false },
    ComposeContext: { init: async () => {}, payload: (text) => ({ text, task: text, source: null }) },
    RunMeta: { clearPending: async () => {} },
    SITES: [{ host: "a", label: "A" }], resolveSiteSelection: (saved) => ({ ...saved }), t: (key) => key, applyI18n() {}, crypto: { randomUUID: () => "id" }, window: { close() { closed++; } }, setTimeout, clearTimeout, console };
  vm.runInNewContext(fs.readFileSync("console/compose.js", "utf8"), context);
  const sending = els["ch-send"].listeners.click[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.some((message) => message.action === "sendAll"), true, "历史写入不得阻塞 AI 群发");
  assert.equal(closed, 0, "历史结果返回前应保留 compose 上下文以接收失败反馈");
  historyDone({ ok: false });
  assert.equal(messages.some((message) => message.from === "AMS_COMPOSE" && message.type === "historySaveFailed"), true, "历史失败必须通知主控制台可见反馈");
  assert.equal(closed, 0, "主控制台收到失败提示前不得关闭 compose");
  feedbackDone(); await sending;
  assert.equal(closed, 1, "历史回调后仍应关闭 compose");
}

async function archiveRejects() {
  const failsum = new El("failsum"), live = new El("live"), send = new El("send"), retry = new El("retry");
  let receive;
  const context = { chrome: {
    runtime: { lastError: null, sendMessage(_message, done) { done({ ok: false }); }, onMessage: { addListener(fn) { receive = fn; } } },
    storage: { session: { get(_key, done) { done({}); }, remove(_key, done) { done?.(); } }, onChanged: { addListener() {} } },
  },
    document: { documentElement: {}, getElementById: (id) => ({ failsum, live, send, retry })[id], querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() } }, t: (key) => key, setTimeout() {}, clearTimeout, Date, Map, console };
  vm.runInNewContext(fs.readFileSync("console/status.js", "utf8") + "\nglobalThis.testApi={copySummary};", context);
  context.testApi.copySummary([{ host: "a", label: "A" }], [{ host: "a", text: "answer" }], "q");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failsum.textContent, "con_collectDoneUnarchived", "复制成功、归档失败必须明确说明未归档");
  receive({ from: "AMS_COMPOSE", type: "historySaveFailed" });
  assert.equal(failsum.textContent, "con_historySaveFailed", "主控制台必须可见地播报 compose 的历史保存失败");
}

function archivePageRejects() {
  const ids = ["ar-list", "ar-detail", "ar-copy", "ar-export", "ar-del", "ar-more", "ar-status", "ar-capture"];
  const els = Object.fromEntries(ids.map((id) => [id, new El(id)]));
  const chrome = { runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage(message, done) {
    if (message.source === "AMS_CONSOLE") return done({ results: [] });
    if (message.action === "archiveAdd") return done({ ok: false });
    return done({ ok: true, items: [] });
  } }, storage: {
    local: { get(_keys, done) { done({ amsConsole: { selected: { a: true } }, amsConsolePrompt: "q" }); } },
    session: { get(_key, done) { done({}); } },
  } };
  const context = { chrome, document: { documentElement: {}, getElementById: (id) => els[id], addEventListener() {}, createElement: () => new El("new"), createTextNode: () => new El("text") },
    navigator: { clipboard: { writeText: () => Promise.resolve() } }, URL: { createObjectURL() {}, revokeObjectURL() {} }, Blob, SITES: [{ host: "a", label: "A" }], t: (key) => key, applyI18n() {}, setTimeout, Date };
  vm.runInNewContext(fs.readFileSync("console/archive.js", "utf8"), context);
  els["ar-capture"].listeners.click[0]({ currentTarget: els["ar-capture"] });
  assert.equal(els["ar-status"].textContent, "arc_saveFailed", "归档页保存失败必须明确提示");
}

(async () => {
  await syncStatusTracksStorage();
  await clearRunningFeedback();
  await clearAuthFeedback();
  await blockedFeedback();
  historyRejects();
  historyRace();
  await composeHistoryRejects();
  await archiveRejects();
  archivePageRejects();
  console.log("sync feedback UI checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
