# PolyAsk Desktop 产品化迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有单窗口九站 Electron M0 上依次完成高密度 UI 收敛、集成与稳定性门禁、扩展核心能力迁移、Google Drive 同步，以及最终全面缺陷与 UI/UX 升级。

**Architecture:** Electron main process 继续拥有九个 `WebContentsView`、布局、可信 IPC、SQLite 数据库、OAuth 与同步引擎；本地 React Shell 负责高密度命令栏、抽屉和全屏工作区；site preload 复用现有 content adapters。方案按可独立验收的阶段推进，扩展和桌面共享数据语义但不共享 Chrome 专属运行时。

**Tech Stack:** Electron 43、Electron Forge 7、Node 24 `node:sqlite`、TypeScript 5、React 19、原生 CSS、Node test runner + tsx、Google OAuth 2.0 PKCE、Drive REST API v3。

**Spec:** `docs/desktop-m0.md`、`docs/desktop-research.md`

## Global Constraints

- 始终保留一个 `BrowserWindow` + 9 个持续运行的 `WebContentsView`；功能页面不得退回九个 Chrome tab、iframe 或截图卡片。
- 远程站点始终使用 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`；所有 Shell IPC 校验 sender 与顶层 frame。
- `deadline` 使用绝对时间戳并全链路透传；`submit_unconfirmed` 不自动重发；取消后每个 await 都核对 epoch。
- 图片最多 4 张，仅 PNG/JPEG，总计不超过 10 MiB；校验 data URL、声明长度、魔数和实际解码。
- 删除历史、归档、模板和分组一律写 tombstone；本地重置不删除 Drive 数据，清空 Drive 是独立二段确认动作。
- Drive 只申请 `drive.appdata`，OAuth 只在系统浏览器完成，使用 PKCE S256、随机 state 和 loopback 回调。
- OAuth refresh token 只用 Electron `safeStorage` 保存；Linux `basic_text` backend 不持久化 token。
- 桌面与扩展共享 schema 1 的 history/archive/state 文件语义，不复制 Chrome Cookie，不伪装 UA，不绕过证书或登录策略。
- 所有用户可见文案同时维护 en、zh-CN、zh-TW；完整错误只由本地化 code 映射产生，不显示 adapter raw reason。
- TypeScript/JavaScript 单文件不超过 300 行；新增职责优先拆为纯模型、main service、preload contract 和 renderer component。
- 每项行为变更执行 TDD：先写失败测试并看到预期失败，再写最小实现；每个关键节点独立 commit。
- 每个阶段都运行 `npm test`、`npm run typecheck`、`bash scripts/verify.sh` 与 `git diff --check`；涉及打包或 Electron 行为时再运行 `npm run package`、`npm run smoke`。

---

### Task 1: 高密度命令栏收敛

**Files:**
- Create: `desktop/src/renderer/keyboard.ts`
- Modify: `desktop/src/renderer/command-bar.tsx`
- Modify: `desktop/src/renderer/icons.tsx`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/shared/copy.ts`
- Modify: `desktop/test/renderer-components.test.tsx`
- Modify: `desktop/test/copy.test.ts`
- Create: `desktop/test/keyboard.test.ts`
- Modify: `docs/desktop-m0.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: `commandKeyAction(event: PromptKeyEvent): "submit" | "collapse" | null`。
- Produces: `SiteSettingIcon`、`FastIcon`、`DeepThinkIcon`，均为 `aria-hidden` 的 16px Lucide 几何。
- Preserves: `aria-pressed`、三语 `title`/`aria-label`、可见焦点、粗指针命中区和发送/取消状态机。

- [ ] **Step 1: 写失败测试**

```ts
test("tier choices are icon-only while their accessible names stay complete", () => {
  const html = renderCommandBar({ tier: null });
  assert.doesNotMatch(html, />PolyAsk</);
  assert.match(html, /aria-label="Use site setting"/);
  assert.match(html, /aria-label="Fast"/);
  assert.match(html, /aria-label="Deep thinking"/);
  assert.equal((html.match(/data-tier-icon=/g) || []).length, 3);
});

