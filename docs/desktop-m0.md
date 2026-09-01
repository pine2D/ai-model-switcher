# PolyAsk Desktop M0 设计规格

## 目标

用 Electron 在 Windows、macOS、Linux 上提供一个系统窗口，承载 9 个真实 AI 站点页面，并按用户当前勾选范围动态展示和群发；验证登录持久化、实时可见群发、现有站点适配器复用、安全隔离和资源开销是否达到继续产品化的条件。

M0 是可保留的技术基线。当前分支已在该基线上迁移扩展核心能力，并开始发布未签名跨平台预览包；“可下载”不代表已完成下述原生平台、签名和 60 分钟验收。

## 成功标准

- 一个 `BrowserWindow` 内为**每个已勾选站点**各建一个独立 `WebContentsView`（默认全选即九个），没有外置 Chrome 标签页或站点窗口。视图**按勾选懒建**：没勾的站点不建视图、不加载页面；取消勾选会释放该视图（登录态存活在持久化 session 分区里，重新勾选会重新加载并仍是登录状态，**丢的是页面上的对话**）。正在发送/生成的站点不释放，留到空闲后的下一次 reconcile。
- 站点页面保持独立会话；**所有已勾选站点都挂载并保持正尺寸**（非当前页的被当前页完全遮住），用户能直接看到回答、思考动画、停止按钮和站点原生错误。
- 一次提问按同一绝对 `deadline` 群发到所选站点；取消沿用 epoch 语义；不确定提交不自动重发。
- 已成功建立的站点会话在应用重启后保留，不读取或复制 Chrome 用户配置和 Cookie。
- Windows、macOS、Ubuntu 至少各完成一次启动、布局和登录验证；Gemini 首次登录是继续产品化的硬门槛。
- 60 分钟运行中没有主进程卡死；单站渲染进程崩溃能被标记并重载，不拖垮其余站点。

## 非目标

- 初始 M0 退出门槛不要求 Drive 同步、归档、辅助综合、迁移包和自动更新；当前产品化分支已在 M0 基线上逐项迁移，未完成项仍不视为初始技术验证的阻塞条件。
- M0 不实现完整视觉设计系统，只建立覆盖布局、密度、焦点、状态和可访问性的最小令牌体系。
- M0 不通过修改 User-Agent、关闭 `webSecurity`、复制浏览器 Cookie 或注入凭据绕过登录限制。
- M0 不追求比「同样数量的 Chrome 标签页」显著更低的内存；目标是集中管理和实时可见。但**只勾几个站就该只付几个站的钱**——曾经无论勾几个都把九站全部建出来并加载，是设计外的浪费，已改为懒建（实测约 124 MB/站，勾 5 个比勾 9 个省约 27%）。

## 架构

### 进程边界

- Main process：创建窗口和视图、维护站点注册表、校验导航/权限、执行群发编排、汇总状态。
- Shell renderer：显示提问区、站点状态、总览/聚焦布局；不持有 Electron 原始 API。
- Shell preload：只暴露带类型的最小命令集合。
- Site preload：运行在隔离世界，通过兼容层加载现有 `i18n.js`、`content/core.js`、上传/Markdown/适配器/诊断脚本；第三方页面看不到 IPC 和 Node API。

### 视图与会话

