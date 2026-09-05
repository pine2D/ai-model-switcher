# Desktop 应用（`desktop/`）

动窗口/视图、preload 注入、群发编排、IPC、错误码、数据层与 Drive 同步之前读这份。**错误码全表、超时预算表、跨端不变量、源码文本守卫规则都在这里**；`CLAUDE.md` 只留硬约束条文，这份讲实现与事故现场。冲突以 `CLAUDE.md` 为准。

站点适配器契约、九张站点卡、站点 DOM 与时序坑见 `docs/adapters.md`；真机验证与门禁口径见 `docs/verify.md`；发版见 `docs/release.md`；OAuth 凭据维护见 `docs/desktop-oauth-security.md`。

`desktop/` 自包含的边界是**构建与测试自包含**：`cd desktop && npm test && npm run typecheck` 是它自己的门禁；仓库级动作（git tag、CHANGELOG、发版编排）留在根。

---

## 1. 进程边界与视图树

| 层 | 职责 | 落点 |
| --- | --- | --- |
| Main | 建窗与视图、导航/权限裁决、群发编排、数据层、Drive 同步、应用菜单 | `desktop/src/main/` |
| Shell preload | 只暴露带类型的最小命令面（`invoke`/`on`），不透传任何 Electron 原始 API | `desktop/src/preload/shell.ts` |
| Shell renderer | 命令栏、工作区、结果库、设置页；只提交经过校验的意图 | `desktop/src/renderer/` |
| Site preload | 隔离世界里加载站点运行时，收发 `site-command`/`site-response` | `desktop/src/preload/site.ts` |
| 站点运行时 | 九站适配器与通用链（classic script、`__AMS` 全局） | `desktop/src/site-runtime/` |

- Shell 是唯一的 `BrowserWindow`；每个**已勾选**站点一个 `WebContentsView`。视图按勾选懒建：没勾的站点不建视图、不加载页面；取消勾选释放视图（登录态活在持久化 session 里，重新勾选会重新加载并仍是登录态，**丢的是页面上的对话**）。正在发送/生成的站点不释放，留到空闲后的下一次 reconcile。
- **所有已勾选站点都挂在视图树里并保持正尺寸**，非当前页的与当前页第一格用完全相同的矩形、压在其之下——不占屏幕、不抢鼠标。**不能只挂当前页**：未 `addChildView` 的 `WebContentsView` 页面视口恒 0×0（只 `setBounds` 同样是 0），`site-runtime/core.js` 的 `findComposer` 因 `r.top < innerHeight` 恒假而返回 null，群发对后台站点必然 `composer_not_found`，一路重投烧到截止线。
- **层序靠「重挂即提升」**：`addChildView` 对已在树里的子视图是原地提升到最顶层（幂等、`children` 不增长）。**绝不要改成先 detach 再 attach**——全拆重挂实测会让被聚焦站点的渲染进程真的丢焦点。落点 `view-manager.ts` 的 `attach`/`detach`/`reconcile`。
- 布局、缩放、槽位顺序、`WebContents` 生命周期归 main；renderer 只提交白名单意图。

## 2. 站点视图与会话

