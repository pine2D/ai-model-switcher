# 后台编排、控制台与数据（`background.js` / `bg/` / `console/` / `popup/` / `options/`）

改窗口、平铺、联动、群发编排、console UI，或动存储 / Drive 同步 / 迁移包 / 权限前读这份。**错误码全表（16 个用户可见 + 内部码）、超时预算表、epoch/串行化/RunMeta 交接、逐文件职责与各 html 的加载顺序、存储键位置与权限清单都在这里**；`CLAUDE.md` 只留 popup-only 铁律与 deadline 透传等硬约束的条文，这份负责讲它们的实现与事故现场。冲突以 `CLAUDE.md` 为准。

控制台是贴顶、占满屏宽、固定高 96px（`STRIP_H`）的独立 `type:"popup"` 窗口，下方平铺各站点窗口。

## 逐文件职责

**`background.js`** —— SW 入口：快捷键转发、窗口登记清理、消息路由、`importScripts`。加载顺序：`windows → panels → page-context → broadcast → synthesis → sync-model → archive-model → store → data → drive → sync → data-admin → transfer`。

| `bg/` | 职责 |
| --- | --- |
| `windows.js` | 窗口层：工作区/建窗/联动（popup-only 铁律核心，`STRIP_H=96`）。300 行 |
| `broadcast.js` | 广播层：群发 / 平铺 / 新会话 / 巡检 / 汇总 / epoch |
| `panels.js` | 只管站点范围窗（scope）：失焦即关、不改主 console 尺寸 |
| `page-context.js` | 右键菜单读网页上下文（`contextMenus`+`activeTab`+`scripting` 唯一使用点） |
| `synthesis.js` | 受管 popup 新会话发综合载荷 |
| `store.js` | 同步数据的本地 IndexedDB 层。`scanAll(kind, visit)` = 单事务只读全表扫描，**`visit` 必须同步**（在里面 await 外部 promise 会让只读事务提前提交并抛 `TransactionInactiveError`）；扫描中途要跨事务写库的场景（`forget` / 批量删除）仍必须用 `iterate` |
| `data.js` | 本地记录与设备状态协议；`migrateLegacy()` 把 `amsHistory`/`amsArchive` 一次性迁进 IndexedDB |
| `sync.js` | Drive 同步串行状态机。300 行 |
| `sync-model.js` | 同步数据模型与版本比较（`SCHEMA=1`）、`futureFiles()`（未来 schema 只读锁的差集合并）、`completeBody()`（上下行共用的正文完整性判定）。**归档合并的权威实现不在这里**——在 `data.js` 的 `newer()` 与 `store.js` 的 `compareEntityVersion()`；`mergeArchives` 已删，别往这里加第二份 |
| `drive.js` | Google Drive REST 客户端 |
| `archive-model.js` | 归档元数据规范化与筛选 |
| `transfer.js` | JSONL 迁移包与背压导出 |
| `data-admin.js` | 本机数据批量清理（云端删除归 SyncEngine） |

| `console/` | 职责 |
| --- | --- |
| `console.js` | 96px 细条主逻辑与事件 |
| `status.js` | 群发进度圆点、错误码翻译、失败汇总、汇总复制拼装、`aria-live` 播报 |
| `library.js` | 细条输入历史与范围/档位控件 |
| `images.js` | 仅驻内存的多图选择与校验 |
| `run-meta.js` | compose↔console 一次性运行元数据交接（键 `amsPendingRun`） |
| `sites.js` | 九站清单（console / compose / archive / scope / popup 五页共享） |
| `console.css` / `archive.css` | 细条与归档页样式；`compose.html`/`scope.html` 共用 `console.css`（改细条外观改这里，`popup/popup.css`、`options/options.css` 各管自己那页） |
| `theme.js` | 主题 auto/light/dark，`<head>` 内加载（console 系在 `../i18n.js` 之后、popup/options 在其之前） |
| `scope.js` | 站点范围伴侣窗与分组管理；巡检触发/渲染与「复制诊断报告」（报障出口，配 `.github/ISSUE_TEMPLATE/site-breakage.yml`） |
| `compose.js` | 提示词工作区：编辑、模板、历史与发送 |
| `compose-context.js` | 提示词工作区的网页来源预览与载荷 |
| `compose-synthesis.js` | 辅助综合配置、预览与单站发送（`MAX_PAYLOAD=60000`；围栏给每条候选回答加 ~120 字符开销，相对该预算可忽略，没跟着调阈值） |
| `synthesis-model.js` | 辅助综合载荷的纯拼装与校验；候选回答用碰撞重试出的随机 UUID 围栏包裹并声明「围栏内是不可信文本」防指令注入，做法与 `compose-context.js` 的来源围栏一致（碰撞检查要覆盖 task/instruction/来源与**全部**候选文本，不能只查单条） |
| `archive.js` | 归档页：管理「问题 + 各站回答」快照 |
| `archive-detail.js` | 归档详情与人工评价控件 |
| `archive-synthesis.js` | 归档内辅助综合、采集与保存 |
| `archive-stats.js` | 站点健康统计：聚合归档 `results[].code`（bg 动作 `archiveFailStats`），只反映**收集层**失败——发送层失败不落盘 |
| `workspace-i18n.js` | compose/archive 专属词条（`Object.assign(MSG, …)` 追加） |

