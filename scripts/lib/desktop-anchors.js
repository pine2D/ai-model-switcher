"use strict";
// Desktop 侧的两份真源锚点，供 scripts/test-*.js 共用（别各自写正则，抽错了会一起假绿）：
//   preloadRequires()  desktop/src/preload/site.ts 的 require 列表 = 站点运行时注入清单与顺序
//   desktopSites()     desktop/src/main/sites.ts 的 { key, host, label } 九站定义
// 扩展已删除（tag archive/extension-v0.25.1），注入清单与站点表的真源只有这两处。
const fs = require("node:fs");
const path = require("node:path");

const PRELOAD = "desktop/src/preload/site.ts";
const SITES = "desktop/src/main/sites.ts";
const ROOT = path.join(__dirname, "..", "..");

// 返回仓库相对路径（如 content/core.js），按 require 出现顺序；搬家后只要 require 相对路径跟着改，这里不用动。
function preloadRequires() {
  const text = fs.readFileSync(path.join(ROOT, PRELOAD), "utf8");
  const files = [...text.matchAll(/^require\("([^"]+\.js)"\);$/gm)]
    .map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(PRELOAD), m[1])));
  if (files.length < 5) throw new Error(`${PRELOAD} 的 require 列表读取失败或结构变了（只抽到 ${files.length} 条）`);
  return files;
}

function desktopSites() {
  const text = fs.readFileSync(path.join(ROOT, SITES), "utf8");
  const sites = [...text.matchAll(/\{\s*key:\s*"([^"]+)",\s*host:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)]
    .map((m) => ({ key: m[1], host: m[2], label: m[3] }));
  const hostCount = (text.match(/\bhost:\s*"/g) || []).length;
  if (!sites.length || sites.length !== hostCount) {
    throw new Error(`${SITES} 有站点行没抽到 key/host/label 三项（${sites.length}/${hostCount}；字段顺序变了就同步这段正则）`);
  }
  return sites;
}

module.exports = { PRELOAD, SITES, preloadRequires, desktopSites };
