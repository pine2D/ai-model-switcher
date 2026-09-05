// desktop/src/renderer/shell-api.ts
// 渲染层唯一的 IPC 门面：组件与 hook 只认 `shell`，不再直接摸 window.polyask。
// 好处只有一个但很关键——测试可以用 setShellApi() 注入桩，让 App 与各 hook 能在 node --test
// 里真实实例化，而不是靠 readFileSync 正则守着源码。真源仍是 preload/shell.ts 的 PolyAskDesktopApi。
import type { PolyAskDesktopApi } from "../preload/shell";

let injected: PolyAskDesktopApi | null = null;

/** 测试注入点；传 null 恢复为读取 window.polyask。 */
export function setShellApi(api: PolyAskDesktopApi | null): void {
  injected = api;
}

// 按属性访问时才解析目标：模块加载时 window.polyask 在 node 里不存在，惰性求值让两种环境都能 import。
export const shell: PolyAskDesktopApi = new Proxy({} as PolyAskDesktopApi, {
  get(_target, key) {
    const api = injected ?? window.polyask;
    return api[key as keyof PolyAskDesktopApi];
  }
});
