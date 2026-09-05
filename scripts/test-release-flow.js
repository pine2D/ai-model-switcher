const assert = require("assert");
const fs = require("fs");

const desktopPackage = JSON.parse(fs.readFileSync("desktop/package.json", "utf8"));
const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const portableArchive = fs.readFileSync("desktop/scripts/archive-portable.ps1", "utf8");
const prepareRelease = fs.readFileSync("scripts/prepare-release.sh", "utf8");
const releaseScript = fs.readFileSync("scripts/release.sh", "utf8");

assert.strictEqual(desktopPackage.scripts.make, "electron-forge make", "Desktop 必须提供 make 命令");
assert.ok(desktopPackage.scripts["collect-release"], "Desktop 必须提供发布产物归档命令");
assert.ok(desktopPackage.scripts["prepare-portable"], "Desktop 必须提供 portable 目录准备命令");

for (const dependency of [
  "@electron-forge/maker-squirrel",
  "@electron-forge/maker-deb",
  "@electron-forge/maker-zip"
]) {
  assert.ok(desktopPackage.devDependencies[dependency], `Desktop 缺少 ${dependency}`);
}

for (const marker of [
  "windows-x64",
  "maker: \"@electron-forge/maker-squirrel\"",
  "linux-x64",
  "macos-x64",
  "macos-arm64",
  "vars.POLYASK_GOOGLE_DESKTOP_CLIENT_ID",
  "secrets.POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET",
  "actions/upload-artifact",
  "actions/download-artifact",
  "release-assets",
  "archive-portable.ps1"
]) {
  assert.ok(workflow.includes(marker), `Release workflow 缺少 ${marker}`);
}