test("IME composition never submits or collapses the prompt", () => {
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: true, metaKey: false, isComposing: true }), null);
  assert.equal(commandKeyAction({ key: "Enter", ctrlKey: true, metaKey: false, isComposing: false }), "submit");
});
```

- [ ] **Step 2: 运行 RED**

Run: `cd desktop && npx tsx --test test/renderer-components.test.tsx test/keyboard.test.ts`

Expected: 品牌仍在、档位仍输出文字、`commandKeyAction` 不存在而失败。

- [ ] **Step 3: 最小实现**

```ts
export interface PromptKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing: boolean;
}

export function commandKeyAction(event: PromptKeyEvent): "submit" | "collapse" | null {
  if (event.isComposing) return null;
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") return "submit";
  return event.key === "Escape" ? "collapse" : null;
}
```

删除 `.brand` DOM/CSS；档位顺序固定为“使用站点设置 / 快速 / 深度思考”，使用 `SlidersHorizontal`、`Zap`、`BrainCircuit` 图标，完整名称进入 `title` 与 `aria-label`。

- [ ] **Step 4: GREEN 与全量验证**

Run: `cd desktop && npm test && npm run typecheck`

Run: `bash scripts/verify.sh && git diff --check`

Expected: 桌面测试和扩展门禁全部通过，三语键集合一致。

- [ ] **Step 5: 视觉回归**

启动应用，在 2048×1152 和约 1280×720 CSS px 下确认命令栏无品牌重复、三个档位可辨、键盘焦点可见、中文输入法候选确认不会群发。

- [ ] **Step 6: 提交**

```bash
git add desktop/src desktop/test docs/desktop-m0.md CHANGELOG.md
git commit -m "feat(desktop): converge compact command controls"
```

### Task 2: Electron smoke 与 60 分钟稳定性门禁

**Files:**
- Create: `desktop/src/main/diagnostics.ts`
- Create: `desktop/src/main/stability-monitor.ts`
- Create: `desktop/scripts/smoke.mjs`
- Create: `desktop/scripts/soak.mjs`
- Create: `desktop/test/diagnostics.test.ts`
- Create: `desktop/test/stability-monitor.test.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/main/view-manager.ts`
- Modify: `desktop/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/desktop-m0.md`

**Interfaces:**
- Produces: `DiagnosticInput { shellId, sites, layout }` 与 `buildDiagnosticSnapshot(input): DiagnosticSnapshot`；Electron 对象先在 main process 边界转换为只读字面量，纯模型不依赖 Electron class。
- Produces: `StabilityMonitor.sample(metrics, events)` 和 JSONL 报告，包含 timestamp、PID、type、CPU、workingSet、peakWorkingSet、crash/load/unresponsive 事件。
- 环境变量只在测试启动时生效：`POLYASK_DIAGNOSTICS_FILE`、`POLYASK_SOAK_REPORT`、`POLYASK_SOAK_MINUTES`；`app.isPackaged` 不开放远程调试端口。

- [ ] **Step 1: 写失败诊断测试**

```ts
test("diagnostic snapshot proves one shell and nine secure site views", () => {
  const snapshot = buildDiagnosticSnapshot({
    shellId: 1,
    layout: { mode: "overview", focused: "claude", placements: ninePlacements },
    sites: SITE_KEYS.map((site, index) => ({
      site,
      webContentsId: index + 2,
      partition: "persist:polyask-sites",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      bounds: ninePlacements[index].bounds
    }))
  });
  assert.equal(snapshot.shellCount, 1);
  assert.equal(snapshot.sites.length, 9);
  assert.ok(snapshot.sites.every((site) => site.partition === "persist:polyask-sites"));
  assert.ok(snapshot.sites.every((site) => site.sandbox && site.contextIsolation && !site.nodeIntegration));
});
```

- [ ] **Step 2: RED → 最小诊断实现 → GREEN**

Run: `cd desktop && npx tsx --test test/diagnostics.test.ts`

Expected RED: 模块缺失。实现只读快照后重跑，Expected GREEN: PASS。

- [ ] **Step 3: 写失败稳定性聚合测试**

```ts
test("soak summary reports growth and renderer failures", () => {
  const summary = summarizeSamples([sample(100), sample(145)], [{ type: "render-process-gone", site: "kimi" }]);
  assert.equal(summary.workingSetGrowthKb, 45);
  assert.equal(summary.failures[0].site, "kimi");
});
```

- [ ] **Step 4: 实现 smoke/soak runner**

`npm run smoke` 先打包当前平台，启动产物，等待诊断 JSON，断言九站与安全偏好后退出。`npm run soak -- --minutes=60` 启动同一产物，每分钟采样，60 分钟后输出摘要并优雅退出；任何 renderer crash、unresponsive 或诊断缺站返回非零。

- [ ] **Step 5: 验证**

Run: `cd desktop && npm test && npm run typecheck && npm run smoke`

Run: `cd desktop && npm run soak -- --minutes=3`

Expected: 短时门禁用于开发验证；正式 M0 记录另跑 60 分钟，不以 3 分钟代替。

- [ ] **Step 6: CI 与提交**

CI Linux 执行 `npm run smoke`，60 分钟 soak 保留为人工/定时门禁。


```bash
git add desktop .github/workflows/ci.yml docs/desktop-m0.md
git commit -m "test(desktop): add runtime smoke and stability gates"
```

### Task 3: SQLite 数据与桌面领域契约

**Files:**
- Create: `desktop/src/shared/workspace.ts`
- Create: `desktop/src/shared/archive.ts`
- Create: `desktop/src/shared/sync.ts`
- Create: `desktop/src/main/database.ts`
- Create: `desktop/src/main/history-repository.ts`
- Create: `desktop/src/main/archive-repository.ts`
- Create: `desktop/src/main/state-repository.ts`
- Create: `desktop/test/workspace.test.ts`
- Create: `desktop/test/archive.test.ts`
- Create: `desktop/test/database.test.ts`
- Modify: `desktop/src/main/index.ts`

**Interfaces:**
- Produces: `WorkspaceState { selectedSites, groups, tier }` 与 `WorkspaceGroup { id, name, sites, updatedAt, deviceId, deletedAt? }`。
- Produces: `ArchiveRecord`，字段与扩展 schema 1 的 `ArchiveModel.validMetadata()` 一致。
- Produces: `DesktopDatabase.open(path)`, `HistoryRepository`, `ArchiveRepository`, `StateRepository`。
- Database tables: `history`、`archives`、`state_items`、`outbox`、`drive_files`、`meta`；正文以 JSON 保存，排序时间与 tombstone 单列建索引。

- [ ] **Step 1: 写失败领域测试**

```ts
test("deleting an archive keeps a tombstone", () => {
  const deleted = tombstoneArchive(record, 2_000, "device-b");
  assert.equal(deleted.deletedAt, 2_000);
  assert.equal(deleted.updatedAt, 2_000);
  assert.equal(deleted.deviceId, "device-b");
});

