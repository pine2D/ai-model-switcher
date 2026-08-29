import assert from "node:assert/strict";
import React from "react";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PromptLibrary } from "../src/renderer/prompt-library";
import { COPY } from "../src/shared/copy";

test("prompt library searches templates and history and keeps explicit actions", () => {
  const html = renderToStaticMarkup(<PromptLibrary
    copy={COPY.zhCN}
    draft="Current prompt"
    templates={[{ id: "one", name: "代码审查", text: "Review", updatedAt: 1, deviceId: "a" }]}
    history={[{ id: "h", text: "Earlier question", lastUsedAt: 2 }]}
    onInsert={() => undefined}
    onSave={() => undefined}
    onDelete={() => undefined}
  />);
  assert.match(html, /搜索模板和最近提问/);
  assert.match(html, /保存当前提问/);
  assert.match(html, /代码审查/);
  assert.match(html, /Earlier question/);
  assert.match(html, /删除模板/);
});