- Shell 使用单个 `BrowserWindow`。
- 每个**已勾选**站点使用一个 `WebContentsView`，由 main process 统一设置 bounds；Shell 只提交布局矩形。
- **层序靠「重挂即提升」实现**：`addChildView` 对已在视图树里的子视图是原地提升到最顶层（幂等、`children` 不增长，Electron 43.4.0 实测），所以当前页盖住后台页不需要先 detach。**不要改成全拆重挂**——实测那样会让被聚焦站点的渲染进程真的丢焦点（`hasFocus` 转 false、blur 触发）。
- Shell 与远程站点使用不同 Session。全部站点共享 `persist:polyask-sites`，让跨域登录各自持久化在同一个应用用户数据目录。
- 站点视图始终 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`。

### 发行形态与数据目录

- 安装版沿用 Electron 的系统用户数据目录；Windows 便携版通过根目录 `portable.json` 识别发行形态，并将 `userData` 与 `sessionData` 都切换到同级 `PolyAsk Data`。已有便携数据时先切换目录再申请便携实例锁；首次复制旧数据时先临时占用旧 profile 的 Electron 实例锁，复制或完成暂存切换后释放，再申请便携实例锁，之后才打开 SQLite 和站点 Session。
- 便携版根目录固定分为可替换的 `App` 和持久的 `PolyAsk Data`。升级替换整个 `App`；`portable.json` 与 `README.txt` 不含用户数据，可随新包覆盖。`app.asar` 随 `App` 更新，设置、SQLite、Cookie 和站点会话不进入发布 ZIP，也不随升级覆盖。
- 首次运行真正的便携版时，只在系统默认用户数据目录中发现 SQLite 或 Chromium 会话资料后询问是否复制，空目录与实例锁元数据不算旧数据。复制期间 Electron 会临时创建或更新旧 profile 根级实例锁，但不改写其中的设置、Cookie、SQLite 等用户资料。确认后先复制到根目录旁路暂存区，过滤 Windows `lockfile` 与其他平台的 `Singleton*`，重启时在 Chromium 打开数据目录前完成切换；旧资料不清空，失败时保留旧资料并提示关闭全部 PolyAsk 进程后重试。路径探测只有 `ENOENT`/`ENOTDIR` 视为不存在，权限或 I/O 错误直接停止；`PolyAsk Data` 只有在含有与暂存区 nonce 一致的 bootstrap 标记，且其余内容仅为当前 Electron 提前生成的 `Crashpad`、根级 `Local State` 与实例锁元数据时才可被暂存导入替换，未知文件一律保留并给出专用提示。复制出的 profile 会获得新的同步设备 ID，避免用户回退旧版后两个客户端覆盖同一 Drive 状态文件。
- 设置页只接收经过裁剪的版本号和发行形态，不向 Shell renderer 暴露本机用户数据路径。

### 适配器复用

- `i18n.js` 显式暴露只读的 `globalThis.__AMS_I18N__`。
- `content/core.js`、三组适配器和 `diag.js` 从该命名空间取得 `t()`，从而既能继续作为 MV3 classic script 使用，也能被桌面 preload 打包为独立模块。
- Desktop compatibility shim 仅实现适配器需要的 `chrome.i18n`、`chrome.storage` 和 `chrome.runtime.onMessage` 子集。
- 两条方向相反的豁免：`content/pill.js`（扩展专用悬浮控件）不进入桌面 preload；`content/generation.js`（Desktop 专属只读生成态探针，被 `desktop/src/preload/site.ts` 的 `readGeneration()` 独占消费）不进扩展 manifest。两条都由 `scripts/test-desktop-shared-runtime.js` 显式守着，`content/core.js` 一旦拆分会立刻红。`generation.js` 必须排在全部适配器之后 require——它按已填充的注册表逐 host 挂默认实现，早了就静默缺席。

### 消息流

1. Shell renderer 发送经过验证的 `BroadcastRequest`。
2. Main process 创建 epoch 和绝对 deadline，向所选 Site preload 分发同一请求。
3. Site preload 把请求交给现有 runtime listener，并返回 `{ host, ok, code, ... }`。
4. Main process 校验响应来源的 `webContents.id` 与登记站点，更新 Shell 状态。
5. 超时、端口中断、`submit_unconfirmed` 都进入失败终态。扩展侧那条「基于 Kimi 只读 `submitted()` 的自动重试一次」**尚未迁到 Desktop**：目前 Desktop 一律不自动重发，交给用户点重试。

## 安全约束

- 远程页面永不获得 `ipcRenderer`、`contextBridge`、文件系统、Shell 或任意 main-process 方法。
- IPC 采用固定 channel 和数据白名单；main process 同时校验 sender、站点 key、当前 host 和请求结构。
- 顶层导航由 `navigation-guard.ts` 的 auth 流状态机裁决，区分导航来源：`will-navigate`（渲染端 `location.href`/链接/表单，恒主帧）与 `will-redirect`（服务端 302，任意帧）。`site`/`auth` 恒放行；`external` 主帧**只在「auth 流进行中」且「来自服务端 302」时放行**——真机三症状（Google SetSID 联邦跳转、OpenAI auth0/验证码域跳转）全是服务端 302，v0.23.0 之前一律拦下，造成「输完密码/验证码点按钮没反应、刷新却已登录」；而站内被攻陷脚本只能走渲染端 `will-navigate`，即便在 auth 流中其 external 目标也一律拦，堵死「先跳登录域武装、再跳任意站」的两步钓鱼。`auth` 流只由 `did-navigate`（主帧实际提交，程序化 `loadURL`/`reload`/弹窗改写的加载都触发）翻转：踏上登录域进入、提交回本站退出——按「提交」而非「意图」武装，杜绝「发起 auth 导航但永不提交」的钓鱼跳板与新会话后标志位卡死。已登记的登录域含 Google 三站的 `accounts.youtube.com`（联邦 SetSID）与 ChatGPT 的 `auth0.openai.com`（Claude 的 `accounts.youtube.com` 属推断性登记，未经真机验证）。
- 子帧只拦非 https（验证码/嵌入登录 iframe 的服务端重定向属正常网页行为，`webSecurity` 与站点 CSP 才是子帧主防线）；子帧从不改变主帧流状态。注意：子帧的**初次**导航只触发未监听的 `will-frame-navigate`，本就无守卫——要守子帧应监听该事件，而非在 `will-redirect` 上加码。
- 第五种导航语义 `transit`：一方基础设施的反滥用/同意中转域（Google 的 `www.google.com` sorry 异常流量页、`consent.google.com`），登记在 `SiteDefinition.transitHosts`（Gemini 已真机坐实首屏会被 302 到 `www.google.com/sorry`；Claude/ChatGPT 属**推断登记、未经真机验证**，比照 `accounts.youtube.com` 先例）。`transit` **只在服务端 302(`will-redirect`) 放行、渲染端 `will-navigate` 一律拦、不进也不改登录流、不作为 `window.open` 改写目标**。核心不变量:它**不新增任何到达 external 的路径**——通往 external 的闸门仍只由 auth 域武装的 `authFlow` 控制,`transit` 碰不到它(有回归钉死)。取舍记档:① `transit` 是 host 粒度,等于放行 `www.google.com` 全路径的服务端 302 落地,残余风险由「落地的是一方 Google 页面而非攻击者 HTML、无第三方顶层内容代理、往外下一跳 external 仍被拦、GET 导航难做敏感变更」四重边界夹死;② 不校验 sorry 的 `continue` 参数,越界目标由 external 闸门兜底;③ 停在验证码中转页时健康检查归 `unknown`(不再像修复前判 external→error 进注意力清单),属不确定态而非故障,广播/采集/探针都正确地不向它发送。
- **新窗口一律 deny 真窗口**；`window.open` 只有两种改写进本受管视图的情形——目标是本站页面且顶层也在本站（豆包登录按钮走这条），或目标是登录域且「顶层仍在本站 / auth 流进行中」（SSO 弹窗链）。弹窗不携带来源帧，一律不按主帧记账，子帧的 `window.open` 不能借此提权。
- 主帧停在 `external` 会被健康检查标为 `error` 并进工作台注意力清单，不再伪装成「一切正常」。**auth 流中停靠的外部源同样继承第 68 行的 `SITE_PERMISSION_ALLOWLIST`（fullscreen / pointerLock / clipboard-sanitized-write）**——这是该权限段此前未覆盖的事实。
- 每个远程 Session 的权限请求处理器**只放行显式白名单**（`clipboard-sanitized-write`、`fullscreen`、`pointerLock`），其余一律拒绝——包括通知、摄像头、麦克风、地理位置、MIDI、`clipboard-read` 与 `window-management`。白名单是 `desktop/src/main/view-manager.ts` 的 `SITE_PERMISSION_ALLOWLIST`，两个 handler 都读它，改动须同步本节。
- 站点视图开启 `safeDialogs`，限制页面用 `alert`/`confirm` 刷屏冻住整个单窗口；**未启用 `disableDialogs`**——站点自身的确认框仍要能用，关掉它之前需要真机验证九站登录与离开确认。
- 不关闭 Chromium sandbox，不忽略证书错误，不允许 HTTP 内容。
- 打包时启用 Cookie Encryption、ASAR Integrity、OnlyLoadAppFromAsar，并关闭 RunAsNode 和生产环境调试入口。
- Shell 的 CSP 写在 `desktop/src/renderer/index.html` 的 meta 里，`connect-src` 收窄到 `'self' ws://localhost:*`，并补齐 `base-uri` / `form-action`。这是折中：**生产包里仍留着 localhost 的 ws**，因为 webpack HMR 需要它而 meta 是静态的。要按环境彻底移除，得把 `index.html` 改成 HtmlWebpackPlugin 模板，或改由 main 进程 `onHeadersReceived` 下发生产 CSP 响应头（meta 与响应头取交集）——两条都是独立改动，别直接删 `ws:` 把 HMR 打断。