test("workspace selection accepts known sites only and keeps product order", () => {
  assert.deepEqual(normalizeSelection(["kimi", "claude", "unknown"]), ["claude", "kimi"]);
});
```

- [ ] **Step 2: 运行 RED**

Run: `cd desktop && npx tsx --test test/workspace.test.ts test/archive.test.ts`

Expected: 新模块缺失而失败。

- [ ] **Step 3: 写失败持久化测试**

```ts
test("archive updates and tombstones survive reopen", () => {
  const path = temporaryDatabasePath();
  const first = DesktopDatabase.open(path);
  first.archives.put(record);
  first.archives.delete(record.id, 2_000, "device-b");
  first.close();
  const reopened = DesktopDatabase.open(path);
  assert.equal(reopened.archives.get(record.id)?.deletedAt, 2_000);
  reopened.close();
});
```

- [ ] **Step 4: 运行 RED 并实现 SQLite schema**

Run: `cd desktop && npx tsx --test test/database.test.ts`

Expected: `DesktopDatabase` 不存在而失败。

实现 `DatabaseSync`、`PRAGMA journal_mode=WAL`、`foreign_keys=ON`、参数化语句和事务。测试数据库只写 `os.tmpdir()` 下的独立目录。

- [ ] **Step 5: GREEN 与打包验证**

Run: `cd desktop && npm test && npm run typecheck && npm run package`

Expected: Node 测试、Webpack 和 Electron 43 的 `node:sqlite` 打包全部通过。

- [ ] **Step 6: 提交**

```bash
git add desktop/src desktop/test desktop/forge.config.ts
git commit -m "feat(desktop): add durable workspace data store"
```

### Task 4: 站点范围、分组与新会话

**Files:**
- Create: `desktop/src/main/workspace-service.ts`
- Create: `desktop/src/renderer/workspace-drawer.tsx`
- Create: `desktop/src/renderer/workspace-actions.tsx`
- Modify: `desktop/src/shared/contracts.ts`
- Modify: `desktop/src/shared/protocol.ts`
- Modify: `desktop/src/main/view-manager.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/shell.ts`
- Modify: `desktop/src/renderer/command-bar.tsx`
- Modify: `desktop/src/renderer/index.tsx`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/shared/copy.ts`
- Create: `desktop/test/workspace-service.test.ts`
- Modify: `desktop/test/layout.test.ts`
- Modify: `desktop/test/security.test.ts`

