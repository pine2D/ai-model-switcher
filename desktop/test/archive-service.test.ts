import assert from "node:assert/strict";
import test from "node:test";

import { ArchiveService } from "../src/main/archive-service";
import { DesktopDatabase } from "../src/main/database";

function createService() {
  const database = DesktopDatabase.open(":memory:");
  let now = 1_000;
  const service = new ArchiveService(database.archives, {
    deviceId: () => "device-a",
    now: () => now,
    createId: () => `archive-${now}`
  });
  return { database, service, setNow: (value: number) => { now = value; } };
}

test("archive search filters task, answer preview, tag and favorite", () => {
  const { database, service, setNow } = createService();
  try {
    const climate = service.add({
      text: "Compare climate policy",
      task: "Compare climate policy",
      results: [{ host: "claude.ai", label: "Claude", text: "Climate answer" }]
    });
    setNow(2_000);
    service.update(climate.id, { favorite: true, tags: ["work"] });
    service.add({
      text: "Dinner",
      task: "Dinner",
      results: [{ host: "kimi.com", label: "Kimi", text: "Recipe" }]
    });

    const results = service.search({ query: "climate", tag: "work", favorite: true });

    assert.deepEqual(results.items.map((item) => item.id), [climate.id]);
    assert.deepEqual(results.tags, ["work"]);
  } finally {
    database.close();
  }
});

test("archive update validates metadata and delete never physically removes the row", () => {
  const { database, service, setNow } = createService();
  try {
    const record = service.add({
      text: "Question",
      task: "Question",
      source: {
        kind: "page",
        title: "Reference",
        url: "https://example.com/article",
        truncated: false,
        capturedAt: 900
      },
      results: [
        { host: "claude.ai", label: "Claude", text: "Answer" },
        { host: "kimi.com", label: "Kimi", text: null, code: "no_answer" }
      ]
    });
    setNow(2_000);
    const updated = service.update(record.id, {
      favorite: true,
      tags: ["research", "research"],
      note: "Compare later",
      winnerHost: "claude.ai"
    });
    assert.deepEqual(updated.tags, ["research"]);
    assert.match(updated.searchText, /compare later/);
    assert.throws(() => service.update(record.id, { winnerHost: "kimi.com" }), /invalid_winner/);
    assert.throws(() => service.update(record.id, { synthesis: { host: "", text: "x", state: null, instruction: "", createdAt: 2_000 } }), /invalid_synthesis/);

    setNow(3_000);
    service.delete(record.id);
    assert.equal(service.get(record.id), null);
    const stored = database.archives.get(record.id);
    assert.ok(stored && "deletedAt" in stored);
    assert.equal(stored.deletedAt, 3_000);
  } finally {
    database.close();
  }
});

test("archive markdown preserves missing-answer placeholders", () => {
  const { database, service } = createService();
  try {
    const record = service.add({
      text: "Question",
      task: "Question",
      source: {
        kind: "page",
        title: "Reference",
        url: "https://example.com/article",
        truncated: false,
        capturedAt: 900
      },
      results: [
        { host: "claude.ai", label: "Claude", text: "Answer", state: "think" },
        { host: "kimi.com", label: "Kimi", text: null, code: "no_answer" }
      ]
    });
    service.update(record.id, { winnerHost: "claude.ai" });
    service.update(record.id, { synthesis: { host: "chatgpt.com", text: "Combined answer", state: "fast", instruction: "Compare", createdAt: 1_000 } });

    const markdown = service.exportMarkdown(record.id, "zh-CN");

    assert.match(markdown, /^# 问题\n\nQuestion/);
    assert.match(markdown, /\*\*来源\*\*: \[Reference\]\(https:\/\/example\.com\/article\)/);
    assert.match(markdown, /## Claude · 深度思考/);
    assert.match(markdown, /\*\*最佳回答\*\*\n\nAnswer/);
    assert.match(markdown, /## Kimi\n\n> 暂无回答/);
    assert.match(markdown, /## 综合结果\n\n\*\*目标 AI\*\*: ChatGPT · 快速\n\nCombined answer/);
  } finally {
    database.close();
  }
});