**加载顺序即依赖顺序**，写在各 html 里；新增细条功能先按这条链判断归属哪个已有文件：

- `console.html`：head `../i18n.js → theme.js`；body 末 `sites(站点清单) → library(历史/模板读写) → images(选图与校验) → run-meta(一次性交接) → console(细条主逻辑) → status(圆点/翻译/播报)`。**`status.js` 共享 `console.js` 的全局**——`progress`/`lastSend` 声明在 status.js 而事件处理器在 console.js，顺序反了直接 ReferenceError。
- `compose.html`：head 同上；body 末 `sites → workspace-i18n → compose-context → run-meta → synthesis-model → compose-synthesis → compose`。`compose.html?mode=synthesis` 是它的第二形态（辅助综合）。
- `archive.html`：body 末 `sites → workspace-i18n → archive-detail → archive-synthesis → archive → archive-stats`。`archive-stats.js` 引用 `archive.js` 顶层的 `ARCH_ERR_KEYS`（classic script 全局词法作用域），顺序反了直接 ReferenceError。
- `scope.html`：body 末 `sites → scope`。
- `popup.html` / `options.html` 的 head 顺序与 console 系**相反**（先 `console/theme.js` 再 `../i18n.js`）；options 的 head 还多一条 `options-i18n.js`，body 末 `options.js → sync.js → data.js`。

## 窗口登记与生命周期

- **`amsWindows`（`storage.session`）host→`{id,owned,orphans}`**：`owned=true` 仅 `windows.create(popup)` 新建（`closeAll` 可自动关）。**`owned=false` 目前没有任何生产者**——生产代码里恒为 `true`，属预留字段，别把它当现役保护引用（也别删，`orphans` 的回收逻辑还读它）。`orphans` 是「被导航走后失联的旧受管窗 id」：受管窗被导航到登录域时解析不到，新窗覆盖登记，旧 id 收进 `orphans`，由 `closeAll` 与 `openTile` 的 prune 分支逐个 `removeIfPopup` 回收（**不当场关**——用户可能正在那个窗口里登录）。后续按 host 的操作**一律认登记表，不再裸查 tabs**——否则会误抓用户事后在主窗口开的同站标签。
- `managedTabForHost` 除了校验 `type:"popup"`，还要求活动标签停在目标 host；用户把受管窗导航走后绑定立即失效，调用方新建正确窗口。
- **窗口 id 跨浏览器重启失效**：重启后 id 重排，陈旧登记可能撞上无关 popup（如 OAuth 弹窗）被误关/误收编；按 id 只验 type 挡不住 popup 撞 popup。`onStartup` 因此清掉 `amsConsoleWin` / `amsComposeWin` / `amsScopeWin` / `amsArchiveWin` 四个 local 键。**`amsWindows` 不在这份清单里**：它在 `storage.session`，随浏览器关闭自动清空，无需也不该由 `onStartup` 处理（真值位置见本文「数据位置」）。
- compose/scope/archive 三个伴侣窗**绝不进 `amsWindows`**，用各自专属 id 登记。联动语义三家不同：**compose 与 archive 随工作区联动**（console 抬起/最小化跟着走）；**scope 靠失焦即关**，不参与抬窗联动；**三者都随 `closeAll` 一起关**。别照着「都联动」补代码——scope 会变成抬一次关一次。
- 四个开窗入口（console/compose/archive/scope）共用 `bg/windows.js` 的 `onceByKey(name, key, run)` 做 in-flight 去重，**按参数指纹分桶**：同指纹复用在途 promise，指纹不同的排队重跑。所以「辅助综合」不会被并发的普通「编辑」降级，参数也不再被吞。

## 平铺（`openTile`）

- **工作区与 console 上下边一次解析**：`consoleGeometry()` 返回 `{wa,left,top,bottom,reserve,attached}`（console 中心点所在显示器 → 拖到哪屏铺哪屏），`consoleWorkArea()` 只是取 `wa` 的一行包装。合并成一次解析后「混坐标系」才真正根治：**未命中显示器 / console 不是 popup / 缺字段时 `reserve` 一律回退 `STRIP_H`**，不再拿跨屏距离当保留高度（console 在副屏时 `(c.top+c.height)-wa.top` 曾被算成跨屏距离）。
- **保留高度用控制台实际底边 `c.top + c.height`，不是硬编码 96**：WSL2/X410 给每个窗口套 ~30px 标题栏（请求 `top=0` 时 Chrome 如实报告 `top=30`），只用 `height` 会漏掉这段上移、导致平铺窗口压住控制台。取不到登记窗口时回退 `STRIP_H=96`（原生 Windows/macOS 无此上移）。
- **平铺区与范围窗共用 `bg/panels.js` 的 `consoleBand(wa, geo, minH)`**：下方够高就用下方、不够就翻到 console 上方、都不够退回工作区顶部，返回值恒在工作区内。阈值 `TILE_MIN_H`（`bg/broadcast.js`）与 `SCOPE_MIN_H`（`bg/panels.js`）均为 **240**。没有这层夹取时，console 被拖到工作区下缘会让 `reserve == wa.height`，九个平铺窗全建到屏幕外而控制台照样九个绿点。
- 网格：`n≤4` 单排水平等分（各占满高度）；`n≥5` 用 `cols=ceil(sqrt(n))`、`rows=ceil(n/cols)`。
- **`prune=true` 用于显式平铺和 sendAll 缺窗时的隐式开窗**：两者都按当前范围全量重排，并清理未勾选站（owned 关闭、复用仅解除登记）。`prune=false` 只供辅助综合为目标单站补窗，不关闭其他站点，也不重排已有窗口。
- **新建平铺窗一律从站点新会话 URL 开始**，只有既有受管 popup 才延续当前对话。
- **openTile 期间用户若最小化控制台，新建窗口也保持最小化**，不在完成回调里把整组重新抬起。
- 窗口几何断言要留 ±1~2px 容差，且不要「读回 bounds 再算下一轮」——DIP↔屏幕坐标的 floor/ceil 舍入会累积漂移。别假设 `devicePixelRatio=1` 或各屏同缩放。

