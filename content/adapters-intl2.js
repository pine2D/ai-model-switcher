// content/adapters-intl2.js — 国际站点适配器·续（ChatGPT）。
// adapters-intl.js 触及 300 行上限后按站分卷；契约与注意事项同 adapters-intl.js / CLAUDE.md。
// manifest.json 里必须排在 adapters-intl.js 之后、content/diag.js 之前（diag 按已填充的注册表
// 统一包装 diagnose，排在它后面的分卷拿不到通用检查且静默缺席）。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, findByText, openMenu, clickEl, sleep, escMenus } = S;

  Object.assign(S.adapters, {
    "chatgpt.com": {
      // 2026-08-31 改版实测（chrome-dbg，英文界面）：pill 菜单是 Radix popper
      // `[data-testid="composer-intelligence-picker-content"]`，**没有任何 aria-haspopup 子菜单**——
      // 档位从「radio 列表」改成一根 5 格滑块（Power 项，0..4 = Instant/Medium/High/Extra High/Pro），
      // 模型 radio（GPT-5.6 Sol / GPT-5.5）与滑块同时常驻。关闭时 pill 显示当前档名（如 Pro），
      // 打开时显示控件名 Thinking effort。中文界面档位词仍为候选、待真机验证。
      // 菜单开着时 pill 文本变控件名「Thinking effort」（真机 2026-08-31）——不是档位，state() 判非终态
      _OPEN_PILL: /^(thinking effort|思考(强度|力度)?)$/i,
      // 旧模型会把版本前缀并进 pill（实测如 5.5Pro / 5.5Instant），先剥掉再判档。
      _tier: function (text) {
        return (text || "").trim().replace(/^(?:gpt-?)?5\.[3456](?:\s*sol)?/i, "").trim();
      },
      // 锚点：composer pill 纯选择子（真机 2026-08-31：全页精确 1 个）。**不再做文本前置校验**——
      // 新 UI 的 pill 在菜单开着时显示控件名而非档名，带文本校验的 _anchor 会当场返回 undefined，
      // 让 think/fast 双双抛「按钮未找到」而 diagnose 全绿（那正是这次事故的表象）。
      _anchor: function () { return document.querySelector('button.__composer-pill[aria-haspopup="menu"]'); },
      // 打开 pill 菜单（2026-08 改版：Radix popper `composer-intelligence-picker-content`，
      // 里面是 Power 滑块 + 常驻的模型 radio，**没有任何 aria-haspopup 子菜单入口**）
      _openRoot: async function () {
        const anchor = this._anchor();
        if (!anchor) throw new Error("ChatGPT: Intelligence 按钮未找到");
        const open = () => document.querySelector('[data-testid="composer-intelligence-picker-content"]') || this._power();
        for (let i = 0; i < 2; i++) { if (open()) return; openMenu(anchor); if (await waitFor(open, 1500)) return; }
        escMenus(); throw new Error("ChatGPT: 档位菜单未展开");
      },
      // 档位控件：role=menuitem[aria-label=Power]，内含 [data-model-reasoning-effort-slider]；
      // 两条锚点取并集，任一在就认（aria-label 会随界面语言变，data-* 属性不会）。
      _power: function () {
        return [...document.querySelectorAll('[role="menuitem"]')].find((x) =>
          /^(power|强度|力度)$/i.test(x.getAttribute("aria-label") || "") ||
          !!x.querySelector("[data-model-reasoning-effort-slider]")) || null;
      },
      // 档位真值只认位次「now/min/max」，不认档名：0–3 档的档名不在 DOM 里（只有 describedby 的
      // 一行朗读文本给出当前档），拿标签判档一改版就漂。滑块读不出时回退解析 `Pro, 5 of 5.`。
      _level: function () {
        const p = this._power();
        if (!p) return null;
        const sl = p.querySelector('[role="slider"]');
        if (sl) {
          const now = +sl.getAttribute("aria-valuenow"), min = +sl.getAttribute("aria-valuemin"), max = +sl.getAttribute("aria-valuemax");
          if (Number.isFinite(now) && Number.isFinite(min) && Number.isFinite(max) && max > min) return { now, min, max };
        }
        const m = /(\d+)\s*(?:of|\/|共)\s*(\d+)/i.exec(this._describe(p));
        return m ? { now: +m[1] - 1, min: 0, max: +m[2] - 1 } : null;
      },
      _describe: function (el) {
        return (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)
          .map((id) => { const e = document.getElementById(id); return e ? (e.textContent || "").replace(/\s+/g, " ").trim() : ""; })
          .join(" ");
      },
      // top=true 取最高档，否则最低档；不写死标签，自适应加减档。
      // 键盘驱动：站点自己在 Power 项上声明 aria-keyshortcuts="ArrowLeft ArrowRight"；
      // **End/Home 真机无效**（2026-08-31 实测：值纹丝不动），只能逐格按，端点会饱和不越界。
      _pickEdge: async function (top) {
        await this._openRoot();
        let lv = this._level();
        if (!lv) { escMenus(); throw new Error("ChatGPT: 档位滑块未找到"); }
        const key = top ? "ArrowRight" : "ArrowLeft", goal = top ? lv.max : lv.min;
        for (let i = 0; i <= lv.max - lv.min && lv.now !== goal; i++) {
          const el = this._power(); // 每格重渲染，必须重取节点
          if (!el) break;
          if (el.focus) el.focus();
          ["keydown", "keyup"].forEach((type) => el.dispatchEvent(
            new KeyboardEvent(type, { key: key, code: key, bubbles: true, cancelable: true, view: window })));
          await sleep(220);
          lv = this._level() || lv;
        }
        const ok = lv.now === goal;
        escMenus(); // 收尾：菜单不关会罩住输入框，让随后的注入点空
        if (!ok) throw new Error("ChatGPT: 档位未到端点");
      },
      // 模型 radio 与滑块同时常驻菜单（Advanced 视图不必展开也在 DOM，真机 2026-08-31）：先直接找，
      // 找不到再点 aria-label="Select model" 入口展开一次。已选中就不点——点了会连带把菜单收掉。
      _selectModel: async function (re) {
        await this._openRoot();
        let item = findByText('[role="menuitemradio"]', re);
        if (!item) {
          const entry = [...document.querySelectorAll('[role="menuitem"]')]
            .find((x) => /^(select model|选择模型)$/i.test(x.getAttribute("aria-label") || ""));
          if (entry) { entry.click(); item = await waitFor(() => findByText('[role="menuitemradio"]', re), 1500); }
        }
        if (!item) { escMenus(); throw new Error("ChatGPT: 未找到模型 " + re); }
        if (item.getAttribute("aria-checked") === "true") return;
        item.click(); await sleep(700);
      },
      diagnose: function () {
        return [
          { name: t("diag_intelEntry"), ok: !!this._anchor() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
        ];
      },
      state: function () {
        const a = this._anchor();
        const raw = a ? (a.textContent || "").trim() : "";
        if (!raw || this._OPEN_PILL.test(raw)) return null; // 菜单开着：pill 是控件名，非终态
        const t = this._tier(raw);
        if (/instant|medium|极速|即时|均衡|中/i.test(t)) return "fast"; // Instant/Medium
        if (/(?:gpt-?)?5\.[345](?!\d)|\bo3\b/i.test(raw)) return null; // 旧模型高档不能冒充 5.6 think
        if (/high|pro|高/i.test(t)) return "think";             // High/Extra High/Pro（含旧 Standard/Extended）
        return null;
      },
      // 最后一条回答（真机审计 2026-08：每轮 section[data-turn]，正文仍在 .markdown）；
      // data-message-author-role 是滚动发布中的旧内层，保留兜底。
      answer: function () {
        let els = document.querySelectorAll('[data-turn="assistant"]');
        if (!els.length) els = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (!els.length) return null;
        const el = els[els.length - 1];
        return el.querySelector(".markdown") || el;
      },
      think: async function () { await this._selectModel(/^GPT-5\.6\s*Sol$/i); await this._pickEdge(true); },
      fast: async function () { await this._selectModel(/^GPT-5\.6\s*Sol$/i); await this._pickEdge(false); },
      attach: function (files, el, deadline) {
        return S.setInputFiles(document.querySelector("#upload-photos"), files, el, deadline);
      },
      stop: function () {
        const b = document.querySelector('[data-testid="stop-button"]') ||
          [...document.querySelectorAll('button[aria-label]')]
            .find((x) => /stop (answering|streaming|generating)/i.test(x.getAttribute("aria-label") || ""));
        if (b) { clickEl(b); S.toast(t("cs_stopped"), true); }
      },
    },
  });
})();
