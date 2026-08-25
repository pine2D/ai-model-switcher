const assert = require("assert");
const fs = require("fs");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const desktopPackage = JSON.parse(fs.readFileSync("desktop/package.json", "utf8"));
const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
const prepareRelease = fs.readFileSync("scripts/prepare-release.sh", "utf8");
const releaseScript = fs.readFileSync("scripts/release.sh", "utf8");

assert.strictEqual(desktopPackage.version, manifest.version, "Desktop 与扩展必须使用同一发布版本");
assert.strictEqual(desktopPackage.scripts.make, "electron-forge make", "Desktop 必须提供 make 命令");
assert.ok(desktopPackage.scripts["collect-release"], "Desktop 必须提供发布产物归档命令");

for (const dependency of [
  "@electron-forge/maker-squirrel",
  "@electron-forge/maker-deb",
  "@electron-forge/maker-zip"
]) {
  assert.ok(desktopPackage.devDependencies[dependency], `Desktop 缺少 ${dependency}`);
}

for (const marker of [
  "windows-x64",
  "@electron-forge/maker-squirrel,@electron-forge/maker-zip",
  "linux-x64",
  "macos-x64",
  "macos-arm64",
  "vars.POLYASK_GOOGLE_DESKTOP_CLIENT_ID",
  "actions/upload-artifact",
  "actions/download-artifact",
  "release-assets"
]) {
  assert.ok(workflow.includes(marker), `Release workflow 缺少 ${marker}`);
}

for (const path of ["desktop/package.json", "desktop/package-lock.json"]) {
  assert.ok(prepareRelease.includes(path), `prepare-release.sh 未同步 ${path}`);
}

assert.ok(
  releaseScript.includes("五个 Desktop 预览包"),
  "release.sh 的成功提示必须反映当前 Desktop 产物数量"
);

console.log("release flow tests passed");