// F192/F196：权限最小化与 timeout-minutes/concurrency 结构性断言——按已知的固定作业顺序切片，
// 不引入 YAML 解析依赖（本仓无 node_modules，没有可用的 YAML 库）；作业若重排需要同步改这里的切片点。
function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.ok(start !== -1, `找不到标记：${startMarker}`);
  const from = start + startMarker.length;
  const end = endMarker ? text.indexOf(endMarker, from) : text.length;
  assert.ok(end !== -1, `找不到标记：${endMarker}`);
  return text.slice(from, end === -1 ? text.length : end);
}
{
  const top = sliceBetween(workflow, "\npermissions:\n", "\njobs:\n");
  assert.match(top, /^\s+contents: read\s*$/m, "release.yml 顶层权限必须降为 contents: read");
  assert.ok(!/contents: write/.test(top), "release.yml 顶层不得再声明 contents: write");
  assert.match(top, /cancel-in-progress:\s*false/, "release.yml 的 concurrency 必须是 cancel-in-progress: false（半途失败要能重跑补齐）");

  const validate = sliceBetween(workflow, "\n  validate:\n", "\n  desktop:\n");
  assert.match(validate, /permissions:\s*\n\s+contents: read\s*\n\s+actions: read/, "validate 作业必须显式保留 actions: read（gh run list 依赖它）");
  assert.match(validate, /timeout-minutes:\s*\d+/, "validate 作业缺少 timeout-minutes");
  // Release 正文由 validate 产出并以 artifact 交给 publish；漏上传 = 推 tag 后 publish 才炸，且 tag 不可覆盖
  assert.match(validate, /bash scripts\/release\.sh --build-only/, "validate 必须跑 release.sh --build-only 产出 Release 正文");
  assert.match(validate, /name: release-notes\s*\n\s+path: dist\/release-notes\.md\s*\n\s+if-no-files-found: error/, "validate 必须以 if-no-files-found: error 上传 release-notes artifact");
  assert.doesNotMatch(workflow, /\n  extension:\n/, "extension 作业已随扩展删除，不得残留");

  const desktop = sliceBetween(workflow, "\n  desktop:\n", "\n  publish:\n");
  assert.match(desktop, /permissions:\s*\n\s+contents: read/, "desktop 作业权限必须降为 contents: read");
  assert.match(desktop, /timeout-minutes:\s*\d+/, "desktop 作业缺少 timeout-minutes");

  const publish = sliceBetween(workflow, "\n  publish:\n", null);
  assert.match(publish, /permissions:\s*\n\s+contents: write/, "publish 作业必须保留 contents: write（发布 Release 需要）");
  assert.match(publish, /timeout-minutes:\s*\d+/, "publish 作业缺少 timeout-minutes");
  assert.match(publish, /needs: \[validate, desktop\]/, "publish 只依赖 validate 与 desktop");
  assert.doesNotMatch(publish, /polyask-v\*\.zip/, "publish 的 files 不得再含扩展 ZIP——fail_on_unmatched_files 会让 Desktop-only 发版在最后一步炸掉");
  assert.match(publish, /files: \|\s*\n\s+release-assets\/polyask-desktop-\*\s*\n/, "publish 只发布 Desktop 包");
  assert.match(publish, /fail_on_unmatched_files: true/, "publish 必须保留 fail_on_unmatched_files: true");
  assert.match(publish, /body_path: release-assets\/release-notes\.md/);
  // 不烧版本号的验证入口：手动触发默认 dry_run，走完汇总核对但不创建 Release
  assert.match(workflow, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+dry_run:/, "release.yml 必须提供 workflow_dispatch(dry_run)");
  assert.match(publish, /if: inputs\.dry_run != true\s*\n\s+uses: softprops\/action-gh-release/, "dry_run 时不得创建 Release");
  assert.match(publish, /release-notes\.md \]/, "汇总步骤必须断言 release-notes.md 存在且非空");
}
{
  const top = sliceBetween(ciWorkflow, "\npermissions:\n", "\njobs:\n");
  assert.match(top, /^\s+contents: read\s*$/m, "ci.yml 顶层权限必须是 contents: read");
  assert.match(top, /cancel-in-progress:\s*true/, "ci.yml 的 concurrency 应 cancel-in-progress: true（同分支新提交可取消老跑）");

  const verify = sliceBetween(ciWorkflow, "\n  verify:\n", "\n  desktop-cross-platform:\n");
  assert.match(verify, /timeout-minutes:\s*\d+/, "verify 作业缺少 timeout-minutes");

  const desktopCross = sliceBetween(ciWorkflow, "\n  desktop-cross-platform:\n", null);
  assert.match(desktopCross, /timeout-minutes:\s*\d+/, "desktop-cross-platform 作业缺少 timeout-minutes");
}

assert.ok(ciWorkflow.includes("archive-portable.ps1"), "Windows CI 必须构建并解包校验真实 portable ZIP");
for (const marker of [
  "prepare-portable.mjs",
  "PolyAsk Portable",
  "Compress-Archive",
  "Expand-Archive",
  "App/polyask-desktop.exe",
  "App/resources/app.asar",
  "README.txt",
  "PolyAsk Data"
]) {
  assert.ok(portableArchive.includes(marker), `Portable 归档脚本缺少 ${marker}`);
}

for (const path of ["desktop/package.json", "desktop/package-lock.json"]) {
  assert.ok(prepareRelease.includes(path), `prepare-release.sh 未同步 ${path}`);
}

// F190：desktop/package-lock.json 的版本必须真的等于 desktop/package.json 版本，不能只检查
// prepare-release.sh 源码里出现过这个路径字符串（那样即使 lock 悄悄漂移也测不出来）。
const desktopLock = JSON.parse(fs.readFileSync("desktop/package-lock.json", "utf8"));
assert.strictEqual(desktopLock.version, desktopPackage.version, "desktop/package-lock.json 的根 version 与 desktop/package.json 不一致");
assert.strictEqual(
  desktopLock.packages && desktopLock.packages[""] && desktopLock.packages[""].version,
  desktopPackage.version,
  'desktop/package-lock.json 的 packages[""].version 与 desktop/package.json 不一致'
);

assert.ok(
  releaseScript.includes("五个 Desktop 预览包"),
  "release.sh 的成功提示必须反映当前 Desktop 产物数量"
);