## 最小界面

受众是需要长期并排比较 AI 回答的高频桌面用户，界面的单一任务是“发送一次，持续看清所选站点的进展”。

- 总览模式：只显示当前页的已选站点，并按 1–4 个站点动态排布。
- 聚焦模式：当前页显示一个主视图和最多 3 个实时次要视图；窄窗口自动采用此模式。
- 每页最多 4 个站点；选择 5–9 个站点时按站点总数均衡分页，换页只改叠放次序与 bounds，全部已勾选站点始终挂载，不销毁或重载页面。
- 每个视图预留独立标题条，包含站点名、发送状态、聚焦和重载；标题条不覆盖远程网页。
- 品牌沿用扩展的靛蓝色系：亮色 `#4f46e5`、暗色 `#a5a0ff`，成功 `#16a34a`、失败 `#dc2626`，其余使用系统中性色。
- 字体使用 `system-ui`，不捆绑字体；窗口框架、菜单、对话框和快捷键遵循各平台约定。
- 特色元素是每块视图顶部的“提交状态轨道”：一条克制的状态线表达加载、发送、警示、取消和失败；回答与思考进度直接看站点原生页面。轨道不使用持续装饰动画，降低动态效果时取消位移动画。
- 应用菜单提供聚焦提问框、上一/下一站点和上一/下一组站点命令；`Alt+1` / `Alt+2` / `Alt+3` 可直达对应站点页，不存在的页码保持当前页。原有 `CmdOrCtrl+Shift+PageUp` / `CmdOrCtrl+Shift+PageDown` 仍可顺序换页，避免焦点进入独立站点视图后无法返回 Shell。

