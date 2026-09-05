"use strict";
// Desktop 的两份真源锚点，供根 scripts/test-*.js 与 desktop/scripts/*.test.js 共用（别各自写正则，抽错了会一起假绿）：
//   preloadRequires()  desktop/src/preload/site.ts 的 require 列表 = 站点运行时注入清单与顺序（仓库相对路径）
//   desktopSites()     desktop/src/main/sites.ts 的 { key, host, label } 九站定义
// 扩展已删除（tag archive/extension-v0.25.1），注入清单与站点表的真源只有这两处。
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..", "..");
const PRELOAD = "desktop/src/preload/site.ts";
const SITES = "desktop/src/main/sites.ts";
const SITE_RUNTIME = "desktop/src/site-runtime";

// 正则路径无关：抽出全部 require specifier，以 site.ts 所在目录解析后归一成仓库相对路径。
// 不变量：每一条都必须落在 desktop/src/site-runtime/ 下——既保住「漏 require 一卷」的覆盖，又不依赖上跳层数。
function preloadRequires() {
  const text = fs.readFileSync(path.join(ROOT, PRELOAD), "utf8");
  const files = [...text.matchAll(/^require\("([^"]+)"\);$/gm)]
    .map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(PRELOAD), m[1])));
  if (files.length < 5) throw new Error(`${PRELOAD} 的 require 列表读取失败或结构变了（只抽到 ${files.length} 条）`);
  const stray = files.filter((file) => !file.startsWith(`${SITE_RUNTIME}/`));
  if (stray.length) throw new Error(`${PRELOAD} require 了 ${SITE_RUNTIME}/ 之外的文件：${stray.join(", ")}`);
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

module.exports = { ROOT, PRELOAD, SITES, SITE_RUNTIME, preloadRequires, desktopSites };