- 全部站点共享持久 partition `persist:polyask-sites`（`diagnostics.ts` 的 `SITE_PARTITION`），与 Shell 会话分离；不读取也不复制 Chrome 的用户配置与 Cookie。
- 安全偏好写死在 `diagnostics.ts` 的 `SITE_VIEW_SECURITY`：`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`、`safeDialogs: true`。**未启用 `disableDialogs`**——站点自身的确认框仍要能用。打包产物的 smoke **回读每个视图实际生效的 `webPreferences`**（走未在类型声明里公开的 `getLastWebPreferences`，读不到按不安全处理），任一项不达标记 `insecure_site`。
- 顶层导航由 `navigation.ts` 的 `navigationDisposition` 分五类，`navigation-guard.ts` 裁决：`site`（本站 host）/ `auth`（登记的登录域）/ `transit`（一方反滥用与同意中转域，如 Google 的 sorry 页）/ `external` / `block`（非 https 一律 block）。`site`/`auth` 恒放行；`external` 主帧**只在「auth 流进行中」且「来自服务端 302」时放行**；`transit` 只在服务端 302 放行、渲染端一律拦、不进也不改登录流。核心不变量：`transit` **不新增任何到达 external 的路径**。auth 流只由 `did-navigate`（主帧实际提交）翻转，按「提交」而非「意图」武装。
- 子帧只拦非 https；子帧从不改变主帧流状态。**新窗口一律 deny 真窗口**，`window.open` 只有「目标是本站页面且顶层也在本站」「目标是登录域且顶层仍在本站或 auth 流进行中」两种改写进受管视图的情形。
- 站点视图里点到的外部链接交给用户自己的浏览器（`index.ts` 的 `openExternal` → `safeExternalUrl`）；不接这条回调是**静默无反应**。
- 权限请求处理器**只放行显式白名单**（`view-manager.ts` 的 `SITE_PERMISSION_ALLOWLIST`：`clipboard-sanitized-write` / `fullscreen` / `pointerLock`），其余一律拒绝——摄像头、麦克风、地理位置、MIDI、通知、`clipboard-read`、`window-management` 全在拒绝之列。两个 handler 都读它，改动须同步本节。
- `clearSiteData(site)`（站点详情的「清除缓存后重载」）**只清 `cachestorage` + `serviceworkers`**，不动 cookies、localStorage、IndexedDB——保住登录与站点自身偏好，只针对「过期 Service Worker 顶着旧资源、普通 reload 也从同一缓存来」的白屏。`await` 期间用户可能取消勾选，返回前必须重取视图引用（老引用已悬垂）。

## 3. 站点运行时注入

`desktop/src/preload/site.ts` 在隔离世界按**固定顺序**同步 require 11 条：

```
i18n → core → send → upload → md → adapters-intl → adapters-intl2 → adapters-cn → adapters-cn2 → generation → diag
```

- `send.js` 读 `window.__AMS`，必须排在 `core.js` 之后；`generation.js` 与 `diag.js` 必须排在**全部适配器之后**——两者都按已填充的注册表逐 host 挂实现/包装，早了就静默缺席。
- **chrome shim 只剩 `runtime.onMessage.addListener`** 一条（`core.js` 用它收命令），以不可写不可配置的属性装在 `globalThis.chrome` 上。
- **locale 单向注入**：require 完成后由外壳调 `__AMS_I18N__.setLang(resolveLocale(navigator.language))`。全应用只有 `shared/locale.ts` 一份解析（`en` / `zhCN` / `zhTW`，前缀匹配，未命中的 `zh-*` 之外一律 `en`）；运行时不再自己猜语言。
- 命令通道：main 用 `contents.send("polyask:site-command", {requestId, command})`，preload 回 `polyask:site-response`。**两端都只认主帧**——`shell-ipc.ts` 的接收侧显式判 `event.senderFrame?.parent !== null` 就丢弃，再由 `manager.owns(sender)` 校验来源视图；`SiteCommandChannel.receive` 还要求 `pending.contentsId === sender.id`。
- `dispatch` 逐个遍历监听器：某个监听器返回 `true`（会异步 `sendResponse`）或已同步作答就停；没有任何监听器接手才判 `invalid_response`；无监听器时判 `adapter_unavailable`。**不在这里硬断言「有且只有一个监听器」**——模块作用域一抛，`site-command` 监听就注册不上，九站整链失守；监听器数量由离线测试 `desktop/scripts/desktop-shared-runtime.test.js` 数 `addListener` 调用点守着。
- `wasSubmitted` 的每一个失败出口都是「不支持」：超时、无适配器、异常、形状不对，一律不能被读成「确认未提交」。
- 采集正文码点上限 `TEXT_LIMIT = 1_000_000`（`site.ts`），超限不静默丢弃，改带 `answer_truncated` 码。

## 4. 群发链路与超时预算

`renderer` → `polyask:broadcast`（`shell-ipc.ts`）→ `BroadcastCoordinator.send`（`broadcast.ts`）→ `ViewManager.sendCommand` → `SiteCommandChannel` → site preload → 站点运行时。