## 群发（`sendAll` / `submitWhenReady`）

- 有站点没窗口先 `openTile(sites, true)`——缺窗说明勾选集变了，与显式「平铺」同语义：**全量重排 + 清理未勾选**（owned 关闭、复用仅解除登记；曾用 `prune=false` 只给新窗落格 → 新旧两套布局错位重叠，2026-08-18 用户实报）。勾选未变（无缺窗）的追问不调 openTile，手调布局不受扰（`test-tile-reflow.js`）。**初次使用无需先点平铺**（勾选 → 输入 → Enter 一步开窗 + 群发）。开窗失败或 retry 不开窗时缺窗站立即报 `no_window`，不空转到 timeout。
- 各站**并行轮询**页面就绪再提交：content 未注入 / `composer_not_found` 都视为「还没好」继续等，其它 `ok=false` 才是真失败。任一出口都先 `pushSiteResult` 让圆点立刻变色，再返回参与 `Promise.all`。
- **轮询中连续 `NO_WINDOW_MISSES = 8` 轮解析不到受管窗口即判 `no_window`**（gap 800ms ≈ 6.4s），不再空转到 44s/90s 才报 `timeout`。取舍要记清：会话过期跳鉴权域期间同样解析不到，该站会提前拿到 `no_window` 而不是 `timeout`——用户登录完点重试即可，这是用 39s 的纯空等换来的。
- **结果字段 `waited` 与 `resent` 是两件事**：`waited` = 越过首轮软截止线后继续等（**没有任何重发动作**）；`resent` = 真的重发过一次（只读 `submitted()` 明确确认末条用户消息不是本次内容，目前仅 Kimi）。`retried` 保留为 `resent` 的别名供既有 console 文案使用。凡是过去写「首轮到点只置 `retried` 标记继续等」的地方，说的都是现在的 `waited`。
- **单站结果即时回填**：每站完成即 `pushSiteResult`（`{from:"AMS_BG", type:"siteResult"}`），圆点逐个变色不等最慢站；结果带 `ms` 逐站耗时，console 拼进 title 直接服务「对比各家响应速度」。
- **`submittedAfterRerender`**：Kimi 发送/切模会重挂页面并断开消息端口。只有新 content 明确回 `supported:true` 且连续 5 次确认「末条用户消息不存在」才判未发送、才允许重试一次；`supported:false` 或探测超时一律不重发。
- **`isNewSessionUrl`**：按 origin + pathname 一致（忽略 query/hash 与尾斜杠）判断标签是否已停在新会话入口——这九站的会话 id 都落在 path（`/new→/chat/x`、`/→/c/x`、`/app→/app/x`）。已在入口的窗口跳过重载，省闪烁并保留用户未发送的输入。
- 群发收尾：console 已最小化则整组保持最小化；否则按 `autoRaise` 设置置顶全部平铺窗再 `raiseConsole`。
- 只读编排消息零副作用：`checkup`（逐站 `diagnose`，结果只渲染在 scope 伴侣窗行内，**不进主 console 芯片**——`status.js` 的 `applyResults` 按 `typeof r.ok === "boolean"` 分流，把巡检结果喂给它会被误画成群发圆点）、`collect`（逐站 `answer` → Markdown）。

## 消息与交接协议

