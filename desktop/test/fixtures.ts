// desktop/test/fixtures.ts
// 测试共享夹具与源码读取工具。故意不以 .test.ts 命名：node --test 每个用例文件一进程，
// 从 *.test.ts 里 import 夹具会把该文件的 test() 在每个引用方各注册一遍（曾让 4 例跑 5 遍）。
import { readFileSync } from "node:fs";
import path from "node:path";

import { createArchiveRecord } from "../src/shared/archive";

const DESKTOP_ROOT = path.join(__dirname, "..");

/** 按 desktop/ 根的相对路径读源码；走模块相对路径，守卫测试从任何 cwd 跑结果一致。 */
export function readSource(relativePath: string): string {
  return readFileSync(path.join(DESKTOP_ROOT, relativePath), "utf8");
}

export function archiveFixture() {
  return createArchiveRecord({
    text: "Why is the sky blue?",
    task: "Why is the sky blue?",
    results: [
      { host: "claude.ai", label: "Claude", text: "Rayleigh scattering." },
      { host: "chatgpt.com", label: "ChatGPT", text: null, code: "no_answer" }
    ],
    createdAt: 1_000
  }, { id: "archive-a", now: 1_000, deviceId: "device-a" });
}