## Grid / Focus 综合密度规格

### 模式职责

- Grid 是等权比较视图：当前页的已选站点按固定产品顺序动态排布，适合同时观察进度、浏览答案和执行轻量操作。
- Focus 是主次阅读视图：当前主站承担完整阅读、滚动、追问和弹窗处理；当前页的其余站点仍为实时、可交互的 `WebContentsView`，不得降级成截图或纯状态卡。
- 单页超过 4 个完整网站会显著损害可读性，因此 5–9 个已选站点按 3+2、3+3、4+3、4+4、3+3+3 均衡分页，避免出现只有一个站点的末页；**所有已勾选站点始终挂在原生视图树里并保持正尺寸**——非当前页的视图与当前页第一格用完全相同的矩形、压在其之下，因此不占屏幕空间也不抢鼠标事件。**不能只挂当前页**：未挂进视图树的 `WebContentsView` 页面视口恒 0×0（只 `setBounds` 不 `addChildView` 同样是 0，Electron 43.4.0 实测），`content/core.js` 的 `findComposer` 因 `r.top < innerHeight` 恒假而返回 null，群发对后台页站点必然 `composer_not_found`、一路重投烧到截止线。

### 布局几何

- Grid：1 个站点铺满；2 个左右并排；3 个横向三分；4 个为 2×2。
- Focus：1 个站点铺满；2 个采用约 2:1 主次分栏；3–4 个采用左侧主站加右侧 2–3 个等高次要视图。
- 请求 Grid 但任一格宽度 `<380 CSS px` 或总高度 `<210 CSS px` 时，自动采用 Focus；阈值按当前页实际站点数计算。
- Grid 永远恢复固定产品顺序。Focus 记住每页最近主站；页签切换后先恢复该页主站，否则取该页首站。
- 布局或页签切换只改 bounds、叠放次序和页面缩放，不销毁、不重载站点，不中断回答生成、滚动位置或登录会话。

### 统一命令栏

- Grid、Focus 和窄窗共用同一条命令栏和同一套控件优先级，不维护两套视觉节奏。
- 紧凑模式下固定占高不超过 52px，依次容纳布局切换、提问框、档位、选择数量和发送/取消；应用身份由系统标题栏和任务栏承载，不在命令栏重复展示品牌。
- 提问框默认单行；获得焦点时命令栏临时向下扩展一次，失焦或按 Escape 后恢复，不永久挤压视图，也不随输入字符或换行让站点反复重排。普通 Shell DOM 无法可靠覆盖原生 `WebContentsView`，因此不伪造会被站点视图遮挡的浮层。
- Windows/Linux 的传统菜单栏默认自动隐藏，按 `Alt` 临时显示；macOS 沿用系统全局菜单。
- P0 始终显示：提问框、档位、发送/取消、站点名、是否参与群发和状态轨道。P1 空间允许时显示：布局文字、选择数量和状态短文案。P2 只在悬停、键盘聚焦或溢出菜单显示：聚焦、重载等站点操作。

