// desktop/src/shared/ipc-error.ts
// 主进程 handler 抛出的裸码（如 target_not_selected）经 ipcRenderer.invoke 到达渲染层时，会被 Electron
// 包成 "Error invoking remote method 'polyask:x': Error: target_not_selected"。渲染层按 error.message
// 逐条比对码，前缀不剥就永远匹配不上，已写好的三语文案实际不可达。这里是唯一的还原点。
const REMOTE_METHOD_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;

export function ipcErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.replace(REMOTE_METHOD_PREFIX, "").trim();
}
