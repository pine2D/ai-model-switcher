// scripts/lib/cdp-min.js — probe-drift / capture-evidence 共用的最小 CDP 客户端（node≥22 全局 WebSocket）。
// 不依赖 gitignored 的 scratchpad 工具。超时挂在**每次请求**上，socket 关闭/出错时拒绝全部未决请求——
// 会话级超时在 onopen resolve 之后是 no-op，后台标签挂起会让整轮采集静默丢失（2026-08-18 审查实证）。
"use strict";
const BASE = process.env.CDP_BASE || "http://127.0.0.1:9222";

async function listPages(timeoutMs = 5000) {
  const r = await fetch(BASE + "/json/list", { signal: AbortSignal.timeout(timeoutMs) });
  return (await r.json()).filter((t) => t.type === "page");
}
async function activate(id) {
  try { await fetch(BASE + "/json/activate/" + id, { signal: AbortSignal.timeout(5000) }); } catch (e) {}
  await new Promise((r) => setTimeout(r, 300)); // 激活到解冻是异步的，给渲染一拍
}
function wsSession(url, connectTimeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    const pending = new Map();
    const ctxs = [];
    let nextId = 10;
    const connectTimer = setTimeout(() => { try { sock.close(); } catch (e) {} reject(new Error("connect timeout")); }, connectTimeoutMs);
    const failAll = (why) => { for (const p of pending.values()) p.reject(new Error(why)); pending.clear(); };
    sock.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.method === "Runtime.executionContextCreated") ctxs.push(m.params.context);
      if (pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error("cdp: " + (m.error.message || m.error.code))) : p.resolve(m); // CDP 错误帧不作 resolve
      }
    };
    const send = (method, params, timeoutMs = 8000) => new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error("timeout")); }, timeoutMs);
      pending.set(id, { resolve: (m) => { clearTimeout(timer); res(m); }, reject: (e) => { clearTimeout(timer); rej(e); } });
      sock.send(JSON.stringify({ id, method, params }));
    });
    sock.onclose = () => failAll("socket closed");
    sock.onerror = () => { clearTimeout(connectTimer); failAll("ws error"); reject(new Error("ws error")); };
    sock.onopen = () => { clearTimeout(connectTimer); resolve({ send, ctxs, done: () => { try { sock.close(); } catch (e) {} } }); };
  });
}
// 在 PolyAsk 隔离世界求值；同名 world 可能有多个（导航后旧 context 未回收，docs/verify.md）：倒序逐个探 __AMS
async function evalInPolyAsk(target, expr) {
  const s = await wsSession(target.webSocketDebuggerUrl);
  try {
    await s.send("Runtime.enable", {});
    await new Promise((r) => setTimeout(r, 700));
    let ctx = null;
    for (const c of s.ctxs.filter((x) => /PolyAsk/i.test(x.name || "")).reverse()) {
      const probe = await s.send("Runtime.evaluate", { expression: "typeof __AMS", contextId: c.id, returnByValue: true });
      if ((((probe.result || {}).result) || {}).value === "object") { ctx = c; break; }
    }
    if (!ctx) return { err: "no_world" };
    const out = await s.send("Runtime.evaluate", { expression: expr, contextId: ctx.id, returnByValue: true });
    const r = out.result || {};
    if (r.exceptionDetails) return { err: "eval: " + String(r.exceptionDetails.text || "").slice(0, 120) };
    const value = (r.result || {}).value;
    return typeof value === "string" ? { value } : { err: "empty_result" };
  } finally { s.done(); }
}
module.exports = { BASE, listPages, activate, wsSession, evalInPolyAsk };
