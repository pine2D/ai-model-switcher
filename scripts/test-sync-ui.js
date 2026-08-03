const assert = require("node:assert/strict");
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

assert.ok(manifest.permissions.includes("identity") && manifest.permissions.includes("alarms"));
assert.deepEqual(manifest.host_permissions, ["https://www.googleapis.com/*"]);

const runtimeFiles = [
  "background.js", "i18n.js", "console/theme.js", "content/pill.js", "popup/popup.js",
  "console/console.js", "console/compose.js", "console/scope.js", "console/archive.js",
];
const syncRuntimeFiles = runtimeFiles.filter((file) => fs.readFileSync(file, "utf8").includes("storage.sync"));
assert.deepEqual(syncRuntimeFiles, [], "运行时代码不得再读写 Chrome Sync");