- **群发取消（epoch）**：`_sendEpoch` / `cancelPendingSends()`。**只有三处调用它**：console 窗口 `onRemoved`、`closeAll`、`newSession`——旧轮次未派发的站点随即以 `code:"cancelled"` 收场。**新一轮群发不推进 epoch**（`sendAll` 只在入口取一次 `currentSendEpoch()` 往下传）；别照着「新一轮开始即取消上一轮」去改代码，那会把在途的只读 `collect` 一并判成 `stale_run`。长流程每个 `await` 后都要核对 epoch（硬约束）。
- **双层串行化**：content 侧 `serializeInteraction` 把快捷键、悬浮控件、群发的菜单操作串成一条链（站点模型菜单是共享 UI，交错会互相关菜单/点错项；群发把「切档 + 提交」放同一任务，发送前档位不会被插队改写）。bg 侧 `serializeOp` 串行 `openTile`/`sendAll`（防并发读-改-写 `amsWindows` 泄漏重复 popup）。
- **RunMeta 一次性交接**（`console/run-meta.js`）：写 `storage.session` 的 `amsPendingRun`，取出即删，必须 `text` 匹配才认（防陈旧载荷贴到新问题上）；console 侧发送前先 `await pendingClear` 再 resolve。
- **辅助综合的 URL 白名单**：`validSynthesisRequest` 先做自洽性检查（`https:` 且 `new URL(site.url).hostname === site.host`），再对 `bg/synthesis.js` 的 `SYNTHESIS_ALLOWED_SITES` 做 host + url 的整对匹配；任一不过返回 `invalid_request`（综合页已翻译为「请求无效」）。**加站点要同改这份白名单**，否则新站不能当综合目标。
- compose 的派发锁写在 `storage.session` 的 `amsComposeDispatchUntil`，console 读它禁用 send 按钮并到点自动解锁。

## 错误码全表

bg 与 content **只产出 `code`，绝不产出用户可见文案**；bg 的轮询判定认 `r.code`，**绝不正则匹配文案**。

**扩展侧翻译表有五份，新增可见码要同时改**：`console/status.js` 的 `ERR_KEYS`（16 条，群发圆点）、`console/archive.js` 的 `ARCH_ERR_KEYS`（11 条，归档回放）、`console/compose-synthesis.js` 的局部 `ERR_KEYS`（10 条，含仅此页可见的 `invalid_request`）、`console/scope.js` 的 `CHECK_ERR_KEYS`（2 条，巡检失败码 `no_window`/`not_ready`，复用 con_err 词条）、`console/compose-context.js` 的 `ERROR_COPY`（3 条读网页码，见下）。漏一份，那个页面就裸露英文 reason。**Desktop 另有一份**：`desktop/src/shared/status-copy.ts` 的 `describeStatus`（配 `desktop/src/shared/copy.ts` 三语），两端都会出现的码要一起补。

**16 个用户可见码**：`timeout`、`composer_not_found`、`inject_failed`、`submit_unconfirmed`、`tier_unconfirmed`、`image_invalid`、`attachment_unsupported`、`attachment_failed`、`attachment_timeout`、`attachment_action_required`、`no_window`、`not_ready`、`cancelled`、`checkup_ok`、`no_answer`、`error`。

**外加 `invalid_request`**：只在辅助综合页可见（`compose-synthesis.js` 独有词条 `con_errInvalidRequest`），由 `validSynthesisRequest` 拒绝非白名单目标时产出，不进 `status.js` 的 `ERR_KEYS`。

**外加 `no_view`**：Desktop 端产（视图已销毁或未打开——站点未勾选时不建视图，见 `docs/desktop-m0.md` 的懒建约定；落点在 `desktop/src/main/view-manager.ts` 的 `sendCommand` 与 `collect`），扩展侧只在结果库回放里可见：它在 `console/archive.js` 的 `ARCH_ERR_KEYS` 里（词条 `con_errNoView`），跨端同步进来的记录会带这个码，但不进 `status.js` 的 `ERR_KEYS`。与 `invalid_request` 同属「单页面可见码」。`scripts/test-err-codes.js` 对账两端归档码。

**另有 3 个只在提示词工作区可见的读网页码**：`page_access_denied`、`page_empty`（`bg/page-context.js` 产出）与 `source_update_failed`，经 `compose-context.js` 的 `ERROR_COPY` 翻译后显示在 `#cmp-status`，三语词条是 `cmp_contextDenied` / `cmp_contextEmpty` / `cmp_sourceUpdateFailed`。**别把它们当内部码**——新增同类码若漏登记，会被 `|| cmp_contextDenied` 兜成「无法读取当前页面」这条错误原因。

- 生产点：`cancelled`/`no_window`/`not_ready`/`checkup_ok`/`no_answer` 出自 `bg/broadcast.js`；`timeout`/`composer_not_found`/`inject_failed`/`submit_unconfirmed`/`error` 出自 `content/core.js`（`bg/broadcast.js` 也产 timeout/submit_unconfirmed/cancelled）；`tier_unconfirmed` 由 core 在「提交成功但档位未确认」时改写 `r.code`；`image_invalid`/`attachment_*` 出自 `content/upload.js` 与 core。
- `error` 是意外异常兜底：主文案取词条，原始 reason 拼在后面（`base + " · " + r.reason`），不让英文异常原文裸露在中文界面。
- **`ok:true` 也可以带 `code`**（如 `tier_unconfirmed`）：显示为绿点 + 警示 title，不谎报全绿。
- **`attachment_action_required` 目前是孤儿码**：`ERR_KEYS` 有条目、`i18n.js` 三语词条齐全，但 bg 与 content 全仓无生产者。**给它补生产点或和词条一起删之前，别拿它当「已支持的错误状态」引用。**

