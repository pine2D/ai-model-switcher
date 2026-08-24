# Desktop Unified Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将桌面端改造成同一密度系统下的 3×3 Grid、宽屏 4×3 Focus 与窄屏 3×4 Focus，并在不重载九个真实站点的前提下释放页面空间、稳定换位和提供可控页面缩放。

**Architecture:** Main process 继续拥有原生视图的 bounds、Focus 槽位和站点缩放；Shell renderer 只负责命令栏、站点框架、显示偏好和经过 preload 白名单的 IPC。纯布局、显示偏好解析和缩放决策放入无 Electron 依赖的模块，以 Node 测试先锁定；React Shell 拆为小组件，避免继续放大 `index.tsx`。

**Tech Stack:** Electron 43、Electron Forge 7、TypeScript 5、React 19、原生 CSS、Node test runner + tsx；不增加运行依赖或 UI 组件库。

**Spec:** `docs/desktop-m0.md` 的“Grid / Focus 综合密度规格”。

## Global Constraints

- 9 个站点始终使用真实、实时、可交互的 `WebContentsView`，不得替换成截图或纯状态卡。
- Grid 固定为 3×3；Focus 在可用宽度 `>=1440 CSS px` 时使用 4×3 主次马赛克，否则使用 3×4 主次马赛克；主站占 2×2。
- 请求 Grid 但单格宽度 `<380 CSS px` 或总高度 `<210 CSS px` 时自动采用 Focus。
- Focus 换站只交换当前主站和目标次要站；布局切换不得销毁、重载或中断任何站点。
- compact 命令栏不超过 52px、站点标题条 24px、外边距和网格间距 4px；尺寸来自 4px 基础令牌。
- Grid 页面默认 90%，Focus 主站 100%、次要站 90%；用户可以统一使用 100%。
- 远程页面不得获得 Electron/Node API；所有新增 IPC 必须验证 shell 顶层 sender 和输入枚举。
- 紧凑模式交互目标不得小于 24×24 CSS px；警示与失败不能只依赖颜色；三语键集合必须一致。
- 不注入依赖站点 DOM 的密度 CSS，不改变群发 deadline、epoch、错误码或不确定提交不重发语义。
- 继续满足扩展全量 `scripts/verify.sh`、桌面 `npm test`、`npm run typecheck` 和 `npm run package`。

---

### Task 1: 响应式主次马赛克与稳定 Focus 槽位

**Files:**
- Modify: `desktop/src/main/layout.ts`
- Modify: `desktop/src/main/view-manager.ts`
- Modify: `desktop/test/layout.test.ts`

**Interfaces:**
- Consumes: `SiteKey`、`ViewBounds`、`ViewPlacement`、现有 `LayoutOptions`。
- Produces: `resolveLayoutMode(requested, area, gap)`、`computeViewLayout(keys, area, options)` 和 `swapFocusedSite(order, current, next)`；Task 2、3 继续依赖同一 `LayoutState.placements` 契约。

- [ ] **Step 1: 写出 Grid 高宽门槛、宽/窄 Focus 几何和稳定交换的失败测试**

在 `desktop/test/layout.test.ts` 将宽度参数测试改为完整内容区，并加入：

```ts
test("overview requires every tile to meet width and height floors", () => {
  assert.equal(resolveLayoutMode("overview", { x: 0, y: 0, width: 1199, height: 900 }, 4), "focus");
  assert.equal(resolveLayoutMode("overview", { x: 0, y: 0, width: 1440, height: 620 }, 4), "focus");
  assert.equal(resolveLayoutMode("overview", { x: 0, y: 0, width: 1440, height: 900 }, 4), "overview");
});

test("wide focus uses a four by three mosaic with a two by two primary", () => {
  const result = computeViewLayout(keys, { x: 0, y: 0, width: 1600, height: 900 }, {
    mode: "focus", focused: "claude", gap: 4
  });
  const primary = result.find((item) => item.key === "claude")!;
  const secondary = result.filter((item) => item.key !== "claude");
  assert.equal(result.length, 9);
  assert.ok(secondary.every((item) => primary.bounds.width > item.bounds.width));
  assert.ok(secondary.every((item) => primary.bounds.height > item.bounds.height));
});

test("narrow focus uses a three by four mosaic", () => {
  const result = computeViewLayout(keys, { x: 0, y: 0, width: 1200, height: 800 }, {
    mode: "focus", focused: "claude", gap: 4
  });
  assert.equal(new Set(result.map((item) => item.bounds.y)).size, 4);
});

test("focus changes swap only the current and requested sites", () => {
  assert.deepEqual(
    swapFocusedSite(keys, "claude", "gemini"),
    ["gemini", "chatgpt", "claude", "doubao", "deepseek", "qianwen", "kimi", "yuanbao", "chatglm"]
  );
});
```

