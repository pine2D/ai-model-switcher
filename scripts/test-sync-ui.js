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
const data = fs.readFileSync("bg/data.js", "utf8");
assert.ok(!compose.includes("amsHistory") && !compose.includes("slice(0, 20)"));
assert.ok(!archive.includes("amsArchive") && !background.includes("slice(0, 30)"));
assert.ok(library.includes('action: "historyAdd"'));
assert.ok(compose.includes('action: "historyPage"'));
assert.ok(archive.includes('action: "archivePage"') && archive.includes('action: "archiveGet"'));
assert.ok(manage.includes("crypto.randomUUID()") && manage.includes("updatedAt: Date.now()"));
assert.ok(compose.includes('item.text || item.preview || ""'));
assert.ok(store.includes("accept") && store.includes('!Object.hasOwn(value, "deletedAt")'));
assert.ok(archive.includes("!e || !e.results"));
assert.ok(data.includes("Object.hasOwn(actions, msg.action)"));
assert.ok(compose.includes('token !== historyLoadToken || activeKind !== "history"'));
assert.ok(archive.includes("selectedId === entry.id"));

assert.deepEqual(manifest.options_ui, { page: "options/sync.html", open_in_tab: true });
const html = fs.readFileSync("options/sync.html", "utf8");
for (const id of ["connect", "sync-now", "disconnect", "export", "import-file", "clear-remote", "sync-status"]) {
  assert.ok(html.includes(`id="${id}"`), `设置页缺少 ${id}`);
}
assert.ok(fs.readFileSync("scripts/package.sh", "utf8").includes(" options"));
const syncPage = fs.readFileSync("options/sync.js", "utf8");
assert.ok(syncPage.includes("showSaveFilePicker"), "导出必须先在点击回调中取得保存句柄");
assert.ok(syncPage.includes('name: "ams-transfer"'), "导出必须通过迁移端口流式传输");
assert.ok(syncPage.includes("TextDecoderStream"), "导入必须流式读取 JSONL");
assert.ok(syncPage.includes('TextDecoderStream("utf-8", { fatal: true })'), "非法 UTF-8 必须在验证阶段拒绝");
assert.ok(syncPage.includes('"auth_failed"'), "导出授权失败必须提示重新连接");
assert.ok(syncPage.includes("validateImport") && syncPage.includes("importBatch"), "导入必须先全量验证再分批写入");
assert.match(html, /accept="[^"]*\.jsonl[^"]*application\/x-ndjson/, "导入必须接受 JSONL 文件");
assert.ok(syncPage.includes("config.clearProgress") && syncPage.includes("sync_clearProgress"), "清理进度必须作为状态详情呈现");
assert.ok(syncPage.includes('document.title = `PolyAsk · ${t("sync_title")}`'), "页面标题必须使用 sync_title 本地化");
for (const id of ["sync-now", "disconnect", "clear-remote"]) assert.match(html, new RegExp(`id="${id}"[^>]*\\shidden`), `首次渲染不得暴露 ${id}`);
assert.ok(syncPage.includes('const reconnect = !!config.connected && !config.clearRunning && status.state === "auth";'), "auth 重连入口必须让 clearRunning 优先");
assert.ok(syncPage.includes('byId("clear-remote").hidden = !config.connected || !!config.clearRunning || reconnect;'), "auth 状态不得暴露清云端按钮");
