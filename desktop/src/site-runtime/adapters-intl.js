// desktop/src/site-runtime/adapters-intl.js — 国际站点适配器（Claude/Gemini；ChatGPT 在 adapters-intl2.js）
// 触及 300 行上限后按站分卷，契约与注意事项同 CLAUDE.md / docs/adapters.md。
// think = 最强思考(最强模型/最高思考档/思考开)；fast = 均衡快速(快模型/思考关)。
// 切换前对有状态控件先读状态、仅在需要时点击(幂等)；单站失败由 runMode 兜底为 toast。
(function () {
  "use strict";
  const t = globalThis.__AMS_I18N__ ? globalThis.__AMS_I18N__.t : globalThis.t;
  const S = window.__AMS;
  if (!S) return;
  const { waitFor, findByText, openMenu, clickEl, sleep, escMenus } = S;

  Object.assign(S.adapters, {
    "claude.ai": {
      _open: async function () {
        const trig = document.querySelector('[data-testid="model-selector-dropdown"]');
        if (!trig) throw new Error("Claude: 模型按钮未找到");
        if (!document.querySelector('[role="menuitemradio"]')) openMenu(trig);
        let ok = await waitFor(() => document.querySelector('[role="menuitemradio"]'), 1500);
        if (!ok) { openMenu(trig); ok = await waitFor(() => document.querySelector('[role="menuitemradio"]')); }
        if (!ok) throw new Error("Claude: 模型菜单未展开");
      },
      // 2026-08 改版：顶层只留当前模型一项，其余收进「More models」子菜单；顶层找不到再展开子菜单。
      _selectModel: async function (re) {
        await this._open();
        let item = await waitFor(() => findByText('[role="menuitemradio"]', re), 900);
        if (!item) {
          const more = findByText('[role="menuitem"][aria-haspopup="menu"]', /more models|更多模型/i);
          if (more) { openMenu(more); item = await waitFor(() => findByText('[role="menuitemradio"]', re), 1500); }
        }
        if (!item) { escMenus(); throw new Error("Claude: 未找到模型 " + re); }
        clickEl(item); await sleep(700); escMenus(); // 收尾：子菜单不关会罩住输入框，也会让后续动作点空
      },
      // effort 档位标签，由低到高（真机 2026-08-31：Low / MediumDefault / High / Extra / Max）。
      // think 取本表里在场的最高档，站点加减档自适应：撤掉 Max 就自动退到 Extra，再撤退到 High。
      _EFFORT: [/^(low|低)/i, /^(medium|中)/i, /^(high|高)/i, /^(extra|超)/i, /^(max|极致|最大|最高)/i],
      _THINK: /adaptive|high|extra|max|高|最大|极致|超/i, // state() 与 _setEffort() 的复读共用；必须盖住 _EFFORT 最高两档会点到的每个词（中文 UI 是「极致」「超」）
      // 2026-08 改版：effort-menu-trigger / effort-option-* 两个 testid 已消失（Base UI 菜单只剩
      // 自动生成 id），入口退化成「文本 Effort+当前档」的 role=menuitem 子菜单项。
      _effortTrigger: function () {
        return findByText('[role="menuitem"][aria-haspopup="menu"]', /^(effort|强度|思考强度|努力)/i);
      },
      // 档位项与模型项同为 menuitemradio 且同时在 DOM（真机 2026-08-31：顶层 4 个模型 + 子菜单 5 个档位）。
      // 双重语义校验：① 所属 [role=menu] 的 aria-labelledby 必须指回 effort 入口的 id；② 文本须属档位标签集。
      // 少一层都会把「最高档」点成末位模型（同 ChatGPT 2026-08 那次事故）。
      _effortItems: function (trig) {
        const id = trig.id || "";
        // 入口没有 id 就无法校验归属：宁可抛错也不退化成纯文本匹配（那会把「Max Preview」模型项当最高档点下去）。
        if (!id) { escMenus(); throw new Error("Claude: Effort 入口缺少 id，无法校验档位归属"); }
        return [...document.querySelectorAll('[role="menuitemradio"]')]
          .map((el) => ({ el, rank: this._EFFORT.findIndex((re) => re.test((el.textContent || "").trim())) }))
          .filter((x) => {
            if (x.rank < 0) return false;
            const menu = x.el.closest('[role="menu"]');
            return !!(menu && menu.getAttribute("aria-labelledby") === id);
          });
      },
      // effort 子菜单在模型下拉内；控件缺失一律 throw（2026-08-31 起不再有「静默 return」例外——
      // 控件仍在，只是选择子变了，静默会让 runMode 误报「已切到」并弹假成功 toast）。
      _setEffort: async function () {
        await this._open();
        const trig = this._effortTrigger();
        if (!trig) { escMenus(); throw new Error("Claude: Effort 入口未找到"); }
        let items = this._effortItems(trig);
        if (!items.length) { // 子菜单未展开：openMenu 一次再重取（展开会重渲染，不能复用旧节点）
          openMenu(trig);
          items = await waitFor(() => { const l = this._effortItems(trig); return l.length ? l : null; }, 1500) || [];
        }
        if (!items.length) { escMenus(); throw new Error("Claude: Effort 档位未找到"); }
        const top = items.reduce((a, b) => (b.rank > a.rank ? b : a));
        if (top.el.getAttribute("aria-checked") !== "true") { clickEl(top.el); await sleep(450); }
        const ok = await waitFor(() => this._THINK.test(this._label()), 1200); // 点击被吞时不许静默成功
        escMenus();
        if (!ok) throw new Error("Claude: 目标 effort 未生效");
      },
      _label: function () {
        const e = document.querySelector('[data-testid="model-selector-dropdown"]');
        return e ? (e.getAttribute("aria-label") || "") : "";
      },
      diagnose: function () {
        return [
          { name: t("diag_modelEntry"), ok: !!document.querySelector('[data-testid="model-selector-dropdown"]'), kind: "control" },
          { name: t("diag_modelReadable"), ok: /opus|sonnet|haiku|fable/i.test(this._label()), kind: "tier" },
        ];
      },
      // think = Fable 5 + 在场最高 effort（当前 Max）；fast = Sonnet 5（快模型，使用该模型默认设置）。
      // 判档：模型名带 sonnet/haiku 恒 fast；Fable/Opus 再按 thinking/effort 后缀（Adaptive/High/Extra/Max=think，Low/无后缀=fast，其余 effort 不判）
      // aria-label 形如 `Model: Fable 5 · Max`（分隔符 U+00B7，真机 2026-08-31）。
      state: function () {
        const t = this._label();
        if (!t) return null;
        if (/sonnet|haiku/i.test(t)) return "fast";
        if (!/fable|opus/i.test(t)) return null;
        if (this._THINK.test(t)) return "think";
        if (/\blow\b|低/i.test(t)) return "fast";
        if (/(?:fable|opus)\s*[\d.]+$/i.test(t.trim())) return "fast"; // 窄屏思考关：无后缀
        return null;
      },
      // 最后一条回答（真机审计锚点 2026-07：每条 AI 回答一个 .font-claude-response）。
      // 思考折叠头与正文同在一个 grid（真机 2026-07-11：折叠头 .row-start-1 / 正文 .row-start-2），
      // 取正文格，否则思考摘要文本会混入汇总复制；无思考时无该 grid，回退整块。
      answer: function () {
        const els = document.querySelectorAll(".font-claude-response");
        if (!els.length) return null;
        const el = els[els.length - 1];
        return el.querySelector(".row-start-2") || el;
      },
      think: async function () {
        await this._selectModel(/fable\s*5/i); await this._setEffort();
      },
      // fast 只选 Sonnet 5，使用该模型记忆的默认 effort，避免把思考档的 High 强加给快档。
      fast: async function () {
        await this._selectModel(/sonnet\s*5/i);
      },
      attach: function (files, el, deadline) {
        return S.setInputFiles(document.querySelector('input[data-testid="file-upload"]'), files, el, deadline);
      },
    },

    "gemini.google.com": {
      _MI: "button.mat-mdc-menu-item, [role=menuitem]",
      // 只认可见项：页面常驻隐藏的导出菜单（`gv-pm-saved-export-menu gv-hidden` 的 JSON/Markdown 也是
      // [role=menuitem]），拿它当「菜单已展开」会让模型按钮永远不被点开（真机 2026-08-14）。
      _items: function () { return [...document.querySelectorAll(this._MI)]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); },
      _find: function (re) { return this._items().find((el) => re.test((el.textContent || "").trim())) || null; },
      _modelBtn: function () { return [...document.querySelectorAll("button")]
        .find((b) => /mode picker/i.test(b.getAttribute("aria-label") || "")) ||
        document.querySelector('button[class*="input-area-swi"]'); },
      _openModelMenu: async function () {
        const btn = this._modelBtn();
        if (!btn) throw new Error("Gemini: 模型按钮未找到");
        if (btn.getAttribute("aria-expanded") !== "true" || !this._items().length) openMenu(btn);
        let ok = await waitFor(() => this._items().length, 1500);
        if (!ok) { openMenu(btn); ok = await waitFor(() => this._items().length); }
        if (!ok) throw new Error("Gemini: 模型菜单未展开");
      },
      // 收尾：**escMenus 对 Gemini 无效**（真机 2026-08-31：Escape 与点 cdk backdrop 都关不掉，
      // aria-expanded 一直是 true），只有再点一次触发器才收 → 先 Escape 再兜底点触发器。
      // 菜单不关会罩住输入框，让随后的注入点空。
      _close: async function () {
        escMenus();
        if (!this._items().length) return;
        await sleep(250);
        if (!this._items().length) return;
        clickEl(this._modelBtn()); await sleep(300);
      },
      _selectModel: async function (re) {
        await this._openModelMenu();
        const item = await waitFor(() => this._find(re));
        if (!item) { await this._close(); throw new Error("Gemini: 未找到模型 " + re); }
        clickEl(item); await sleep(700); await this._close(); // 收尾：不依赖后续 _setThinking 替它关菜单
      },
      // 当前布局把 Extended thinking 作为模型菜单直达开关；旧布局仍走 Thinking level 嵌套子菜单。
      _setThinking: async function (re, on = true) {
        await this._openModelMenu();
        const direct = this._find(re);
        if (direct) {
          const active = direct.classList.contains("selected") || direct.getAttribute("aria-checked") === "true";
          if (active !== on) clickEl(direct);
          await sleep(400); await this._close(); return;
        }
        if (!on) { await this._close(); return; }
        const trig = await waitFor(() => this._find(/thinking level|思考(等级|程度)?/i));
        if (!trig) { await this._close(); return; } // 无等级子菜单的布局（窄屏/模型无此项）：合法缺席，静默跳过
        let lvl = null;
        for (let i = 0; i < 6 && !lvl; i++) { if (!this._find(re)) openMenu(trig); lvl = await waitFor(() => this._find(re), 600); }
        if (!lvl) { await this._close(); throw new Error("Gemini: 思考等级选项未找到"); } // 子菜单在但目标缺 → 报错可见（静默会漏设等级）
        if (lvl.focus) lvl.focus();
        lvl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        clickEl(lvl); await sleep(400); await this._close();
      },
      diagnose: function () {
        return [
          { name: t("diag_modelEntry"), ok: !!this._modelBtn(), kind: "control" },
          { name: t("diag_tierReadable"), ok: this.state() != null, kind: "tier" },
        ];
      },
      // aria-label 只报模式名（"…currently Pro/Flash"），不含 Extended thinking 状态，故按粗档位判；
      // think() 仍会幂等地把 Extended thinking 一并打开（真机 2026-08-14 改版）。
      state: function () { const b = this._modelBtn(), t = b ? b.getAttribute("aria-label") || "" : "";
        return /flash/i.test(t) ? "fast" : (/\bpro\b|extended|扩展/i.test(t) ? "think" : null); },
      // 最后一条回答（真机审计锚点 2026-07：每条回答一个 <message-content>，正文在 .markdown）
      answer: function () {
        const els = document.querySelectorAll("message-content");
        if (!els.length) return null;
        const el = els[els.length - 1];
        return el.querySelector(".markdown") || el;
      },
      // 深档模型正则与 fast 对称地**版本无关**（2026-08-31 事故只修了 fast 那一半）：任意版本号 + Pro。
      // Pro 侧没有 Flash-Lite 式的更弱同名档，不需要后瞻。等级 UI 词中英双写；英文 "Extended" 真机已确认。
      think: async function () { await this._selectModel(/\b\d+(?:\.\d+)?\s*pro\b/i); await this._setThinking(/^(extended|扩展)/i); },
      // 快档模型正则**版本无关**：写死 3.6 在站点升到 3.7 Flash 当天就整站抛「未找到模型」（真机
      // 2026-08-31 事故）。取「任意版本号 + Flash、且不是 Flash-Lite」——Lite 是更弱的另一档，
      // 后瞻同时挡住 `Flash-Lite` 与 `Flash Lite` 两种写法。
      fast: async function () {
        await this._selectModel(/\b\d+(?:\.\d+)?\s*flash\b(?!\s*-?\s*lite)/i);
        await this._setThinking(/^(extended|扩展)/i, false);
      },
      // Gemini 忽略合成 drop，附件菜单又要求可信点击且不保留 file input；留空明确报 unsupported。
    },

    // DeepSeek：模式 tab(Instant/Expert/Vision，空对话首屏) + DeepThink 开关(ds-toggle-button, aria-pressed)
  });
})();
