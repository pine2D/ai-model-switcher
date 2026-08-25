# PolyAsk Desktop M0 设计规格

## 目标

用 Electron 在 Windows、macOS、Linux 上提供一个系统窗口，窗口内同时承载 9 个真实 AI 站点页面，并验证登录持久化、实时可见群发、现有站点适配器复用、安全隔离和资源开销是否达到继续产品化的条件。

M0 是可保留的技术基线。当前分支已在该基线上迁移扩展核心能力，并开始发布未签名跨平台预览包；“可下载”不代表已完成下述原生平台、签名和 60 分钟验收。

## 成功标准

- 一个 `BrowserWindow` 内存在 9 个独立 `WebContentsView`，没有外置 Chrome 标签页或站点窗口。
- 9 个站点页面保持真实渲染；用户能直接看到回答、思考动画、停止按钮和站点原生错误。
- 一次提问按同一绝对 `deadline` 群发到所选站点；取消沿用 epoch 语义；不确定提交不自动重发。
- 已成功建立的站点会话在应用重启后保留，不读取或复制 Chrome 用户配置和 Cookie。
- Windows、macOS、Ubuntu 至少各完成一次启动、布局和登录验证；Gemini 首次登录是继续产品化的硬门槛。
- 60 分钟运行中没有主进程卡死；单站渲染进程崩溃能被标记并重载，不拖垮其余站点。

## 非目标

- 初始 M0 退出门槛不要求 Drive 同步、归档、辅助综合、迁移包和自动更新；当前产品化分支已在 M0 基线上逐项迁移，未完成项仍不视为初始技术验证的阻塞条件。
- M0 不实现完整视觉设计系统，只建立覆盖布局、密度、焦点、状态和可访问性的最小令牌体系。
- M0 不通过修改 User-Agent、关闭 `webSecurity`、复制浏览器 Cookie 或注入凭据绕过登录限制。
- M0 不追求比 9 个 Chrome 标签页显著更低的内存；目标是集中管理和实时可见。

## 架构

### 进程边界

- Main process：创建窗口和视图、维护站点注册表、校验导航/权限、执行群发编排、汇总状态。
- Shell renderer：显示提问区、站点状态、总览/聚焦布局；不持有 Electron 原始 API。
- Shell preload：只暴露带类型的最小命令集合。
- Site preload：运行在隔离世界，通过兼容层加载现有 `i18n.js`、`content/core.js`、上传/Markdown/适配器/诊断脚本；第三方页面看不到 IPC 和 Node API。

### 视图与会话

- Shell 使用单个 `BrowserWindow`。
- 每个站点使用一个 `WebContentsView`，由 main process 统一设置 bounds；Shell 只提交布局矩形。
- Shell 与远程站点使用不同 Session。9 个站点共享 `persist:polyask-sites`，让跨域登录各自持久化在同一个应用用户数据目录。
- 站点视图始终 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`。

### 适配器复用

- `i18n.js` 显式暴露只读的 `globalThis.__AMS_I18N__`。
- `content/core.js`、三组适配器和 `diag.js` 从该命名空间取得 `t()`，从而既能继续作为 MV3 classic script 使用，也能被桌面 preload 打包为独立模块。
- Desktop compatibility shim 仅实现适配器需要的 `chrome.i18n`、`chrome.storage` 和 `chrome.runtime.onMessage` 子集。
- `content/pill.js` 不进入桌面 preload。

### 消息流

1. Shell renderer 发送经过验证的 `BroadcastRequest`。
2. Main process 创建 epoch 和绝对 deadline，向所选 Site preload 分发同一请求。
3. Site preload 把请求交给现有 runtime listener，并返回 `{ host, ok, code, ... }`。
4. Main process 校验响应来源的 `webContents.id` 与登记站点，更新 Shell 状态。
5. 超时、端口中断、`submit_unconfirmed` 都进入失败终态；只有现有 Kimi `submitted()` 契约允许确认未提交后重试一次。

## 安全约束

- 远程页面永不获得 `ipcRenderer`、`contextBridge`、文件系统、Shell 或任意 main-process 方法。
- IPC 采用固定 channel 和数据白名单；main process 同时校验 sender、站点 key、当前 host 和请求结构。
- 顶层导航限制为站点精确 host 及明确登录域；新窗口默认阻止，M0 不自动向系统浏览器转交外部链接。
- 每个远程 Session 设置权限请求处理器，M0 默认拒绝通知、摄像头、麦克风、地理位置和 MIDI。
- 不关闭 Chromium sandbox，不忽略证书错误，不允许 HTTP 内容。
- 打包时启用 Cookie Encryption、ASAR Integrity、OnlyLoadAppFromAsar，并关闭 RunAsNode 和生产环境调试入口。

## 最小界面

受众是需要长期并排比较 AI 回答的高频桌面用户，界面的单一任务是“发送一次，持续看清九处进展”。

- 总览模式：空间足够时显示 3×3 真实视图。
- 聚焦模式：一个主视图加 8 个实时次要视图组成主次马赛克，窄窗口自动采用此模式。
- 每个视图预留独立标题条，包含站点名、发送状态、聚焦和重载；标题条不覆盖远程网页。
- 品牌沿用扩展的靛蓝色系：亮色 `#4f46e5`、暗色 `#a5a0ff`，成功 `#16a34a`、失败 `#dc2626`，其余使用系统中性色。
- 字体使用 `system-ui`，不捆绑字体；窗口框架、菜单、对话框和快捷键遵循各平台约定。
- 特色元素是每块视图顶部的“提交状态轨道”：一条克制的状态线表达加载、发送、警示、取消和失败；回答与思考进度直接看站点原生页面。轨道不使用持续装饰动画，降低动态效果时取消位移动画。
- 应用菜单提供聚焦提问框、上一个站点和下一个站点命令，分别使用 `CmdOrCtrl+Shift+P`、`CmdOrCtrl+PageUp` 和 `CmdOrCtrl+PageDown`，避免焦点进入独立站点视图后无法返回 Shell。

