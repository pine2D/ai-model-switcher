import { ipcRenderer } from "electron";

import type {
  SiteCommand,
  SiteCommandEnvelope,
  SiteResponseEnvelope,
  SiteResult
} from "../shared/protocol";

type SendResponse = (response: unknown) => void;
type RuntimeListener = (
  message: SiteCommand,
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
require("../../../content/upload.js");
require("../../../content/md.js");
require("../../../content/adapters-intl.js");
require("../../../content/adapters-cn.js");
require("../../../content/adapters-cn2.js");
require("../../../content/diag.js");

function normalizeResult(value: unknown): SiteResult {
  if (!value || typeof value !== "object") return { ok: false, code: "invalid_response" };
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.ok !== "boolean") return { ok: false, code: "invalid_response" };
  const result: SiteResult = { ok: candidate.ok };
  if (typeof candidate.code === "string") return { ...result, code: candidate.code.slice(0, 64) };
  return result;
}

function dispatch(command: SiteCommand): Promise<SiteResult> {
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
      resolve(normalizeResult(value));
    };
    const timer = setTimeout(
      () => finish({ ok: false, code: "submit_unconfirmed" }),
      remaining
    );
    try {
      const asyncResponse = listener(command, {}, finish) === true;
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