**Interfaces:**
- Produces: `WorkspaceService.getState()`, `setSelection(sites)`, `saveGroup(input)`, `deleteGroup(id)`, `newSession(sites)`。
- Produces Shell IPC: `polyask:workspace-state`、`polyask:set-selection`、`polyask:save-group`、`polyask:delete-group`、`polyask:new-session`、`polyask:set-drawer-open`。
- `ViewManager.setDrawerOpen(open)` 为 Shell 左侧保留 compact 280px / comfortable 320px，不覆盖原生 views；关闭后恢复原 bounds。

- [ ] **Step 1: 写失败服务测试**

```ts
test("new session reloads selected sites at canonical URLs without touching others", async () => {
  await service.newSession(["claude", "kimi"]);
  assert.deepEqual(navigations, [["claude", "https://claude.ai/new"], ["kimi", "https://www.kimi.com/"]]);
});

test("group deletion writes a tombstone", () => {
  const deleted = service.deleteGroup("research");
  assert.ok(deleted.deletedAt);
});
```

- [ ] **Step 2: RED → service 与 IPC GREEN**

Run: `cd desktop && npx tsx --test test/workspace-service.test.ts test/security.test.ts`

验证未知站点、重复站点、空分组、超长名称和不可信 sender 均被拒绝。

- [ ] **Step 3: 写失败布局测试并实现抽屉占位**

```ts
test("opening the scope drawer reserves width instead of covering site views", () => {
  const placements = computeWorkspaceLayout(area, { drawerWidth: 280 });
  assert.ok(placements.every((item) => item.bounds.x >= 280));
  assert.ok(placements.every((item) => item.bounds.width > 0));
});
```

- [ ] **Step 4: 实现连续多选与分组 UI**

抽屉提供全部、清空、支持图片、国外、国内和用户分组；单站选择不会自动关闭抽屉。分组删除使用与条目 id 绑定的二段确认；每次重渲染撤销确认态。

- [ ] **Step 5: 全量验证与提交**

Run: `cd desktop && npm test && npm run typecheck && npm run smoke`

```bash
git add desktop/src desktop/test CHANGELOG.md
git commit -m "feat(desktop): add site scope and session controls"
```

### Task 5: 多图片群发

