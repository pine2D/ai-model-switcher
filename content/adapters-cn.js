// content/adapters-cn.js — 国内站点适配器（DeepSeek/豆包/千问；Kimi/元宝/智谱在 adapters-cn2.js）
// think = 最强思考(最强模型/最高思考档/思考开)；fast = 均衡快速(快模型/思考关)。
// 切换前对有状态控件先读状态、仅在需要时点击(幂等)；单站失败由 runMode 兜底为 toast。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, findByText, openMenu, clickEl, sleep, escMenus } = S;

  Object.assign(S.adapters, {
    "deepseek.com": {
      _deepThink: function () {
        return [...document.querySelectorAll(".ds-toggle-button")]
          .find((x) => /deepthink|深度思考/i.test((x.textContent || "").trim()));
      },
      _setDeepThink: async function (on) {
        const t = this._deepThink();
        if (!t) throw new Error("DeepSeek: DeepThink 开关未找到"); // 开关常驻 composer，缺失即异常（静默 return 会让 runMode 误报成功）
        if ((t.getAttribute("aria-pressed") === "true") !== on) clickEl(t);
        await sleep(300);
      },
      _selectMode: async function (re) {
        // DeepSeek 模式 radio 只认原生 click(拒绝合成事件 isTrusted=false)；选择幂等，原生 click 安全。
        // radio 仅空对话首屏存在，聊天中缺失属正常态 → 静默跳过（档位真值由 DeepThink 开关兜底）
        const el = findByText('[role="radio"]', re); // Instant / Expert / Vision
        if (el) { el.click(); await sleep(400); }
      },
      // diag 不含模式 radio：它仅空对话首屏存在，聊天中缺失属正常态，列进来会让巡检恒红误报
      diagnose: function () {
        return [
          { name: t("diag_deepThink"), ok: !!this._deepThink() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
        ];
      },
      // 档位真值优先读常驻 composer 的 DeepThink 开关（真机实证 2026-07-11：radio 首条消息后
      // 从 DOM 消失，只读 radio 会在整个对话期恒 null——pill 高亮熄灭/巡检误报/二轮切档失去确认）；
      // radio 仅作首屏无开关时的兜底。
      state: function () {
        const dt = this._deepThink();
        if (dt) return dt.getAttribute("aria-pressed") === "true" ? "think" : "fast";
        const r = [...document.querySelectorAll('[role="radio"]')]
          .find((x) => x.getAttribute("aria-checked") === "true");
        const t = r ? r.textContent || "" : "";
        return /Expert|专家/.test(t) ? "think" : /Instant|快速/.test(t) ? "fast" : null;
      },
      think: async function () { await this._selectMode(/Expert|专家/); await this._setDeepThink(true); },
      fast: async function () { await this._selectMode(/Instant|快速/); await this._setDeepThink(false); },
      thinkImage: async function () { await this._selectMode(/Vision|视觉/); await this._setDeepThink(true); },
      fastImage: async function () { await this._selectMode(/Vision|视觉/); await this._setDeepThink(false); },
      // 2026-07-23 真机：常驻文件 input 接受合成 change；上传完成后预览 img.alt 保留文件名。
      attach: function (files, el, deadline) {
        return S.setInputFiles(document.querySelector('input[type="file"][accept*=".png"]'), files, el, deadline);
      },
      // 发送键无 send/发送 标签（真机审计 2026-07：composer 右下 primary 圆钮）；图片处理期间仅加
      // ds-button--disabled，不设 aria-disabled，需等按钮真正可用后再原生点击。
      // 已知限制（真机证实，DeepSeek/豆包/Kimi 同）：流式生成期间站点把同一按钮复用为「停止」（class/id 不变
      // 仅换图标），流式中二次群发会点成停止、截断上一条回答——confirmSubmitted 会诚实报失败，retry 可恢复；
      // 图标判别太脆弱不做守卫，属窄窗口取舍。
      submit: async function (_el, deadline) {
        const b = await waitFor(() => {
          const el = [...document.querySelectorAll('[role="button"].ds-button--primary.ds-button--circle')].pop();
          return el && !el.classList.contains("ds-button--disabled") &&
            el.getAttribute("aria-disabled") !== "true" ? el : null;
        }, Number(deadline) ? Math.max(0, Number(deadline) - Date.now()) : 10000);
        if (!b) return false;
        b.click();
      },
      // 最后一条回答：.ds-message 为 AI 消息容器，正文取思考段（.ds-think-content）之外的最后一个 .ds-markdown
      answer: function () {
        const msgs = document.querySelectorAll(".ds-message");
        for (let i = msgs.length - 1; i >= 0; i--) {
          const mds = [...msgs[i].querySelectorAll(".ds-markdown")].filter((x) => !x.closest(".ds-think-content"));
          if (mds.length) return mds[mds.length - 1];
        }
        return null;
      },
    },

    // 豆包：composer 模式按钮(当前显示当前模式)，点开菜单含 快速/专家/超能模式([role=menuitem])
    "doubao.com": {
      _modeBtn: function () {
        return [...document.querySelectorAll("button")]
          .find((x) => { const t = (x.textContent || "").trim(); return /^(快速|专家|超能)/.test(t) && t.length < 14; });
      },
      _select: async function (re) {
        for (let i = 0; i < 3; i++) {
          const btn = this._modeBtn();
          if (!btn) throw new Error("豆包: 模式按钮未找到"); // 静默 return 会让 runMode 误报"已切到"
          if (re.test((btn.textContent || "").trim())) return; // 已是目标，幂等返回
          if (!findByText('[role="menuitem"]', re)) openMenu(btn);
          const item = await waitFor(() => findByText('[role="menuitem"]', re), 1500);
          if (item) { item.click(); await sleep(500); } // 选项 onclick，用原生 click
          escMenus(); await sleep(200);
        }
        throw new Error("豆包: 目标模式未选中");
      },
      diagnose: function () {
        return [
          { name: t("diag_modeBtn"), ok: !!this._modeBtn() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
        ];
      },
      state: function () {
        const b = this._modeBtn();
        const t = b ? (b.textContent || "").trim() : "";
        return /^专家/.test(t) ? "think" : /^快速/.test(t) ? "fast" : null;
      },
      think: async function () { await this._select(/^专家/); },
      fast: async function () { await this._select(/^快速/); },
      attach: function (files, el, deadline) {
        return S.setInputFiles(document.querySelector('input[type="file"][accept*="png"]'), files, el, deadline);
      },
      // 发送键无标签但有稳定 id（真机审计 2026-07）；不可用时落回通用路径（textarea Enter 可发）
      submit: function () {
        const b = document.getElementById("flow-end-msg-send");
        if (!b || b.disabled || b.getAttribute("aria-disabled") === "true" || b.getAttribute("data-disabled") === "true") return false;
        b.click();
      },
      // 最后一条回答（chrome-dbg 真机审计 2026-07：消息容器 [data-message-id]，用户消息右对齐带
      // justify-end、AI 无；正文在 .md-box-root。注意豆包渲染会在中文与数字间插空格）
      answer: function () {
        const msgs = [...document.querySelectorAll("[data-message-id]")]
          .filter((m) => !((m.className || "").includes("justify-end")) && !m.querySelector(".justify-end"));
        if (!msgs.length) return null;
        const el = msgs[msgs.length - 1];
        return el.querySelector(".md-box-root") || el;
      },
    },

    // 千问：think=Qwen3.7-千问+思考研究，fast=Qwen3.8-Max+快速；兼容旧版裸思考按钮。
    "qianwen.com": {
      // 模型下拉触发器：aria-haspopup 属性由前端延迟水合，新加载页面一段时间内只有纯文本节点，
      // 先按 aria 找，找不到退回按可见文本找最内层节点（click 冒泡可达真正持有 handler 的祖先）
      _trigger: function () {
        const byAria = [...document.querySelectorAll('[aria-haspopup="dialog"]')].find((x) => /Qwen3/.test(x.textContent || ""));
        if (byAria) return byAria;
        return [...document.querySelectorAll("div,button,span")].filter((e) => {
          const t = (e.textContent || "").trim();
          return /^Qwen3/.test(t) && t.length <= 25 && e.children.length <= 3; // 只读 state() 不需可见性判定
        }).pop() || null;
      },
      _selectModel: async function (re) {
        const md = this._trigger();
        if (!md) throw new Error("千问模型下拉未就绪");
        // 先读后点：已是目标模型直接返回。否则触发器自身文本会让下面的 findByText 误判
        // "菜单已开"，leaf 又抓到触发器本身，点击反而打开模型对话框（真机 2026-07-21：
        // fast/think 同模型后每次切档都踩中此分支，白开对话框靠 Escape 兜底，慢且脆弱）
        if (re.test((md.textContent || "").trim())) return;
        if (!findByText("div,li,span,button", re)) md.click();
        const leaf = await waitFor(() =>
          [...document.querySelectorAll("div,li,span,button")]
            .filter((e) => e.children.length <= 2 && re.test((e.textContent || "").trim()) && (e.textContent || "").trim().length < 26).pop());
        if (!leaf) { escMenus(); throw new Error("千问: 模型选项未找到"); } // 静默 return 会让 runMode 误报成功
        let c = leaf, clicked = false;
        for (let i = 0; i < 5 && c; i++) {
          if (c.onclick || /option|menuitem/.test(c.getAttribute("role") || "") || c.tagName === "LI") { c.click(); clicked = true; break; }
          c = c.parentElement;
        }
        if (!clicked) leaf.click();
        await sleep(500);
        escMenus();
      },
      _thinkBtn: function () {
        const menu = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => {
          const r = b.getBoundingClientRect(), label = (b.getAttribute("aria-label") || b.textContent || "").trim();
          return r.width > 0 && r.height > 0 && /^(快速|思考研究|Fast|Thinking Research)$/i.test(label);
        });
        if (menu) return menu;
        return [...document.querySelectorAll("button")]
          .find((b) => [...b.querySelectorAll("span")].some((x) => /^(思考|Thinking)$/i.test((x.textContent || "").trim())) || /^(思考|Thinking)$/i.test((b.textContent || "").trim()));
      },
      _isThink: function (b) {
        if (b && b.getAttribute("aria-haspopup") === "menu")
          return /思考研究|Thinking Research/i.test(b.getAttribute("aria-label") || b.textContent || "");
        return !!b && (b.className || "").split(/\s+/).includes("text-theme");
      },
      _setThink: async function (on) {
        const b = this._thinkBtn();
        if (!b) throw new Error("千问: 思考按钮未找到"); // 常驻 composer，缺失即异常
        if (this._isThink(b) === on) return;
        if (b.getAttribute("aria-haspopup") === "menu") {
          b.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window, detail: 1, button: 0 }));
          const re = on ? /思考研究|Thinking Research/i : /^快速|^Fast/i;
          const item = await waitFor(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((x) => {
            const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && re.test((x.textContent || "").trim());
          }), 1500);
          if (!item) throw new Error("千问: 模式选项未找到");
          item.click(); await sleep(500);
        } else { b.click(); await sleep(300); }
        const after = this._thinkBtn();
        if (!after || this._isThink(after) !== on) throw new Error("千问: 思考开关未生效");
      },
      diagnose: function () {
        return [
          { name: t("diag_modelDropdown"), ok: !!this._trigger() },
          { name: t("diag_thinkBtn"), ok: !!this._thinkBtn() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
        ];
      },
      state: function () {
        const m = this._trigger();
        const t = m ? m.textContent || "" : "";
        const b = this._thinkBtn();
        if (!b) return null;
        const on = this._isThink(b);
        if (on && /Qwen3\.7-千问(?!-Max)/i.test(t)) return "think";
        return !on && /Qwen3\.8-Max(?!-Preview)/i.test(t) ? "fast" : null;
      },
      think: async function () { await this._selectModel(/Qwen3\.7-千问(?!-Max)/i); await this._setThink(true); },
      fast: async function () { await this._selectModel(/Qwen3\.8-Max(?!-Preview)/i); await this._setThink(false); },
      // 动态 input 需可信菜单点击，合成 drop/paste 被忽略（2026-07-23 真机），明确报 unsupported。
      // 最后一条回答（真机审计锚点 2026-07：.answer-common-card，正文在 .qk-markdown）。
      // 思考档思考段也是 .qk-markdown（祖先 thinkingContent-<hash>，CSS-module 后缀会变故用
      // [class*=] 匹配，真机 2026-07-11），过滤后取最后一个，否则思考全文混入汇总。
      answer: function () {
        const cards = document.querySelectorAll(".answer-common-card");
        if (!cards.length) return null;
        const el = cards[cards.length - 1];
        const mds = [...el.querySelectorAll(".qk-markdown")].filter((m) => !m.closest('[class*="thinkingContent"]'));
        return mds[mds.length - 1] || el;
      },
    },
  });
})();
