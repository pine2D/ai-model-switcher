// content/core.js — 核心：helpers + 注册表 + runMode + 快捷键消息入口。
// 适配器由 content/adapters.js 注册到 window.__AMS.adapters（manifest js 顺序保证其后加载）。
(function () {
  "use strict";

  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 轮询等待：fn 返回真值则返回之，超时返回 null
  async function waitFor(fn, timeout = 3500, step = 120) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await sleep(step);
    }
  }

  // 在节点集合里按正则找命中文本的元素
  function findByText(selector, re, root) {
    const nodes = [...(root || document).querySelectorAll(selector)];
    return nodes.find((n) => re.test((n.textContent || "").trim())) || null;
  }

  // Radix / Angular-Material 菜单靠 pointer 序列开，单纯 click 可能不开
  function openMenu(el) {
    if (!el) return;
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))
    );
  }

  function clickEl(el) {
    if (!el) return false;
    // detail:1 拟真（真实点击 detail=1；el.click()/裸构造是 0）——Kimi 新首页按 detail===0 过滤机器人点击（真机 2026-07-21）
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, detail: 1, button: 0 }))
    );
    return true;
  }

  function escMenus() {
    for (let i = 0; i < 2; i++) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
  }

  // 提示条：顶部居中（胶囊在 top:8px，toast 放 48px 不遮挡）
  function toast(msg, ok) {
    try {
      const d = document.createElement("div"), accent = ok ? "#4ade80" : "#ff8f91";
      d.textContent = msg; d.setAttribute("role", "status");
      d.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483647;top:48px;left:50%;transform:translateX(-50%);" +
        "max-width:90%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:8px 12px;" +
        "border:1px solid rgba(255,255,255,.14);border-left:3px solid " + accent + ";border-radius:9px;" +
        "background:#12161e;color:#fff;font:13px/1.4 sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.32)";
      document.body.appendChild(d); const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      d.animate(reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translate(-50%,-6px)" }, { opacity: 1, transform: "translateX(-50%)" }], { duration: 140, easing: "cubic-bezier(0.23,1,0.32,1)", fill: "both" });
      setTimeout(() => { const exit = d.animate(reduce ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "translateX(-50%)" }, { opacity: 0, transform: "translate(-50%,-4px)" }], { duration: 110, easing: "cubic-bezier(0.23,1,0.32,1)", fill: "both" });
        exit.finished.then(() => d.remove(), () => d.remove()); }, 2390);
    } catch (e) {}
  }
  // 视口内可见、面积最大的编辑区（textarea / contenteditable）；找不到返回 null。高度阈值须留余量：
  // Claude 单行编辑器标称 20px，缩放机器上实测 19.99…，贴着实测值的 >=20 会筛掉唯一的真编辑器（2026-08）
  function findComposer() {
    const cands = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 80 && r.height >= 16 &&
        r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
    if (!cands.length) return null;
    cands.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    return cands[0].el;
  }

  // 可见文本（answer 收集用）：innerText 只取渲染可见内容——textContent 会把站内/第三方扩展注入的
  // 隐藏节点（水印 UUID、翻译克隆等）一并带出，所见即所得必须用 innerText（textContent 仅作兜底）
  function visText(el) { return ((el && (el.innerText != null ? el.innerText : el.textContent)) || "").trim(); }

  // 读输入框当前文本：textarea/input 取 .value（.textContent 是初始值不随输入更新），其余取 .textContent
  function readText(e) {
    if (!e) return "";
    const v = (e.tagName === "TEXTAREA" || e.tagName === "INPUT") ? (e.value || "") : (e.textContent || "");
    return v.trim();
  }

  // 切换成功后把光标放回输入框
  function focusComposer() {
    try { const el = findComposer(); if (el) el.focus(); } catch (e) {}
  }

  // 注入并提交：附件必须先确认；文字按 textarea setter / beforeinput 注入，再走 adapter、按钮或 Enter。
  // 返回 {ok, code?, reason?}，用户文案由 console 按错误码翻译。
  async function submitPromptNow(text, deadline, images) {
    let el = findComposer();
    if (!el) return { ok: false, code: "composer_not_found" }; // 失败一律传 code，由 console 端按界面语言翻译
    if (images && images.length) {
      const upload = window.__AMS.uploadImages && await window.__AMS.uploadImages(images, pickAdapter(), el, deadline);
      if (!upload || !upload.ok) return upload || { ok: false, code: "attachment_unsupported" };
      const left = Number(deadline) ? Math.max(0, Number(deadline) - Date.now()) : 3500;
      el = findComposer() || (left ? await waitFor(findComposer, Math.min(3500, left)) : null);
      if (!el) return { ok: false, code: "attachment_timeout" }; // 不返回 composer_not_found，避免 bg 整包重传同一图片
    }
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // inject 返回 false=交回通用链；抛异常=通用链不安全，直接 inject_failed（Kimi 会 DOM/model 分叉）。
      const a0 = pickAdapter();
      let injected0 = false;
      try { injected0 = !!(a0 && typeof a0.inject === "function" && a0.inject(el, text) !== false); }
      catch (e) { return { ok: false, code: "inject_failed" }; }
      if (injected0) { await sleep(150); } // Lexical 类编辑器异步应用注入，立即读文本会误判 inject_failed
      else {
      // 先全选(替换既有内容)，再用 beforeinput 注入；没进去再退回 execCommand。
      const _before = (el.textContent || "").trim();
      try { const s = getSelection(); s.removeAllRanges(); const rg = document.createRange(); rg.selectNodeContents(el); s.addRange(rg); } catch (e) {}
      el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
      await sleep(60);
      const _after = (el.textContent || "").trim();
      if (!(_after && _after !== _before)) { // 受控编辑器多行会重排换行，includes 误判；改判"非空且较注入前有变化"
        let injected = false;
        try { document.execCommand("selectAll", false, null); injected = document.execCommand("insertText", false, text); }
        catch (e) {}
        if (!injected) { el.textContent = text; el.dispatchEvent(new InputEvent("input", { bubbles: true })); }
      }
      }
    }
    // 硬校验（两条分支同样生效，textarea 的 native setter 也会被受控组件回滚）：注入彻底落空时框仍为空，绝不能走到下面"空框=已发送"的校验循环产生假成功
    if (text.trim() && !readText(el)) return { ok: false, code: "inject_failed" };
    await sleep(250);
    if (deadline && Date.now() >= deadline) return { ok: false, code: "timeout" };
    const a = pickAdapter();
    const confirmUntil = images && images.length ? deadline : 0;
    if (a && typeof a.submit === "function") {
      // 契约：submit 返回 false = 本站发送键此刻未找到/不可用 → 落回下方通用路径（按钮/Enter/校验循环）。
      // 点击成功也要过提交校验：新适配的发送键（div 无 role 等）点了未必生效，不校验就是假成功回归。
      try {
        const before = readText(el);
        if ((await a.submit(el, deadline)) !== false)
          return (await confirmSubmitted(before, confirmUntil)) ? { ok: true } : { ok: false, code: "submit_unconfirmed" };
      } catch (e) { return { ok: false, code: "error", reason: String((e && e.message) || e) }; }
    }
    // 通用提交优先原生发送按钮，无可用按钮再发 Enter；所有路径都用 confirmSubmitted 防假成功。
    // 发送键定位在 content/send.js（纵向锚点取裁剪祖先、横向择近、跳过不可用项，两个真机坑记在那里）；
    // 该文件缺席时退化成纯 Enter 兜底。expired() 是尾段闸门：尾段最坏在绝对截止线后 6s 才走完，而那时
    // 后台早已结算成 submit_unconfirmed——「告知未确认之后消息又真的发出去」最坏。只挡动作，不缩短确认
    // 窗口（缩窗口不阻止迟到发送，只会把「贴线点了、确认到了」的成功例误转成失败）。
    const sendBtn = () => (window.__AMS.sendBtn ? window.__AMS.sendBtn(el) : null);
    const expired = () => !!deadline && Date.now() >= deadline; const _txtBefore = readText(el); let btn = sendBtn();
    // 点击只给 3s 确认：带图时 confirmUntil 是 90s 绝对截止线，在这里等满会把下面的 Enter 回退整个吃掉
    if (btn && !btn.disabled && !expired()) { btn.click(); if (await confirmSubmitted(_txtBefore, Date.now() + 3000)) return { ok: true }; }
    if (!expired()) ["keydown", "keypress", "keyup"].forEach((t) => el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })));
    await sleep(150); btn = sendBtn(); if (btn && !btn.disabled && !expired()) btn.click(); // Enter 没发出去且按钮可用 → 原生点
    return (await confirmSubmitted(_txtBefore, confirmUntil)) ? { ok: true } : { ok: false, code: "submit_unconfirmed" };
  }

  // 提交后输入框可能异步清空或重挂；每轮重取活节点，空或不再等于原文才算成功。
  async function confirmSubmitted(before, deadline) {
    const end = Number(deadline) || Date.now() + 3000;
    while (Date.now() < end) {
      await sleep(200);
      const composer = findComposer();
      if (!composer) continue;
      const cur = readText(composer);
      if (!cur || cur !== before) return true;
    }
    return false;
  }

  // 注册表：适配器由 adapters.js 填充
  const adapters = {};

  function pickAdapter() {
    const h = location.hostname;
    const key = Object.keys(adapters).find((k) => h.includes(k));
    return key ? adapters[key] : null;
  }

  // silent=true 时不弹 toast、只返回是否成功（供 switchTier 静默重试）。
  async function runModeNow(mode, silent, image) {
    const a = pickAdapter(), action = image && a && a[mode + "Image"] ? mode + "Image" : mode;
    if (!a || !a[action]) return false;
    // 站点偶发渲染抖动会导致首次失败：静默重试一次，仍失败才报错
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        escMenus(); // 清掉可能残留的菜单，保证从干净态开始
        await sleep(attempt ? 600 : 150);
        await a[action]();
        if (!silent) toast(t(mode === "think" ? "cs_switchedThink" : "cs_switchedFast"), true);
        focusComposer();
        try { document.dispatchEvent(new CustomEvent("ams:switched")); } catch (e) {}
        return true;
      } catch (e) {
        escMenus(); try { console.debug("[PolyAsk] switch:", (e && e.message) || e); } catch (e2) {} if (attempt && !silent) toast(t("cs_switchFailGeneric"), false); // 最后一次失败后也必须收尾，残留菜单会罩住输入框让随后的注入点空；适配器抛的是硬编码中文，只降级进控制台，不进用户可见文案
      }
    }
    return false;
  }

  // 站点模型菜单是共享 UI：快捷键、悬浮按钮与群发交错会互相关菜单/点错项。
  // 所有外部交互串行；群发把「切档 + 提交」放在同一任务里，发送前档位不会被插队改写。
  let interactionChain = Promise.resolve();
  function serializeInteraction(fn) {
    const next = interactionChain.then(fn, fn);
    interactionChain = next.then(() => {}, () => {});
    return next;
  }
  function runMode(mode, silent) { return serializeInteraction(() => runModeNow(mode, silent)); }
  function submitPrompt(text, deadline, images) { return serializeInteraction(() => submitPromptNow(text, deadline, images)); }

  // 群发切档用 state() 验证；静默重试到目标档或超时，state 不可读则连续两次无异常视为已尽力。
  async function switchTier(mode, deadlineMs = 10000, image) {
    const okMsg = t(mode === "think" ? "cs_switchedThink" : "cs_switchedFast");
    const t0 = Date.now();
    let nullTries = 0;
    let sawReadable = false; // ponytail: guards two-null shortcut from firing on transient nulls for state-readable sites
    let attemptedOk = false;
    for (;;) {
      const _s = getState(); if (_s != null) sawReadable = true;
      // state 只表示粗档位，不能证明模型版本/强度/开关均精确；每次群发至少跑一次幂等适配器。
      if (attemptedOk && _s === mode) { toast(okMsg, true); return true; }
      const switched = await runModeNow(mode, true, image);           // 已在交互队列内，直接调用内部实现
      if (switched) attemptedOk = true;
      await sleep(350);
      const _s2 = getState(); if (_s2 != null) sawReadable = true;
      if (switched && _s2 === mode) { toast(okMsg, true); return true; } // 适配器成功且状态已切到
      if (switched && _s2 == null && !sawReadable && ++nullTries >= 2) { toast(okMsg, true); return true; }
      if (Date.now() - t0 > deadlineMs) { toast(t("cs_switchUnstable"), false); return false; }
      await sleep(switched ? 400 : 700); // 切到了短等 state 追上；没切到多等页面加载出切换器
    }
  }

  // 当前档位（同步快速读，不开菜单）；适配器无 state 或读不出时返回 null
  function getState() {
    const a = pickAdapter();
    try { return a && a.state ? a.state() : null; } catch (e) { return null; }
  }

  // 只读健康自检：适配器自带 diagnose() 优先，否则回退为档位可读性
  function diagnose() {
    const a = pickAdapter();
    if (!a) return [{ name: t("cs_siteAdapter"), ok: false, kind: "probe" }];
    if (a.diagnose) { try { return a.diagnose(); } catch (e) { return [{ name: t("cs_diagError"), ok: false, kind: "probe" }]; } }
    return [{ name: t("diag_tierReadable"), ok: getState() != null, kind: "tier" }];
  }

  // 快捷键/弹窗入口：runtime 消息只来自本扩展，无需 origin 校验。
  // 守卫：主世界注入测试时 chrome.runtime.onMessage 不存在，跳过监听不影响其余能力。
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.source !== "AMS") return;
      if (msg.mode === "think" || msg.mode === "fast") runMode(msg.mode);
      if (msg.cmd === "getState") { const a = pickAdapter(); sendResponse({ state: getState(), canConfirm: !!(a && a.submitted) }); } if (msg.cmd === "wasSubmitted") { const a = pickAdapter(); let ok = false; try { ok = !!(a && a.submitted && a.submitted(msg.text || "")); } catch (e) {} sendResponse({ supported: !!(a && a.submitted), ok }); }
      if (msg.cmd === "collectAnswer") { // 只读快照：adapter.answer 返回最后一条回答的根节点，通用序列化为 Markdown
        let text = null;
        try {
          const a = pickAdapter();
          const node = a && a.answer ? a.answer() : null;
          text = typeof node === "string" ? node
            : node ? (window.__AMS.toMarkdown ? window.__AMS.toMarkdown(node) : visText(node)) : null;
        } catch (e) {}
        sendResponse({ host: location.hostname, state: getState(), text: text || null });
      }
      if (msg.cmd === "diagnose") sendResponse({ checks: diagnose(), host: location.hostname });
      if (msg.cmd === "submitPrompt") {
        serializeInteraction(async () => {
          try {
            const deadline = Number(msg.deadline) || 0;
            if (deadline && Date.now() >= deadline) return { host: location.hostname, ok: false, code: "timeout" };
            // 新开页面若立即 runMode 会因模型切换器未渲染而切换失败：先等输入框出现
            //（页面交互就绪的代理，切换器此时通常已就位），再切档位、提交。未就绪则返回
            // composer_not_found 让 background(sendAll) 轮询重试，杜绝"切换失败仍直接提交"。
            const waitMs = deadline ? Math.max(0, Math.min(4000, deadline - Date.now())) : 4000;
            if (!(await waitFor(() => findComposer(), waitMs))) return { host: location.hostname, ok: false, code: "composer_not_found" };
            if (deadline && Date.now() >= deadline) return { host: location.hostname, ok: false, code: "timeout" };
            let tierOk = true, tier = msg.tier, images = msg.images || [];
            const a = pickAdapter(), imageMode = images.length && a && (a.thinkImage || a.fastImage);
            if (imageMode && tier !== "think" && tier !== "fast") tier = getState() || "fast";
            if (tier === "think" || tier === "fast") {
              const tierMs = deadline ? Math.max(1, Math.min(10000, deadline - Date.now())) : 10000;
              tierOk = await switchTier(tier, tierMs, !!imageMode); await sleep(200);
            }
            if (deadline && Date.now() >= deadline) return { host: location.hostname, ok: false, code: "timeout" };
            const r = await submitPromptNow(msg.text || "", deadline, images);
            if (r.ok && !tierOk) r.code = "tier_unconfirmed"; // 提交成功但档位未确认：console 绿点带警示，不再谎报全绿
            return Object.assign({ host: location.hostname }, r);
          } catch (e) { return { host: location.hostname, ok: false, code: "error", reason: String((e && e.message) || e) }; }
        }).then(sendResponse, (e) => sendResponse({ host: location.hostname, ok: false, code: "error", reason: String((e && e.message) || e) }));
        return true; // 异步 sendResponse
      }
    });
  } catch (e) {}

  window.__AMS = { runMode, adapters, waitFor, findByText, openMenu, clickEl, sleep, escMenus, toast, getState, diagnose, findComposer, submitPrompt, visText };
})();
