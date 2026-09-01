import { Menu } from "electron";


import { normalizeAccelerator } from "../shared/accelerators";
import type { MenuShortcut } from "../shared/protocol";

// 菜单里带 role 的项（重新加载、缩放、全屏、撤销/复制/粘贴、退出…）的加速器由 Electron 自己给，
// 不写在模板里，因此也不在 COMMANDS 表里——快捷键速查只渲染 COMMANDS，就永远漏掉它们。
// 真机实测（Electron 43.4.0）：Menu.getApplicationMenu() 能读出这些 role 项的 label 与 accelerator
// （Quit → CommandOrControl+Q、Reload → CmdOrCtrl+R、Toggle Full Screen → F11 …），
// 所以速查直接从**真实菜单**读，menu 与速查从此不可能漂开。
interface MenuLike {
  readonly items: readonly MenuItemLike[];
}

interface MenuItemLike {
  readonly label?: string;
  readonly type?: string;
  readonly visible?: boolean;
  readonly accelerator?: string;
  readonly submenu?: MenuLike;
}

export function collectMenuShortcuts(menu: MenuLike | null): MenuShortcut[] {
  if (!menu) return [];
  const shortcuts: MenuShortcut[] = [];
  for (const top of menu.items) {
    const group = (top.label || "").trim();
    for (const item of top.submenu?.items ?? []) {
      if (item.type === "separator" || item.visible === false) continue;
      const label = (item.label || "").trim();
      const accelerator = (item.accelerator || "").trim();
      if (!group || !label || !accelerator) continue;
      shortcuts.push({ group, label, accelerator });
    }
  }
  return shortcuts;
}

export function applicationMenuShortcuts(): MenuShortcut[] {
  return collectMenuShortcuts(Menu.getApplicationMenu() as unknown as MenuLike | null);
}

export { normalizeAccelerator };