- **`deadline` 是绝对时间戳**，在 `broadcast.ts` 一次算出（`now() + max(1, timeoutMs)`）并原样放进每站命令，全链路透传、只读不重算。循环等待与 ≥1s 的固定等待一律夹取。
- **群发预算只有 `shell-ipc.ts` 一个真源**：`request.images.length ? 90_000 : 44_000`。**辅助综合走的是 `index.ts` 里另一处硬编码的 `44_000`，且没有带图分支**——改群发预算必须同批跟进这一处，否则带图辅助综合按纯文本预算跑。
- **epoch 取消**：`BroadcastCoordinator` 每次 `send` 自增 `epoch` 并换一个 `AbortController`；`cancel()` 自增 epoch 并 abort。每个 `await` 之后都核对 epoch，不一致立刻返回 `cancelled`。新写的长流程照此办理。
- **可重试码只有两个**：`RETRIABLE = {composer_not_found, not_ready}`——只有它们代表「还没开始提交」，可在同一 deadline 内等 `min(500, 剩余)` 后重投。其它任何码（含新增的）默认不可重试。
- **提交不确定 ≠ 可以重发**：`submit_unconfirmed` 走只读确认窗（下表），确认「已提交」返回成功；确认「未提交」也**只有在开关打开时**才允许自动重发一次。开关 `POLYASK_KIMI_RESUBMIT` 是 `broadcast.ts` 的模块常量，**当前为 `false`**，不是设置项——用户不该有能力打开一条尚未真机验证的自动重发路径。测试必须显式传 `resubmit`。

| 场景 | 值 | 落点 |
| --- | --- | --- |
| 群发绝对 deadline | 纯文本 44s / 带图 90s | `shell-ipc.ts` |
| 辅助综合发送 | 44s，**硬编码、无带图分支** | `index.ts` |
| 辅助综合等新会话 | 22s | `synthesis-service.ts` |
| 可重试码重投间隔 | `min(500ms, 剩余)` | `broadcast.ts` |
| 只读提交确认窗 | `min(deadline, now+1.5s)`，轮询 150ms，连续 5 次未见判未提交 | `broadcast.ts` |
| 回答采集（`collect`） | 每轮 8s | `collection-service.ts` |
| 只读诊断（`diagnose`） | 2.5s | `view-manager.ts` |
| 生成态探针（`generation`） | 单次 2.5s，轮询 900ms，连续 5 次读不到状态才放弃 | `view-manager.ts` |
| 生成监控观测期 | 起始 45s；**确实见到「生成中」后延长到 15 分钟** | `view-manager.ts` |
| Drive 周期同步 / 本机变更防抖 | 15 分钟 / 3s | `sync-engine.ts` |
| OAuth 回调等待 / 网络请求截止 | 5 分钟 / 30s | `oauth-pkce.ts`、`drive-client.ts` |

改任何一格必须同时看「谁在它下游等」：站点侧的单步等待一律夹到 deadline 内，通道层 `SiteCommandChannel` 也按 `deadline - now` 起定时器，deadline 已过直接返回 `timeoutResult`。

## 5. 错误码

**main 与站点运行时只产 `code`，绝不产用户可见文案**；判定认 `code`，**绝不正则匹配文案**。翻译只有两处落点：`shared/status-copy.ts` 的映射 + `shared/copy.ts` 的三语词条。

`shared/protocol.ts` 的 `SITE_CODES`（18 个）与 `status-copy.ts` 的 `STATUS_COPY_KEY` 一一对应：

| code | copy key | | code | copy key |
| --- | --- | --- | --- | --- |
| `tier_unconfirmed` | `tierUnconfirmed` | | `load_failed` | `loadFailed` |
| `composer_not_found` | `composerNotFound` | | `renderer_crashed` | `crashed` |
| `not_ready` | `siteNotReady` | | `image_invalid` | `imagePayloadInvalid` |
| `submit_unconfirmed` | `submitUnconfirmed` | | `attachment_unsupported` | `attachmentUnsupported` |
| `timeout` | `timedOut` | | `attachment_failed` | `attachmentFailed` |
| `cancelled` | `cancelledStatus` | | `attachment_timeout` | `attachmentTimedOut` |
| `inject_failed` | `injectFailed` | | `attachment_action_required` | `attachmentActionRequired` |
| `no_view` | `siteUnavailable` | | `invalid_response` | `invalidResponse` |
| `error` | `siteError` | | `adapter_unavailable` | `adapterUnavailable` |

采集码另走 `describeCollectionCode`：`no_answer` → `noAnswer`、`no_view` / `no_window` → `siteUnavailable`（`no_window` 是 Drive schema 1 线格式里带进来的旧码，语义与 `no_view` 相通）、`not_ready` → `siteNotReady`、`answer_truncated` → `answerTruncated`，其余落 `failed`。辅助综合发送另有 `describeSynthesisSendCode`，多一个 `target_not_selected`。

