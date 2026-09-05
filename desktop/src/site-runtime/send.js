// desktop/src/site-runtime/send.js — 通用发送键定位（几何锚点 + 语义过滤）。core.js 的 submitPromptNow 调用它。
// 必须排在 desktop/src/site-runtime/core.js 之后（要读 window.__AMS），与适配器分卷先后无关。
// 两个真机坑决定了这里的写法，改之前先读：
// ① **纵向锚点不能取编辑节点本身**：Claude 的 ProseMirror 随行数无限长高并溢出它的裁剪容器，
//    而发送键贴的是裁剪容器的下沿。用编辑节点的 top 作锚，|send.top - composer.top| 随行数线性增长
//    （真机 2026-08-31：空框 57、8 行 189、15 行 343），越过 240 带后整条按钮路径失效。
//    改取「最近的裁剪祖先」的盒子，并以它的 bottom 而非 top 作下沿锚点。
// ② **同一选择器会命中侧栏假按钮**：claude.ai 每条会话一个 `More options for <标题>` 按钮，
//    标题含 send/发送 时就匹配，且文档序在输入框之前、纵向也落在带内（真机 2026-08-31 带内 9 个）。
//    它在另一列，横向差着几百像素——所以按「横向离输入区的距离」择优。
//    **横向必须量到编辑节点自身，不能量到裁剪祖先**：祖先若是整页/整列容器（横跨侧栏），
//    假按钮的中心也落在它的横向区间里，双方距离同为 0，只能由文档序裁决，而侧栏在前——
//    那会比旧实现更差（旧实现的窄纵向带本来能挡掉它）。纵向取祖先、横向取自身，两者不共用一个盒子。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;
  const SEL = 'button[data-testid*="send" i], button[aria-label*="send" i], button[aria-label*="发送"]';
  const BAND = 240;   // 纵向容差，沿用既有值
  const TIE = 40;     // 横向「算同一簇」的容差：约一个发送键的宽度。**不设绝对的远近阈值**——
                      // 窗口越窄各列挨得越近，任何写死的像素数都会在某个宽度上翻车

  // 最近的裁剪祖先（overflow 非 visible）；找不到就用元素自己。上溯 8 层足够，再多就是页面骨架了。
  function anchorRect(el) {
    let box = el;
    for (let n = el.parentElement, i = 0; n && i < 8; n = n.parentElement, i++) {
      let style;
      try { style = getComputedStyle(n); } catch (e) { break; }
      if (!style) break;
      if (style.overflowY !== "visible" || style.overflowX !== "visible") { box = n; break; }
    }
    return box.getBoundingClientRect();
  }

  // aria-disabled 也要认：不少站把发送键做成 div/button + aria-disabled，原生 disabled 恒 false。
  function usable(b) { return !b.disabled && (!b.getAttribute || b.getAttribute("aria-disabled") !== "true"); }

  // 候选中心到输入区横向区间的距离；落在区间内即 0。
  function offset(r, cr) {
    const cx = r.left + r.width / 2;
    return cx < cr.left ? cr.left - cx : cx > cr.right ? cx - cr.right : 0;
  }

  // 返回本站此刻的发送键，找不到返回 null。**保守优先**：横向近处无候选时退回旧行为的候选集，
  // 只是多一层「跳过不可用项」——绝不会比改动前少找到一个按钮。
  S.sendBtn = function (el) {
    const composer = (S.findComposer && S.findComposer()) || el;
    if (!composer || typeof composer.getBoundingClientRect !== "function") return null;
    const cr = anchorRect(composer);        // 纵向锚点：裁剪祖先
    const hr = composer.getBoundingClientRect(); // 横向锚点：编辑节点自身
    const hits = [].slice.call(document.querySelectorAll(SEL))
      .map(function (b) { return { b: b, r: b.getBoundingClientRect() }; })
      .filter(function (x) {
        return x.r.width > 0 && x.r.height > 0 &&
          x.r.top > cr.top - BAND && x.r.top < cr.bottom + BAND;
      });
    if (!hits.length) return null;
    // 取横向最近的那一簇（真发送键恒在输入区内或紧贴其边，offset 近 0；侧栏假按钮在另一列，
    // 差着整个栏宽）。簇内再优先可用项——首命中不可用就整轮放弃按钮路径是旧实现的另一个缺陷。
    // 全簇都不可用时仍返回其中第一个：调用点的 `btn && !btn.disabled` 会拦下它并落到 Enter 兜底。
    const sorted = hits.slice().sort(function (p, q) { return offset(p.r, hr) - offset(q.r, hr); });
    const best = offset(sorted[0].r, hr);
    const tie = sorted.filter(function (x) { return offset(x.r, hr) <= best + TIE; });
    const pick = tie.filter(function (x) { return usable(x.b); })[0] || sorted[0];
    return pick.b;
  };
}());