- [ ] **Step 2: 运行布局测试并确认失败原因来自尚未实现的新签名和马赛克**

Run: `cd desktop && npx tsx --test test/layout.test.ts`

Expected: FAIL，至少包含 `swapFocusedSite is not a function` 或 `resolveLayoutMode` 参数/断言不匹配。

- [ ] **Step 3: 实现纯布局函数**

在 `desktop/src/main/layout.ts`：

```ts
const WIDE_FOCUS_MIN = 1_440;
const GRID_TILE_MIN_WIDTH = 380;
const GRID_TILE_MIN_HEIGHT = 210;

export function resolveLayoutMode(
  requested: "overview" | "focus",
  area: ViewBounds,
  gap = 4
): "overview" | "focus" {
  if (requested === "focus") return "focus";
  const tileWidth = (area.width - gap * 2) / 3;
  const tileHeight = (area.height - gap * 2) / 3;
  return tileWidth < GRID_TILE_MIN_WIDTH || tileHeight < GRID_TILE_MIN_HEIGHT
    ? "focus"
    : "overview";
}

export function swapFocusedSite(
  order: readonly SiteKey[],
  current: SiteKey,
  next: SiteKey
): SiteKey[] {
  const result = [...order];
  const currentIndex = result.indexOf(current);
  const nextIndex = result.indexOf(next);
  if (currentIndex < 0 || nextIndex < 0 || currentIndex === nextIndex) return result;
  [result[currentIndex], result[nextIndex]] = [result[nextIndex], result[currentIndex]];
  return result;
}
```

用 `splitAxis()` 生成 4×3 或 3×4 tracks；主站合并左上 2×2，次要站按规格中的八个剩余槽位依次放置。跨度宽高必须用相邻 track 的实际边界计算，不能假设整除。

- [ ] **Step 4: 让 ViewManager 持有 Focus 槽位顺序**

在 `ViewManager` 增加：

```ts
private focusOrder: SiteKey[] = SITES.map((site) => site.key);
```

`setLayout()` 在进入 Focus 或切换主站时调用 `swapFocusedSite(this.focusOrder, this.focused, focused)`，而 `layout()` 在 Grid 使用固定 `SITES` 顺序、Focus 使用 `focusOrder`。先算内容区，再用新 `resolveLayoutMode(this.mode, area, gap)` 判定自动 Focus。

- [ ] **Step 5: 运行布局与桌面全量测试**

Run: `cd desktop && npm test && npm run typecheck`

Expected: 全部 PASS，且 `focus gives the selected site the largest surface and keeps eight live` 保持通过。

- [ ] **Step 6: 提交布局交付物**

```bash
git add desktop/src/main/layout.ts desktop/src/main/view-manager.ts desktop/test/layout.test.ts
git -c user.name="OpenAI Codex" -c user.email="codex@openai.com" commit -m "feat(desktop): add responsive focus mosaic"
```

### Task 2: 显示偏好、密度指标与安全页面缩放

**Files:**
- Create: `desktop/src/shared/display.ts`
- Create: `desktop/src/renderer/display-preferences.ts`
- Create: `desktop/test/display.test.ts`
- Modify: `desktop/src/shared/protocol.ts`
- Modify: `desktop/src/shared/copy.ts`
- Modify: `desktop/src/main/view-manager.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/shell.ts`
- Modify: `desktop/src/renderer/index.tsx`
- Modify: `desktop/test/copy.test.ts`
- Modify: `desktop/test/shell-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `LayoutState`、`ViewManager.layout()` 和 Focus 主站。
- Produces: `DisplayPreferences`、`DisplayMetrics`、`parseDisplayPreferences()`、`metricsForDensity()`、`zoomForSite()`、`loadDisplayPreferences()`、`saveDisplayPreferences()`；Task 3 用这些值驱动 Shell 尺寸。

- [ ] **Step 1: 写出显示偏好解析、密度尺寸和缩放决策的失败测试**

创建 `desktop/test/display.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  metricsForDensity,
  parseDisplayPreferences,
  zoomForSite
} from "../src/shared/display";

