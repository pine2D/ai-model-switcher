import { ipcRenderer } from "electron";

import type {
  SiteCommand,
  SiteCommandResponse,
  SiteCommandEnvelope,
  SiteCollectionResult,
  SiteDiagnosticResponse,
  SiteGenerationResponse,
  SiteResponseEnvelope,
  SiteResult,
  SiteSubmittedResponse
} from "../shared/protocol";
import { normalizeSubmitted, parseGenerationState } from "../shared/protocol";
import { resolveLocale } from "../shared/locale";
import { normalizeDiagnosticChecks } from "../shared/site-health";

type SendResponse = (response: unknown) => void;
type RuntimeListener = (
  message: unknown,
  sender: Record<string, never>,
  sendResponse: SendResponse
) => unknown;

const listeners: RuntimeListener[] = [];
// 站点运行时只用到 chrome.runtime.onMessage 这一条 API（core.js 用它收命令）。语言不再经 chrome.i18n /
// storage 让 i18n.js 自己猜，而是下面 require 完成后由外壳单向注入——locale 解析全应用只有 shared/locale.ts 一份。
const chromeShim = {
  runtime: {
    onMessage: {
      addListener: (listener: RuntimeListener) => { listeners.push(listener); }
    }
  }
};

Object.defineProperty(globalThis, "chrome", {
  value: chromeShim,
  configurable: false,
  enumerable: false,
  writable: false
});

require("../site-runtime/i18n.js");
require("../site-runtime/core.js");
require("../site-runtime/send.js");
require("../site-runtime/upload.js");
require("../site-runtime/md.js");
require("../site-runtime/adapters-intl.js");
require("../site-runtime/adapters-intl2.js");
require("../site-runtime/adapters-cn.js");
require("../site-runtime/adapters-cn2.js");
require("../site-runtime/generation.js");
require("../site-runtime/diag.js");

(globalThis as typeof globalThis & { __AMS_I18N__?: { setLang?: (lang: string) => void } })
  .__AMS_I18N__?.setLang?.(resolveLocale(navigator.language || "en"));

function normalizeResult(value: unknown): SiteResult {
  if (!value || typeof value !== "object") return { ok: false, code: "invalid_response" };
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.ok !== "boolean") return { ok: false, code: "invalid_response" };
  const result: SiteResult = { ok: candidate.ok };
  if (typeof candidate.code === "string") return { ...result, code: candidate.code.slice(0, 64) };
  return result;
}

// 码点上限：远超任何真实回答长度，只挡病态注入（撑爆 DOM 反灌回来的巨串）；
// 超限不静默丢弃——改用 answer_truncated code 携带截断事实，由 copy.answerTruncated 三语提示。
const TEXT_LIMIT = 1_000_000;

function boundText(text: string): { readonly value: string; readonly truncated: boolean } {
  if (text.length <= TEXT_LIMIT) return { value: text, truncated: false }; // 码点数 <= UTF-16 单元数，快速放行常见情形
  const points = [...text];
  return points.length > TEXT_LIMIT
    ? { value: points.slice(0, TEXT_LIMIT).join(""), truncated: true }
    : { value: text, truncated: false };
}

function normalizeCollection(value: unknown): SiteCollectionResult {
  if (!value || typeof value !== "object") return { code: "no_answer" };
  const candidate = value as Record<string, unknown>;
  const raw = typeof candidate.text === "string" && candidate.text.trim() ? candidate.text : undefined;
  const state = typeof candidate.state === "string" ? candidate.state.slice(0, 64) : undefined;
  const code = typeof candidate.code === "string" ? candidate.code.slice(0, 64) : undefined;
  const bounded = raw ? boundText(raw) : null;
  return {
    ...(bounded ? { text: bounded.value } : {}),
    ...(state ? { state } : {}),
    ...(!bounded ? { code: code || "no_answer" } : bounded.truncated ? { code: "answer_truncated" } : code ? { code } : {})
  };
}

function normalizeDiagnostic(value: unknown): SiteDiagnosticResponse {
  if (!value || typeof value !== "object") return { code: "not_ready" };
  const checks = normalizeDiagnosticChecks((value as Record<string, unknown>).checks);
  return checks.length ? { checks } : { code: "not_ready" };
}

function readGeneration(): SiteGenerationResponse {
  const runtime = (globalThis as typeof globalThis & {
    __AMS?: { adapters?: Record<string, { generation?: () => unknown }> };
  }).__AMS;
  const host = location.hostname;
  const key = Object.keys(runtime?.adapters ?? {}).find((candidate) => host.includes(candidate));
  const adapter = key ? runtime?.adapters?.[key] : undefined;
  try {
    return { state: parseGenerationState(adapter?.generation?.()) };
  } catch {
    return { state: null };
  }
}

function dispatch(command: SiteCommand): Promise<SiteCommandResponse> {
  if (command.cmd === "generation") return Promise.resolve(readGeneration());
  // wasSubmitted 的每一个失败出口都是「不支持」：超时、无适配器、异常、形状不对，一律不能被读成「确认未提交」。
  const probing = command.cmd === "wasSubmitted";
  const unsupported: SiteSubmittedResponse = { supported: false, ok: false };
  if (!listeners.length) return Promise.resolve(probing ? unsupported : { ok: false, code: "adapter_unavailable" });
  const remaining = Math.max(0, command.deadline - Date.now());
  if (remaining === 0) return Promise.resolve(probing ? unsupported : { ok: false, code: "timeout" });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(command.cmd === "collect"
        ? normalizeCollection(value)
        : command.cmd === "diagnose" ? normalizeDiagnostic(value)
          : probing ? normalizeSubmitted(value) : normalizeResult(value));
    };
    const timer = setTimeout(
      () => finish(command.cmd === "submitPrompt"
        ? { ok: false, code: "submit_unconfirmed" }
        : probing ? unsupported : { code: "not_ready" }),
      remaining
    );
    try {
      const message = command.cmd === "collect"
        ? { source: "AMS", cmd: "collectAnswer" }
        : command.cmd === "diagnose" ? { source: "AMS", cmd: "diagnose" } : command;
      // 逐个分发：某个监听器返回 true（会异步 sendResponse）或已同步作答就停；没有任何监听器接手才判 invalid_response。
      // 「有且只有一个监听器」由 desktop/scripts/desktop-shared-runtime.test.js 离线数 addListener 调用点守着，
      // 绝不在这里硬断言——模块作用域一抛，下面的 site-command 监听就注册不上，九站整链失守。
      const claimed = listeners.some((listener) => listener(message, {}, finish) === true || settled);
      if (!claimed && !settled) finish(probing ? unsupported : { ok: false, code: "invalid_response" });
    } catch {
      finish(probing ? unsupported : { ok: false, code: "error" });
    }
  });
}

ipcRenderer.on("polyask:site-command", async (_event, envelope: SiteCommandEnvelope) => {
  if (!envelope || typeof envelope.requestId !== "string" || !envelope.command) return;
  const response: SiteResponseEnvelope = {
    requestId: envelope.requestId,
    result: await dispatch(envelope.command)
  };
  ipcRenderer.send("polyask:site-response", response);
});
