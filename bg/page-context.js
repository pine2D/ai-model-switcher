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

  function capText(value) {
    const chars = [...String(value || "").trim()];
    const truncated = chars.length > 30000;
    return {
      text: truncated ? chars.slice(0, 24000).concat(chars.slice(-6000)).join("") : chars.join(""),
      truncated,
    };
  }

  function extractPage(rootDocument = document) {
    const root = rootDocument.querySelector("article") || rootDocument.querySelector("main") ||
      rootDocument.querySelector('[role="main"]') || rootDocument.body;
    return String(root?.innerText || "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function pageFailure(code) {
    await callbackApi((done) => chrome.storage.session.set({ amsComposeContextError: code }, done));
    await openCompose();
    return { ok: false, code };
  }

  async function handleClick(info, tab) {
    if (info?.menuItemId !== MENU_SELECTION && info?.menuItemId !== MENU_PAGE) return { ok: false };
    const isPage = info.menuItemId === MENU_PAGE;
    if (!canRead(tab)) return isPage ? pageFailure("page_access_denied") : { ok: false, code: "page_access_denied" };

    let value = info.selectionText;
    if (isPage) {
      try {
        const [{ result = "" } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPage,
        });
        value = result;
      } catch (e) {
        return pageFailure("page_access_denied");
      }
    }

    const { text, truncated } = capText(value);
    if (!text) return isPage ? pageFailure("page_empty") : { ok: false, code: "page_empty" };
    const context = {
      kind: isPage ? "page" : "selection",
      title: String(tab.title || ""),
      url: tab.url,
      text,
      truncated,
      capturedAt: Date.now(),
    };
    const values = { amsComposeContext: context };
    if (isPage) values.amsComposeContextError = null;
    await callbackApi((done) => chrome.storage.session.set(values, done));
    await openCompose();
    return { ok: true, context };
  }

  chrome.runtime.onInstalled.addListener(() => { void installMenus().catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => { void installMenus().catch(() => {}); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.amsLang) void installMenus().catch(() => {});
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => { void handleClick(info, tab).catch(() => {}); });

  return { MENU_SELECTION, MENU_PAGE, installMenus, handleClick, capText, extractForTest: extractPage };
})();
