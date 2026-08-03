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

const compose = fs.readFileSync("console/compose.js", "utf8");
const archive = fs.readFileSync("console/archive.js", "utf8");
const library = fs.readFileSync("console/library.js", "utf8");
const background = fs.readFileSync("background.js", "utf8");
const manage = fs.readFileSync("console/manage.js", "utf8");
const store = fs.readFileSync("bg/store.js", "utf8");
assert.ok(!compose.includes("amsHistory") && !compose.includes("slice(0, 20)"));
assert.ok(!archive.includes("amsArchive") && !background.includes("slice(0, 30)"));
assert.ok(library.includes('action: "historyAdd"'));
assert.ok(compose.includes('action: "historyPage"'));
assert.ok(archive.includes('action: "archivePage"') && archive.includes('action: "archiveGet"'));
assert.ok(manage.includes("crypto.randomUUID()") && manage.includes("updatedAt: Date.now()"));
assert.ok(compose.includes('item.text || item.preview || ""'));
assert.ok(store.includes("accept") && store.includes("!value.deletedAt"));
assert.ok(archive.includes("!e || !e.results"));
