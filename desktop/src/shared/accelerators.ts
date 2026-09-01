// Electron 对同一个组合会吐出多种写法（CommandOrControl / CmdOrCtrl / Command / Control），
// 归一后才能把菜单读来的加速器与 COMMANDS 表里的写法对账去重。
// mac 上 CmdOrCtrl 是 ⌘，其余平台是 Ctrl。
export function normalizeAccelerator(accelerator: string, isMac = false): string {
  const primary = isMac ? "cmd" : "ctrl";
  return accelerator
    .split("+")
    .map((part) => {
      const token = part.trim().toLowerCase();
      if (["commandorcontrol", "cmdorctrl"].includes(token)) return primary;
      if (["command", "cmd", "super", "meta"].includes(token)) return "cmd";
      if (["control", "ctrl"].includes(token)) return "ctrl";
      if (["option", "alt"].includes(token)) return "alt";
      if (token === "plus") return "+";
      return token;
    })
    .join("+");
}