// Release 正文的信任尾段：校验和命令 + 未签名/无自动更新的诚实说明，随每次发版固定附带
{
  const trailer = releaseScript.slice(releaseScript.indexOf("# RELEASE_TRUST_TRAILER_START"), releaseScript.indexOf("# RELEASE_TRUST_TRAILER_END"));
  assert.ok(trailer.length > 0, "release.sh 缺少信任尾段标记块");
  for (const needle of ["Get-FileHash -Algorithm SHA256", "shasum -a 256", "未签名", "自动更新", "SmartScreen", "隐私与安全性"]) {
    assert.ok(trailer.includes(needle), `release.sh 信任尾段缺 ${needle}`);
  }
  assert.ok(releaseScript.indexOf("# F191_UNRELEASED_GUARD_END") < releaseScript.indexOf("# RELEASE_TRUST_TRAILER_START"),
    "尾段必须在 CHANGELOG 校验之后追加，否则尾段的 - 列表会让「版本段必须有条目」的检查假绿");
}

// CHANGELOG 三条校验必须跑在每个 PR 都会经过的路径上（ci.yml 首步 release.sh --build-only），
// 不能只剩 --publish 一个执行点——tag 不可覆盖，把检查往后挪是错误方向
{
  assert.match(ciWorkflow, /bash scripts\/release\.sh --build-only/, "ci.yml 必须跑 release.sh --build-only");
  const shared = releaseScript.slice(releaseScript.indexOf("bash scripts/verify.sh"), releaseScript.indexOf("# F191_UNRELEASED_GUARD_START"));
  assert.doesNotMatch(shared, /"\$MODE" = "publish"/, "两种模式共用段里不得出现 publish 分支");
  for (const needle of ["缺少 [$VERSION] 的有效版本条目", "[未发布] 链接未从 $TAG 开始", "缺少 [$VERSION] 版本链接"]) {
    assert.ok(shared.includes(needle), `CHANGELOG 校验「${needle}」必须在 --build-only 也会跑的共用段里`);
  }
}

// F191：--publish 必须拦住「[未发布] 段仍有未晋升条目」，但绝不能拦 --build-only（PR/日常 CI 会全红）。
// 直接切片、真跑源码里的那段 shell，而不是另抄一份判据——防止测试与实现各写各的、悄悄分叉。
{
  const startMarker = "# F191_UNRELEASED_GUARD_START";
  const endMarker = "# F191_UNRELEASED_GUARD_END";
  const start = releaseScript.indexOf(startMarker);
  const end = releaseScript.indexOf(endMarker);
  assert.ok(start !== -1 && end !== -1 && end > start, "release.sh 缺少 F191 未发布段守卫的标记块");
  const guard = releaseScript.slice(start + startMarker.length, end);
  assert.ok(guard.includes('"$MODE" = "publish"'), "F191 守卫必须限定只在 --publish 生效");

  const os = require("os");
  const path = require("path");
  const { execFileSync } = require("child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polyask-f191-"));
  const dirty = "## [未发布]\n\n### 修复\n\n- 临发版补记的一条修复\n\n## [0.1.0] - 2026-01-01\n\n- 首次发布\n";
  const clean = "## [未发布]\n\n## [0.1.0] - 2026-01-01\n\n- 首次发布\n";
  const scriptPath = path.join(dir, "guard.sh");
  const run = (changelog, mode) => {
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), changelog);
    fs.writeFileSync(
      scriptPath,
      `#!/usr/bin/env bash\nset -euo pipefail\ncd ${JSON.stringify(dir)}\nMODE=${JSON.stringify(mode)}\n${guard}\n`
    );
    try {
      execFileSync("bash", [scriptPath], { stdio: "pipe" });
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  assert.equal(run(dirty, "publish"), 1, "F191: --publish 遇到 [未发布] 段有未晋升条目必须拦截");
  assert.equal(run(clean, "publish"), 0, "F191: --publish 遇到空 [未发布] 段不得误拦");
  assert.equal(run(dirty, "build"), 0, "F191: --build-only 绝不能被 [未发布] 段非空拦住");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("release flow tests passed");
