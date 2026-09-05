import assert from "node:assert/strict";
import test from "node:test";

import { SITE_CODES } from "../src/shared/protocol";
import { readSource } from "./fixtures";

// 站点码的双向覆盖：源码里产出的每个码都要有用户可见文案，文案表里的每个码也要真有产出方。
// 扩展侧 scripts/test-err-codes.js 曾靠 console/status.js 守这条线，扩展退役后这里是唯一承接者。

// 产出方：preload 注入的 content 运行时（按 site.ts 的 require 列表取，搬家不用改这里）+ preload 自身 + 主进程四个产码文件。
function producerFiles(): string[] {
  const preload = "src/preload/site.ts";
  const requires = [...readSource(preload).matchAll(/^require\("([^"]+\.js)"\);$/gm)].map((m) => `src/preload/${m[1]}`);
  assert.ok(requires.length >= 5, `${preload} 的 require 列表读取失败或结构变了`);
  return [...requires, preload, "src/main/view-manager.ts", "src/main/broadcast.ts", "src/main/collection-service.ts", "src/main/synthesis-service.ts"];
}

function producedCodes(): Map<string, string> {
  const produced = new Map<string, string>();
  for (const file of producerFiles()) {
    for (const m of readSource(file).matchAll(/(?:\bcode:\s*|\.code\s*=\s*)"([a-z_]+)"/g)) {
      if (!produced.has(m[1])) produced.set(m[1], file);
    }
  }
  assert.ok(produced.size >= 10, `码抽取失效，实得 ${produced.size} 个（正则或文件清单坏了？）`);
  return produced;
}

function collectionCodes(): Set<string> {
  const source = readSource("src/shared/status-copy.ts");
  const block = source.slice(source.indexOf("export function describeCollectionCode("));
  const codes = new Set([...block.slice(0, block.indexOf("\n}\n")).matchAll(/case\s+"([a-z_]+)"\s*:/g)].map((m) => m[1]));
  assert.ok(codes.size >= 3, "describeCollectionCode 的 case 抽取失效");
  return codes;
}

// 产出了但刻意不进状态/采集文案表的码（写明理由）。目前为空：诊断码若只走 diagnose 通道，登记在这里。
const PRODUCED_WITHOUT_COPY: Record<string, string> = {};

// 文案表里有、源码扫描却找不到字面量的码（写明理由）。
const COPY_WITHOUT_PRODUCER: Record<string, string> = {
  no_window: "扩展端产的码；跨端同步的结果库条目可能带它（F218），Desktop 只需认得",
  attachment_action_required: "适配器 attach() 契约码，由 content/upload.js 透传字符串返回值；当前没有适配器产出，契约保留（docs/adapters.md）"
};

test("every site code produced by the runtime has explicit user-facing copy", () => {
  const known = new Set<string>([...SITE_CODES, ...collectionCodes()]);
  for (const [code, file] of producedCodes()) {
    assert.ok(known.has(code) || code in PRODUCED_WITHOUT_COPY,
      `${file} 产出码 ${code}，但 SITE_CODES / describeCollectionCode 都没有它，也没登记豁免理由——用户会看到兜底的笼统文案`);
  }
});

test("every code in the copy tables is really produced somewhere", () => {
  const produced = producedCodes();
  for (const code of [...SITE_CODES, ...collectionCodes()]) {
    assert.ok(produced.has(code) || code in COPY_WITHOUT_PRODUCER,
      `文案表里的 ${code} 在产出方源码里找不到——码被改名/删除后文案成了死条目，或需要登记豁免理由`);
  }
  for (const code of Object.keys(COPY_WITHOUT_PRODUCER)) {
    assert.ok(!produced.has(code), `${code} 现在已有产出方，把它从 COPY_WITHOUT_PRODUCER 里摘掉`);
  }
});
