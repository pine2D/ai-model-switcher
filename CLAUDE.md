# PolyAsk · AI 众答

发布物包括 Chrome MV3 扩展和 `desktop/` Electron 预览包。**核心是群发到 9 个真实 AI 页面并排比较**；切档可报错，群发不能断。两端均有图片、结果库、辅助综合和 Drive 同步；扩展保持原生 JS、无构建、classic script。

<!-- 最后与代码核对：2026-09-01 · manifest v0.24.1。发版前重跑核对并更新这行。
     本文件控制在 11 KB 内；新增硬约束先挤旧项或外迁 docs/。 -->

## 先读哪份（下面几份不常驻上下文，动到对应部分再读）

| 你要做的事 | 先读 |
| --- | --- |
| 动 `content/`：注入/提交/切档/汇总、站点、图片、页面改版 | `docs/adapters.md`（契约、站点卡、图片限额） |
| 动后台/扩展页/manifest：窗口、群发、存储、Drive、迁移、权限、快捷键 | `docs/console-windows.md`（错误码、预算、epoch、交接、文件职责） |
| 写回归测试、真机复现、chrome-dbg/CDP 探锚点 | `docs/verify.md` |
| 发版/tag、改用户文案或三语词条、动打包白名单 | `docs/release.md`（含 i18n 落点表） |
| 动 `desktop/`：窗口/视图、preload、React shell、IPC、安全、打包 | `docs/desktop-m0.md` |

专题文档更细；**与本文硬约束冲突时以 CLAUDE.md 为准**，并立刻修正文档。站点 DOM/时序坑写 `docs/adapters.md`，CDP/工具坑写 `docs/verify.md`，不要重复。

## 硬约束（违反不报错，只会静默出事）