- `describeStatus` **不做运行时白名单校验**：认不得的码按 `phase` 兜底，宁可笼统也不丢消息。
- `ok:true` 也可以带 `code`（如 `tier_unconfirmed`）：显示为成功 + 警示，不谎报全绿。
- `attachment_action_required` 是适配器 `attach()` 的契约码，由 `site-runtime/upload.js` 透传字符串返回值；当前没有适配器产出，契约保留，已在覆盖测试里登记豁免。
- **新增可见码要同时改三处**：`SITE_CODES`（或 `describeCollectionCode` 的 `case`）、`STATUS_COPY_KEY`、`copy.ts` 的三语。漏一处 `desktop/test/status-copy-coverage.test.ts` 会红——它做双向对账：源码里产出的每个码必须有文案，文案表里的每个码必须真有产出方，例外要在 `PRODUCED_WITHOUT_COPY` / `COPY_WITHOUT_PRODUCER` 里写明理由。
- IPC 抛出的裸码经 `ipcRenderer.invoke` 会被 Electron 包成 `Error invoking remote method '…': Error: <code>`，**唯一还原点是 `shared/ipc-error.ts` 的 `ipcErrorCode`**；不剥前缀，渲染层写好的三语文案永远不可达。
- 同步失败码另有一套：`main/sync-failures.ts` 的 `classifySyncFailure` 是唯一映射点，新增 reason 必须同步 `shared/sync-diagnostics.ts` 的 `SAFE_REASONS`（不进白名单就不会出现在报障报告里）、`renderer/sync-status.ts` 的 `describeSync`、`copy.ts` 三语。
- **站点视图内不再弹 toast**（`core.js` 的 toast 是 no-op），用户可见反馈全部在外壳。

## 6. 布局与密度

- 单页最多 4 个站点（`shared/site-pages.ts` 的 `SITE_PAGE_SIZE = 4`）。1–4 站动态排布，5–9 站按 3+2、3+3、4+3、4+4、3+3+3 均衡分页，避免只有一站的末页。换页只改叠放次序与 bounds，不销毁、不重载、不中断生成与滚动位置。
- Overview（总览）是等权比较视图；Focus 是主次阅读视图，次要站点仍是实时可交互的 `WebContentsView`，不得降级成截图或状态卡。Overview 永远恢复固定产品顺序；Focus 记住每页最近主站。
- 几何：Overview 1 站铺满、2 站左右、3 站三分、4 站 2×2；Focus 1 站铺满、2 站约 2:1、3–4 站左主右次。请求 Overview 但格宽 `<380` 或高 `<210` CSS px 时自动落 Focus（`main/layout.ts` 的 `GRID_TILE_MIN_WIDTH` / `GRID_TILE_MIN_HEIGHT`，按当前页实际站点数算）。
- 密度令牌在 `shared/display.ts`：compact = 外壳高 52 / 标题条 24 / 边距 4 / 间距 4；comfortable = 64 / 32 / 8 / 8。提问框展开时外壳临时升到 120（comfortable 144），失焦或 Escape 后恢复，不永久挤压视图。所有尺寸走 4px 基础令牌，禁止逐组件散落魔数。
- 页面缩放与密度相互独立：`siteScale` 只有 `0.9` 与 `1` 两个合法值，Focus 主站恒 1，其余取 `siteScale`（`zoomForSite`）。缩放只由 main 的 `webContents.setZoomFactor()` 执行，renderer 通过校验过的 IPC 提交枚举值，远程页面碰不到这个接口。
- 命令栏一条通用：Overview、Focus、窄窗共用同一套控件优先级。始终显示提问框、档位、发送/取消、站点名、是否参与群发与状态轨道；空间允许时显示布局文字与选择数量；聚焦、重载等站点动作只在悬停/键盘聚焦/溢出菜单出现。紧凑模式交互目标不小于 24×24 CSS px，检测到粗指针切 comfortable。
- 品牌沿用靛蓝：亮色 `#4f46e5`、暗色 `#a5a0ff`，成功 `#16a34a`、失败 `#dc2626`，其余用系统中性色；字体 `system-ui`，不捆绑字体。唯一持续识别元素是贯穿各站标题条的提交状态轨道，不加装饰渐变与无信息动画。布局切换不为原生视图 bounds 伪造动画。
- 应用菜单提供聚焦提问框、上/下一站点、上/下一组站点；`Alt+1`/`Alt+2`/`Alt+3` 直达站点页（不存在的页码保持当前页），`CmdOrCtrl+Shift+PageUp`/`PageDown` 顺序换页——焦点进入原生站点视图后要能回到外壳。Windows/Linux 菜单栏默认自动隐藏、按 `Alt` 临时显示；macOS 用系统全局菜单。

