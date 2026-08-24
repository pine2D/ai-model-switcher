# PolyAsk Desktop M0 设计规格

## 目标

用 Electron 在 Windows、macOS、Linux 上提供一个系统窗口，窗口内同时承载 9 个真实 AI 站点页面，并验证登录持久化、实时可见群发、现有站点适配器复用、安全隔离和资源开销是否达到继续产品化的条件。

M0 是可保留的技术基线，不包含扩展版全部功能迁移，也不承诺在登录硬门槛通过前形成可发布产品。

## 成功标准

- 一个 `BrowserWindow` 内存在 9 个独立 `WebContentsView`，没有外置 Chrome 标签页或站点窗口。
- 9 个站点页面保持真实渲染；用户能直接看到回答、思考动画、停止按钮和站点原生错误。
- 一次提问按同一绝对 `deadline` 群发到所选站点；取消沿用 epoch 语义；不确定提交不自动重发。
- 已成功建立的站点会话在应用重启后保留，不读取或复制 Chrome 用户配置和 Cookie。
- Windows、macOS、Ubuntu 至少各完成一次启动、布局和登录验证；Gemini 首次登录是继续产品化的硬门槛。
- 60 分钟运行中没有主进程卡死；单站渲染进程崩溃能被标记并重载，不拖垮其余站点。

## 非目标

- M0 不迁移 Drive 同步、归档、辅助综合、迁移包和自动更新。
- M0 不实现完整视觉设计系统，只建立能验证布局、焦点、状态和可访问性的壳层。
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
- 聚焦模式：一个主视图加 8 个实时视图轨道，窄窗口自动采用此模式。
- 每个视图预留独立标题条，包含站点名、发送状态、聚焦和重载；标题条不覆盖远程网页。
- 品牌沿用扩展的靛蓝色系：亮色 `#4f46e5`、暗色 `#a5a0ff`，成功 `#16a34a`、失败 `#dc2626`，其余使用系统中性色。
- 字体使用 `system-ui`，不捆绑字体；窗口框架、菜单、对话框和快捷键遵循各平台约定。
- 特色元素是每块视图顶部的“提交状态轨道”：一条克制的状态线表达加载、发送、警示、取消和失败；回答与思考进度直接看站点原生页面。轨道不使用持续装饰动画，降低动态效果时取消位移动画。
- 应用菜单提供聚焦提问框、上一个站点和下一个站点命令，分别使用 `CmdOrCtrl+Shift+P`、`CmdOrCtrl+PageUp` 和 `CmdOrCtrl+PageDown`，避免焦点进入独立站点视图后无法返回 Shell。

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

已完成首个纵向切片：Electron 43 + Forge 7 + TypeScript + React 脚手架、单 `BrowserWindow`、9 个持久化 `WebContentsView`、九宫格/聚焦布局、安全导航和权限策略、隔离 preload、现有适配器加载、绝对 deadline/epoch 群发、页面与群发状态分层、三语错误/警示状态、单站重载和跨视图键盘焦点命令。取消会锁定当前群发直至请求结算，并只重建仍在执行的对应站点视图。

2026-08-24 在 WSL2/WSLg 完成 Linux 冒烟：应用持续运行，DevTools 枚举得到 1 个 PolyAsk shell 和 9 个 AI 顶层 page target，九站均进入真实页面。`npm test`、`npm run typecheck`、`npm run package` 和扩展全量 `scripts/verify.sh` 均为 M0 的本地门禁；CI 同样执行桌面依赖锁定安装、测试、类型检查与 Linux 打包。

尚未完成 M0 退出验收：Electron 运行时集成自动化、Windows/macOS/原生 Ubuntu 真机、九站实际登录和群发、Gemini 首次登录硬门槛、60 分钟稳定性、读屏/高对比度/缩放检查，以及各平台签名安装包。

运行依赖执行 `npm audit --omit=dev` 为 0 项已知漏洞。完整 `npm audit` 仍报告 Electron Forge 构建链的上游传递依赖公告，当前稳定版没有非破坏性全量修复；这些包不进入应用运行依赖，但正式发布前必须重新评估并清零或形成明确处置记录。

## 开发命令

```bash
cd desktop
npm install
npm test
npm run typecheck
npm start
npm run package
```
