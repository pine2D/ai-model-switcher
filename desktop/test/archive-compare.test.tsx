import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { ArchiveCompare } from "../src/renderer/archive-compare";
import { compareAnswerParagraphs } from "../src/shared/archive-compare";
import { getCopy } from "../src/shared/copy";

test("answer comparison marks only exact paragraphs as shared", () => {
  const comparison = compareAnswerParagraphs(
    "Shared paragraph.\n\nLeft only.\ncontinues",
    "Shared paragraph.\n\nshared paragraph.\n\nRight only."
  );

  assert.deepEqual(comparison.left, [
    { text: "Shared paragraph.", relation: "shared" },
    { text: "Left only.\ncontinues", relation: "unique" }
  ]);
  assert.deepEqual(comparison.right, [
    { text: "Shared paragraph.", relation: "shared" },
    { text: "shared paragraph.", relation: "unique" },
    { text: "Right only.", relation: "unique" }
  ]);
});

test("answer comparison renders two explicit choices without rankings", () => {
  const copy = getCopy("zh-CN");
  const html = renderToStaticMarkup(
    <ArchiveCompare
      copy={copy}
      results={[
        { host: "claude.ai", label: "Claude", text: "共同段落\n\nClaude 内容" },
        { host: "chatgpt.com", label: "ChatGPT", text: "共同段落\n\nChatGPT 内容" },
        { host: "gemini.google.com", label: "Gemini", text: "Gemini 内容" }
      ]}
    />
  );

  assert.match(html, /回答对照/);
  assert.match(html, /仅按完全相同的段落标记/);
  assert.match(html, /name="compare-left"/);
  assert.match(html, /name="compare-right"/);
  assert.match(html, /共同段落/);
  assert.match(html, /仅此回答/);
  assert.doesNotMatch(html, /评分|更好|最佳/);
});