## 7. 数据边界与本机数据管理

- 本机库是 `app.getPath("userData")/polyask.sqlite`（Electron 内置 `node:sqlite`），WAL、外键、参数化仓储、事务 outbox。表：`history`、`archives`、`state_items`、`outbox`、`drive_files`、`meta`。
- **界面状态不进数据库也不进同步**：窗口范围、最大化、布局模式、当前页、每页聚焦站点写在同目录的 `desktop-ui-state.json`（`ui-state-store.ts`，防抖 + 临时文件原子替换，损坏回退默认值、不阻止启动）。恢复时把窗口限制到当前显示器可见区域；页数因选站变化时把当前页夹到有效范围。不恢复抽屉、命令面板、确认框、发送中等瞬时状态。
- **删除一律 tombstone**：写 `deletedAt` + 入 outbox，不物理删。`DataAdminService` 的「清空历史」「清空结果库」走的就是这条正常路径，删除会同步到其它设备——否则其它设备会把记录同步回来。
- **「重置全部本机数据」是本应用唯一的物理删除路径**，语义刻意不同：先 `sync.disconnect()` 断开 Drive，再 `database.resetLocalData()` 物理清空五张表并只保留 `meta` 里的 `deviceId`。这里**不能用 tombstone**——tombstone 比云端记录新，重新连接后会赢过云端副本并上传，等于把云端也删了，与「重置不会删除云端数据」的承诺相反。`deviceId` 保留是因为本机在云端的旧 fragment 靠它找回，换掉会让重置后首轮上传把本机不建模的设置键整体丢掉。改这两条语义之前先改用户可见的承诺文案。
- Drive 同步：scope 固定 `https://www.googleapis.com/auth/drive.appdata`，全部操作限定 `appDataFolder`。数据格式沿用 `SYNC_SCHEMA = 1`：每设备一个 state fragment、每设备/文本哈希一份 history、每条结果库记录一份 archive；按 `updatedAt` 后 `deviceId` 合并，同时刻 tombstone 优先。更高 schema 进入只读兼容模式，仍可下载但禁止上传。
- **schema 1 的线格式冻结在 `desktop/test/fixtures/schema1-*.json`**（每个文件 `{file, body}`，出自扩展时代的真实实现，代码保留在 tag `archive/extension-v0.25.1`）。**不要重新生成、不要按新校验「修正」它们**：`schema1-wire-format.test.ts` 把全部样本喂进下行链路并要求逐条接收，任何一次校验收紧命中存量形状会先红在那里，而不是在用户的结果库里静默少几条。只有 `SYNC_SCHEMA` 真升版才新增 `schema2-*.json`，schema 1 样本保留。
- **两条跨端不变量**（跨设备记录要能互认，改一端就是让另一端拒收）：
  1. **提问在派发之前无条件入库**——`shell-ipc.ts` 的 `history.record(request.text)` 先于 `coordinator.send`。只有「请求解析失败」「图片站点不支持」这两处 throw 之前的非法请求不入库；**全部站点都失败的提问照样留记录**，这是有意的（用户要能重发）。
  2. **结果库字段上限按码点计、两端一致**（`shared/archive.ts`）：`title` 512、`instruction` 4000、`note` 4000、`host`/`label`/`winnerHost` 256、预览 `text` 320、`state`/`code` 64、单个 `tag` 32、`tags` 数组 20 项。`title` 与预览**截断**，其余**超限即 throw**。新增字段必须同时进这张表，否则表现为「某台设备的记录同步不过来」。