**内部码，故意不进任何 ERR_KEYS、不给用户看**：`stale_run`（`background.js`）；`superseded`（`bg/page-context.js`）；`not_found`（`bg/data.js`、`bg/sync.js`、`bg/drive.js`、`bg/broadcast.js`）、`reconnect_required`、`local_write_failed`（`bg/data.js`、`bg/data-admin.js`）；`auth_failed`、`network_error`、`invalid_response`、`unauthorized`、`forbidden`、`rate_limited`、`server_error`、`request_failed`（`bg/drive.js`）；`sync_failed`、`schema`、`stale_body`（`bg/sync.js`）；`import_failed`、`invalid_header`、`newer_format`、`unknown_kind`、`export_cancelled`、`export_failed`（`bg/transfer.js`）；`invalid_record`（`bg/transfer.js` 与 `bg/archive-model.js` 共有）；`invalid_tags`、`invalid_source`、`invalid_synthesis`、`invalid_favorite`、`invalid_note`、`invalid_patch`、`invalid_winner`（`bg/archive-model.js`）。

## 超时预算表（改一处必须同步另一处）

| 场景 | 值 |
| --- | --- |
| 单站首轮 / 绝对截止（`submitWhenReady`） | 纯文本 22s / 44s；带图 45s / 90s。首轮到点只置 `waited` 标记继续等，绝对线才判 `timeout`。轮询 gap 800ms；连续 8 轮解析不到受管窗口提前判 `no_window` |
| 提交确认（`confirmSubmitted`） | 纯文本 3s（`confirmUntil=0` 时内部回退 `now+3000`）；带图用整次剩余预算（`confirmUntil=deadline`） |
| 切档（`switchTier`） | 默认 10s；群发链路取 `Math.min(10000, deadline-now)`。循环内切到了 sleep 400ms、没切到 700ms，每轮先 sleep 350ms 再读 state |
| 找 composer（`waitFor` 默认 3500ms / step 120ms） | `submitPromptNow` 用 `Math.min(3500, 剩余)`；`onMessage` 的 submitPrompt 分支用 `Math.min(4000, deadline-now)`，无 deadline 时 4000ms |
| 附件确认（`waitAttachments`） | 未给 deadline 时默认 15s；图片硬限 `MAX_BYTES = 10 MiB` |
| 巡检 / 汇总（`checkupAll` / `collectAll`） | 各 8s |
| 重挂后确认窗（`submittedAfterRerender`） | `Math.min(deadline, now+1500)`，轮询 150ms，连续 5 次 miss 才判未发送 |
| 辅助综合等新会话（`waitForNewSession`） | 22s，轮询 100ms；随后仍走 `submitWhenReady(…, 22000, 800, …)` |
| console 圆点客户端兜底（`armDotTimeouts`） | 60s；带图 110s |
| send 按钮重新启用 | 60s；带图 110s。忙碌态通用 reset 兜底 30s；带图群发排队在途时 110s |

`deadline` 透传与夹取规则见 `CLAUDE.md` 硬约束。**console 兜底必须严格大于后台预算**：小了圆点先翻红而后台还在发；后台加长了不改兜底，则 SW 被杀时圆点永久转圈。旧值 50s/95s 对 44s/90s 只有 ~5.5% 余量，首开九站极易击穿，现按 ≥20% 余量重算。

> 带图的 110s 在源码里写作 `95000 + 15000` 而非直接 `110000`，是为了保留 `scripts/test-multi-image.js` 对字面量 `95000` 的正则断言。哪天把那条断言改成检查 `≥108000`，源码就可以简化成纯字面量。

## 联动（弃用 `onFocusChanged`）

- `chrome.windows.onFocusChanged` **实测在 Windows 上对「点 console 抬窗 / 最小化 console」常不派发、也不唤醒休眠的 SW**，且在 `minimizeAllManaged` 期间乱发焦点事件，造成「最小化后又自动复原」的竞态。改由 console **页面 DOM 事件**驱动。
- window `focus` → `consoleFocused` 消息 → **`scheduleRaise` 去抖 ~180ms** 再抬整组。点 console 的最小化按钮会先让窗口获焦，不去抖就会立刻抬窗、把正在最小化的 console 又解最小化，与最小化打架且时好时坏；`consoleHidden` 到达即 `clearTimeout` 取消本次抬窗。真要抬时再核对 console 非 minimized 兜底。另有 `suppressFocusUntil` 时间窗，抑制程序化抬窗（`raiseConsole` 末尾重聚焦 console）自触发的 focus 回报，防递归。
- **hidden ≠ 最小化**：`visibilitychange` hidden 后必须后台核实 `windows.get(id).state === "minimized"` 才联动 `minimizeAllManaged`——Chrome 的遮挡跟踪也会把被完全遮挡的窗口置 hidden。
- `onRemoved` == console 窗口 → `cancelPendingSends()`（不等串行链，未派发的站立即停）+ `serializeOp(closeAll)`（只关 owned）。伴侣窗关闭只清自身登记。

## 薄弹窗限制（96px）与三个伴侣窗

