// content/upload.js — 图片载荷校验、File 重建、文件输入/拖放与附件就绪确认。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;

  const MAX_COUNT = 4;
  const MAX_BYTES = 10 * 1024 * 1024;
  const TYPES = new Set(["image/png", "image/jpeg"]);
  const CANDIDATES = 'img,canvas,[class*="attach"],[class*="upload"],[class*="preview"]';

  async function decodeImage(payload) {
    if (!payload || !TYPES.has(payload.type) || !Number.isInteger(payload.size) ||
        payload.size < 1 || payload.size > MAX_BYTES ||
        typeof payload.dataUrl !== "string" || payload.dataUrl.length > Math.ceil(MAX_BYTES * 4 / 3) + 64) return null;
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload.dataUrl);
    if (!match || match[1] !== payload.type) return null;
    try {
      const raw = atob(match[2]);
      if (raw.length !== payload.size) return null;
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
      const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (payload.type === "image/png" ? !png : !jpeg) return null;
      const fallback = payload.type === "image/png" ? "image.png" : "image.jpg";
      const name = String(payload.name || fallback).split(/[\\/]/).pop().slice(0, 128) || fallback;
      const file = new File([bytes], name, { type: payload.type, lastModified: Date.now() });
      const bitmap = await createImageBitmap(file);
      if (bitmap && typeof bitmap.close === "function") bitmap.close();
      return file;
    } catch (e) { return null; }
  }

  function anchorRect(composer) {
    try {
      const r = composer.getBoundingClientRect();
      return { left: r.left - 80, right: r.right + 80, top: r.top - 420, bottom: r.bottom + 120 };
    } catch (e) { return null; }
  }
  function visibleNear(el, anchor) {
    if (!anchor || !el || typeof el.getBoundingClientRect !== "function") return false;
    try {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" &&
        s.opacity !== "0" && r.right >= anchor.left && r.left <= anchor.right &&
        r.bottom >= anchor.top && r.top <= anchor.bottom;
    } catch (e) { return false; }
  }
  function attr(el, name) {
    try { return el.getAttribute(name) || ""; } catch (e) { return ""; }
  }
  function token(el) {
    let bg = "";
    try { bg = getComputedStyle(el).backgroundImage || ""; } catch (e) {}
    let child = false, r = { width: 0, height: 0 };
    try { child = !!(el.querySelector && el.querySelector("img,canvas")); r = el.getBoundingClientRect(); } catch (e) {}
    const cls = typeof el.className === "string" ? el.className : "";
    const label = [attr(el, "aria-label"), attr(el, "title"), attr(el, "alt"), (el.textContent || "").trim().slice(0, 120)].join("|");
    const visual = /^(IMG|CANVAS)$/.test(el.tagName || "") && r.width >= 40 && r.height >= 40;
    const container = /attach|upload|preview/i.test(cls) && (child || /\.(png|jpe?g)\b/i.test(label) || /^url\(/i.test(bg));
    if (!visual && !container) return "";
    return [
      el.tagName || "", el.src || attr(el, "src"), attr(el, "aria-label"), attr(el, "title"), attr(el, "alt"),
      cls, (el.textContent || "").trim().slice(0, 120), bg,
    ].join("|");
  }
  function snapshot(anchor) {
    const tokens = new Set([...document.querySelectorAll(CANDIDATES)]
      .filter((el) => visibleNear(el, anchor)).map(token).filter(Boolean));
    const busy = [...document.querySelectorAll('[role="progressbar"],[aria-busy="true"],[class*="loading"],[class*="spinner"]')]
      .some((el) => visibleNear(el, anchor));
    const errors = new Set([...document.querySelectorAll('[role="alert"]')].filter((el) => {
      if (!visibleNear(el, anchor)) return false;
      return /upload|image|file|图片|文件|格式|大小|失败/i.test(el.textContent || "");
    }).map(token));
    return { tokens, busy, errors };
  }
  async function waitAttachments(anchor, before, deadline, fileNames) {
    let candidate = "", since = 0;
    const t0 = Date.now();
    while (Date.now() < deadline) {
      const current = snapshot(anchor);
      if ([...current.errors].some((value) => !before.errors.has(value))) return false;
      const added = [...current.tokens].filter((value) => !before.tokens.has(value));
      const named = fileNames.every((name) => added.some((value) => value.includes(name)));
      // busy 最多压制 5s：DeepSeek 传完后仍常驻一个 .ds-loading（真机 2026-08-14），老条件
      // (!current.busy || before.busy) 会一路等到超时返回 attachment_timeout，文字压根来不及注入。
      const blocked = current.busy && !before.busy && Date.now() - t0 < 5000;
      if ((named || added.length >= fileNames.length) && !blocked) {
        const signature = added.sort().join("\n");
        if (signature !== candidate) { candidate = signature; since = Date.now(); }
        else if (Date.now() - since >= 400) return true;
      } else { candidate = ""; since = 0; }
      await S.sleep(Math.min(120, Math.max(0, deadline - Date.now())));
    }
    return false;
  }

  async function setInputFiles(input, files, composer, deadline) {
    if (!input || !files || !files.length) return false;
    const anchor = anchorRect(composer), before = snapshot(anchor);
    try {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { return false; }
    return waitAttachments(anchor, before, Number(deadline) || Date.now() + 15000, files.map((file) => file.name));
  }
  async function dropFiles(target, files, composer, deadline) {
    if (!target || !files || !files.length) return false;
    const anchor = anchorRect(composer), before = snapshot(anchor);
    try {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, dataTransfer: transfer,
        }));
      }
    } catch (e) { return false; }
    return waitAttachments(anchor, before, Number(deadline) || Date.now() + 15000, files.map((file) => file.name));
  }
  async function uploadImages(payloads, adapter, composer, deadline) {
    if (!Array.isArray(payloads) || !payloads.length || payloads.length > MAX_COUNT)
      return { ok: false, code: "image_invalid" };
    const files = await Promise.all(payloads.map(decodeImage));
    if (files.some((file) => !file) || files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES)
      return { ok: false, code: "image_invalid" };
    if (!adapter || typeof adapter.attach !== "function")
      return { ok: false, code: "attachment_unsupported" };
    const end = Number(deadline) || Date.now() + 15000;
    if (Date.now() >= end) return { ok: false, code: "attachment_timeout" };
    try {
      const ok = await adapter.attach(files, composer, end);
      if (typeof ok === "string") return { ok: false, code: ok };
      if (ok) return { ok: true };
      return { ok: false, code: Date.now() >= end ? "attachment_timeout" : "attachment_failed" };
    } catch (e) { return { ok: false, code: "attachment_failed" }; }
  }

  Object.assign(S, { uploadImages, setInputFiles, dropFiles });
})();
