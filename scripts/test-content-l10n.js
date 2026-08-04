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
  vm.runInNewContext(fs.readFileSync("options/options-i18n.js", "utf8"), { MSG: scope.result, applyI18n() {} });
  return scope.result;
}

const rows = messages();
for (const [key, row] of Object.entries(rows)) {
  assert.deepEqual(Object.keys(row).sort(), [...LANGS].sort(), `${key}: locale coverage differs`);
  for (const lang of LANGS) assert.deepEqual(placeholders(row[lang]), placeholders(row.en), `${key}.${lang}: placeholders differ`);
  assert.doesNotMatch(row.en, /[—–]/, `${key}.en: replace long dashes`);
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

console.log("[content-l10n] locale coverage, placeholders, keys, and punctuation passed");
