#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");

const LUCIDE_BODY_HASHES = {
  keyboard: "7f4f502a83d5dc79d1be8d119615e36cdefbb7dff2d24ac8c68d232f9e6136e8",
  activity: "596b6ea9f4af7ce53b1b3ecd35643ebca178a67f063af0414c75a32ae1c72ccc",
  settings: "ef56482b5291f904126b111f7112a595f4ea22c5bb37e640f0e0379352850838",
  "settings-2": "345bb3cf3dd783c81aa77147562df15485d0965905a4f97df2120c13ddb7bad1",
  "cloud-cog": "3e39604d62eb342d4d82771016b6dd48406cb86f041eb928dcce2abb24045936",
  "package-open": "18a4f24b16b5a7f29b95d1a0545ab1651d8d666f119ddb129d80bc50b3b9a116",
  shield: "057136df30c581ad959815dcc2b910623fd984d88b9d32f2178e2fd10239df71",
  "sun-moon": "c22209a3cd0f8d83131cadf70f1aa8f426edd03e9cbf6ca5debc7f77d22cfa72",
  languages: "240f444c8044ba544a5a443367dd5267a81095ec9c2a209ecf536738720d026b",
  "panel-right": "a18193593eaa2a5be512afa67386459479256564af4313c172515a0b17a48802",
  pin: "a8c26633c020093e17b2d6d45ec19d083afedf8c5592fdad87f0c9e1d1dcc982",
  "circle-check": "96be72b10b7acf22de9484aabdde2d20d1ab910cdf85aaf8c198555a28969385",
  "refresh-cw": "5bfd14094a059e31b3ef044d969defe27343663af6fc1b453c0a94730942dfe0",
  "log-out": "14800026b269ca10078a4765345758895957d6acff5853993110ffc774f58649",
  "file-down": "4b245c49819fc701165212f38a38aa87b7c529005ee3c92a4bfb342e81ca346e",
  "file-up": "7df3fff9659d5f19d2e005f4128c238d401720c862b70c6c1fcd8799aae4c50d",
  "trash-2": "b3d5cd1955ec96de3695d068edf84fc144360962ca5262872d71cb02075e6d61",
  "chevron-left": "f145963d483dcee2255846c1895144e44a2df66ce85e9a63f921f12739f2e4d1",
  "chevron-right": "2273536ef4a19417a74dc6147416f288f4540101ace2cf962d808af39e1a5fa4",
  "image-plus": "a41d97c8218fa0b7af05ad0f19cfe134146cbbb9b45f93f21252d77bcbfc0568",
  pencil: "6034d275e3ebff11851f56053842bcf9ecd326dd96a8b12eea0f9b1447c17aa2",
  "rotate-ccw": "c484810a3563c2878fbac102036f049ca2253a7496669dabd603c4b3318c6c54",
  "columns-2": "0c10fa8c88c5beae97299e90c0be70d2e8c065581980a3ee37691c329170bbae",
  copy: "cafb915df3f285f655481348925be9013520a035c24205dc6b61079863f57807",
  plus: "b5d12bc3003fba43ad285f58ea6ce2f4848663f640a225e4fc8806daddec24b4",
  archive: "323a0c4f52f184ecd145c7bf66a8ebfa18cbb2020f24852f67594af7346f04da",
  x: "3f969bc86b02f3a880881c4ac4cc095e2fd21fbe9134eb4f82c1e7a5c1183d39",
};
const FILE_HASHES = {
  "icons/lucide/check.svg": "7f33acc9a77a61659531044525fc008edebe215bf4dcf1c789c8674ad3277db0",
  "icons/lucide/x.svg": "4a9cdab38fbb96162e7dace28e33f4ca0e49d8963a6162abc3d4691b7d675117",
  "icons/lucide/LICENSE": "b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57",
};
const BRAND_BODY_HASH = "22d3ff81795a32612d90c5645315b33cdab2a19f40a5dd81ed77abb11a26b68a";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const svgBody = (svg) => svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"))
  .replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

const files = [
  "popup/popup.html", "options/options.html", "console/console.html",
  "console/compose.html", "console/archive.html",
];
let brandCount = 0, lucideCount = 0;
const lucideNames = new Set();
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/<svg\b[\s\S]*?<\/svg>/g)) {
    const svg = match[0];
    if (svg.includes("data-brand-icon")) {
      brandCount++;
      assert.match(svg, /viewBox="0 0 16 16"/, `${file} 的品牌 SVG viewBox 被改写`);
      assert.match(svg, /aria-hidden="true"/, `${file} 的品牌 SVG 缺少 aria-hidden`);
      assert.equal(sha256(svgBody(svg)), BRAND_BODY_HASH, `${file} 的品牌 SVG body 被改写`);
      continue;
    }
    lucideCount++;
    const name = svg.match(/class="[^"]*\blucide lucide-([a-z0-9-]+)\b[^"]*"/)?.[1];
    assert.ok(name && LUCIDE_BODY_HASHES[name], `${file} 存在非 Lucide 1.28.0 SVG`);
    lucideNames.add(name);
    assert.match(svg, /viewBox="0 0 24 24"/, `${file} 的 Lucide viewBox 被改写`);
    assert.match(svg, /aria-hidden="true"/, `${file} 的 ${name} 缺少 aria-hidden`);
    assert.equal(sha256(svgBody(svg)), LUCIDE_BODY_HASHES[name], `${file} 的 ${name} 不是官方 Lucide 1.28.0 body`);
  }
}
assert.equal(lucideCount, 30, "内联 Lucide 图标应恰好为 30 个");
assert.equal(brandCount, 3, "data-brand-icon 应恰好为 3 个");
assert.deepEqual([...lucideNames].sort(), Object.keys(LUCIDE_BODY_HASHES).sort(), "内联 Lucide 应恰好覆盖 27 个固定名称");
for (const file of ["popup/popup.css", "console/console.css"]) {
  assert.ok(!fs.readFileSync(file, "utf8").includes("data:image/svg+xml"), `${file} 不得保留手写 data SVG`);
}
for (const [file, expected] of Object.entries(FILE_HASHES)) {
  assert.equal(sha256(fs.readFileSync(file)), expected, `${file} 不是官方 Lucide 1.28.0 文件`);
}
console.log("[icons] 全界面 Lucide 1.28.0 契约通过");