- 图片限额：单批最多 4 张 PNG/JPEG、合计不超过 10 MiB（`shared/images.ts` 的 `MAX_IMAGE_COUNT` / `MAX_IMAGE_BYTES`）。**改任何一个数，代码 + 三语词条 + README/docs 叙述的全部落点要一起改**，清单与当前数值以 `scripts/test-image-limits.js` 的对账项和 `docs/adapters.md` 的「图片载荷」为准，别凭记忆列。
- 便携版：根目录 `portable.json` 识别发行形态，`userData` 与 `sessionData` 都切到同级 `PolyAsk Data`。根目录固定分为可替换的 `App` 与持久的 `PolyAsk Data`，升级只替换 `App`。首次运行才询问是否从系统默认目录复制旧资料，复制走旁路暂存 + 重启后切换，失败保留旧资料；复制出的 profile 获得新的同步 `deviceId`，避免用户回退旧版后两个客户端覆盖同一份云端状态。设置页只拿到裁剪过的版本号与发行形态，不暴露本机用户数据路径。

## 8. 站点健康与诊断报告

- 左侧工作区的「站点状态」标签页（命令 `open-site-health`，`Alt+H`）做只读健康检查：**只调 `state`、`diagnose` 等只读契约，不开菜单、不切档、不写输入框、不触发发送**。
- `diagnose()` 每条检查必须带 `kind`（`shared/site-health.ts` 的 `SiteCheckKind`）：`reach`（到不到得了站点）/ `control`（关键控件在不在）/ `tier`（当前档位读不读得出）/ `probe`。缺省与未知值一律按 `control` 处理（fail-loud），漏标一处只会被归成 `control` 继续误报。
- **只有非 `tier` 的红项决定站点可用性**（`checks.filter(check => check.kind !== "tier")`）。各站 `state()` 是刻意的偏函数：用户停在任何非预设的合法档位都返回 null，那不是故障。`tier` 红项仍在详情页以提示显示。
- 判定口径：只有站点给出明确登录证据才说「需要登录」，无法可靠判断一律「无法确认」，不拿 URL 或页面外观猜。单站正在发送或重载会破坏当前任务时禁用「重新加载」并说明原因。
- **可复制诊断报告**（`shared/site-report.ts` 的 `buildSiteReport`）是切除扩展后唯一的结构化报障入口，**不得只可见不可复制**。内容边界：版本 / 发行形态 / 平台 / 显示缩放、每站的 `phase`+`code`+健康结论+`checkedAt`、每条 check 的 `{name, kind, ok}`。**绝不包含对话内容、URL、账号信息**——`check.name` 是本地化的 `diag_*` 词条不是页面文本，站点只写 key 与产品名不写 host。Drive 连接诊断另在设置页，同样走负向泄漏约束的白名单快照。

## 9. 源码文本守卫的明文规则

`desktop/test/` 里有一批测试不执行代码，而是读源码文本做正则断言（`shell-contract.test.ts` 最集中，另有 `status-copy-coverage`、`sync-reasons-coverage`、`site-navigation-escape`、`view-visibility`、`ui-guidelines` 等）。它们守的是「运行时验证成本过高、但改错了会静默出事」的不变量。

- **什么时候允许写**：① 断言的是**缺席**（某个危险 API 没被用上，如 `forcefullyCrashRenderer`、`location.reload`）；② 真实验证需要跑起 Electron 或真机，而 CI 的离线单测跑不到；③ 两份清单必须对齐而没有共同的运行时表达（如码表双向对账）。**能用真实调用断言行为的，一律写真实测试**，别用文本匹配替代。
- **一律走 `desktop/test/fixtures.ts` 的 `readSource(相对 desktop/ 的路径)`**。它以模块位置解析路径，守卫测试从任何 cwd 跑结果一致；**别用 cwd 相对路径的 `readFileSync`**，也别自己拼 `__dirname`。
- **断言要指名文件与原因**：测试名说清守的是哪条不变量，断言失败信息里要能看出「为什么这段文本不能没有」。只写 `assert.match(src, /foo/)` 而不解释，下一个人读不出该修代码还是该改断言。
- **别把断言钉死在可自由重构的字面量上**。反例参考：`status-copy-coverage.test.ts` 的产出方清单是**从 `site.ts` 的 require 列表现读**的，运行时文件搬家不用改测试；同时它带 `assert.ok(requires.length >= 5)` 与 `produced.size >= 10` 两条**自校验**，正则失效时先红在「抽取坏了」而不是假绿放行。新写的守卫照此办理：只要断言依赖某个正则抽取，就配一条「抽到的条目数不能塌成 0」的下限断言。
- 例外要**在代码里登记理由**，不要靠注释外的默契：`PRODUCED_WITHOUT_COPY` / `COPY_WITHOUT_PRODUCER` 每条都写明为什么豁免，且反向断言「豁免项现在若已有产出方就必须摘掉」。

