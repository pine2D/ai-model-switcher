"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const hygiene = require("./oauth-secret-hygiene");

assert.strictEqual(
  typeof hygiene.checkFiles,
  "function",
  "OAuth 凭据卫生门禁必须提供可复用的文件检查函数"
);

function createWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polyask-oauth-hygiene-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

{
  const secret = `GOCSPX-${"A".repeat(28)}`;
  const files = {
    "desktop/src/main/config.ts": `export const credential = ${JSON.stringify(secret)};\n`
  };
  const root = createWorkspace(files);
  const problems = hygiene.checkFiles(root, Object.keys(files));
  const report = hygiene.formatProblems(problems);

  assert.deepStrictEqual(problems, ["tracked_google_oauth_secret:desktop/src/main/config.ts:1"]);
  assert.ok(!report.includes(secret), "凭据检查失败时不得把 Secret 回显到日志");
}

{
  const files = {
    "desktop/src/main/config.test.ts": [
      "const secret = 'test-desktop-client-secret';",
      "const placeholder = 'REPLACE_WITH_GOOGLE_DESKTOP_CLIENT_SECRET';"
    ].join("\n")
  };
  const root = createWorkspace(files);

  assert.deepStrictEqual(hygiene.checkFiles(root, Object.keys(files)), []);
}

{
  const files = {
    "desktop/resources/oauth.json": "{}\n"
  };
  const root = createWorkspace(files);

  assert.deepStrictEqual(hygiene.checkFiles(root, Object.keys(files)), [
    "tracked_oauth_resource:desktop/resources/oauth.json"
  ]);
}

// F187：checkFiles 用 value.includes(0) 检出 NUL 字节即整份跳过（scripts/oauth-secret-hygiene.js:25）。
// 这两条钉住现状（放行分支），不收紧检测——收紧需要改判定逻辑本体，超出本条 finding 的范围。
{
  // 真二进制样本（PNG 头 + IHDR 长度字段自带的 0x00）：必须被 NUL 启发式跳过，不抛错、不误报成泄漏
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x01, 0x00]);
  const files = { "icons/icon32.png": pngBytes };
  const root = createWorkspace(files);

  assert.deepStrictEqual(hygiene.checkFiles(root, Object.keys(files)), [],
    "含 NUL 字节的真二进制样本（如 png 图标）应被 NUL 启发式直接跳过，不抛错、不误报（现状：已知放行分支）");
}

{
  // UTF-16LE 编码的密钥：ASCII 字符间夹 0x00，同样命中 NUL 跳过——不是本条 fix_notes 的收紧范围，
  // 只是把「只按 utf8 解一次」这个根因更早触发；此处钉住现状，避免以后有人误以为已经防住这类编码。
  const secret = `GOCSPX-${"B".repeat(28)}`;
  const utf16Content = Buffer.from(`export const credential = "${secret}";\n`, "utf16le");
  const files = { "desktop/src/main/config-utf16.ts": utf16Content };
  const root = createWorkspace(files);

  assert.deepStrictEqual(hygiene.checkFiles(root, Object.keys(files)), [],
    "UTF-16LE 保存的密钥当前不会被检出（已知放行，根因是仅按 utf8 解码一次，非本条收紧范围）");
}

console.log("oauth secret hygiene tests passed");