**Files:**
- Create: `desktop/src/shared/images.ts`
- Create: `desktop/src/renderer/image-picker.tsx`
- Modify: `desktop/src/shared/protocol.ts`
- Modify: `desktop/src/main/broadcast.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/shell.ts`
- Modify: `desktop/src/preload/site.ts`
- Modify: `desktop/src/renderer/command-bar.tsx`
- Modify: `desktop/src/renderer/index.tsx`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/shared/copy.ts`
- Create: `desktop/test/images.test.ts`
- Modify: `desktop/test/broadcast.test.ts`
- Modify: `desktop/test/protocol.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: `DesktopImage { name, type, size, dataUrl }` 与 `validateImages(value): DesktopImage[] | null`。
- `BroadcastRequest.images` 最多 4 项；有图 timeout 为 90 秒，无图为 44 秒。
- Site command 继续把相同 `images` 数组交给现有 `submitPrompt`，由 `content/upload.js` 做最终解码和站点附件确认。

- [ ] **Step 1: 写失败图片契约测试**

```ts
test("desktop accepts four valid PNG/JPEG files up to ten MiB total", () => {
  assert.equal(validateImages(validImages(4, 10 * 1024 * 1024))?.length, 4);
});

test("desktop rejects a mismatched signature before site dispatch", () => {
  assert.equal(validateImages([{ name: "x.png", type: "image/png", size: 3, dataUrl: "data:image/png;base64,QUJD" }]), null);
});
```

- [ ] **Step 2: RED → 校验与协议 GREEN**

Run: `cd desktop && npx tsx --test test/images.test.ts test/protocol.test.ts test/broadcast.test.ts`

- [ ] **Step 3: 实现紧凑图片入口**

命令栏使用 `ImagePlus` 图标；选择后显示数量徽标和可移除的缩略列表。只向 `image:true` 的站点群发；用户选择了不支持站点时，在发送前以三语明确列出并要求用户调整范围，不静默跳过。

- [ ] **Step 4: 真机验证与提交**

在 Claude、ChatGPT、DeepSeek、豆包、Kimi、元宝各验证一张 PNG；Gemini、千问、智谱显示不支持而不发送。确认取消不会让同一图片自动重传。

Run: `cd desktop && npm test && npm run typecheck && npm run package`

Run: `bash scripts/verify.sh`

```bash
git add desktop/src desktop/test README.md CHANGELOG.md
git commit -m "feat(desktop): support multi-image broadcasts"
```

### Task 6: 回答汇总、历史与归档工作区

**Files:**
- Create: `desktop/src/main/collection-service.ts`
- Create: `desktop/src/main/archive-service.ts`
- Create: `desktop/src/renderer/archive-workspace.tsx`
- Create: `desktop/src/renderer/archive-detail.tsx`
- Modify: `desktop/src/shared/protocol.ts`
- Modify: `desktop/src/main/view-manager.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/shell.ts`
- Modify: `desktop/src/renderer/workspace-actions.tsx`
- Modify: `desktop/src/renderer/index.tsx`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/shared/copy.ts`
- Create: `desktop/test/collection-service.test.ts`
- Create: `desktop/test/archive-service.test.ts`
- Create: `desktop/test/archive-components.test.tsx`

**Interfaces:**
- Site command union新增 `{ source:"AMS", cmd:"collect" }`，响应 `CollectedAnswer { site, host, label, text, state, code? }`。
- Produces: `CollectionService.collect(sites, runId)`，以点击时刻为准，不等待流式结束。
- Produces: `ArchiveService.search/get/add/update/delete/exportMarkdown`。
- `ViewManager.setSurface("sites" | "archive" | "settings")` 临时 detach/reattach site views，保持 webContents 与页面状态不变。

- [ ] **Step 1: 写失败收集测试**

```ts
test("collection preserves product order and reports missing answers", async () => {
  const results = await service.collect(["claude", "kimi"], "run-1");
  assert.deepEqual(results.map((item) => item.site), ["claude", "kimi"]);
  assert.equal(results[1].code, "no_answer");
});
```

- [ ] **Step 2: RED → 收集 IPC GREEN**

Run: `cd desktop && npx tsx --test test/collection-service.test.ts test/protocol.test.ts`

- [ ] **Step 3: 写失败归档测试**

```ts
test("archive search filters task, answer preview, tag and favorite", () => {
  repository.put(archiveFixture);
  assert.equal(service.search({ query: "climate", tag: "work", favorite: true }).items.length, 1);
});

