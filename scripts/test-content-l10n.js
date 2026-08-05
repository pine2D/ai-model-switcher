#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const LANGS = ["en", "zh_CN", "zh_TW"];
const htmlFiles = ["popup/popup.html", "options/options.html", "console/console.html", "console/compose.html", "console/scope.html", "console/archive.html"];
const placeholders = (value) => [...String(value).matchAll(/\{\d+\}|\$[A-Za-z0-9_]+\$/g)].map((match) => match[0]).sort();
const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
function openingTag(source, name, value) {
  for (const match of source.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)) {
    if (attribute(match[0], name) === value) return { name: match[1].toLowerCase(), source: match[0], end: match.index + match[0].length };
  }
  assert.fail(`missing element with ${name}="${value}"`);
}
function firstTag(source, name) {
  const match = source.match(new RegExp(`<${name}\\b[^>]*>`, "i"));
  assert.ok(match, `missing <${name}>`);
  return match[0];
}
function fallbackText(source, element) {
  const end = source.indexOf(`</${element.name}>`, element.end);
  assert.notEqual(end, -1, `missing </${element.name}>`);
  return source.slice(element.end, end).replace(/<[^>]*>/g, "").trim();
}

function messages() {
  const source = fs.readFileSync("i18n.js", "utf8");
  const scope = {};
  vm.runInNewContext(`${source.slice(0, source.indexOf("\nconst I18N_LANGS"))}\nglobalThis.result = MSG;`, scope);
  vm.runInNewContext(fs.readFileSync("console/workspace-i18n.js", "utf8"), { MSG: scope.result, applyI18n() {} });
  vm.runInNewContext(fs.readFileSync("options/options-i18n.js", "utf8"), { MSG: scope.result, applyI18n() {} });
  return scope.result;
}

const rows = messages();
const sourceKeys = ["cmp_source", "cmp_sourceSelection", "cmp_sourcePage", "cmp_sourceRemove", "cmp_sourceDetail",
  "cmp_sourceCount", "cmp_sourceTruncated", "cmp_contextDenied", "cmp_contextEmpty", "cmp_sourceReplaceQuestion",
  "cmp_sourceReplace", "cmp_sourceKeep", "cmp_payloadSource", "cmp_payloadUrl", "cmp_referenceNotice",
  "cmp_referenceStart", "cmp_referenceEnd", "cmp_sendSave", "cmp_consoleOpenFailed", "cmp_settingsLoadFailed"];
for (const key of sourceKeys) assert.ok(rows[key], `missing webpage context copy: ${key}`);
assert.deepEqual(JSON.parse(JSON.stringify(rows.cmp_sendSave)), {
  en: "Sending saves this content to question history and to Google Drive when sync is enabled.",
  zh_CN: "发送后，此内容会保存到提问历史；启用同步时还会上传到 Google Drive。",
  zh_TW: "傳送後，此內容會儲存到提問記錄；啟用同步時也會上傳到 Google Drive。",
});
for (const [key, row] of Object.entries(rows)) {
  assert.deepEqual(Object.keys(row).sort(), [...LANGS].sort(), `${key}: locale coverage differs`);
  for (const lang of LANGS) assert.deepEqual(placeholders(row[lang]), placeholders(row.en), `${key}.${lang}: placeholders differ`);
  assert.doesNotMatch(row.en, /[—–]/, `${key}.en: replace long dashes`);
}

const menuScope = {
  chrome: {
    contextMenus: { onClicked: { addListener() {} } },
    i18n: { getUILanguage: () => "en" },
    runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    storage: { local: {}, session: {}, onChanged: { addListener() {} } },
  },
  openCompose: async () => {},
};
vm.runInNewContext(`${fs.readFileSync("bg/page-context.js", "utf8")}\nglobalThis.menuCopy = PageContext.menuCopy;`, menuScope);
assert.deepEqual(JSON.parse(JSON.stringify(menuScope.menuCopy)), {
  selection: { en: "Compare selection with PolyAsk", zh_CN: "用 PolyAsk 比较所选内容", zh_TW: "用 PolyAsk 比較所選內容" },
  page: { en: "Compare this page with PolyAsk", zh_CN: "用 PolyAsk 比较当前网页", zh_TW: "用 PolyAsk 比較目前網頁" },
});
for (const [kind, row] of Object.entries(menuScope.menuCopy)) {
  assert.deepEqual(Object.keys(row).sort(), [...LANGS].sort(), `PageContext.menuCopy.${kind}: locale coverage differs`);
  for (const lang of LANGS) assert.deepEqual(placeholders(row[lang]), placeholders(row.en), `PageContext.menuCopy.${kind}.${lang}: placeholders differ`);
  assert.doesNotMatch(row.en, /[—–]/, `PageContext.menuCopy.${kind}.en: replace long dashes`);
}

assert.deepEqual(JSON.parse(JSON.stringify(rows.arc_title)), { en: "Result library", zh_CN: "结果库", zh_TW: "結果庫" });
const resultLibraryKeys = ["con_archiveTitle", "arc_listAria", "arc_empty", "arc_delConfirm", "arc_loadFailed",
  "arc_saveFailed", "arc_deleteFailed", "con_moreArchive", "con_collectDoneUnarchived", "arc_title"];
const legacyTerms = { en: /\barchiv(?:e|ed|es)\b/i, zh_CN: /归档|歸檔|封存/, zh_TW: /归档|歸檔|封存/ };
for (const key of resultLibraryKeys) {
  for (const lang of LANGS) assert.doesNotMatch(rows[key][lang], legacyTerms[lang], `${key}.${lang}: use result library terminology`);
}