## 10. 仍成立的设计决策

- **真实页面优先**：所有辅助界面服务于站点页面，不建立持续占宽的信息栏；应用身份由系统标题栏、任务栏/Dock 与应用菜单承担，不在高密度命令栏重复放品牌。
- **一个动作，一份定义**：命令、快捷键、菜单项与可访问名称共用同一注册表（`shared/commands.ts`）。加动作先进注册表，不在某一处单开分支。
- **状态不冒进**：`submitted` 只证明提问已提交，不能证明回答已生成完。没有可靠证据时只说「已发送」。生成态钩子 `generation()` 返回 `"idle" | "generating" | "complete" | null`，`null` = 无法可靠判断，界面停在「已发送」；**不得靠「文字一段时间没变」推断完成**；钩子保持同步只读。
- **不中断运行**：切页签、聚焦站点、开关面板、打开命令面板都不重载站点、不终止生成。后台站点完成或失败时不自动切页、不抢焦点。
- **职责边界**：左侧工作区管选站/预设/分组/健康与单站检查重载；设置页管 Drive、显示与数据设置、连接诊断、更新检查；命令面板只搜索并执行已有命令，不承载长期状态；页签只表达后台分页的发送/生成/完成/失败，不自动切页。新信息没有明确归属时**默认不进左侧工作区**。
- **允许 0–9 个任意站点组合**，别假设用户总选 9 个。选择变化、切分组不得销毁仍被选择的站点视图；「新建会话」会丢站点页面里的未保存内容，执行前必须确认。
- **本地数据层不引原生第三方依赖**（用 Electron 自带的 `node:sqlite`），降低三平台打包差异；OAuth refresh token 只经 `safeStorage` 持久化，Linux 后端不可用时只留进程内令牌并明确说明重启后需重新连接。
- **不以技术绕过登录限制**：不改 User-Agent、不关 `webSecurity`、不复制浏览器 Cookie、不注入凭据。浏览器能登录而应用不能时，按嵌入式环境兼容问题保留诊断证据，不宣称已修复。
- **生产包不留远程调试开关**，测试不依赖对外开放的调试端口；稳定性观测走 `app.getAppMetrics()` 周期采样加 `render-process-gone` / `unresponsive` / 加载失败事件（`main/runtime-gates.ts`，由环境变量 `POLYASK_SOAK_REPORT` / `POLYASK_DIAGNOSTICS_FILE` 一次性开启）。
- **可访问性是功能要求不是装饰**：键盘焦点、读屏播报、高对比度、reduced motion、中文输入法合成态，与布局同级。仅用键盘要能完成群发、取消、回到提问框、换主站、换站点页与重载。

## 11. 行数门禁

- `desktop/src/site-runtime/*.js` 与根 `scripts/*.js`：**单文件 ≤300 行**。
- `desktop/src/**/*.ts|tsx`：**单文件 ≤400 行**，三个越界文件走棘轮（只许降不许升，基线写死在 `scripts/verify.sh`，要上调必须同一 commit 改基线并写明理由）；豁免只有 `shared/copy.ts` 一条，且不用通配——通配会让日后新建的文件自动逃逸。
- 动手前先 `wc -l`，别凭记忆行数；要加行按职责拆分，不靠压行或删注释续命。

## 12. 开发命令

```bash
cd desktop
npm install
npm test          # 单元 + 契约 + 12 份适配器离线回归（desktop/scripts/*.test.js）
npm run typecheck # 与 npm test 首段的 tsc --noEmit 重叠；CI 单独再跑一遍是刻意的双保险
npm start
npm run package
npm run make
npm run smoke
npm run soak -- --minutes=60
```

根 `bash scripts/verify.sh` 跑跨端项（语法、JSON、行数门禁、OAuth 卫生、文档与测试登记、workflow YAML、5 个跨端测试）；两条都要跑。开发用 OAuth 凭据的配置见 `docs/desktop-oauth-security.md`。