test("archive delete never physically removes the row", () => {
  service.delete(archiveFixture.id);
  assert.ok(repository.getIncludingDeleted(archiveFixture.id)?.deletedAt);
});
```

- [ ] **Step 4: 实现单窗口归档表面**

归档工作区覆盖 Shell 并 detach 九个 views，不新开窗口；关闭归档后原 webContents id 和滚动/回答状态保持不变。功能包括列表、搜索、标签、收藏、笔记、最佳答案、Markdown 预览/复制/导出和二段删除确认。

- [ ] **Step 5: 自动保存语义**

每次成功群发写历史；用户点击汇总时定格问题、档位、站点选择、来源、各站结果和时间，写入归档后再复制 Markdown。没有答案的站点保留错误码占位，不伪装成功。

- [ ] **Step 6: 验证与提交**

Run: `cd desktop && npm test && npm run typecheck && npm run smoke`

```bash
git add desktop/src desktop/test CHANGELOG.md README.md
git commit -m "feat(desktop): add collection and archive workspace"
```

### Task 7: 辅助综合工作流

**Files:**
- Create: `desktop/src/shared/synthesis.ts`
- Create: `desktop/src/main/synthesis-service.ts`
- Create: `desktop/src/renderer/synthesis-workspace.tsx`
- Modify: `desktop/src/shared/protocol.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/shell.ts`
- Modify: `desktop/src/renderer/archive-detail.tsx`
- Modify: `desktop/src/renderer/index.tsx`
- Modify: `desktop/src/shared/copy.ts`
- Create: `desktop/test/synthesis.test.ts`
- Create: `desktop/test/synthesis-service.test.ts`
- Create: `desktop/test/synthesis-components.test.tsx`

**Interfaces:**
- Produces: `buildSynthesisPrompt({ task, answers, selectedSites, instruction }): string`，与扩展 `SynthesisModel.build()` 的输出语义一致。
- Produces: `SynthesisService.send({ archiveId, targetSite, tier, selectedHosts, instruction })`。
- 流程：目标站新会话 → 单站发送综合提示 → 用户看到实时生成 → 收集目标站最新回答 → 确认保存到原归档 `synthesis` 字段。

- [ ] **Step 1: 写失败纯模型测试**

```ts
test("synthesis prompt contains only selected successful answers", () => {
  const text = buildSynthesisPrompt(fixture);
  assert.match(text, /Claude answer/);
  assert.doesNotMatch(text, /failed Gemini/);
  assert.match(text, /Resolve disagreements/);
});
```

- [ ] **Step 2: RED → 模型 GREEN**

Run: `cd desktop && npx tsx --test test/synthesis.test.ts`

- [ ] **Step 3: 写失败状态机测试**

验证 archive 不存在、没有成功答案、目标未选择、发送取消、`submit_unconfirmed`、收集失败和替换已有 synthesis 的二段确认。

- [ ] **Step 4: 实现单窗口综合 UI 与服务**

综合工作区复用 Archive surface；提供答案复选、目标站、档位、自定义要求和完整提示预览。发送后返回 sites surface 并聚焦目标站；保存后回到原归档详情。

- [ ] **Step 5: 验证与提交**

Run: `cd desktop && npm test && npm run typecheck && npm run smoke`

```bash
git add desktop/src desktop/test CHANGELOG.md
git commit -m "feat(desktop): add assisted synthesis workflow"
```

### Task 8: Google Drive 桌面 OAuth 与同步

**Files:**
- Create: `desktop/src/main/oauth-pkce.ts`
- Create: `desktop/src/main/token-store.ts`
- Create: `desktop/src/main/drive-client.ts`
- Create: `desktop/src/main/sync-engine.ts`
- Create: `desktop/src/main/sync-repository.ts`
- Create: `desktop/src/renderer/settings-workspace.tsx`
- Create: `desktop/resources/oauth.example.json`
- Modify: `desktop/src/shared/sync.ts`
- Modify: `desktop/src/shared/protocol.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/shell.ts`
- Modify: `desktop/src/renderer/index.tsx`
- Modify: `desktop/src/shared/copy.ts`
- Modify: `desktop/forge.config.ts`
- Modify: `desktop/package.json`
- Create: `desktop/test/oauth-pkce.test.ts`
- Create: `desktop/test/token-store.test.ts`
- Create: `desktop/test/drive-client.test.ts`
- Create: `desktop/test/sync-engine.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: `OAuthPkce.authorize({ clientId, scope, openExternal, listen }): Promise<TokenSet>`。
- Produces: `TokenStore.save/load/clear`，持久化 refresh token 时必须经过 `safeStorage.encryptStringAsync`。
- Produces: `DriveClient.listFiles/listChanges/getStartToken/download/upsert/clearAll`，只访问 Drive v3 与 `appDataFolder`。
- Produces: `SyncEngine.connect/syncNow/disconnect/clearRemote/status`，本地变更 3 秒去抖、周期 15 分钟、启动时同步。
- Produces: `loadOAuthClientId()`；开发优先读取 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID`，发行包读取构建时生成的 `resources/oauth.json`。`oauth.example.json` 只说明 `{ "clientId": "...apps.googleusercontent.com" }` 结构，不进入发行包。
- Sync 状态：`idle | syncing | offline | auth | blocked | waiting | schema | error`；界面只显示本地化 code。

- [ ] **Step 1: 写失败 PKCE 测试**

```ts
test("desktop OAuth uses system browser, S256 PKCE, state and loopback redirect", async () => {
  const request = await buildAuthorizationRequest({ clientId: "client", port: 43123, randomBytes: fixedRandom });
  assert.equal(request.url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(request.url.searchParams.get("state"));
  assert.equal(request.url.searchParams.get("redirect_uri"), "http://127.0.0.1:43123");
});
```

- [ ] **Step 2: RED → OAuth 与 token store GREEN**

授权 listener 只绑定 `127.0.0.1` 随机端口，校验 state，5 分钟超时后关闭；错误页不回显 token/code。系统浏览器由 `shell.openExternal` 打开。

Run: `cd desktop && npx tsx --test test/oauth-pkce.test.ts test/token-store.test.ts`

- [ ] **Step 3: 写失败 Drive transport 测试**

覆盖 401 刷新一次、403 policy/quota 分类、404、410 page token 失效、429/5xx Retry-After、分页 list/changes、非法 JSON 与取消。

- [ ] **Step 4: 写失败同步合并测试**

使用手工 fixtures 验证 state/history/archive 合并、deviceId 决胜、tombstone 胜出、future schema 只读、outbox revision、防旧上传覆盖新写入，以及“断开不删 Drive”。

- [ ] **Step 5: 实现设置工作区**

设置表面提供连接、立即同步、断开、清空云端、状态、最近成功时间、待上传数和 Linux token backend 警示。清空云端必须输入明确确认文本；缺少 desktop OAuth client ID 时显示 `oauth_not_configured`，不回退 Chrome Extension client。

- [ ] **Step 6: 集成验证**

Run: `cd desktop && npm test && npm run typecheck && npm run smoke`

使用测试 Google Cloud Desktop client 完成系统浏览器授权，验证扩展写入的 history/groups/archive 可被桌面读取，桌面 tombstone 可被扩展合并。

- [ ] **Step 7: 提交**

```bash
git add desktop/src desktop/test desktop/resources desktop/forge.config.ts desktop/package.json desktop/package-lock.json README.md CHANGELOG.md
git commit -m "feat(desktop): add secure Drive synchronization"
```

### Task 9: 全面缺陷排查与 UI/UX 优化升级

**Files:**
- Modify: `desktop/src/**`（仅修复审查确认的问题）
- Modify: `desktop/test/**`
- Create: `docs/desktop-audit.md`
- Modify: `docs/desktop-m0.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: 逐项证据化审查表，按 blocker/P0/P1/P2 记录现象、根因、修复、自动化与真机证据。
- Preserves: 九站 webContents id、登录 session、绝对 deadline、epoch、tombstone、三语和安全边界。

- [ ] **Step 1: 静态缺陷审查**

检查所有 IPC parser、sender/frame 校验、导航与 popup 策略、文件/URL/图片边界、OAuth token 泄漏、SQLite 注入、错误码覆盖、取消竞态、renderer crash 恢复、单文件行数和未使用依赖。

- [ ] **Step 2: 动态压力审查**

覆盖：连续双击发送、发送中取消后立即新发、九站加载中切 Grid/Focus、抽屉与 archive 往返、图片上传中取消、归档并发写/删、Drive 离线/401/410/429、renderer crash、系统休眠恢复和 60 分钟 soak。

- [ ] **Step 3: UI/UX 规范审查**

使用 `web-design-guidelines`、`claude-mem:design-is` 和 `frontend-design`：检查信息优先级、空白、控件分组、缩放、截断、键盘顺序、读屏、高对比度、粗指针、reduced motion、亮暗色和三语长度。只实施有证据的优化，不为了装饰增加 chrome。

- [ ] **Step 4: 每个确认 bug 走 RED/GREEN**

每个问题先写能复现的失败测试或运行时脚本；若只能真机验证，在 `docs/desktop-audit.md` 记录精确步骤、截图和修复前后现象。

- [ ] **Step 5: 截图矩阵**

采集 Grid、宽 Focus、窄 Focus、scope drawer、图片态、archive、synthesis、settings；覆盖 en/zh-CN/zh-TW、亮/暗、高对比度、100%/125%/150%/200%。确认没有 view 重叠、横向滚动、不可达控件或站点页面被 Shell 遮挡。

- [ ] **Step 6: 全量验证**

Run: `bash scripts/verify.sh`

Run: `cd desktop && npm test && npm run typecheck && npm audit --omit=dev && npm run package && npm run smoke`

Run: `cd desktop && npm run soak -- --minutes=60`

Expected: 全部退出码 0，soak 无 renderer crash/unresponsive；所有未完成原生平台项仍明确标注，不能用 WSLg 代替。

- [ ] **Step 7: 提交**

```bash
git add desktop/src desktop/test docs/desktop-audit.md docs/desktop-m0.md README.md CHANGELOG.md
git commit -m "fix(desktop): complete productization audit"
```

### Task 10: 跨平台完成审计与交付

**Files:**
- Modify: `docs/desktop-m0.md`
- Modify: `docs/desktop-audit.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `.github/workflows/ci.yml`（仅在平台 runner 验证后）

**Interfaces:**
- Produces: Windows、macOS、原生 Ubuntu 的启动、登录、布局、图片、归档、OAuth、同步、辅助综合、可访问性和安装包证据。
- Produces: requirement-by-requirement completion audit，不以“未发现问题”替代证据。

- [ ] **Step 1: Windows 原生验收**

验证 100%/125%/150%/200% 缩放、Alt 菜单、中文 IME、Narrator、高对比度、系统浏览器 OAuth、DPAPI token、安装/升级/卸载和 60 分钟稳定性。

- [ ] **Step 2: macOS 原生验收**

验证系统菜单、Command 快捷键、VoiceOver、Keychain、全屏、系统浏览器 OAuth、签名/notarization 前置和 60 分钟稳定性。

- [ ] **Step 3: 原生 Ubuntu 验收**

验证 X11/Wayland、Orca、Secret Service 可用与 `basic_text` 降级、系统浏览器 OAuth、deb/rpm 运行和 60 分钟稳定性。

- [ ] **Step 4: 完成审计**

逐条对照本计划、`docs/desktop-m0.md`、用户方案 2/3 和审查清单，给每项附自动化输出、运行时快照、截图或平台记录。缺少证据的项目保持未完成。

- [ ] **Step 5: 最终提交**

```bash
git add .github/workflows/ci.yml README.md CHANGELOG.md docs/desktop-m0.md docs/desktop-audit.md
git commit -m "docs(desktop): record cross-platform productization evidence"
```