- 96px 窗口会裁切自定义 DOM 浮层以及 `prompt()` / `confirm()`（截图实证）。主 console **不使用原生下拉，且始终保持 96px**。
- 细条内的交互一律做成内联控件（命名输入、二段删除确认）；需要纵向空间的功能开独立 popup：
  - **`compose.html`** —— 提示词工作区：长文本编辑、模板管理、历史、发送；`?mode=synthesis` 为辅助综合形态。
  - **`scope.html`** —— 站点范围伴侣窗：**连续多选（勾一个不关窗、可以连着勾）**、分组管理、站点巡检；**失焦即关**，且不改变主 console 高度。这两条是一对矛盾约束：只记住「失焦即关」的人容易改成「选完即关」，那样多选就废了。自适应高度只在**首次求值时**认 `?top=` 给的位置（`fitScopeHeight` 一进去就翻 `scopeTopHonored`，不等 `chrome.windows.update` 真的发生）——之后一律以窗口当前实际 top 为准，否则用户拖走窗口后，下一次内容变化会把它拽回原位。
  - **`archive.html`** —— 结果工作区：采集当前结果、归档列表、复制、导出、删除。
- **二段确认必须绑定目标条目 id/ts，任何重渲染即撤销确认态**（语言切换、列表重建、并发新增都会让确认目标漂移而误删）；删除前重读最新库按 id/ts 定位——归档窗打开期间 console 侧新增的快照不再被陈旧快照整值回写抹掉。归档是不可恢复的完整对比现场。

## console 端状态机（`console/status.js`）

- 三项职责，缺一都会在下次重构时被顺手删掉：**错误码翻译**、**失败汇总**（一次群发里挂掉的站点合并成一条可读结论）、**汇总复制拼装**（把各站 Markdown 拼成一份带站名与档位标注的文本）。
- **`aria-live` 播报区**：`console.html` 的 `#live`。96px 细条上的圆点变色对读屏用户不可见，这是唯一的进度通道，**无障碍属于不可简化项**。现在写入它的有五处：`sendStart` 开场（`con_liveSendStart`）、`siteResult` 期间**节流后**的进度（`con_liveProgress`，逐站结果密集到达时不逐站播）、平铺完成（`con_liveTileDone`）、新会话（`con_liveNewSession`）、关闭全部（`con_liveClosedAll`，须排在 `clearRunState()` 之后否则被其内部的 `updateFailSum` 覆盖）。终态的失败汇总与汇总复制结果同样落这里。
- **文案不缓存成品串**：芯片文案与失败汇总只存 `chipMeta`（host → `{kind,payload}` 原始数据），在 document 的 `i18n:changed` 事件里按当前语言重算；同一事件里顺带调 `images.js` 的 `setPendingImages(pendingImages, false)` 刷新图片按钮文案。**别在这个事件里直接调 render()**——会把旧语言的译文原样抄回。`console/scope.js` 用同一套模式重算 `#scope-live` 与巡检行。
- **`ignoreResults` 忽略态**：`closeAll` 乐观清零后，在途群发的迟到 `siteResult` 与回调会把刚清空的芯片重新点亮 → 进入忽略态，直到用户下一次动作（`sendStart` 推送或平铺/巡检点击）才解除。
- **客户端兜底超时（`armDotTimeouts`）**：回调/推送断掉（SW 被杀、扩展重载）时圆点会永久卡「发送中」，故到点就地翻超时失败并推进 progress。
- 芯片 `title` 与 `aria-label` 同步状态（title 对读屏/触屏不可靠）；`openTile` 结果用「open」态（空心绿圈）与「已回答」的实心绿勾区分——平铺后满屏绿勾曾被误读为已回复。

## console 输入框与主题

- **双向回填判定必须带 `document.hasFocus()`**：窗口失焦后 `activeElement` 不重置，只看 `activeElement` 会永久挡住回填，导致旧文覆盖新编辑。
- 所有 Enter 发送与 ↑/↓ 历史都要判 `!e.isComposing`（IME 合成中不误发、方向键选词不被劫持）。
- 主题真值在 `storage.local.amsTheme`，`localStorage` 只是同步缓存，供 `<head>` 内的外链 `console/theme.js` 同步读取、抢在首帧前应用（MV3 CSP 禁内联，防闪烁的内联版本曾被拦且实际未生效）。

## 快捷键

- **manifest `commands` 三条**：`switch-think`（**Alt+T**，切换到深度思考）、`switch-fast`（**Alt+Y**，切换到快速模型）、`open-console`（**Alt+Q**，打开或聚焦群发控制台）。描述走 `_locales` 的 `__MSG_cmdThink__` / `__MSG_cmdFast__` / `__MSG_cmdOpenConsole__`。
- **转发者是 `background.js` 的 `chrome.commands.onCommand`**：`open-console` 直接调 `openConsole()`（幂等）；think/fast 取 `tabs.query({active:true, currentWindow:true})` 后 `tabs.sendMessage({source:"AMS", mode})`，活动标签不是受支持站点（没有 content script）时静默吞掉。
- **console 内另有 5 个页面级快捷键**（不在 manifest，由 `console.js` 的 document keydown 按 `e.code` 分发，要求 Alt 且排除 ctrl/meta/shift/repeat/isComposing）：**Alt+C** 汇总复制、**Alt+L** 平铺、**Alt+N** 新会话、**Alt+P** 聚焦输入框、**Alt+R** 重试失败站点。popup 页把这 5 条写死展示。

## popup 页（`popup/`）