## Grid / Focus 综合密度规格

### 模式职责

- Grid 是等权比较视图：9 个站点按固定产品顺序排成 3×3，适合同时观察进度、浏览答案和执行轻量操作。
- Focus 是主次阅读视图：当前主站承担完整阅读、滚动、追问和弹窗处理；其余 8 站仍为实时、可交互的 `WebContentsView`，不得降级成截图或纯状态卡。
- 窄窗无法让 9 个完整网站同时舒适操作。此时优先保证主站可用、次要站可监看，不以缩成不可读的小字伪装“九站都可完整操作”。

### 布局几何

- Grid 使用 3×3 等分网格。
- 可用宽度 `>=1440 CSS px` 的 Focus 使用 4×3 网格：主站占左上 2×2，8 个次要站各占一格；主站面积是次要站的 4 倍。
- 可用宽度 `<1440 CSS px` 的 Focus 使用 3×4 网格：主站占左上 2×2，右侧两格和底部六格容纳次要站，优先保证主站宽度。
- 请求 Grid 但单格宽度 `<380 CSS px` 或单格总高度 `<210 CSS px` 时，自动采用 Focus；断点同时看宽和高，不再只看窗口宽度。
- Grid 永远恢复固定产品顺序。Focus 内点击次要站时，只交换它与当前主站的位置；其余 7 站槽位不动。键盘切换沿固定站点顺序执行同样的双站交换。
- 布局切换只改 bounds 和页面缩放，不销毁、不重载站点，不中断回答生成、滚动位置或登录会话。

### 统一命令栏

- Grid、Focus 和窄窗共用同一条命令栏和同一套控件优先级，不维护两套视觉节奏。
- 紧凑模式下固定占高不超过 52px，依次容纳布局切换、提问框、档位、选择数量和发送/取消；应用身份由系统标题栏和任务栏承载，不在命令栏重复展示品牌。
- 提问框默认单行；获得焦点时命令栏临时向下扩展一次，失焦或按 Escape 后恢复，不永久挤压视图，也不随输入字符或换行让 9 个站点反复重排。普通 Shell DOM 无法可靠覆盖原生 `WebContentsView`，因此不伪造会被站点视图遮挡的浮层。
- Windows/Linux 的传统菜单栏默认自动隐藏，按 `Alt` 临时显示；macOS 沿用系统全局菜单。
- P0 始终显示：提问框、档位、发送/取消、站点名、是否参与群发和状态轨道。P1 空间允许时显示：布局文字、选择数量和状态短文案。P2 只在悬停、键盘聚焦或溢出菜单显示：聚焦、重载等站点操作。

### 站点框架与状态

- 紧凑标题条高 24px；外边距和网格间距均为 4px；所有尺寸与间距来自 4px 基础令牌，禁止逐组件散落魔数。
- 正常的加载、发送、已提交和取消主要由提交状态轨道表达，不在 9 格重复铺满长文案。警示与失败显示图标和短文案，完整三语说明放入 tooltip 与读屏播报。
- 图标替代跨平台含义稳定的布局、档位、聚焦、重载和更多操作；三个档位固定使用“站点设置”“快速”“深度思考”图标，并通过本地化 tooltip、可访问名称和选中态消除歧义。主发送动作在空间允许时保留文字。
- 紧凑模式的交互目标不小于 24×24 CSS px；检测到粗指针时切换到 comfortable 令牌，增加命中区域和间距，不缩小主要字号。