test("display preferences accept only supported density and scale", () => {
  assert.deepEqual(parseDisplayPreferences({ density: "compact", siteScale: 0.9 }), {
    density: "compact", siteScale: 0.9
  });
  assert.equal(parseDisplayPreferences({ density: "tiny", siteScale: 0.9 }), null);
  assert.equal(parseDisplayPreferences({ density: "compact", siteScale: 0.8 }), null);
});

test("compact metrics obey the density budget", () => {
  assert.deepEqual(metricsForDensity("compact"), {
    shellHeight: 52, tileHeaderHeight: 24, edgeGap: 4, viewGap: 4
  });
});

test("fit scale keeps a focused primary at 100 percent", () => {
  assert.equal(zoomForSite(DEFAULT_DISPLAY_PREFERENCES, "overview", false), 0.9);
  assert.equal(zoomForSite(DEFAULT_DISPLAY_PREFERENCES, "focus", true), 1);
  assert.equal(zoomForSite(DEFAULT_DISPLAY_PREFERENCES, "focus", false), 0.9);
  assert.equal(zoomForSite({ density: "compact", siteScale: 1 }, "focus", false), 1);
});
```

同文件用内存 `getItem/setItem` 对象验证损坏 JSON 回落默认值、保存后可读回。

- [ ] **Step 2: 运行显示测试并确认模块缺失**

Run: `cd desktop && npx tsx --test test/display.test.ts`

Expected: FAIL with `Cannot find module '../src/shared/display'`。

- [ ] **Step 3: 实现无 Electron 依赖的显示契约**

创建 `desktop/src/shared/display.ts`：

```ts
export type Density = "compact" | "comfortable";
export type SiteScale = 0.9 | 1;

export interface DisplayPreferences {
  readonly density: Density;
  readonly siteScale: SiteScale;
}

export interface DisplayMetrics {
  readonly shellHeight: number;
  readonly tileHeaderHeight: number;
  readonly edgeGap: number;
  readonly viewGap: number;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  density: "compact",
  siteScale: 0.9
};

export function parseDisplayPreferences(value: unknown): DisplayPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.density !== "compact" && candidate.density !== "comfortable") return null;
  if (candidate.siteScale !== 0.9 && candidate.siteScale !== 1) return null;
  return { density: candidate.density, siteScale: candidate.siteScale };
}
```

`metricsForDensity("comfortable")` 返回 `{ shellHeight: 64, tileHeaderHeight: 32, edgeGap: 8, viewGap: 8 }`。`zoomForSite()` 只返回 `0.9` 或 `1`。

- [ ] **Step 4: 实现 Shell 偏好持久化 helper**

`desktop/src/renderer/display-preferences.ts` 使用固定键 `polyask.display`，`loadDisplayPreferences(storage)` 捕获 JSON 异常并回落 `DEFAULT_DISPLAY_PREFERENCES`；未保存偏好且 `matchMedia("(pointer: coarse)").matches` 时，调用方将 density 初值改为 `comfortable`。`saveDisplayPreferences()` 只序列化经过 parser 的对象。

- [ ] **Step 5: 将显示偏好接入 ViewManager 和站点 zoom**

`ViewManager` 增加：

```ts
private display = DEFAULT_DISPLAY_PREFERENCES;

getDisplayPreferences(): DisplayPreferences {
  return this.display;
}