七块：品牌头 + 当前站连接状态点（`#site-status`/`#status-text`）、「打开群发控制台」主按钮（带当前 host 让 console 预勾该站）、🧠深思/⚡快速分段按钮组（`aria-pressed` 同步 `state()`）、不支持站点提示（`#unsupported`）、**动态快捷键列表**（`#keys`，用 `chrome.commands.getAll()` 渲染，按 open-console→switch-think→switch-fast 排序，未绑定显示 `pop_shortcutUnset`，**不写死**）、「控制台内快捷键」网格（Alt+C/L/N/P/R，写死）、工具行三按钮（快捷键管理 → `chrome://extensions/shortcuts`、🩺诊断 → `#diagout` 逐项打勾/叉、打开设置）。

## options 设置页（`options/`）

`options_ui.open_in_tab = true`（在标签页里开，不是嵌入式弹层）。用 `location.hash` 路由四区，`OPTION_SECTIONS = [general, sync, transfer, privacy]`，非法 hash 回落 `general`：

页面级脚本（**与 `bg/` 同名，最容易开错文件**）：`options/options.js` 四区路由与 `PREFS` 映射；`options/sync.js` 是**设置页侧**的同步状态卡与连接/断开 UI（**不是** `bg/sync.js` 那个同步引擎）；`options/data.js` 是本机数据清理的共享二段确认（**不是** `bg/data.js`）。

- **`#general`** —— 主题 / 语言 / 悬浮控件显示方式（`displayMode`）/ 发送后自动置顶，四个开关。新增可见开关必须加进 `options/options.js` 的 `PREFS` 映射（控件 id → `{key, fallback}`），它同时负责初值渲染与 `storage.onChanged` 回填。
- **`#sync`** —— 同步状态卡 + Google Drive 连接 / 立即同步 / 断开。
- **`#transfer`** —— 迁移包明文提示 + 导出 / 导入（accept `application/json,.jsonl,application/x-ndjson`）。
- **`#privacy`** —— 本机数据（清空提问历史 / 清空结果库 / 重置本机数据，均带二段确认）+ 隐私说明（含「断开连接不撤销 Google 授权」）+ **网页访问**（不申请站点 host 权限、右键读页是一次性动作、未发送草稿留在本机）+ 危险操作（删除云端同步数据，二次确认）。**改权限或数据行为时要同步这一区的文案**，词条落 `options/options-i18n.js`（不要塞进已近 300 行的根 `i18n.js`）。

## 数据位置

- **`storage.local`**（常驻）：`amsLang`、`amsTheme`、`displayMode`、`amsAutoRaise`（四个设置项）、`amsConsole`（勾选 + 档位）、`amsConsolePrompt`、`amsConsolePrefill`、`amsTemplates`、`amsGroups`、`amsSyncConfig`、`amsSyncStatus`，以及窗口 id `amsConsoleWin`/`amsComposeWin`/`amsScopeWin`/`amsArchiveWin`。
- **`storage.session`**（会话级）：`amsWindows`、`amsLastRun`、`amsPendingRun`、`amsPendingSynthesis`、`amsComposeContext`、`amsComposeContextError`、`amsComposeDispatchUntil`、`amsComposeSynthesis`。
- **IndexedDB**：库名 `polyask`，`DB_VERSION = 2`，五个 store —— `history`（keyPath `id`，索引 `lastUsed=[lastUsedAt,id]`）、`archives`（keyPath `id`，索引 `created=[createdAt,id]`）、`outbox`（keyPath `key`，索引 `next=[nextAt,key]` 与 `entity=[kind,entityId]`）、`files`（keyPath `fileId`，索引 `logicalKey`）、`meta`（keyPath `key`）。`meta` 存 `deviceId`、`deviceState`、`pageToken`、`remoteStates`、`materializedState`、`futureFiles`（触发只读的 fileId → schema 映射）、`legacyMigrated`（遗留数据迁移完成时间戳）——**都是本机 meta，不参与跨设备投影**，`clearLocalData()` 一并清空。
- 历史与归档**不设条数上限**，但本地只缓存近期正文：`trimBodies(200, 50)` —— 历史保留最近 200 条正文、归档保留最近 50 条，更旧的按需从 Drive 拉回；断开连接后 `Data.resolve` 会抛 `reconnect_required`，UI 落到 `arc_loadFailed`，重连即可回源。**UI 必须处理「元数据在、正文异步加载中、加载失败」三态。**
- **提问在派发之前无条件入历史库**，两端一致：扩展 `console/console.js` 的 `pushHistory` 先于 `sendAll`，Desktop `shell-ipc.ts` 的 `history.record` 先于 `coordinator.send`。只有「请求解析失败」「图片站点不支持」这两处 throw 之前的非法请求不入库——**全部站点都失败的提问在两端都会留下记录**，这是有意的（用户要能重发）。
- 归档条目带搜索/收藏/标签/备注/最佳答案标记，这些字段参与 Drive 同步：改字段要同步 `bg/archive-model.js` 的规范化逻辑。
- **归档字段上限（两端必须一致，单位是码点不是字节）**：`title` 512、`instruction` 4000、`note` 4000、`host`/`label`/`winnerHost` 256、预览 `text` 320、`state`/`code` 64、单个 `tag` 32、`tags` 数组 20 项。**新增归档字段就要进这张表**，否则一端写得进、另一端判 `invalid_record` 拒收，表现为「某台设备的记录同步不过来」。两端处置方式有意不同：`title` 与预览**截断**（`bg/page-context.js` 与 `bg/archive-model.js` 各截一次），其余**超限即 throw**——`validMetadata` 拿规范化结果与原始记录逐键比对，一截断就会把存量记录判无效。Desktop 对应实现在 `desktop/src/shared/archive.ts` 与 `synthesis.ts`。
- `archiveFailStats`（`bg/data.js`）只读扫描归档聚合 `results[].code`：归档的 code 只来自收集链（`no_window`/`not_ready`/`no_answer`），`no_answer` 集中出现 ≈ 该站 `answer()` 锚点漂移；发送层失败不落盘（要落盘就触发持久化键五处登记，有意不做）；已上云旧条目被 `trimBodies` 裁掉 `results` 后不参与统计。
- 迁移包：`bg/transfer.js` 的 `KINDS` 五类（setting / template / group / history / archive），`format=polyask-transfer`，`VERSION=1`，JSONL。
- 新增持久化键的多处登记清单见 `CLAUDE.md` 硬约束。三张 local 键表的分工：`bg/sync.js` 的 `LOCAL_KEYS`（7 键，触发/参与 Drive 同步投影）、`bg/data-admin.js` 的 `LOCAL_KEYS`（13 键，重置清理清单，比同步白名单多 `amsConsolePrompt`/`amsConsolePrefill`/`amsHistory`/`amsArchive`/`amsSyncConfig`/`amsSyncStatus`；其中 `amsHistory`/`amsArchive` 是**历史遗留 local 键**：由 `Data.migrateLegacy()` 一次性迁进 IndexedDB 后删除，完成标记落 SyncStore meta 的 `legacyMigrated`；仍留在重置清单里是为了兜住「迁移前就被重置」的机器。现役数据在 IndexedDB，别照着重置清单去 `storage.local` 找）、`bg/data.js` 的 `SETTINGS`（4 键，跨设备设置投影）。前四键（`amsLang`/`amsTheme`/`displayMode`/`amsAutoRaise`）三表重合。
- **`amsConsolePrompt` 会驻留整页正文**：`compose.js` 的 `savePrompt()` 把完整草稿（含右键带入的网页来源载荷，≤30000 字符）写进这个 `storage.local` 键，发送后不清除——重开细条或重启浏览器会静默回填上次那一整页文本。它**不参与 Drive 同步**（不在 `LOCAL_KEYS` 白名单），content script 也读不到，只有「重置本机数据」会清掉。**别顺手清它**：`console/archive.js` 拿它当采集兜底，`scripts/test-compose-context.js` 也钉死了「写完整载荷」这一既定设计。用户可读的披露在 options `#privacy` 与 README。