const dataTerms = {
  en: ["settings", "templates", "groups", "question history", "AI answers", "favorites", "tags", "notes", "which answer is marked as best"],
  zh_CN: ["设置", "模板", "分组", "提问历史", "AI 回答", "收藏", "标签", "备注", "哪个回答被标为最佳"],
  zh_TW: ["設定", "範本", "群組", "提問記錄", "AI 回答", "收藏", "標籤", "備註", "哪個回答被標為最佳"],
};
const driveTerms = {
  en: ["all data synced to Google Drive", "plaintext", "end-to-end encryption"],
  zh_CN: ["所有同步到 Google Drive 的数据", "明文", "端到端加密"],
  zh_TW: ["所有同步到 Google Drive 的資料", "明文", "端對端加密"],
};
const transferTerms = { en: ["all data exported", "plaintext", "end-to-end encryption"],
  zh_CN: ["全部导出数据", "明文", "端到端加密"], zh_TW: ["全部匯出資料", "明文", "端對端加密"] };
for (const lang of LANGS) {
  const intro = rows.sync_intro[lang].toLowerCase(), storage = rows.sync_storage[lang].toLowerCase();
  const sensitive = rows.sync_sensitive[lang].toLowerCase(), transfer = rows.sync_transferPlain[lang].toLowerCase();
  assert.ok(intro.includes(dataTerms[lang][2].toLowerCase()), `sync_intro.${lang}: missing groups`);
  assert.ok(storage.includes(rows.arc_title[lang].toLowerCase()), `sync_storage.${lang}: missing result library`);
  for (const term of dataTerms[lang]) {
    assert.ok(storage.includes(term.toLowerCase()), `sync_storage.${lang}: missing ${term}`);
    assert.ok(transfer.includes(term.toLowerCase()), `sync_transferPlain.${lang}: missing ${term}`);
  }
  for (const term of driveTerms[lang]) assert.ok(sensitive.includes(term.toLowerCase()), `sync_sensitive.${lang}: missing ${term}`);
  for (const term of transferTerms[lang]) assert.ok(transfer.includes(term.toLowerCase()), `sync_transferPlain.${lang}: missing ${term}`);
}

const locales = Object.fromEntries(LANGS.map((lang) => [lang, JSON.parse(fs.readFileSync(`_locales/${lang}/messages.json`, "utf8"))]));
const localeKeys = Object.keys(locales.en).sort();
for (const lang of LANGS) {
  assert.deepEqual(Object.keys(locales[lang]).sort(), localeKeys, `_locales/${lang}: keys differ`);
  for (const key of localeKeys) assert.deepEqual(placeholders(locales[lang][key].message), placeholders(locales.en[key].message), `_locales/${lang}.${key}: placeholders differ`);
}
for (const [key, value] of Object.entries(locales.en)) assert.doesNotMatch(value.message, /[—–]/, `_locales/en.${key}: replace long dashes`);

for (const file of htmlFiles) {
  const source = fs.readFileSync(file, "utf8");
  assert.equal(attribute(firstTag(source, "html"), "lang"), "zh-CN", `${file}: initial language differs from fallback content`);
  for (const match of source.matchAll(/data-i18n(?:-title|-ph|-aria)?="([^"]+)"/g)) {
    assert.ok(rows[match[1]], `${file}: missing i18n key ${match[1]}`);
  }
}
for (const file of ["console/archive.js", "console/archive-detail.js"]) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bt\("([^"]+)"/g)) assert.ok(rows[match[1]], `${file}: missing i18n key ${match[1]}`);
}

const consoleHtml = fs.readFileSync("console/console.html", "utf8");
const libraryButton = openingTag(consoleHtml, "data-i18n-title", "con_archiveTitle");
assert.equal(attribute(libraryButton.source, "data-i18n-aria"), "con_archiveTitle");
assert.equal(attribute(libraryButton.source, "title"), rows.con_archiveTitle.zh_CN);
assert.equal(attribute(libraryButton.source, "aria-label"), rows.con_archiveTitle.zh_CN);
const archiveHtml = fs.readFileSync("console/archive.html", "utf8");
const libraryList = openingTag(archiveHtml, "data-i18n-aria", "arc_listAria");
assert.equal(attribute(libraryList.source, "aria-label"), rows.arc_listAria.zh_CN);
assert.equal(attribute(openingTag(archiveHtml, "id", "ar-detail").source, "data-empty"), rows.arc_loading.zh_CN);
const scopeHtml = fs.readFileSync("console/scope.html", "utf8"), scopeTitle = openingTag(scopeHtml, "data-i18n", "con_groupAria");
assert.equal(scopeTitle.name, "title"); assert.equal(fallbackText(scopeHtml, scopeTitle), rows.con_groupAria.zh_CN);
const optionsHtml = fs.readFileSync("options/options.html", "utf8");
const optionsTitle = openingTag(optionsHtml, "data-i18n", "settings_title");
assert.equal(optionsTitle.name, "title"); assert.equal(fallbackText(optionsHtml, optionsTitle), rows.settings_title.zh_CN);
for (const key of ["sync_intro", "sync_storage", "sync_sensitive", "sync_transferPlain"]) {
  const element = openingTag(optionsHtml, "data-i18n", key);
  assert.equal(fallbackText(optionsHtml, element), rows[key].zh_CN, `${key}: HTML fallback differs`);
}
assert.doesNotMatch(fs.readFileSync("README.md", "utf8"), /归档|歸檔|封存/);
const changelog = fs.readFileSync("CHANGELOG.md", "utf8"), unreleased = changelog.slice(changelog.indexOf("## [未发布]"), changelog.indexOf("## [0.13.0]"));
assert.doesNotMatch(unreleased, /归档|歸檔|封存/);

console.log("[content-l10n] locale coverage, placeholders, keys, and punctuation passed");