### 站点框架与状态

- 紧凑标题条高 24px；外边距和网格间距均为 4px；所有尺寸与间距来自 4px 基础令牌，禁止逐组件散落魔数。
- 正常的加载、发送、已提交和取消主要由提交状态轨道表达，不在各格重复铺满长文案。警示与失败显示图标和短文案，完整三语说明放入 tooltip 与读屏播报；页签聚合后台页的发送中与失败数量。
- 图标替代跨平台含义稳定的布局、档位、聚焦、重载和更多操作；三个档位固定使用“站点设置”“快速”“深度思考”图标，并通过本地化 tooltip、可访问名称和选中态消除歧义。主发送动作在空间允许时保留文字。
- 紧凑模式的交互目标不小于 24×24 CSS px；检测到粗指针时切换到 comfortable 令牌，增加命中区域和间距，不缩小主要字号。

### 密度与站点缩放

- Shell 密度提供 `compact` / `comfortable` 两档；鼠标键盘桌面默认 compact，用户选择持久化。
- 页面缩放与 Shell 密度相互独立。Grid 默认 90%，Focus 主站 100%、次要站 90%；用户可统一改为 100%，选择持久化。
- 页面缩放只通过 main process 的 `webContents.setZoomFactor()` 执行。Shell 通过校验过的 IPC 提交枚举值，远程页面不能控制该接口。
- 切换 Focus 主站时只调整当前页相关站点的缩放，避免无关页面重流。
- 不向远程站点注入隐藏侧栏、广告或导航的 CSS，不以依赖站点私有 DOM 的方式换取密度。

### 视觉方向

- 视觉主题仍是“多站响应墙”，而不是通用卡片仪表盘：真实网页是主体，PolyAsk chrome 保持安静，唯一持续识别元素是贯穿各站标题条的提交状态轨道。
- 继续使用系统字体与现有靛蓝、成功绿、警示黄、失败红；不增加装饰渐变、阴影层级或无信息动画。
- 布局切换不为原生视图 bounds 伪造动画。Shell 页签指示器在指针操作时使用 180ms 过渡，键盘换页立即响应；抽屉和图片托盘使用 140–240ms 的可中断进退场，设置与结果库仅使用轻量入场过渡，并遵守 reduced motion。

### 状态与数据边界

- main process 继续拥有 native view bounds、Focus 槽位顺序和站点缩放；Shell renderer 只渲染对应框架并发送经过校验的布局/显示偏好。
- Focus 槽位顺序属于当前窗口状态，不进入跨设备数据；密度与页面缩放偏好保存在桌面 Shell 自己的持久存储，不进入 Chrome 扩展同步。
- 页面加载状态和群发运行状态继续分层；布局、密度和缩放变化不得覆盖提交终态或产生新的自动重发路径。

## Google Drive 同步

