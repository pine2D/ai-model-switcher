# PolyAsk · AI 众答

发布物包括 Chrome MV3 扩展和 `desktop/` Electron 跨平台预览包。**核心是群发到 9 个真实 AI 页面并排比较**；切深度/快速档可报错，群发链路不能断。扩展另有网页内容与迁移包；两端均有图片、结果库、辅助综合和 Drive 同步。扩展代码保持原生 JS、无构建、classic script。

<!-- 最后与代码核对：2026-08-25 · manifest v0.17.0。发版前重跑核对并更新这行。
     本文件控制在 11 KB 内；新增硬约束先挤旧项或外迁 docs/。 -->

## 先读哪份（下面几份不常驻上下文，动到对应部分再读）

| 你要做的事 | 先读 |
| --- | --- |
| 动 `content/` 任一文件：注入/提交/切档/汇总复制、加新站点、图片上传、某站改版后失灵 | `docs/adapters.md`（契约全表、九张站点卡、图片限额） |
| 动 `background.js`/`bg/`/`console/`/`popup/`/`options/`/`manifest.json`：开窗平铺、群发编排、联动最小化、进度圆点、96px 细条 UI、存储与 Drive 同步、迁移包、权限与快捷键 | `docs/console-windows.md`（错误码全表、超时预算表、epoch 与交接协议、逐文件职责） |
| 写回归测试、真机复现、chrome-dbg/CDP 探锚点 | `docs/verify.md` |
| 发版打 tag、改任何用户可见文案或三语词条（`i18n.js`/`_locales`/各 `*-i18n.js`）、动 `scripts/` 打包白名单 | `docs/release.md`（含 i18n 落点表） |
| 动 `desktop/`：窗口/视图、preload、React shell、IPC、安全、打包 | `docs/desktop-m0.md` |

专题文档比这里细，**但只要与本文「硬约束」冲突，一律以 CLAUDE.md 为准**——然后立刻回去把那份专题文档改对，不要留两套说法。
专题之间的分工：站点特有的 DOM/时序坑写进 `docs/adapters.md` 的站点卡，只在 CDP/工具层才咬人的坑写进 `docs/verify.md`，同一条别两边各写一遍。

## 硬约束（违反不报错，只会静默出事）