setDisplayPreferences(value: DisplayPreferences): void {
  this.display = value;
  this.layout();
}
```

`layout()` 使用 `metricsForDensity(this.display.density)` 计算 shell、标题条和 gap。布局完成后遍历 views，只在 `webContents.getZoomFactor()` 与目标值不同时调用 `setZoomFactor()`；目标值由 `zoomForSite(display, renderedMode, key === focused)` 决定。

- [ ] **Step 6: 增加经过 shell 顶层 sender 校验的 IPC 与原生菜单项**

`BootstrapState` 增加 `display: DisplayPreferences`。Shell preload 暴露：

```ts
setDisplayPreferences(value: DisplayPreferences): Promise<DisplayPreferences>;
onDisplayPreferences(listener: (value: DisplayPreferences) => void): () => void;
```

Main 注册 `polyask:set-display` handler：先执行既有 `trustedShell(event)`，再调用 `parseDisplayPreferences(value)`，失败抛 `invalid_display_preferences`；成功后更新 manager、重建菜单并把规范化值返回 Shell。原生 View 菜单增加两组 radio：紧凑/舒适、适应/100%，点击后调用同一更新函数并向 Shell 发送 `polyask:display-preferences` 以持久化。

- [ ] **Step 7: 在 Renderer 启动时读取、应用和保存偏好**

`App` 初始化读取 localStorage；bootstrap 后调用 `window.polyask.setDisplayPreferences(initialDisplay)`。`onDisplayPreferences` 收到原生菜单变更后更新 React state、设置 `document.documentElement.dataset.density` 并持久化。增加并同步三语键：`densityMenu`、`compactDensity`、`comfortableDensity`、`siteScaleMenu`、`fitSiteScale`、`actualSiteScale`。

- [ ] **Step 8: 运行显示、文案、IPC 和全量桌面测试**

Run: `cd desktop && npm test && npm run typecheck`

Expected: 全部 PASS；`copy.test.ts` 继续证明 en/zhCN/zhTW 键完全一致；`shell-contract.test.ts` 证明新 IPC 仍复用 `trustedShell`。

- [ ] **Step 9: 提交显示偏好交付物**

```bash
git add desktop/src desktop/test
git -c user.name="OpenAI Codex" -c user.email="codex@openai.com" commit -m "feat(desktop): add density and site scale preferences"
```

### Task 3: 统一紧凑命令栏与临时多行编辑区

**Files:**
- Create: `desktop/src/renderer/command-bar.tsx`
- Create: `desktop/src/renderer/site-frames.tsx`
- Create: `desktop/src/renderer/icons.tsx`
- Modify: `desktop/src/renderer/index.tsx`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/shared/copy.ts`
- Modify: `desktop/src/main/view-manager.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/preload/shell.ts`
- Modify: `desktop/test/copy.test.ts`
- Modify: `desktop/test/shell-contract.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `DisplayPreferences`、`metricsForDensity()`、现有 broadcast/layout/status API。
- Produces: `CommandBar`、`SiteFrames`、`Icon` 组件及 `polyask:set-composer-expanded` transient IPC；Task 4 在这些组件上实施优先级和可访问性收纳。

- [ ] **Step 1: 写出 52px Shell、24px 标题条和临时展开行为的失败契约**

在 `desktop/test/shell-contract.test.ts` 加入：

```ts
test("compact shell uses shared density metrics and a transient composer expansion", () => {
  const manager = readFileSync("src/main/view-manager.ts", "utf8");
  const preload = readFileSync("src/preload/shell.ts", "utf8");
  assert.match(manager, /metricsForDensity/);
  assert.match(preload, /setComposerExpanded/);
});

test("renderer splits the command bar and site frames into focused components", () => {
  const renderer = readFileSync("src/renderer/index.tsx", "utf8");
  assert.match(renderer, /<CommandBar/);
  assert.match(renderer, /<SiteFrames/);
});
```

- [ ] **Step 2: 运行 Shell contract 并确认失败**

Run: `cd desktop && npx tsx --test test/shell-contract.test.ts`

Expected: FAIL，因为组件和 `setComposerExpanded` 尚不存在。

- [ ] **Step 3: 拆分纯展示组件**

`command-bar.tsx` 的 props 明确包含 `text`、`tier`、`runState`、`layoutMode`、选择数量、文案和回调；组件不直接调用 IPC。`site-frames.tsx` 接收 `sites`、`statuses`、`layout`、`selected` 和选择/聚焦/重载回调。`icons.tsx` 只提供带 `aria-hidden="true"` 的 16px SVG：Grid、Focus、Reload、More；无障碍名称留在 button。

- [ ] **Step 4: 实现临时展开而非 DOM 浮层**

Electron 的原生 `WebContentsView` 位于 BrowserWindow renderer 之上，Shell DOM 无法可靠覆盖它，因此采用一次性临时扩展：textarea focus 时调用 `setComposerExpanded(true)`，blur 或 Escape 时调用 `false`；main 仅在布尔值改变时重新 layout 一次，输入字符和换行不继续触发重排。compact 展开高度固定 120px，comfortable 为 144px；收起后恢复 Task 2 的 52/64px。

Main 的 `polyask:set-composer-expanded` 只接受 boolean 且复用 `trustedShell`；ViewManager 增加 `composerExpanded` 和 `setComposerExpanded(value)`，窗口关闭时不持久化该状态。

- [ ] **Step 5: 将 Shell 改成单行 command deck**

`styles.css` 用变量统一：

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --shell-height: 52px;
  --tile-header-height: 24px;
  --control-height: 32px;
  --target-size: 24px;
}

:root[data-density="comfortable"] {
  --shell-height: 64px;
  --tile-header-height: 32px;
  --control-height: 40px;
  --target-size: 32px;
}
```

