// content/adapters-intl.js — 国际站点适配器（Claude/ChatGPT/Gemini）
// think = 最强思考(最强模型/最高思考档/思考开)；fast = 均衡快速(快模型/思考关)。
// 切换前对有状态控件先读状态、仅在需要时点击(幂等)；单站失败由 runMode 兜底为 toast。
(function () {
  "use strict";
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
      // effort 子菜单内的 Thinking 开关（与 effort-option-* 同层）
      _thinkSwitch: function () {
        return [...document.querySelectorAll('[role="switch"]')]
          .find((s) => /thinking|思考/i.test((s.getAttribute("aria-label") || "") +
            (s.closest('[role="menuitem"]') ? s.closest('[role="menuitem"]').textContent : ""))) || null;
      },
      // Thinking/effort 控制位于模型下拉内；effort 级别由参数传入（max/medium/low…），
      // 用稳定 testid effort-option-<level>；开关切换会重渲染故 waitFor 重取。
      _setThinking: async function (on, effort) {
        await this._open();
        const optSel = '[data-testid="effort-option-' + effort + '"]';
        const trig = document.querySelector('[data-testid="effort-menu-trigger"]');
        if (trig) {
          if (!this._thinkSwitch() && !document.querySelector(optSel)) openMenu(trig);
          // 1) 旧布局有 Thinking 开关；Fable 5 新布局只有 effort 单选项。
          const ready = await waitFor(() => this._thinkSwitch() || document.querySelector(optSel), 1500);
          if (!ready) { escMenus(); throw new Error("Claude: Thinking/effort 控件未找到"); }
          const sw = this._thinkSwitch();
          if (sw && (sw.getAttribute("aria-checked") === "true") !== on) { clickEl(sw); await sleep(450); }
          // 2) effort 档位切到目标级别
          if (!document.querySelector(optSel)) {
            const t2 = document.querySelector('[data-testid="effort-menu-trigger"]');
            if (t2) openMenu(t2);
          }
          const opt = await waitFor(() => document.querySelector(optSel), 1500);
          if (!opt) { escMenus(); throw new Error("Claude: 目标 effort 未找到"); }
          if (opt.getAttribute("aria-checked") !== "true") clickEl(opt);
          await sleep(300);
          if (effort === "high" && !/high|高/i.test(this._label())) {
            escMenus(); throw new Error("Claude: High effort 未生效");
          }
          escMenus(); return;
        }
        // 回退：无 effort 入口的旧布局（窄屏 Adaptive 开关），仅切裸开关；开关也缺失时保持
        // 静默——fast() 依赖"无思考控件自然降级为纯选模型"的语义（见 fast() 注释），不误伤
        const sw = this._thinkSwitch();
        if (sw) { if ((sw.getAttribute("aria-checked") === "true") !== on) clickEl(sw); await sleep(300); }
        escMenus();
      },
      _label: function () {
        const e = document.querySelector('[data-testid="model-selector-dropdown"]');
        return e ? (e.getAttribute("aria-label") || "") : "";
      },
      // 嵌入态被官方锁 haiku 的识别（同步）：① 确在 iframe（独立标签恒 false）；
      // ② 模型入口显示原始兜底 id（正常 UI 只显示友好名，绝不显示 api id）——claude 官方嵌入门，无干净绕过
      _isEmbedLocked: function () {
        try { return window.self !== window.top && /haiku-latest|3-5-haiku/i.test(this._label()); }
        catch (e) { return false; }
      },
      diagnose: function () {
        if (this._isEmbedLocked())
          return [{ name: t("diag_iframeLimited"), ok: false }];
        return [
          { name: t("diag_modelEntry"), ok: !!document.querySelector('[data-testid="model-selector-dropdown"]') },
          { name: t("diag_modelReadable"), ok: /opus|sonnet|haiku|fable/i.test(this._label()) },
        ];
      },
      // think = Fable 5 High；fast = Sonnet 5（快模型，使用该模型默认设置）。
      // 判档：模型名带 sonnet/haiku 恒 fast；Fable/Opus 再按 thinking/effort 后缀（Adaptive/High/Extra/Max=think，Low/无后缀=fast，其余 effort 不判）
      state: function () {
        if (this._isEmbedLocked()) return null; // 受限态：不谎报 "fast"，HUD 不亮琥珀
        const t = this._label();
        if (!t) return null;
        if (/sonnet|haiku/i.test(t)) return "fast";
        if (!/fable|opus/i.test(t)) return null;
        if (/adaptive|high|extra|max|高|最大/i.test(t)) return "think";
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
        if (this._isEmbedLocked()) throw new Error("Claude 在 iframe 中被官方限制为 haiku，档位不可切换（请在独立标签使用）");
        await this._selectModel(/fable\s*5/i); await this._setThinking(true, "high");
      },
      // fast 只选 Sonnet 5，使用该模型记忆的默认 effort，避免把思考档的 High 强加给快档。
      fast: async function () {
        if (this._isEmbedLocked()) throw new Error("Claude 在 iframe 中被官方限制为 haiku，档位不可切换（请在独立标签使用）");
        await this._selectModel(/sonnet\s*5/i);
      },
      attach: function (files, el, deadline) {
        return S.setInputFiles(document.querySelector('input[data-testid="file-upload"]'), files, el, deadline);
      },
    },

    "chatgpt.com": {
      // GPT-5.6：Instant 仍为 GPT-5.5；Medium～Extra High 为 Sol；Pro 为 Sol Pro。
      // 兼容滚动发布期间仍显示的 Pro Standard/Extended（标准/扩展）。
      // 真机验证 2026-07-11（chrome-dbg，英文界面）：pill 为纯档名（Pro/Instant，无版本前缀）；
      // 菜单 radio 的 "Instant5.5" 尾缀是行内徽标拼接（不影响按位置取档/只看 pill 的锚点）；
      // 模型子菜单触发器唯一、文本 "GPT-5.6 Sol" 无零宽字符。中文界面档位词仍为候选、待真机验证。
      _LABELS: /^(instant|medium|high|extra\s*high|o3|极速|即时|均衡|中(?:等)?|高(?:级)?|[极超]高|pro(?:\s*(?:standard|extended|标准|扩展|深度模式))?)$/i,
      // 旧模型会把版本前缀并进 pill（实测如 5.5Pro / 5.5Instant），先剥掉再判档。
      _tier: function (text) {
        return (text || "").trim().replace(/^(?:gpt-?)?5\.[3456](?:\s*sol)?/i, "").trim();
      },
      // 锚点：composer pill（实测精确 1 个）优先，再回退任意 haspopup=menu；文本须属档位标签集（^锚定，避免误中侧栏标题）
      _anchor: function () {
        return [...document.querySelectorAll(
            'button.__composer-pill[aria-haspopup="menu"], button[aria-haspopup="menu"]')]
          .find((x) => this._LABELS.test(this._tier(x.textContent)));
      },
      // 子菜单渲染在独立 popper 里，只看第一个 wrapper 会漏，故全局取
      _radios: function () { return [...document.querySelectorAll('[role="menuitemradio"]')]; },
      // 打开 pill 菜单第一层（2026-08 改版：Power 滑块 + Advanced 视图里的 Model/Effort 子菜单入口）
      _openRoot: async function () {
        const anchor = this._anchor();
        if (!anchor) throw new Error("ChatGPT: Intelligence 按钮未找到");
        const open = () => anchor.getAttribute("aria-expanded") === "true" &&
          !!(document.querySelector('[role="menuitem"][aria-haspopup="menu"]') || this._radios().length);
        for (let i = 0; i < 2; i++) { if (open()) return; openMenu(anchor); if (await waitFor(open, 1500)) return; }
        escMenus(); throw new Error("ChatGPT: 档位菜单未展开");
      },
      // 档位项只认标签集，整份列表带模型名即判为 Model 子菜单：两处子菜单同为 menuitemradio，混用
      // 会把「最高档」点成末位模型（真机 2026-08：think 先选模型，残留的正是模型列表 → 点成 o3）。
      _tiers: function () {
        const rs = this._radios();
        if (!rs.length || rs.some((x) => /gpt-|claude/i.test(x.textContent || ""))) return null;
        const tiers = rs.filter((x) => this._LABELS.test(this._tier(x.textContent)));
        return tiers.length ? tiers : null;
      },
      // 打开档位菜单，返回 radio 列表（DOM 升序：极速…Pro）
      _openEffort: async function () {
        await this._openRoot();
        if (!this._tiers()) { // 新布局档位在 Effort 子菜单里；旧布局第一层就是档位，无此入口
          const trig = findByText('[role="menuitem"][aria-haspopup="menu"]', /^(effort|强度|推理|思考|力度)/i)
            || [...document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')]
              .filter((x) => !/gpt-|^o3$|claude/i.test((x.textContent || "").trim())).pop();
          if (trig) trig.click();
        }
        const rs = await waitFor(() => this._tiers(), 1500);
        if (!rs) { escMenus(); throw new Error("ChatGPT: 档位菜单未展开"); }
        return rs;
      },
      // top=true 取最高档（末位），否则最低档（首位）；不写死标签，自适应加减档
      _pickEdge: async function (top) {
        const rs = await this._openEffort();
        const item = top ? rs[rs.length - 1] : rs[0];
        if (!item) { escMenus(); throw new Error("ChatGPT: 档位为空"); }
        clickEl(item); await sleep(400);
      },
      // 模型子菜单靠原生 click 展开；通用 pointer 序列会连续触发开/关而把两级菜单一起收起。
      _selectModel: async function (re) {
        await this._openRoot();
        const trig = await waitFor(() => [...document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')]
          .find((x) => /GPT-|^o3$/i.test((x.textContent || "").trim())), 1500);
        if (!trig) { escMenus(); throw new Error("ChatGPT: 模型入口未找到"); }
        if (re.test((trig.textContent || "").trim())) { escMenus(); return; }
        trig.click();
        const item = await waitFor(() => findByText('[role="menuitemradio"]', re), 1500);
        if (!item) { escMenus(); throw new Error("ChatGPT: GPT-5.6 Sol 未找到"); }
        item.click(); await sleep(700); escMenus(); await sleep(200); // 子菜单开着时点 Effort 只会把它关掉
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

    "gemini.google.com": {
      _MI: "button.mat-mdc-menu-item, [role=menuitem]",
      _modelBtn: function () {
        return [...document.querySelectorAll("button")]
          .find((b) => /mode picker/i.test(b.getAttribute("aria-label") || ""))
          || document.querySelector('button[class*="input-area-swi"]');
      },
      _openModelMenu: async function () {
        const btn = this._modelBtn();
        if (!btn) throw new Error("Gemini: 模型按钮未找到");
        if (!document.querySelector(this._MI)) openMenu(btn);
        let ok = await waitFor(() => document.querySelector(this._MI), 1500);
        if (!ok) { openMenu(btn); ok = await waitFor(() => document.querySelector(this._MI)); }
        if (!ok) throw new Error("Gemini: 模型菜单未展开");
      },
      _selectModel: async function (re) {
        await this._openModelMenu();
        const item = await waitFor(() => findByText(this._MI, re));
        if (!item) { escMenus(); throw new Error("Gemini: 未找到模型 " + re); }
        clickEl(item); await sleep(700);
      },
      // 当前布局把 Extended thinking 作为模型菜单直达开关；旧布局仍走 Thinking level 嵌套子菜单。
      _setThinking: async function (re, on = true) {
        await this._openModelMenu();
        const direct = findByText(this._MI, re);
        if (direct) {
          const active = direct.classList.contains("selected") || direct.getAttribute("aria-checked") === "true";
          if (active !== on) clickEl(direct);
          await sleep(400); escMenus(); return;
        }
        if (!on) { escMenus(); return; }
        const trig = await waitFor(() => findByText(this._MI, /thinking level|思考(等级|程度)?/i));
        if (!trig) { escMenus(); return; } // 无等级子菜单的布局（窄屏/模型无此项）：合法缺席，静默跳过
        let lvl = null;
        for (let i = 0; i < 6 && !lvl; i++) {
          if (!findByText(this._MI, re)) openMenu(trig);
          lvl = await waitFor(() => findByText(this._MI, re), 600);
        }
        if (!lvl) { escMenus(); throw new Error("Gemini: 思考等级选项未找到"); } // 子菜单在但目标缺 → 报错可见（静默会漏设等级）
        if (lvl.focus) lvl.focus();
        lvl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        clickEl(lvl); await sleep(400); escMenus();
      },
      diagnose: function () {
        return [
          { name: t("diag_modelEntry"), ok: !!this._modelBtn() },
          { name: t("diag_tierReadable"), ok: this.state() != null },
        ];
      },
      state: function () {
        const b = this._modelBtn();
        const t = b ? b.getAttribute("aria-label") || "" : "";
        if (/extended|扩展/i.test(t)) return /pro\b/i.test(t) ? "think" : null;
        return /flash/i.test(t) ? "fast" : null;
      },
      // 最后一条回答（真机审计锚点 2026-07：每条回答一个 <message-content>，正文在 .markdown）
      answer: function () {
        const els = document.querySelectorAll("message-content");
        if (!els.length) return null;
        const el = els[els.length - 1];
        return el.querySelector(".markdown") || el;
      },
      // 等级 UI 词中英双写；英文 "Extended" 真机已确认，中文「扩展」为直译候选
      think: async function () { await this._selectModel(/3\.1\s*pro\b/i); await this._setThinking(/^(extended|扩展)/i); },
      fast: async function () { await this._selectModel(/3\.6\s*flash\b/i); await this._setThinking(/^(extended|扩展)/i, false); },
      // Gemini 忽略合成 drop，附件菜单又要求可信点击且不保留 file input；留空明确报 unsupported。
    },

    // DeepSeek：模式 tab(Instant/Expert/Vision，空对话首屏) + DeepThink 开关(ds-toggle-button, aria-pressed)
  });
})();
