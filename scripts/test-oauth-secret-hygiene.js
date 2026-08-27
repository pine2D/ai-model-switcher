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

console.log("oauth secret hygiene tests passed");
