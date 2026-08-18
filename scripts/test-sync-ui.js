const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

assert.ok(manifest.permissions.includes("identity") && manifest.permissions.includes("alarms"));
assert.deepEqual(manifest.host_permissions, ["https://www.googleapis.com/*"]);
assert.deepEqual(manifest.oauth2, {
  client_id: "228744155119-1h2j47hqp2s4tvnjjmd868qglqqo2eae.apps.googleusercontent.com",
  scopes: ["https://www.googleapis.com/auth/drive.appdata"],
});
const idBytes = crypto.createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16);
assert.equal([...idBytes].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join(""), "ijghaoddhdgnienpaifekldgoaledefi");

const runtimeFiles = [
  "background.js", "i18n.js", "console/theme.js", "content/pill.js", "popup/popup.js",
  "console/console.js", "console/compose-context.js", "console/compose.js", "console/scope.js", "console/archive.js",
];
const syncRuntimeFiles = runtimeFiles.filter((file) => fs.readFileSync(file, "utf8").includes("storage.sync"));
assert.deepEqual(syncRuntimeFiles, [], "运行时代码不得再读写 Chrome Sync");

const compose = fs.readFileSync("console/compose.js", "utf8");
const archive = fs.readFileSync("console/archive.js", "utf8");
const library = fs.readFileSync("console/library.js", "utf8");
const background = fs.readFileSync("background.js", "utf8");
const store = fs.readFileSync("bg/store.js", "utf8");
const data = fs.readFileSync("bg/data.js", "utf8");
assert.ok(!compose.includes("amsHistory") && !compose.includes("slice(0, 20)"));
assert.ok(!archive.includes("amsArchive") && !background.includes("slice(0, 30)"));
assert.ok(library.includes('action: "historyAdd"'));
assert.ok(compose.includes('action: "historyPage"'));
assert.ok(archive.includes('action: "archiveSearch"') && archive.includes('action: "archiveTags"') && archive.includes('action: "archiveGet"'));
assert.ok(compose.includes("crypto.randomUUID()") && compose.includes("updatedAt: Date.now()"), "模板记录必须带同步所需的 id/updatedAt");
assert.ok(compose.includes('item.text || item.preview || ""'));
assert.ok(store.includes("accept") && store.includes('!Object.hasOwn(value, "deletedAt")'));
assert.ok(archive.includes("!e || !e.results"));
assert.ok(data.includes("Object.hasOwn(actions, msg.action)"));
assert.ok(compose.includes('token !== historyLoadToken || activeKind !== "history"'));
assert.ok(archive.includes("selectedId === entry.id"));

assert.deepEqual(manifest.options_ui, { page: "options/options.html", open_in_tab: true });
const html = fs.readFileSync("options/options.html", "utf8");
const optionsI18n = fs.readFileSync("options/options-i18n.js", "utf8");
for (const id of ["connect", "sync-now", "disconnect", "export", "import-file", "clear-remote", "sync-status"]) {
  assert.ok(html.includes(`id="${id}"`), `设置页缺少 ${id}`);
}
for (const key of [
  "settings_title", "settings_nav", "settings_general", "settings_privacy",
  "settings_theme", "settings_language", "settings_displayMode", "settings_autoRaise",
]) {
  assert.ok(optionsI18n.includes(`${key}:`), `设置中心缺少 ${key}`);
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
assert.ok(syncPage.includes('document.title = `PolyAsk · ${t("settings_title")}`'), "页面标题必须使用 settings_title 本地化");
for (const id of ["sync-now", "disconnect", "clear-remote"]) assert.match(html, new RegExp(`id="${id}"[^>]*\\shidden`), `首次渲染不得暴露 ${id}`);
assert.match(html, /id="section-privacy"[\s\S]*id="clear-confirmation"[^>]*hidden/, "隐私分区的清除确认必须默认隐藏");
assert.ok(syncPage.includes('const reconnect = !!config.connected && !config.clearRunning && status.state === "auth";'), "auth 重连入口必须让 clearRunning 优先");
assert.ok(syncPage.includes('byId("clear-remote").hidden = !config.connected || !!config.clearRunning || reconnect;'), "auth 状态不得暴露清云端按钮");
