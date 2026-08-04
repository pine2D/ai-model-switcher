#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const LANGS = ["en", "zh_CN", "zh_TW"];
const htmlFiles = ["popup/popup.html", "options/options.html", "console/console.html", "console/compose.html", "console/scope.html", "console/archive.html"];
const placeholders = (value) => [...String(value).matchAll(/\{\d+\}|\$[A-Za-z0-9_]+\$/g)].map((match) => match[0]).sort();

function messages() {
  const source = fs.readFileSync("i18n.js", "utf8");
  const scope = {};
  vm.runInNewContext(`${source.slice(0, source.indexOf("\nconst I18N_LANGS"))}\nglobalThis.result = MSG;`, scope);
  vm.runInNewContext(fs.readFileSync("console/workspace-i18n.js", "utf8"), { MSG: scope.result, applyI18n() {} });
  vm.runInNewContext(fs.readFileSync("options/options-i18n.js", "utf8"), { MSG: scope.result, applyI18n() {} });
  return scope.result;
}

const rows = messages();
for (const [key, row] of Object.entries(rows)) {
  assert.deepEqual(Object.keys(row).sort(), [...LANGS].sort(), `${key}: locale coverage differs`);
  for (const lang of LANGS) assert.deepEqual(placeholders(row[lang]), placeholders(row.en), `${key}.${lang}: placeholders differ`);
  assert.doesNotMatch(row.en, /[—–]/, `${key}.en: replace long dashes`);
}

assert.deepEqual(JSON.parse(JSON.stringify(rows.arc_title)), { en: "Result library", zh_CN: "结果库", zh_TW: "結果庫" });
const resultLibraryKeys = ["con_archiveTitle", "arc_listAria", "arc_empty", "arc_delConfirm", "arc_loadFailed",
  "arc_saveFailed", "arc_deleteFailed", "con_moreArchive", "con_collectDoneUnarchived", "arc_title"];
const legacyTerms = { en: /\barchiv(?:e|ed|es)\b/i, zh_CN: /归档|歸檔|封存/, zh_TW: /归档|歸檔|封存/ };
for (const key of resultLibraryKeys) {
  for (const lang of LANGS) assert.doesNotMatch(rows[key][lang], legacyTerms[lang], `${key}.${lang}: use result library terminology`);
}

const organizationTerms = {
  en: ["favorites", "tags", "notes", "best-answer markings"],
  zh_CN: ["收藏", "标签", "备注", "最佳答案标记"],
  zh_TW: ["收藏", "標籤", "備註", "最佳答案標記"],
};
const disclosureTerms = {
  en: ["plaintext", "end-to-end encryption"],
  zh_CN: ["明文", "端到端加密"],
  zh_TW: ["明文", "端對端加密"],
};
for (const lang of LANGS) {
  const storage = rows.sync_storage[lang].toLowerCase(), sensitive = rows.sync_sensitive[lang].toLowerCase();
  const transfer = rows.sync_transferPlain[lang].toLowerCase();
  assert.ok(storage.includes(rows.arc_title[lang].toLowerCase()), `sync_storage.${lang}: missing result library`);
  for (const term of organizationTerms[lang]) {
    assert.ok(storage.includes(term.toLowerCase()), `sync_storage.${lang}: missing ${term}`);
    assert.ok(sensitive.includes(term.toLowerCase()), `sync_sensitive.${lang}: missing ${term}`);
    assert.ok(transfer.includes(term.toLowerCase()), `sync_transferPlain.${lang}: missing ${term}`);
  }
  for (const term of disclosureTerms[lang]) {
    assert.ok(sensitive.includes(term.toLowerCase()), `sync_sensitive.${lang}: missing ${term}`);
    assert.ok(transfer.includes(term.toLowerCase()), `sync_transferPlain.${lang}: missing ${term}`);
  }
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
  for (const match of source.matchAll(/data-i18n(?:-title|-ph|-aria)?="([^"]+)"/g)) {
    assert.ok(rows[match[1]], `${file}: missing i18n key ${match[1]}`);
  }
}
for (const file of ["console/archive.js", "console/archive-detail.js"]) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bt\("([^"]+)"/g)) assert.ok(rows[match[1]], `${file}: missing i18n key ${match[1]}`);
}

const consoleHtml = fs.readFileSync("console/console.html", "utf8");
assert.ok(consoleHtml.includes(`title="${rows.con_archiveTitle.zh_CN}" aria-label="${rows.con_archiveTitle.zh_CN}"`), "console result library fallback differs");
const archiveHtml = fs.readFileSync("console/archive.html", "utf8");
assert.ok(archiveHtml.includes(`data-i18n-aria="arc_listAria" aria-label="${rows.arc_listAria.zh_CN}"`), "result library list fallback differs");
const optionsHtml = fs.readFileSync("options/options.html", "utf8");
for (const key of ["sync_intro", "sync_storage", "sync_sensitive", "sync_transferPlain"]) {
  assert.ok(optionsHtml.includes(`data-i18n="${key}">${rows[key].zh_CN}</`), `${key}: HTML fallback differs`);
}
assert.doesNotMatch(fs.readFileSync("README.md", "utf8"), /归档|歸檔|封存/);
const changelog = fs.readFileSync("CHANGELOG.md", "utf8"), unreleased = changelog.slice(changelog.indexOf("## [未发布]"), changelog.indexOf("## [0.13.0]"));
assert.doesNotMatch(unreleased, /归档|歸檔|封存/);

console.log("[content-l10n] locale coverage, placeholders, keys, and punctuation passed");