## 权限（每项对应哪个功能）

| 权限 | 用途 |
| --- | --- |
| `storage` | 设置/模板/分组/同步配置在 `storage.local`；受管窗口表与一次性交接在 `storage.session` |
| `tabs` | 向站点 content script 发消息并管理受管标签（sendMessage / query / update / get / create，监听 onUpdated、onRemoved） |
| `system.display` | 取显示器 workArea 作为平铺基准（console 中心点落在哪块屏就铺哪块） |
| `identity` | Google OAuth 取 Drive token（`getAuthToken` / `removeCachedAuthToken` / `clearAllCachedAuthTokens`） |
| `alarms` | 定时同步：周期 15 分钟的 `ams-sync` 闹钟唤醒 SW 跑同步 |
| `contextMenus` | 两条右键菜单「用 PolyAsk 比较所选内容 / 当前网页」（id `ams-send-selection` / `ams-send-page`） |
| `activeTab` + `scripting` | 右键菜单触发时读当前页正文，唯一使用点是 `bg/page-context.js` 的 `chrome.scripting.executeScript` |

`host_permissions` 仅 `https://www.googleapis.com/*`（Drive REST `/drive/v3` 与上传端点 `/upload/drive/v3`），`oauth2` scope 仅 `https://www.googleapis.com/auth/drive.appdata`。**不申请任何 AI 站点 host 权限**，站点访问全靠 `content_scripts.matches` 的 9 条（注入顺序 `i18n.js → content/core.js → content/send.js → upload.js → md.js → adapters-intl.js → adapters-intl2.js → adapters-cn.js → adapters-cn2.js → diag.js → pill.js`，`run_at: document_idle`；`send.js` 读 `window.__AMS`，必须排在 `core.js` 之后；`diag.js` 必须在全部适配器分卷之后——它按已填充的注册表统一包装 `diagnose`）。

右键读页细则：菜单只在 `documentUrlPatterns: http://*/*, https://*/*` 下注册，读取前还要 `canRead(tab)` 再校验一次协议；正文上限 30000 字符，超长保留首 24000 + 尾 6000 并打 `truncated` 标记；菜单标题按 `storage.local.amsLang` 三语手写在 `MENU_COPY`（不走 `i18n.js`），`installMenus` 用 `installQueue` 串行化防重复创建。

悬浮控件的 `displayMode` 键（三态 `handle`/`always`/`hidden`）细节见 `docs/adapters.md`。
