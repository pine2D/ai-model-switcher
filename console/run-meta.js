// console/run-meta.js — Compose 与控制台之间一次性传递的运行元数据。
const RunMeta = (() => {
  const KEY = "amsPendingRun";

  function jsonValue(value, seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    const valid = (Array.isArray(value) || Object.prototype.toString.call(value) === "[object Object]") && Object.keys(value).every((key) => jsonValue(value[key], seen));
    seen.delete(value);
    return valid;
  }
  function valid(payload) {
    try {
      return !!payload && typeof payload.text === "string" && typeof payload.task === "string" && (payload.source === null || typeof payload.source === "object" && jsonValue(payload.source));
    } catch (error) { return false; }
  }
  function session(method, value) {
    return new Promise((resolve, reject) => chrome.storage.session[method](value, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(result || {});
    }));
  }
  function savePending(payload) {
    if (!valid(payload)) return Promise.reject(new TypeError("invalid run metadata"));
    return session("set", { [KEY]: { text: payload.text, task: payload.task, source: payload.source } });
  }
  async function resolve(text) {
    let values, readError;
    try { values = await session("get", KEY); } catch (error) { readError = error; }
    await session("remove", KEY);
    if (readError) throw readError;
    const pending = values[KEY];
    return valid(pending) && pending.text === text ? { task: pending.task, source: pending.source } : { task: text, source: null };
  }
  function clearPending() { return session("remove", KEY); }

  return { savePending, resolve, clearPending };
})();