`.command-bar` 使用单行 grid：品牌、布局切换、`minmax(200px, 1fr)` 提问框、档位、数量、发送。收起 textarea 高度等于 control；展开时 command bar 高度跟随 main 传入的 transient 状态。删除原 `.topbar` + `.composer` 双层结构和 `brandSub` 的可见输出，但保留应用标题与读屏名称。

- [ ] **Step 6: 保持群发、取消和焦点行为不回归**

`index.tsx` 继续拥有状态和副作用，向组件传回调。`Ctrl/Cmd+Enter`、取消锁定、`Ctrl/Cmd+Shift+P` 聚焦 textarea、Grid/Focus `aria-pressed` 和逐站 live region 行为必须原样保留。

- [ ] **Step 7: 运行 Shell contract、桌面全量测试和类型检查**

Run: `cd desktop && npm test && npm run typecheck`

Expected: 全部 PASS，`index.tsx` 低于 180 行，新 TS/TSX 文件各自低于 300 行。

- [ ] **Step 8: 提交紧凑 Shell 交付物**

```bash
git add desktop/src desktop/test
git -c user.name="OpenAI Codex" -c user.email="codex@openai.com" commit -m "feat(desktop): compact the unified command shell"
```

### Task 4: 响应式优先级、状态收纳与桌面交互抛光

**Files:**
- Modify: `desktop/src/renderer/command-bar.tsx`
- Modify: `desktop/src/renderer/site-frames.tsx`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/shared/status-copy.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/test/shell-contract.test.ts`
- Modify: `desktop/test/copy.test.ts`

**Interfaces:**
- Consumes: Task 3 的组件 props 和密度 CSS 变量。
- Produces: P0/P1/P2 responsive chrome、短状态展示、hover/focus 操作和平台菜单行为；不改变 main/layout 或 broadcast 契约。

- [ ] **Step 1: 写出优先级、状态和菜单行为的失败契约**

在 `shell-contract.test.ts` 加入源码契约：

```ts
test("dense chrome preserves primary actions and defers secondary actions", () => {
  const command = readFileSync("src/renderer/command-bar.tsx", "utf8");
  const frames = readFileSync("src/renderer/site-frames.tsx", "utf8");
  assert.match(command, /priority-p0/);
  assert.match(command, /priority-p1/);
  assert.match(frames, /tile-actions/);
  assert.match(frames, /aria-label/);
});

