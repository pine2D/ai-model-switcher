// console/archive-stats.js — 结果库「站点健康统计」：只读聚合归档 results[].code（收集层失败）。
// no_answer 集中出现 ≈ 该站 answer() 锚点漂移（回答抓取层），这是唯一来自用户真机的维护信号；
// 发送层失败不落盘，本视图有意不含（数据口径见 bg/data.js 的 archiveFailStats 注释与面板内说明行）。
// 依赖 archive.js 顶层的 ARCH_ERR_KEYS 与 sites.js 的 SITES（classic script 全局词法作用域），
// 故本文件必须排在两者之后加载。渲染全程 textContent 组装，无注入面。
(function () {
  const details = document.getElementById("ar-stats");
  const box = document.getElementById("ar-stats-body");
  if (!details || !box) return;
  function cell(row, tag, text) { const n = document.createElement(tag); n.textContent = text; row.appendChild(n); }
  function render(stats) {
    box.replaceChildren();
    if (!stats.length) { box.textContent = t("arc_statsEmpty"); return; }
    const table = document.createElement("table");
    const head = document.createElement("tr");
    ["arc_statsSite", "arc_statsCollects", "arc_statsNoAnswer", "arc_statsOtherFail", "arc_statsLastFail"].forEach((key) => cell(head, "th", t(key)));
    table.appendChild(head);
    for (const s of stats) {
      const tr = document.createElement("tr");
      const noAnswer = s.codes.no_answer || 0;
      const other = Object.entries(s.codes).reduce((sum, [code, n]) => (code === "no_answer" ? sum : sum + n), 0);
      // label 以 SITES 为权威（归档里的 label 是历史快照，早期条目可能缺失或用旧站名）
      cell(tr, "td", (SITES.find((site) => site.host === s.host) || {}).label || s.label);
      cell(tr, "td", String(s.total));
      cell(tr, "td", noAnswer ? String(noAnswer) : "—");
      cell(tr, "td", other ? String(other) : "—");
      const codeText = s.lastFailCode ? t(ARCH_ERR_KEYS[s.lastFailCode] || "con_errGeneric") : null;
      // 时间戳缺失（迁移/远端历史条目可无 ts/createdAt）时只显示错误名，不渲染 1970 假日期
      cell(tr, "td", codeText ? (s.lastFailTs > 0 ? new Date(s.lastFailTs).toLocaleDateString(document.documentElement.lang || undefined) + " · " + codeText : codeText) : "—");
      table.appendChild(tr);
    }
    box.appendChild(table);
  }
  function refresh() {
    chrome.runtime.sendMessage({ source: "AMS_DATA", action: "archiveFailStats" }, (res) => {
      void chrome.runtime.lastError;
      // 失败态与空态分开：把加载失败伪装成「暂无数据」会让用户去存更多结果而不是重试
      if (!res || !res.ok) { box.textContent = t("arc_loadFailed"); return; }
      render(res.stats || []);
    });
  }
  let refreshTimer = 0;
  function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 500); } // 归档批量写入时合并重扫
  details.addEventListener("toggle", () => { if (details.open) refresh(); });
  chrome.runtime.onMessage.addListener((msg) => {
    if (details.open && msg && msg.source === "AMS_DATA" && msg.type === "archiveChanged") refreshSoon();
  });
  document.addEventListener("i18n:changed", () => { if (details.open) refresh(); });
})();