- **popup-only 铁律**：所有「host→窗口」解析只走 `popupWindowForHost(host,wins)`，只返回 `type:"popup"`；关窗 `removeIfPopup(id)`、改窗 `updateIfPopup(id,props)`（先 get 校验 type）。**禁止用 `tabs.query({url})` 按 URL 反查窗口**（`{active,currentWindow}` 取当前标签、`{windowId}` 取已登记窗口的标签不在此列）——曾因此把用户日常 `type:"normal"` 窗口收编进平铺/广播/新会话并清空其对话。openTile/sendAll/focusAll/minimizeAll/newSession 全走它。
- **提交不确定 ≠ 可以重发**：消息超时、端口断开、`submit_unconfirmed` 一律 `done(false,"submit_unconfirmed")` 交给用户点 retry。**只有**实现了只读 `adapter.submitted(text)` 的站（目前仅 Kimi）、且明确确认「末条用户消息不是本次内容」，才允许自动重试一次。给没有 `submitted()` 的站加自动重发 = 同一个问题被问两遍且用户无从察觉。
- **删除一律 tombstone**：写 `deletedAt` + 入 outbox，不物理删；清空提问历史也要留删除标记，否则其它设备下次同步把数据带回来。本机重置不删 Drive 数据（对用户的承诺语义，要改先改文案）。
- **判定阈值绝不贴着实测值写**：`findComposer` 的高度阈值是 `>=16` 不是 `>=20`。标称 20px 的编辑器在开了显示缩放的机器上实测 19.999998px，零余量的 `>=20` 筛掉唯一真编辑器 → `findComposer` 返回 null → 整条群发链空跑到 44s 截止线（v0.15.2 事故根因）。**凡拿实测值定阈值，一律留 ≥20% 余量**（标称 20 → 写 16）。
- **`deadline` 是绝对时间戳、全链路透传**：`bg/broadcast.js` 算出 → content `submitPrompt` → `adapter.submit`/`attach` → `confirmSubmitted`。**循环等待、以及 ≥1s 的固定等待，一律夹取**：`Math.min(x, Math.max(0, deadline - Date.now()))`。唯一例外是「让编辑器/菜单渲染跟上」的毫秒级 sleep（inject 后 150ms、点击后 250/400ms）——既有惯例可不夹取，但单条 ≤500ms，且不得在一条路径上叠成秒级。console 客户端兜底必须严格大于后台预算。
- **只产 `code`，不产用户可见文案**：bg 与 content 一律返回错误码，翻译在 console 侧按界面语言做；bg 的轮询判定认 `r.code`，**绝不正则匹配文案**。新增用户可见码要同时补四张翻译表与三语词条（四张表的位置见 `docs/console-windows.md` 错误码全表），漏一处那个页面就裸露英文 reason。
- **适配器协议**：每站必需 `{think, fast, state, diagnose}` 四项，其余钩子可选、不实现 = 该能力静默降级（不是报错）。`state`/`diagnose`/`answer`/`submitted` **只读同步，不得开菜单**。`return false` = 落回 core 通用链；`throw` = 通用链对本站不安全，core 直接失败**不回退**。全表与九站映射见 `docs/adapters.md`。
- **切档控件缺失一律 `throw`，不要静默 `return`**——静默 return 会让 `runMode` 误报「已切到」并弹假成功 toast。例外只有 4 处（DeepSeek 首屏 radio、Claude 无-effort-入口回退、Gemini 两处），全部写死在适配器里；加新例外前先读 `docs/adapters.md` 的例外清单及其理由。
- **站点 UI 三条通用规则**：① 控件正在下沉到二级子菜单（顶层只留当前值），写新逻辑默认「顶层找不到 → 找子菜单入口 → 展开 → 再找」，别假设一层列表；② 同一页面里不同语义的列表可能共用同一个 role（ChatGPT 的 Model 与 Effort 都是 `[role=menuitemradio]`），取列表必须校验语义，否则「最高档」被点成末位模型；③ **每个菜单动作自己 `escMenus()` 收尾**，子菜单不关会罩住输入框，并让后续动作点空。
- **群发取消（epoch）**：`_sendEpoch` / `cancelPendingSends()`。新写的长流程必须在每个 `await` 后核对 epoch，否则用户关了控制台、后台还在往站点输入框里打字。现成写法：`bg/broadcast.js` 轮询循环每轮核对，`background.js` 的 collect 在入口前后各核对一次。
- **compose ↔ console 一次性交接只走 `console/run-meta.js`**：写 `storage.session` 的 `amsPendingRun`，取出即删，且必须 `text` 匹配才认。**不要新增 storage.local 常驻键或点对点消息**——这条路径已返工八次，每次都是「交接窗口没关严，旧上下文漏进下一次发送」。
- **新增持久化键要同时登记多处**——同步白名单 / 跨设备设置投影 / 重置清单 /（要进迁移包）迁移类型 /（设置页可见开关）`PREFS`，五处文件与常量名见 `docs/console-windows.md` 数据位置。范例 `displayMode` 同时在同步白名单与重置清单里；漏一处，同步/迁移/重置/回填静默失效。
- **不申请任何 AI 站点 host 权限**（站点访问只靠 `content_scripts.matches` 那 9 条），`host_permissions` 仅 `https://www.googleapis.com/*`。动权限必须同步 options 设置页 `#privacy` 区的隐私文案 + README + CHANGELOG。
- **图片限额（张数 / 类型 / 单批大小，数值见 `docs/adapters.md`）改任何一个数**，就要同改 `content/upload.js` + `console/images.js` + README + 三语文案。
- **加站点**：扩展同改 manifest matches + 适配器 + `console/sites.js`；desktop 另改 `desktop/src/main/sites.ts`。漏项会静默缺席，`test-site-selection.js` 会红。步骤见 `docs/adapters.md`。
- **单文件 ≤300 行（JS）**：`scripts/verify.sh` 直接 `exit 1`。`bg/sync.js`、`bg/windows.js`、`content/core.js` 正好 300 行，加一行就红——动这三个必须同时想好拆分方案：按站点或职责分卷（`adapters-cn` → `adapters-cn2` 即此例），不要靠压行/删注释续命。`scripts/` 同样受限。
- **MV3 扩展页 CSP 是 `script-src 'self'`**：内联 `<script>` 与 `on*=` 被拦，连「防首帧闪烁的主题预应用」也必须外链（`console/theme.js` 放 `<head>` 内，外链脚本仍先于首帧执行；各页 head 顺序见 docs）。
- **真机验证不可省，且本机全绿 ≠ 用户环境可用**：改适配器、切档、发送相关的 bug，必须先重载扩展 + 刷新站点标签，再用生产 `__AMS` 复现和回归，不得只凭静态代码或官方文案推断。**用户报的 bug 在本机复现不出时，先要现象再猜层次**——问「输入框里有没有出现文字 / 有没有发出去 / 有没有报错文案」，据此定位坏在 composer / inject / submit / state 哪一层再动手。两机差异见 `docs/verify.md`——本机跑通不构成「已修复」的证据。
- **`console.html` 的 `#live` 播报区不可删**：群发进度、失败汇总、收集结果都要写进去。96px 细条上的圆点变色对读屏用户不可见，这是唯一进度通道——「精简 UI」类重构最容易顺手删掉它，且删了不报错。
- **已发布 tag 不覆盖**，改内容必须升版；新增扩展运行时顶层项必须登记 `RUNTIME`，否则会产出坏包。`desktop/` 独立，禁止打进扩展 ZIP。
- **扩展与 Desktop 共用发布版本**：`prepare-release.sh` 同步 manifest 与 Desktop package/lock。Desktop Release 必须从 Repository Variable 注入合法 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID`，产物缺 `resources/oauth.json` 直接拒发；当前四个平台/架构包均为未签名预览版。

## 命令

```bash
bash scripts/verify.sh               # 语法 + JSON + 300 行 + 文档/测试登记 + 全部 node 测试 + git diff --check
node scripts/test-<name>.js          # 单跑一个（改完仍要跑 verify.sh 全量）
bash scripts/prepare-release.sh auto # 推导版本、晋升 CHANGELOG、同步扩展与 Desktop 版本（只改文件不 commit）
bash scripts/release.sh --publish    # 推 tag 并触发五个主包发布（--build-only 只验 Chrome 包）
```

## 架构（先在这里定位入口文件）

- **群发编排**：`background.js`（SW 入口：快捷键转发、窗口登记清理、消息路由、`importScripts`）→ `bg/`（窗口/平铺/群发/伴侣窗/右键读页/辅助综合）。
- **站点适配**：`content/core.js`（`__AMS` 注册表、`runMode`/`switchTier`、`submitPrompt`、`onMessage`）+ `content/{md,upload,pill,diag,adapters-intl,adapters-cn,adapters-cn2}.js`。
- **数据与同步**：`bg/` 的 8 个数据模块（`store` 是 IndexedDB `polyask`，另有 data / sync-model / sync / drive / archive-model / transfer / data-admin）。
- **扩展页面**：`console/`（96px 细条主 console + compose/scope/archive 三个独立 popup）、`popup/`、`options/`、根 `i18n.js`。
- **桌面预览版**：`desktop/src/{main,preload,renderer}/`；复用 content 适配器，独立打包、独立会话。

逐文件职责、各 html 的 script 加载顺序（即依赖顺序）、存储键位置见 `docs/console-windows.md`——新增细条功能先按那份判断归属。

## Git

- 提交用 `git-commit` skill（Conventional Commits，可带 AI 署名 trailer）；仓库无 user 配置，用内联身份提交。
- 持续维护 `CHANGELOG.md` 的「未发布」段，所有用户可感知变更都要记。发版流程见 `docs/release.md`。
- 本地工作目录（`docs/superpowers/`、`.superpowers/`、`.spec-workflow/`、`.codegraph/`、`.serena/`、`dist/`、`scratchpad/`）已 gitignore——别把需要入库的东西放进去，也别在文档里假设克隆者有 `scratchpad/`。