### 密度与站点缩放

- Shell 密度提供 `compact` / `comfortable` 两档；鼠标键盘桌面默认 compact，用户选择持久化。
- 页面缩放与 Shell 密度相互独立。Grid 默认 90%，Focus 主站 100%、次要站 90%；用户可统一改为 100%，选择持久化。
- 页面缩放只通过 main process 的 `webContents.setZoomFactor()` 执行。Shell 通过校验过的 IPC 提交枚举值，远程页面不能控制该接口。
- 切换 Focus 主站时只调整交换双方的缩放，避免 9 个页面同时重流。
- 不向远程站点注入隐藏侧栏、广告或导航的 CSS，不以依赖站点私有 DOM 的方式换取密度。

### 视觉方向

- 视觉主题仍是“九站响应墙”，而不是通用卡片仪表盘：真实网页是主体，PolyAsk chrome 保持安静，唯一持续识别元素是贯穿各站标题条的提交状态轨道。
- 继续使用系统字体与现有靛蓝、成功绿、警示黄、失败红；不增加装饰渐变、阴影层级或无信息动画。
- 布局切换不为原生视图伪造动画；只对 Shell 控件使用短暂状态过渡，并遵守 reduced motion。

### 状态与数据边界

- main process 继续拥有 native view bounds、Focus 槽位顺序和站点缩放；Shell renderer 只渲染对应框架并发送经过校验的布局/显示偏好。
- Focus 槽位顺序属于当前窗口状态，不进入跨设备数据；密度与页面缩放偏好保存在桌面 Shell 自己的持久存储，不进入 Chrome 扩展同步。
- 页面加载状态和群发运行状态继续分层；布局、密度和缩放变化不得覆盖提交终态或产生新的自动重发路径。

## Google Drive 同步

- 桌面端只接受 Google Cloud 的 Desktop app OAuth 客户端 ID；使用系统浏览器授权、PKCE S256、随机 `state` 和绑定 `127.0.0.1` 的随机端口回调，不内嵌登录页，不复用扩展 OAuth 客户端。
- 权限固定为 `https://www.googleapis.com/auth/drive.appdata`。列举、变更订阅、下载、上传和删除全部限定在 `appDataFolder`；清云只处理 `appProperties.app === "polyask"` 的文件。
- 刷新令牌只通过 Electron 异步 `safeStorage` 持久化。Linux 后端为 `basic_text`、`unknown` 或安全存储不可用时，只保留进程内令牌并提示重启后需重新登录。
- 同步复用扩展 schema 1：每设备一个 state 文件、每设备/文本哈希一份 history 文件、每归档一份 archive 文件。状态按 `updatedAt` 后 `deviceId` 合并，同时间 tombstone 优先；远端正文必须与 Drive metadata 的 id/device 一致。
- 本机变更 3 秒防抖，应用启动时及每 15 分钟同步一次；429/5xx 指数退避，410 自动全量重扫，401 只刷新令牌重试一次。未来 schema 进入只读兼容模式，仍允许下载但禁止上传。
- 断开连接会撤销 OAuth、清本机 Drive 索引并保留本机数据、云端数据与待同步 outbox。「删除云端数据」必须在设置页逐字输入 `DELETE`，完成后断开连接；中断时保留进度，可重新进入操作。

