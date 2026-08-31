// content/pill.js — 三态悬浮控件：handle(默认贴边把手)/always(常显)/hidden。
// displayMode 存 chrome.storage.local，popup 修改后经 storage.onChanged 实时生效。
(function () {
  "use strict";
  if (document.getElementById("ams-pill-host")) return;

  const host = document.createElement("div");
  host.id = "ams-pill-host";
  host.style.cssText =
    "position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host{display:block;--ease-out:cubic-bezier(0.23,1,0.32,1)}
      .wrap{display:flex;flex-direction:column;align-items:center}
      .handle{position:relative;border:0;padding:0;width:36px;height:24px;cursor:pointer;background:transparent}
      .handle:before{content:"";position:absolute;inset:0 0 auto;width:36px;height:6px;border-radius:0 0 6px 6px;
        background:rgba(120,120,120,.45);transition:background .14s ease}
      .pill{display:none;align-items:center;border-radius:999px;overflow:hidden;margin-top:4px;
        border:1px solid rgba(255,255,255,.12);background:rgba(18,22,30,.94);box-shadow:0 4px 16px rgba(0,0,0,.3);
        backdrop-filter:blur(8px);
        font:13px/1 -apple-system,"Segoe UI",sans-serif;color:#fff;
        opacity:1;transition:opacity .16s var(--ease-out)}
      .pill.idle{opacity:.42}
      .pill:hover{opacity:1}
      .pill button{all:unset;cursor:pointer;padding:7px 14px;white-space:nowrap;transition:background-color .12s ease,transform .12s var(--ease-out)}
      .pill button:hover{background:rgba(255,255,255,.14)}
      .pill button.active{background:rgba(98,89,222,.78)}
      .handle:focus-visible,.pill button:focus-visible{outline:2px solid #fff;outline-offset:2px}
      .sep{width:1px;align-self:stretch;background:rgba(255,255,255,.22)}
      .pill button:active{transform:scale(.97)}
      @media (hover:hover) and (pointer:fine){.handle:hover:before{background:rgba(120,120,120,.8)}}
      @media (prefers-reduced-motion:reduce){.handle:before{transition:background-color .1s ease}.pill{transition:opacity .1s ease}.pill button{transition:background-color .1s ease}.pill button:active{transform:none}}
      @media (prefers-reduced-transparency:reduce){.pill{background:#12161e;backdrop-filter:none}.pill.idle{opacity:1}}
      @media (prefers-contrast:more){.pill{background:#0c0f15;border-color:rgba(255,255,255,.55);backdrop-filter:none}.pill.idle{opacity:1}}
      /* 模式形态 */
      .wrap[data-mode=hidden]{display:none}
      .wrap[data-mode=always] .handle{display:none}
      .wrap[data-mode=always] .pill{display:flex}
      .wrap[data-mode=handle].open .handle{display:none}
      .wrap[data-mode=handle].open .pill{display:flex}
    </style>
    <div class="wrap" id="wrap" data-mode="handle">
      <button type="button" class="handle" id="handle"></button>
      <div class="pill" id="pill">
        <button id="think"></button>
        <span class="sep"></span>
        <button id="fast"></button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const wrap = root.getElementById("wrap");
  const pill = root.getElementById("pill");
  const btnT = root.getElementById("think");
  const btnF = root.getElementById("fast");
  const hdl  = root.getElementById("handle");

  function applyTexts() {
    hdl.title        = t("cs_pillHandleTitle");
    hdl.setAttribute("aria-label", hdl.title);
    btnT.textContent = t("cs_pillThink");
    btnT.title       = t("cs_pillThinkTitle");
    btnF.textContent = t("cs_pillFast");
    btnF.title       = t("cs_pillFastTitle");
  }
  applyTexts();
  document.addEventListener("i18n:changed", applyTexts);

  // 当前档位高亮（同步读，不开菜单）
  // F091：hidden 模式下控件不可见，用户已明确关闭——早退，不做 adapter.state() 扫描。
  // 切回 handle 由 openPill() 补读、切到 always 由 applyMode 的 refreshState() 补读，不会残留过期高亮。
  function refreshState() {
    if (wrap.dataset.mode === "hidden") return;
    const s = window.__AMS && window.__AMS.getState ? window.__AMS.getState() : null;
    btnT.classList.toggle("active", s === "think");
    btnF.classList.toggle("active", s === "fast");
    btnT.setAttribute("aria-pressed", s === "think" ? "true" : "false");
    btnF.setAttribute("aria-pressed", s === "fast" ? "true" : "false");
  }

  // handle 模式：hover/click 展开，4s 无交互收回
  let collapseTimer = null;
  function armCollapse() {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => wrap.classList.remove("open"), 4000);
  }
  function openPill() {
    wrap.classList.add("open");
    refreshState();
    armCollapse();
  }
  // F100：命中区（24px）比可见把手（6px）高，鼠标横扫宿主顶栏中央的透明区会被误吞。
  // 保留 24px 命中区不退回（这是刻意的最小可点击尺寸），改用 hover-intent 延时：
  // 划过不停留不弹出，把误触成本从「立刻弹出 4 秒 HUD」降到零；真要用仍可直接点击 handle。
  let hoverOpenTimer = null;
  hdl.addEventListener("mouseenter", () => { hoverOpenTimer = setTimeout(openPill, 350); });
  hdl.addEventListener("mouseleave", () => clearTimeout(hoverOpenTimer));
  hdl.addEventListener("click", () => { clearTimeout(hoverOpenTimer); openPill(); (btnF.classList.contains("active") ? btnF : btnT).focus(); });
  pill.addEventListener("mouseenter", () => { clearTimeout(collapseTimer); pill.classList.remove("idle"); });
  pill.addEventListener("mouseleave", () => { if (wrap.dataset.mode === "handle") armCollapse(); else if (wrap.dataset.mode === "always") armIdle(); });
  pill.addEventListener("focusin", () => clearTimeout(collapseTimer));
  pill.addEventListener("focusout", () => { if (wrap.dataset.mode === "handle") armCollapse(); });

  // always 模式：闲置半透明
  let idleTimer = null;
  function armIdle() {
    clearTimeout(idleTimer);
    pill.classList.remove("idle");
    idleTimer = setTimeout(() => pill.classList.add("idle"), 4000);
  }

  function applyMode(mode) {
    wrap.dataset.mode = mode === "always" || mode === "hidden" ? mode : "handle";
    wrap.classList.remove("open");
    clearTimeout(idleTimer); pill.classList.remove("idle"); // idle 是 always 专属态，防切回 handle 后残留半透明
    if (mode === "always") { refreshState(); armIdle(); }
  }

  chrome.storage.local.get({ displayMode: "handle" }, (v) => applyMode(v.displayMode));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch.displayMode) applyMode(ch.displayMode.newValue);
  });

  document.addEventListener("ams:switched", refreshState);
  let hostRefreshTimer = null;
  document.addEventListener("click", (e) => {
    if (e.composedPath && e.composedPath().includes(host)) return;
    clearTimeout(hostRefreshTimer);
    hostRefreshTimer = setTimeout(refreshState, 500); // 宿主原生控件切档后同步 HUD，不观察整页 DOM
  }, true);
  setTimeout(refreshState, 2500); // 页面载入后读一次初始档位

  function act(mode) {
    window.__AMS.runMode(mode);
    if (wrap.dataset.mode === "handle") armCollapse(); else armIdle();
  }
  btnT.addEventListener("click", () => act("think"));
  btnF.addEventListener("click", () => act("fast"));
})();