- 桌面端只接受 Google Cloud 的同一组 Desktop app OAuth Client ID 与 Client Secret；使用系统浏览器授权、PKCE S256、随机 `state` 和绑定 `127.0.0.1` 的随机端口回调，不内嵌登录页，不复用扩展 OAuth 客户端。Client Secret 会随桌面应用分发，不能作为保密安全边界。
- 权限固定为 `https://www.googleapis.com/auth/drive.appdata`。列举、变更订阅、下载、上传和删除全部限定在 `appDataFolder`；清云只处理 `appProperties.app === "polyask"` 的文件。
- 刷新令牌只通过 Electron 异步 `safeStorage` 持久化。Linux 后端为 `basic_text`、`unknown` 或安全存储不可用时，只保留进程内令牌并提示重启后需重新登录。
- 同步复用扩展 schema 1：每设备一个 state 文件、每设备/文本哈希一份 history 文件、每归档一份 archive 文件。状态按 `updatedAt` 后 `deviceId` 合并，同时间 tombstone 优先；远端正文必须与 Drive metadata 的 id/device 一致。
- 只有设置页的“连接 Google Drive”会发起系统浏览器授权；未连接时，启动、15 分钟周期任务和本机变更均保持静默。本机变更 3 秒防抖；429/5xx 指数退避，410 自动全量重扫，401 只刷新令牌重试一次。服务端 `Retry-After` **只用于延长退避，不会缩短**；`0` 与已过期的时间点视为无效（否则 `?? ` 不吃 0 会把 `nextAt` 设成当前时刻，按网络往返轰炸一个已经在限流的 Drive）。OAuth 令牌交换与 Drive 网络请求均有 30 秒截止时间；**系统浏览器回调的等待上限另有 5 分钟**（`oauth-pkce` 的 `timeoutMs` 默认值，`oauth-session` 未显式传参），等待期间设置页可随时关闭。超时保持未连接或待同步状态，并给出网络/代理检查提示。未来 schema 进入只读兼容模式，仍允许下载但禁止上传。
- 回调页只说明“已收到授权，正在验证”，不提前声称 Drive 已连接；应用只有在首次 Drive 访问验证成功后才写入“已连接”状态，授权或验证超时仍保持未连接。失败提示会区分授权码、OAuth 客户端配置、回调地址、刷新令牌与首次 Drive 鉴权；只保留经过格式校验的 Google 错误代码与有限诊断类别，不记录授权码、访问令牌、原始响应正文或账号信息。
- 断开连接会撤销 OAuth、清本机 Drive 索引并保留本机数据、云端数据与待同步 outbox；撤销失败只落 `revoke_failed` 提示，不阻塞后续操作。**「授权成功但首次 Drive 校验失败」也要能撤销**：此时令牌已落盘而状态不是 connected，设置页据 `SyncStatus.hasStoredToken`（源自 `SyncConfig.tokenStored`）额外给出断开入口；该字段刻意做成可选，也**不进** `sync-diagnostics` 的白名单快照，因此不会出现在报障报告里。**不要在校验失败分支里无条件 `disconnect()`**——网络抖动会把用户强制踢回重新授权。「删除云端数据」必须在设置页逐字输入 `DELETE`，完成后断开连接；**可被「断开连接」取消**。清理失败或被中断时释放清理标记、保留已删除计数基线，同步与断开立即恢复可用，用户重点一次「删除云端数据」即可重跑——清理进行中同步会以 `clear_pending` 早退（不再静默空跑）。
- 同步失败分类收在 `desktop/src/main/sync-failures.ts` 的 `classifySyncFailure`（错误 → `{state, reason}` 的纯函数映射），由 `sync-engine.ts` 的 `fail()` 调用。**新增 reason 只改这一个文件，且必须同步三处**：`shared/sync-diagnostics.ts` 的 `SAFE_REASONS`（不进白名单就不会出现在报障报告里）、`renderer/sync-status.ts` 的 `describeSync`、`shared/copy.ts` 的三语。漏一处就是 UI 裸露英文码或报告丢 reason 行。