test("windows and linux auto-hide the native menu bar", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  assert.match(main, /setAutoHideMenuBar/);
});
```

- [ ] **Step 2: 运行契约测试并确认失败**

Run: `cd desktop && npx tsx --test test/shell-contract.test.ts`

Expected: FAIL，缺少 priority classes、tile actions 或 menu auto-hide。

- [ ] **Step 3: 应用 P0/P1/P2 收纳规则**

P0：提问框、档位、发送/取消、站点名、选择和状态轨道始终存在。P1：品牌文字、布局文字、选择摘要和普通状态短文案在空间不足时隐藏，但 button 保留 tooltip/`aria-label`。P2：聚焦和重载按钮默认 `opacity:0; pointer-events:none`，在 `.tile-frame:hover` 或 `.tile-frame:focus-within` 时恢复；粗指针媒体查询下始终显示。

- [ ] **Step 4: 压缩正常状态，只突出异常状态**

`SiteFrames` 对 `warning`、`failed`、`crashed` 显示短文案；`loading`、`ready`、`sending`、`submitted`、`cancelled` 只显示轨道和读屏文本。警示图标使用 `aria-hidden`，完整 `describeStatus()` 继续进入 live region 和 title，不输出 adapter raw reason。

- [ ] **Step 5: 完成平台菜单与精细视觉**

Windows/Linux 创建窗口后调用：

```ts
if (process.platform !== "darwin") {
  window.setAutoHideMenuBar(true);
  window.setMenuBarVisibility(false);
}
```

Shell 取消装饰性大圆角和多余阴影，保留现有靛蓝与状态色。按钮 target 使用 `--target-size`；相邻小按钮不得低于 24px。所有新增动效只过渡颜色/透明度，`prefers-reduced-motion` 下关闭发送轨道脉冲。

- [ ] **Step 6: 运行三语、Shell 与全量桌面验证**

Run: `cd desktop && npm test && npm run typecheck`

Expected: 全部 PASS；三语键一致，所有 icon-only button 均有 `aria-label`，警示和失败仍显示可见文字。

- [ ] **Step 7: 提交交互抛光交付物**

```bash
git add desktop/src desktop/test
git -c user.name="OpenAI Codex" -c user.email="codex@openai.com" commit -m "feat(desktop): refine dense responsive controls"
```

### Task 5: 全量验证、截图回归与状态文档

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/desktop-m0.md`
- Modify: `desktop/test/layout.test.ts` only if measured acceptance assertions need correction
- Modify: `desktop/test/shell-contract.test.ts` only if final packaged behavior exposes a missing contract

**Interfaces:**
- Consumes: Tasks 1–4 的完整桌面功能。
- Produces: 可复现的验证证据、用户可见说明和干净工作区；不新增功能接口。

- [ ] **Step 1: 运行静态和单元门禁**

Run:

```bash
bash scripts/verify.sh
cd desktop
npm test
npm run typecheck
npm audit --omit=dev
```

Expected: 扩展全量通过；桌面测试 0 fail；TypeScript 0 error；运行依赖 0 项已知漏洞。

- [ ] **Step 2: 打包最终 Linux 目录**

Run: `cd desktop && npm run package`

Expected: Forge 完成 Linux x64 package，主进程、shell preload、site preload 和 renderer bundles 无错误。

- [ ] **Step 3: 做最终产物布局冒烟**

启动 `desktop/out/polyask-desktop-linux-x64/polyask-desktop`，验证：

- 2048×1152 Grid：9 站同时可见，命令栏收起不超过 56px。
- 2048×1152 Focus：主站 2×2，8 个次要站均保持真实页面，次要站宽度至少 480px。
- 1280×720 Focus：使用 3×4，9 个 view 不重叠、不越界。
- 点击次要站后只有主站和目标站交换，回答不中断，刷新后登录仍在。
- 90%/100%、compact/comfortable、三语和 `Ctrl/Cmd+Shift+P` 均可操作。

- [ ] **Step 4: 采集三张截图并与规格核对**

采集 Grid、宽屏 Focus、窄屏 Focus。人工检查命令栏截断、标题条重叠、站点原生横向滚动、异常状态文字、键盘焦点环和粗指针 fallback；发现问题时先补失败契约再修，不直接改 CSS 猜数值。

- [ ] **Step 5: 更新用户与工程文档**

`CHANGELOG.md` 未发布段记录统一高密度 Shell、主次马赛克、页面缩放和稳定 Focus 换位。`README.md` 补充 Grid/Focus 职责及 View 菜单的密度/缩放入口。`docs/desktop-m0.md` 将“综合密度布局实现”从未完成项移除，并写入实际测量结果；不得把 WSLg 冒烟写成 Windows 原生验收。

- [ ] **Step 6: 运行提交前最终门禁**

Run:

```bash
git diff --check
bash scripts/verify.sh
cd desktop && npm test && npm run typecheck && npm run package
```

Expected: 所有命令成功，`git status --short` 只包含 Task 5 的预期文档/测试文件。

- [ ] **Step 7: 提交验收交付物**

```bash
git add CHANGELOG.md README.md docs/desktop-m0.md desktop/test
git -c user.name="OpenAI Codex" -c user.email="codex@openai.com" commit -m "docs(desktop): record unified density verification"
```
