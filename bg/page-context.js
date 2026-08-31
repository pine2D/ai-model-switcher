// bg/page-context.js — 用户主动触发的网页上下文入口（右键菜单）
const PageContext = (() => {
  "use strict";

  const MENU_SELECTION = "ams-send-selection";
  const MENU_PAGE = "ams-send-page";
  const MENU_COPY = {
    selection: { en: "Compare selection with PolyAsk", zh_CN: "用 PolyAsk 比较所选内容", zh_TW: "用 PolyAsk 比較所選內容" },
    page: { en: "Compare this page with PolyAsk", zh_CN: "用 PolyAsk 比较当前网页", zh_TW: "用 PolyAsk 比較目前網頁" },
  };

  function callbackApi(call) {
    return new Promise((resolve, reject) => call((value) => {
      const error = chrome.runtime.lastError;
      if (error) { reject(new Error(error.message)); return; }
      resolve(value);
    }));
  }

  async function readLanguage() {
    const value = await callbackApi((done) => chrome.storage.local.get({ amsLang: "auto" }, done));
    return value?.amsLang || "auto";
  }

  function resolveLanguage(preference) {
    if (["en", "zh_CN", "zh_TW"].includes(preference)) return preference;
    const ui = String(chrome.i18n?.getUILanguage?.() || "en").toLowerCase();
    if (!ui.startsWith("zh")) return "en";
    return ui.includes("tw") || ui.includes("hk") || ui.includes("hant") ? "zh_TW" : "zh_CN";
  }

  function menuTitle(kind, language) {
    return MENU_COPY[kind][language] || MENU_COPY[kind].en;
  }

  let installQueue = Promise.resolve();
  function installMenus() {
    const current = installQueue.then(async () => {
      const language = resolveLanguage(await readLanguage());
      await callbackApi((done) => chrome.contextMenus.removeAll(done));
      await callbackApi((done) => chrome.contextMenus.create({
        id: MENU_SELECTION,
        title: menuTitle("selection", language),
        contexts: ["selection"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
      }, done));
      await callbackApi((done) => chrome.contextMenus.create({
        id: MENU_PAGE,
        title: menuTitle("page", language),
        contexts: ["page"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
      }, done));
    });
    installQueue = current.catch(() => {});
    return current;
  }

  function canRead(tab) {
    try { return ["http:", "https:"].includes(new URL(tab?.url || "").protocol); } catch (e) { return false; }
  }

  // 首 24000 + 尾 6000 之间插入语言无关的省略标记，避免两段无缝焊接成一句连续文本让模型误读；
  // 标记本身不用三段短横线，避免和 console/compose-context.js 的 activeMarker UUID 围栏视觉混淆。
  function capText(value) {
    const chars = [...String(value || "").trim()];
    const truncated = chars.length > 30000;
    if (!truncated) return { text: chars.join(""), truncated };
    const head = chars.slice(0, 24000), tail = chars.slice(-6000), omitted = chars.length - head.length - tail.length;
    const marker = `\n\n[… omitted ${omitted} characters / 已省略 ${omitted} 个字符 …]\n\n`;
    return { text: head.join("") + marker + tail.join(""), truncated };
  }

  function extractPage(rootDocument = document) {
    // 唯一命中才用 article：列表页每条目一个 <article> 时，querySelector 只会捞到文档顺序第一条，
    // 混进导航/推荐位。querySelectorAll 不可用时（离线测试桩）退回旧的单命中判定，不改变既有行为。
    const hasList = typeof rootDocument.querySelectorAll === "function";
    const article = hasList ? (rootDocument.querySelectorAll("article").length === 1 ? rootDocument.querySelector("article") : null)
      : rootDocument.querySelector("article");
    const roots = [article, rootDocument.querySelector("main"),
      rootDocument.querySelector('[role="main"]'), rootDocument.body];
    for (const root of roots) {
      const text = String(root?.innerText || "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (text) return text;
    }
    return "";
  }

  async function pageFailure(code, current = () => true) {
    await callbackApi((done) => chrome.storage.session.set({ amsComposeContextError: code }, done));
    if (!current()) return { ok: false, code: "superseded" };
    await openCompose();
    return { ok: false, code };
  }

  let captureVersion = 0;
  async function handleClick(info, tab) {
    if (info?.menuItemId !== MENU_SELECTION && info?.menuItemId !== MENU_PAGE) return { ok: false };
    const version = ++captureVersion, current = () => version === captureVersion;
    const isPage = info.menuItemId === MENU_PAGE;
    if (!canRead(tab)) return isPage ? pageFailure("page_access_denied", current) : { ok: false, code: "page_access_denied" };

    let value = info.selectionText;
    if (isPage) {
      try {
        const [{ result = "" } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPage,
        });
        value = result;
      } catch (e) {
        return current() ? pageFailure("page_access_denied", current) : { ok: false, code: "superseded" };
      }
    }

    if (!current()) return { ok: false, code: "superseded" };
    const { text, truncated } = capText(value);
    if (!text) return isPage ? pageFailure("page_empty", current) : { ok: false, code: "page_empty" };
    const context = {
      kind: isPage ? "page" : "selection",
      title: [...String(tab.title || "")].slice(0, 512).join(""),
      url: tab.url,
      text,
      truncated,
      capturedAt: Date.now(),
    };
    const values = { amsComposeContext: context, amsComposeContextError: null };
    await callbackApi((done) => chrome.storage.session.set(values, done));
    if (!current()) return { ok: false, code: "superseded" };
    await openCompose();
    return { ok: true, context };
  }

  chrome.runtime.onInstalled.addListener(() => { void installMenus().catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => { void installMenus().catch(() => {}); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.amsLang) void installMenus().catch(() => {});
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => { void handleClick(info, tab).catch(() => {}); });

  return { MENU_SELECTION, MENU_PAGE, menuCopy: MENU_COPY, installMenus, handleClick, capText, extractForTest: extractPage };
})();
