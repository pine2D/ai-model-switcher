#!/usr/bin/env node
// desktop/scripts/audit-runtime.mjs
//
// F229：`npm audit --omit=dev` 在 Electron 项目里天生看不到 electron 本身——按 npm 惯例它
// 永远是 devDependency（desktop/package.json 的 dependencies 只有 electron-squirrel-startup /
// react / react-dom 三项），却是随每个发行包一起分发的实际运行时。`--omit=dev` 的覆盖面对
// 这一项恒为零，不是"今天漏了"，是这道门禁天然看不见它。
//
// 这个脚本反过来做：跑一次不带 --omit 的完整 `npm audit --json`，只挑「真的会随应用打进
// 制品」的运行时包看 high/critical——electron 本身，以及非 Forge 工具链的 @electron/* 命名空间
// 包；@electron-forge/*、@electron/packager、@electron/rebuild、@electron/node-gyp 是 Forge
// 构建工具链自身在用的依赖，只在打包期跑、不进 app.asar，混进来会把这道门禁在今天就永久卡红
// （2026-08 实测这三个工具链包合计有多条 high 公告，而 electron 本身当时是 0）。
//
// 用法：node desktop/scripts/audit-runtime.mjs（从仓库任意目录跑都行，自己定位到 desktop/ 根）。
// 不是 *.test.mjs，不会被 `npm test`（node --test scripts/*.test.mjs）拾取。

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DESKTOP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 命名空间是 @electron/ 但只在构建期跑、不进 app.asar 的工具链包，见上方文件头注释。
const BUILD_TIME_ELECTRON_SCOPE = new Set([
  "@electron/rebuild",
  "@electron/packager",
  "@electron/node-gyp",
]);

function isRuntimeElectronPackage(name) {
  if (name === "electron") return true;
  return name.startsWith("@electron/") && !BUILD_TIME_ELECTRON_SCOPE.has(name);
}

function runAudit() {
  try {
    const out = execFileSync("npm", ["audit", "--json"], {
      cwd: DESKTOP_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (err) {
    // npm audit 只要存在任何漏洞就退出非零；JSON 报告本身仍写在 stdout，
    // 只有连 stdout 都解析不出 JSON 才是真的执行失败（网络/registry 不可达等）。
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {
        // 继续走下面的失败分支
      }
    }
    console.error("✗ npm audit 执行失败，且未产出可解析的 JSON：", err.message);
    process.exit(1);
  }
}

const report = runAudit();
const vulns = report.vulnerabilities || {};
const entries = Object.values(vulns).filter((v) => isRuntimeElectronPackage(v.name));
const hits = entries.filter((v) => v.severity === "high" || v.severity === "critical");

if (hits.length > 0) {
  console.error("✗ Electron 运行时依赖存在 high/critical 漏洞公告：");
  for (const hit of hits) {
    console.error(`    ${hit.name} (${hit.severity})  ${hit.range || ""}`);
  }
  console.error("这些包会随应用打进发行制品，不受 `npm audit --omit=dev` 覆盖，需要人工评估升级。");
  process.exit(1);
}

console.log(
  entries.length > 0
    ? `✓ Electron 运行时依赖无 high/critical 漏洞（已排查：${entries.map((v) => v.name).join(", ")}）`
    : "✓ Electron 运行时依赖（electron 本身及非工具链的 @electron/* 包）无漏洞公告"
);