开发时将 `resources/oauth.example.json` 复制为被 Git 忽略的 `resources/oauth.json` 并填入 Desktop Client ID，或设置 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID` 后执行 `npm run configure-oauth`。Release workflow 从同名 GitHub Actions Repository Variable 生成该文件；Forge 将其复制到产物，归档脚本会拒绝缺失或格式无效的发行包。未配置的本地构建仍可运行，但设置页会禁用连接并说明原因。

### 验收指标

- 在 2048×1152、100% 系统缩放下，Shell 固定占高从 156px 降至不超过 56px；Grid 每站原生内容高度至少增加 36px；Focus 次要站宽度至少 480px。
- 在 1280×720、1440×900、1920×1080、2048×1152、2560×1440，以及 100%/125%/150% 系统缩放下，9 个 placements 均为正尺寸、互不重叠且不超出内容区。
- Grid/Focus 切换和 Focus 换站时 9 个 `webContents.id` 保持不变；换站只改变两处槽位，主站面积始终大于任一次要站。
- English、简体中文、繁體中文下命令栏无截断；仅键盘可完成群发、取消、返回提问框、切换主站和重载。
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

## 当前实现状态

已完成 M0 纵向切片和综合密度布局：Electron 43 + Forge 7 + TypeScript + React 脚手架、单 `BrowserWindow`、9 个持久化 `WebContentsView`、3×3 Grid、宽屏 4×3 Focus、窄屏 3×4 Focus、安全导航和权限策略、隔离 preload、现有适配器加载、绝对 deadline/epoch 群发、页面与群发状态分层、三语错误/警示状态、单站重载和跨视图键盘焦点命令。站点范围、档位和用户分组已持久化；命令栏支持最多 4 张 PNG/JPEG 图片的选择、粘贴、预览和兼容范围校验。回答可并行采集并定格到单窗口结果库；结果库临时 detach 而不销毁九个站点视图，支持搜索、收藏、标签、备注、最佳答案和 Markdown 预览/导出。辅助综合同样复用单窗口结果库：选择至少两条成功回答并预览完整载荷后，只向一个目标原生站点的新会话发送；用户可实时观察生成，再采集并经确认写回原归档。Google Drive 同步已迁移 schema 1 数据、原生 OAuth/PKCE、操作系统令牌保护、增量同步、退避、未来格式只读和受保护的云端清理。取消会锁定当前群发直至请求结算，并只重建仍在执行的对应站点视图。

2026-08-24 在 WSL2/WSLg 完成 Linux 冒烟：应用持续运行，DevTools 枚举得到 1 个 PolyAsk shell 和 9 个 AI 顶层 page target，九站均进入真实页面。人工验证进一步确认九站均可登录，Gemini 首次登录与群发成功；除 Kimi 因站点当时要求付费订阅而拒绝对话外，其余 8 站均成功提交并实时显示回答。该 Kimi 结果属于站点业务限制，不是容器、登录或群发链路故障。

同日在打包后的 Linux x64 产物上完成密度截图回归。150% 宿主缩放下，X11 窗口表面完整显示 3×3 Grid 和宽屏 4×3 Focus；将客户区调整到约 1280×720 CSS px 后，3×4 Focus 的 9 个站点框架均为正尺寸、互不重叠且没有越界。截图只证明 Linux/WSLg 行为，不代替 Windows 或 macOS 原生验收。

打包产物的自动 smoke 已证明 1 个 Shell、9 个唯一 `webContents`、同一持久化 Session、安全 webPreferences 和全部正尺寸视图。3 分钟短时 soak 完成 4 次进程采样，未发生 renderer crash 或 unresponsive；冷启动到九站完全加载的工作集增长属于启动口径，正式 60 分钟报告将另行判断热启动后的稳定性。主进程已使用 Electron 43 内置 `node:sqlite` 建立 schema 1 数据层，WAL、外键、参数化仓储、事务 outbox 和 tombstone 均有重开测试。桌面端现有 131 项 TypeScript/React 测试与 4 项运行器测试通过，`npm run typecheck`、`npm run package`、`npm run smoke`、`npm audit --omit=dev` 和扩展全量 `scripts/verify.sh` 均通过。CI 已配置 Linux、Windows、macOS 三平台测试、类型检查和应用目录构建，Linux 另执行打包产物 smoke；Release workflow 配置了 Windows x64、Linux x64、macOS x64/arm64 原生 maker 和逐包 SHA-256。远端矩阵结果不替代真机人工验收。

2026-08-25 已创建独立 Desktop OAuth Client ID，并通过 Repository Variable 进入 Release 构建。实际 Linux x64 `.deb` 已通过 maker、文件名归一化和内容审计：包内存在普通用户可读的 `resources/oauth.json`，可执行文件与 `/usr/bin/polyask-desktop` 链接一致。该证据只覆盖 Client ID 入包，不等于系统浏览器授权、refresh token 或 Drive 联网同步已经通过。

尚未完成 M0 退出验收：真实 Desktop OAuth/Drive 联网同步、Windows/macOS/原生 Ubuntu 真机安装、Kimi 可对话账号复测、正式 60 分钟稳定性、读屏与高对比度检查、其余系统缩放组合，以及各平台签名和 macOS 公证。

运行依赖执行 `npm audit --omit=dev` 为 0 项已知漏洞。完整 `npm audit` 仍报告 Electron Forge 构建链的上游传递依赖公告，当前稳定版没有非破坏性全量修复；这些包不进入应用运行依赖，但正式发布前必须重新评估并清零或形成明确处置记录。

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