- **popup-only 铁律**：所有「host→窗口」解析只走 `popupWindowForHost(host,wins)`，只返回 `type:"popup"`；关窗 `removeIfPopup(id)`、改窗 `updateIfPopup(id,props)`（先 get 校验 type）。**禁止用 `tabs.query({url})` 按 URL 反查窗口**（`{active,currentWindow}` 取当前标签、`{windowId}` 取已登记窗口的标签不在此列）——曾因此把用户日常 `type:"normal"` 窗口收编进平铺/广播/新会话并清空其对话。openTile/sendAll/focusAll/minimizeAll/newSession 全走它。
- **提交不确定 ≠ 可以重发**：消息超时、端口断开、`submit_unconfirmed` 一律 `done(false,"submit_unconfirmed")` 交给用户点 retry。**只有**实现了只读 `adapter.submitted(text)` 的站（目前仅 Kimi）、且明确确认「末条用户消息不是本次内容」，才允许自动重试一次。给没有 `submitted()` 的站加自动重发 = 同一个问题被问两遍且用户无从察觉。
- **删除一律 tombstone**：写 `deletedAt` + 入 outbox，不物理删；清空历史也要留标记，否则其它设备会同步回来。本机重置不删 Drive 数据；要改先改承诺文案。
- **判定阈值绝不贴着实测值写**：`findComposer` 的高度阈值是 `>=16` 不是 `>=20`。标称 20px 的编辑器在开了显示缩放的机器上实测 19.999998px，零余量的 `>=20` 筛掉唯一真编辑器 → `findComposer` 返回 null → 整条群发链空跑到 44s 截止线（v0.15.2 事故根因）。**凡拿实测值定阈值，一律留 ≥20% 余量**（标称 20 → 写 16）。
- **`deadline` 是绝对时间戳、全链路透传**：`bg/broadcast.js` 算出 → content `submitPrompt` → `adapter.submit`/`attach` → `confirmSubmitted`。**循环等待、以及 ≥1s 的固定等待，一律夹取**：`Math.min(x, Math.max(0, deadline - Date.now()))`。唯一例外是「让编辑器/菜单渲染跟上」的毫秒级 sleep（inject 后 150ms、点击后 250/400ms）——既有惯例可不夹取，但单条 ≤500ms，且不得在一条路径上叠成秒级。console 客户端兜底必须严格大于后台预算。
- **只产 `code`，不产用户可见文案**：bg/content 返回错误码，console 翻译；bg 轮询认 `r.code`，**绝不正则匹配文案**。新增可见码须补**五张**扩展翻译表与三语词条（位置见 `docs/console-windows.md`）；两端都会出现的码还要补 `desktop/src/shared/status-copy.ts` 与 `desktop/src/shared/copy.ts` 三语。漏一处就裸露英文 reason。
- **`diagnose()` 每条检查必须带 `kind`**（`reach`/`control`/`tier`/`probe`，机器字段不产文案）。Desktop 只让**非 `tier`** 的红项决定站点可用性——各站 `state()` 是刻意的偏函数，用户停在任何非预设的合法档位（千问 Qwen3.7+快速、Kimi Instant、元宝 Expert）都返回 null，那不是故障。漏标一处会被归成 `control` 继续误报（方向安全但等于没修），`scripts/test-diag-runtime.js` 的九站不变量守着。
- **适配器协议**：每站必需 `{think, fast, state, diagnose}` 四项，其余钩子可选、不实现 = 该能力静默降级（不是报错）。`state`/`diagnose`/`answer`/`submitted` **只读同步，不得开菜单**。`return false` = 落回 core 通用链；`throw` = 通用链对本站不安全，core 直接失败**不回退**。全表与九站映射见 `docs/adapters.md`。
- **切档控件缺失一律 `throw`，不要静默 `return`**——静默 return 会让 `runMode` 误报「已切到」并弹假成功 toast。例外只有 3 处（DeepSeek 首屏 radio、Gemini 两处），全部写死在适配器里；加新例外前先读 `docs/adapters.md` 的例外清单及其理由。
- **站点 UI 三条通用规则**（细节与反例见 `docs/adapters.md`）：① 控件在下沉到二级子菜单，默认「顶层找不到 → 展开子菜单 → 再找」，别假设一层列表；② 同一 role 可能承载不同语义的列表，取列表必须校验语义，否则「最高档」被点成末位模型；③ **每个菜单动作自己 `escMenus()` 收尾**，子菜单不关会罩住输入框并让后续动作点空。
- **群发取消（epoch）**：`_sendEpoch` / `cancelPendingSends()`。新写的长流程必须在每个 `await` 后核对 epoch，否则用户关了控制台、后台还在往站点输入框里打字。现成写法：`bg/broadcast.js` 轮询循环每轮核对，`background.js` 的 collect 在入口前后各核对一次。
- **compose ↔ console 一次性交接只走 `console/run-meta.js`**：写 `storage.session` 的 `amsPendingRun`，取出即删，且必须 `text` 匹配才认。**不要新增 storage.local 常驻键或点对点消息**——这条路径已返工八次，每次都是「交接窗口没关严，旧上下文漏进下一次发送」。
- **新增持久化键要同时登记**同步白名单 / 跨设备投影 / 重置清单 /（若迁移）迁移类型 /（若设置页可见）`PREFS`；位置见 `docs/console-windows.md`。漏一处，同步/迁移/重置/回填会静默失效。
- **不申请任何 AI 站点 host 权限**（站点访问只靠 `content_scripts.matches` 那 9 条），`host_permissions` 仅 `https://www.googleapis.com/*`。动权限必须同步 options 设置页 `#privacy` 区的隐私文案 + README + CHANGELOG。
- **图片限额（张数 / 类型 / 单批大小）改任何一个数**，两端代码 + 三语词条 + README/docs 叙述共十处落点要一起改；清单与当前数值以 `scripts/test-image-limits.js` 的对账项和 `docs/adapters.md`「图片载荷」为准，别凭记忆列。
- **加站点 / 新开适配器分卷**：两端各有一串登记落点，漏项会静默缺席（`test-site-selection.js` 会红）。清单见 `docs/adapters.md` 的「加新站点」与「新开一卷要登记五处」。
- **单文件 ≤300 行（JS）**：`scripts/verify.sh` 会失败。`bg/`、`content/`、`console/` 有多份已贴着上限（动手前 `wc -l` 一遍，别凭记忆行数）；要加行须按站点或职责拆分，不要靠压行/删注释续命。`scripts/` 同样受限。
- **MV3 扩展页 CSP 是 `script-src 'self'`**：内联 `<script>` 与 `on*=` 被拦，连「防首帧闪烁的主题预应用」也必须外链（`console/theme.js` 放 `<head>` 内，外链脚本仍先于首帧执行；各页 head 顺序见 docs）。
- **真机验证不可省，本机全绿 ≠ 用户环境可用**：适配器/切档/发送 bug 须重载扩展、刷新站点，再用生产 `__AMS` 回归。**本机不能复现时先要现象再猜层次**（composer / inject / submit / state）；四问话术与两机差异见 `docs/verify.md`。
- **`console.html` 的 `#live` 不可删**：群发进度、失败汇总、收集结果都写入。圆点变色对读屏不可见，这是唯一进度通道。
- **已发布 tag 不覆盖**，改内容必须升版；新增扩展运行时顶层项必须登记 `RUNTIME`，否则会产出坏包。`desktop/` 独立，禁止打进扩展 ZIP。
- **扩展与 Desktop 版本一致**：`prepare-release.sh` 同步 manifest 与 Desktop package/lock。Release 从 Repository Variable 注入合法 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID`，缺 `resources/oauth.json` 拒发；5 个 Desktop 包均未签名。

## 命令

```bash
bash scripts/verify.sh               # 零依赖的仓库级卫生：.js/.mjs 语法 + JSON + 300 行（.js）+ desktop/src 400 行棘轮 + OAuth 卫生 + 文档/.github 引用 + workflow YAML + 根 scripts 五个跨端测试 + git diff --check
cd desktop && npm test               # Desktop 门禁：tsc --noEmit + tsx --test（test/）+ node --test（scripts/*.test.{js,mjs}，含九站适配器回归）；verify.sh 不跑它
cd desktop && npm run typecheck      # 与 npm test 首段重叠，CI 单独再跑一遍是刻意的双保险
bash scripts/prepare-release.sh auto # 推导版本、晋升 CHANGELOG、同步 Desktop package/lock（只改文件不 commit）
bash scripts/release.sh --publish    # 推 tag 并触发五个 Desktop 包发布（--build-only 只校验源码并提取 Release 正文）
```

## 架构（先在这里定位入口文件）

- **群发编排**：`background.js`（SW 入口）→ `bg/`（窗口/平铺/群发/伴侣窗/读页/辅助综合）。
- **站点适配**：`content/core.js` + `content/{send,md,upload,pill,diag,generation,adapters-intl,adapters-intl2,adapters-cn,adapters-cn2}.js`（`pill.js` 只进扩展、`generation.js` 只进 Desktop preload，两条豁免见 `docs/adapters.md`）。
- **数据与同步**：`bg/` 的 8 个数据模块；`store` 使用 IndexedDB `polyask`。
- **扩展页面**：`console/`（96px 细条主 console + 三个独立 popup）、`popup/`、`options/`、根 `i18n.js`。
- **桌面预览版**：`desktop/src/{main,preload,renderer}/`；复用 content 适配器，独立打包、独立会话。

逐文件职责、HTML 脚本顺序、存储键位置见 `docs/console-windows.md`。

## Git

- 提交用 `git-commit` skill（Conventional Commits，可带 AI 署名 trailer）；仓库无 user 配置，用内联身份提交。
- 持续维护 `CHANGELOG.md` 的「未发布」段，所有用户可感知变更都要记。发版流程见 `docs/release.md`。
- `docs/` 默认 gitignore，只有 `.gitignore` 白名单里那几份契约文档入库；其余 `docs/*.md` 与 `.superpowers/`、`.spec-workflow/`、`.codegraph/`、`.serena/`、`dist/`、`scratchpad/` 克隆者都拿不到——别把需要入库的东西放进去（要入库就补白名单），也别在入库文档里引用未入库的路径（`verify.sh` 的文档引用检查按 `git ls-files` 判定，会直接红）。
