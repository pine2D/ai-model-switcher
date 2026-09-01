import { ipcRenderer } from "electron";

import type {
  SiteCommand,
  SiteCommandResponse,
  SiteCommandEnvelope,
  SiteCollectionResult,
  SiteDiagnosticResponse,
  SiteGenerationResponse,
  SiteResponseEnvelope,
  SiteResult
} from "../shared/protocol";
import { parseGenerationState } from "../shared/protocol";
import { normalizeDiagnosticChecks } from "../shared/site-health";

type SendResponse = (response: unknown) => void;
type RuntimeListener = (
  message: unknown,
  sender: Record<string, never>,
  sendResponse: SendResponse
) => unknown;

const listeners: RuntimeListener[] = [];
const chromeShim = {
  i18n: { getUILanguage: () => navigator.language || "en" },
  storage: {
    local: {
      get: (defaults: Record<string, unknown>, callback: (value: Record<string, unknown>) => void) => {
        callback({ ...defaults });
      }
    },
    onChanged: { addListener: (_listener: unknown) => undefined }
  },
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

require("../../../i18n.js");
require("../../../content/core.js");
require("../../../content/send.js");
require("../../../content/upload.js");
require("../../../content/md.js");
require("../../../content/adapters-intl.js");
require("../../../content/adapters-intl2.js");
require("../../../content/adapters-cn.js");
require("../../../content/adapters-cn2.js");
require("../../../content/generation.js");
require("../../../content/diag.js");

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
  const listener = listeners[0];
  if (!listener) return Promise.resolve({ ok: false, code: "adapter_unavailable" });
  const remaining = Math.max(0, command.deadline - Date.now());
  if (remaining === 0) return Promise.resolve({ ok: false, code: "timeout" });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(command.cmd === "collect"
        ? normalizeCollection(value)
        : command.cmd === "diagnose" ? normalizeDiagnostic(value) : normalizeResult(value));
    };
    const timer = setTimeout(
      () => finish(command.cmd === "submitPrompt"
        ? { ok: false, code: "submit_unconfirmed" }
        : { code: "not_ready" }),
      remaining
    );
    try {
      const message = command.cmd === "collect"
        ? { source: "AMS", cmd: "collectAnswer" }
        : command.cmd === "diagnose" ? { source: "AMS", cmd: "diagnose" } : command;
      const asyncResponse = listener(message, {}, finish) === true;
      if (!asyncResponse && !settled) finish({ ok: false, code: "invalid_response" });
    } catch {
      finish({ ok: false, code: "error" });
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