开发时将 `resources/oauth.example.json` 复制为被 Git 忽略的 `resources/oauth.json` 并填入同一个 Desktop 客户端的 `clientId` 与 `clientSecret`，或同时设置 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID` 和 `POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET` 后执行 `npm run configure-oauth`。Release workflow 分别从 GitHub Actions Repository Variable 与 Repository Secret 生成该文件；Forge 将其复制到产物，归档脚本会拒绝凭据缺失或格式无效的发行包。未配置的本地构建仍可运行，但设置页会禁用连接并说明原因。

正式版与本地开发使用不同的 Desktop OAuth Client。Client Secret 防误提交、Google Cloud 监控和事故轮换流程见 `docs/desktop-oauth-security.md`；这些维护者约束不进入普通用户界面。

### 验收指标

- 在 2048×1152、100% 系统缩放下，Shell 固定占高不超过 56px；1–4 个站点的 Grid/Focus 均保持网页可读。
- 在 1280×720、1440×900、1920×1080、2048×1152、2560×1440，以及 100%/125%/150% 系统缩放下，0–9 个任意选择的当前页 placements 均为正尺寸、互不重叠且不超出内容区。
- Grid/Focus、页签和 Focus 换站时已勾选站点的 `webContents.id` 保持不变；**全部已勾选站点都挂在原生视图树且为正尺寸**，当前页最多 4 格是其子集（与 `desktop/scripts/smoke.mjs` 默认全选下的 `attached=9` 断言一致）。
- English、简体中文、繁體中文下命令栏无截断；仅键盘可完成群发、取消、返回提问框、切换主站、切换站点页和重载。
- compact、comfortable、90% 和 100% 页面缩放均有自动化契约测试；最终产物至少完成一次 Grid、宽屏 Focus、窄屏 Focus 的截图回归。

## 测试策略

- Node 单元测试：站点注册表、布局算法、IPC 数据验证、deadline/epoch 编排。
- 共享 runtime 回归：在彼此隔离的模块作用域加载 i18n/core/adapters，证明桌面打包不会破坏扩展 classic-script 行为。
- Electron 集成测试：启动应用、枚举 9 个 WebContents、验证 Session、导航阻断、IPC sender 校验和视图 bounds。
- Playwright/Chromium CDP：操作 Shell；开发模式下按 `webContents` 目标检查各站点。
- 真机人工验证：Windows Narrator、macOS VoiceOver、Ubuntu Orca；深浅色、高对比度、缩放和 reduced motion。

## M0 退出决策

- 九站登录、群发、实时可见和 60 分钟稳定性全部通过：进入产品化阶段。
- 仅个别非 Google 站点因 DOM 漂移失败：按现有适配器流程修复后复测。
- Gemini 因嵌入式浏览器政策无法安全完成首次登录：停止全量桌面产品化，由产品层选择排除 Gemini、外置浏览器或 API 方案，不以技术绕过继续。

## 登录兼容性

- Gemini：只有当前视图确实进入 `accounts.google.com` 并返回 `gemini.google.com` 后，应用才自动重载一次 Gemini；普通导航和后续重载不会触发循环。该恢复用于两步验证完成后页面停滞的情况，不改变 Google 登录策略。
- DeepSeek：若页面提示“当前设备环境异常”，先用同一账号、同一网络在最新版 Edge/Chrome 复测，并记录是否使用代理、企业网络或安全软件。当前没有经过验证且安全的通用绕过；PolyAsk 不伪装 User-Agent、不关闭 `webSecurity`、不复制浏览器 Cookie。浏览器能登录而 Desktop 仍失败时，应按嵌入式环境兼容问题保留诊断证据，不能宣称已修复。

## 当前实现状态

已完成 M0 纵向切片、动态选站布局和工作台交互：Electron 43 + Forge 7 + TypeScript + React 脚手架、单 `BrowserWindow`、9 个持久化 `WebContentsView`、每页最多 4 站的 Grid/Focus、安全导航和权限策略、隔离 preload、现有适配器加载、绝对 deadline/epoch 群发、页面与群发状态分层，以及跨视图统一命令。界面按当前页排布已选站点、其余已勾选站点保持挂载并被完全遮住；1–4 站动态排布，5–9 站均衡分页且保留每页聚焦记忆，页签可靠区分已发送、生成中、完成和失败。左侧工作台统一站点选择、保存分组和只读健康检查；站点详情另支持忽略缓存的强制重载,以及清除该站 Service Worker/CacheStorage 后重载(保留登录、不清 cookies/本地偏好),用于站点资源被过期缓存卡死的白屏场景；Drive 连接诊断留在设置页并可复制经过负向泄漏约束的报告。命令面板、快捷键速查、提问模板、最近提问、本地草稿、下一未完成/失败站点、可选后台通知、手动更新入口和结果双选对照均已落地。群发结果区分失败与取消，并可按原发送范围重试；任意数量的已选站点使用同一套结果和重试逻辑。命令栏支持最多 4 张 PNG/JPEG 图片（合计 ≤10 MiB）的选择、粘贴、预览和兼容范围校验；这三个数字与扩展共用一套限额，改动落点清单见 `docs/adapters.md` 的「图片载荷」。重试沿用同一 `runId`，生成监控随之续跑：仍在生成的站点保留计时与 15 分钟观测期限，只有被重试的站点重新计时；点过取消后整轮监控作废，之后的重试只监控被重试的站点（其余站点此时已回报 cancelled，本就在重试集合内）。两端 Markdown 导出的综合结果段落格式逐行一致（`**目标 AI**` 标签 + 站点显示名，档位挂在目标行末）。回答可并行采集并定格到单窗口结果库；结果库临时 detach 而不销毁站点视图，支持搜索、收藏、标签、备注、最佳答案、双回答段落对照和 Markdown 预览/导出。辅助综合同样复用单窗口结果库，并只允许当前已勾选的站点作为综合目标。Google Drive 同步已迁移 schema 1 数据、原生 OAuth/PKCE、操作系统令牌保护、增量同步、退避、网络截止时间、未来格式只读和受保护的云端清理；未连接时后台同步不发起授权，首次 Drive 验证成功后才标记已连接。Gemini 完成 Google 验证并返回后会执行一次受控重载。取消会锁定当前群发直至请求结算，并只重建仍在执行的对应站点视图。

2026-08-24 在 WSL2/WSLg 完成 Linux 冒烟：应用持续运行，DevTools 枚举得到 1 个 PolyAsk shell 和 9 个 AI 顶层 page target，九站均进入真实页面。人工验证进一步确认九站均可登录，Gemini 首次登录与群发成功；除 Kimi 因站点当时要求付费订阅而拒绝对话外，其余 8 站均成功提交并实时显示回答。该 Kimi 结果属于站点业务限制，不是容器、登录或群发链路故障。

同日在打包后的 Linux x64 产物上完成密度截图回归。150% 宿主缩放下，X11 窗口表面完整显示 3×3 Grid 和宽屏 4×3 Focus；将客户区调整到约 1280×720 CSS px 后，3×4 Focus 的 9 个站点框架均为正尺寸、互不重叠且没有越界。截图只证明 Linux/WSLg 行为，不代替 Windows 或 macOS 原生验收。

打包产物的自动 smoke 在**默认全选**下校验 1 个 Shell、9 个唯一 `webContents`、同一持久化 Session，并**回读每个站点视图实际生效的 webPreferences**（`sandbox`、`contextIsolation`、`nodeIntegration`、`webSecurity`）——任一项不达标即记 `insecure_site`；回读走 Electron 未在类型声明里公开的 `getLastWebPreferences`，读不到时按不安全处理（宁可红，不可假绿）。所有已勾选站点（默认九站）都挂载且有正尺寸，当前页最多 4 格是它的子集；后台视图被当前页完全遮住。3 分钟短时 soak 完成 4 次进程采样，未发生 renderer crash 或 unresponsive；冷启动到九站完全加载的工作集增长属于启动口径，正式 60 分钟报告将另行判断热启动后的稳定性。主进程已使用 Electron 43 内置 `node:sqlite` 建立 schema 1 数据层，WAL、外键、参数化仓储、事务 outbox 和 tombstone 均有重开测试。Desktop TypeScript/React 与运行器测试全部通过，`npm run typecheck`、`npm run package`、`npm run smoke`、`npm audit --omit=dev` 和扩展全量 `scripts/verify.sh` 均通过。CI 已配置 Linux、Windows、macOS 三平台测试、类型检查和应用目录构建，Linux 另执行打包产物 smoke；Release workflow 配置了 Windows x64 安装版、程序/数据分离的便携 ZIP、Linux x64、macOS x64/arm64 原生 maker，并为每个主包生成 SHA-256。远端矩阵结果不替代真机人工验收。

2026-08-25 已创建独立 Desktop OAuth Client ID，并通过 Repository Variable 进入 Release 构建。2026-08-27 Windows 真机确认授权码交换返回 `invalid_request / client_secret`：旧包只携带 Client ID，未提交该 Desktop 客户端生成的 Client Secret。当前构建链改为成对注入并审计 Client ID 与 Client Secret，授权码交换和刷新请求都会提交完整凭据；修正版仍需 Windows 真机完成 Drive 联网闭环。

尚未完成 M0 退出验收：真实 Desktop OAuth/Drive 联网同步、Windows/macOS/原生 Ubuntu 真机安装、Kimi 可对话账号复测、正式 60 分钟稳定性、读屏与高对比度检查、其余系统缩放组合，以及各平台签名和 macOS 公证。

运行依赖执行 `npm audit --omit=dev` 为 0 项已知漏洞——但 `--omit=dev` **结构性看不到 electron 本身**（按 npm 惯例它总是 devDependency，却是随每个发行包分发的实际运行时）。CI 的 verify 作业另跑 `node desktop/scripts/audit-runtime.mjs`，对完整 `npm audit` 报告只挑 electron 本身与非 Forge 工具链的 `@electron/*` 包判 high/critical 是否为零，当前为 0 项。完整 `npm audit` 仍报告 Electron Forge 构建链（`@electron-forge/*`、`@electron/packager`、`@electron/rebuild`、`@electron/node-gyp`）的上游传递依赖公告，当前稳定版没有非破坏性全量修复；这些包只在打包期跑、不进 `app.asar`，但正式发布前仍需重新评估并清零或形成明确处置记录。

## 开发命令

```bash
cd desktop
npm install
npm test
npm run typecheck
npm start
npm run package
npm run make
npm run smoke
npm run soak -- --minutes=60
```
