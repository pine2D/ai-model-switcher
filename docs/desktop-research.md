# PolyAsk Desktop 技术调研与决策记录

最后核对：2026-08-24。本文保存桌面端启动阶段的框架、安全、平台规范与自动化调研结论，并补充产品化阶段的数据与 Google Drive 方案。实现边界以 `docs/desktop-m0.md` 为准。

## 问题与目标

Chrome 扩展依靠 9 个独立 popup 展示真实 AI 页面，避开 iframe 对登录、模型、侧边栏和站点能力的限制，但无法在一个窗口内持续观察九站回答。桌面端需要在 Windows、macOS、Linux 的一个系统窗口中承载 9 个真实页面，保留各站登录和原生交互，同时复用扩展的群发适配器与数据语义。

## 调研保存情况

- 受 Git 管理的结论：本文、`docs/desktop-m0.md`、`docs/desktop-density-plan.md`。
- 初始实施计划仍存在于 `docs/superpowers/plans/2026-08-24-desktop-m0.md`，但该目录被 `.gitignore` 排除，不能作为长期唯一凭据。
- claude-mem 中的原始调研观察为 `#73318`—`#73329`，最终架构决定为 `#73331`。

## 框架比较

| 方案 | 多页面能力 | 跨平台一致性 | 现有适配器复用 | 主要代价 | 结论 |
| --- | --- | --- | --- | --- | --- |
| Electron | 单窗口多个 `WebContentsView`，捆绑 Chromium | 高 | JavaScript 与 Chromium 行为最接近扩展 | 安装体积和九个 renderer 的资源占用较高 | 采用 |
| Tauri 2 | 支持多 webview | 中；Windows、macOS、Linux 分别依赖 WebView2、WKWebView、WebKitGTK | 站点和注入行为需按三套引擎回归 | 系统依赖和站点兼容差异较大 | 不用于当前基线 |
| Qt WebEngine | 多 `QWebEngineView`、profile 和 isolated world 成熟 | 较高 | 需要重写 JavaScript/IPC 与打包工具链 | C++/Qt 发行复杂度高 | 保留为备选 |
| 浏览器 iframe/扩展侧栏 | 单窗口 DOM 最简单 | 受浏览器限制 | 部分可复用 | Claude 等站拒绝或降级 iframe，不能满足真实页面目标 | 排除 |

Electron 的决定不是追求更小体积，而是以同一 Chromium 版本换取九站行为一致性，并以 `WebContentsView` 获得真实、持续运行、可交互的顶层页面。

## 已采用架构

- 一个本地可信 `BrowserWindow` Shell 管理命令栏、状态、归档和设置。
- 九个 `WebContentsView` 使用共享持久 partition `persist:polyask-sites`，共享登录但不复制 Chrome Cookie。
- 远程页面保持 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`。
- Site preload 只暴露适配器所需的最小 Chrome 兼容面；main process 校验 sender、frame、消息结构和绝对 deadline。
- 布局、缩放、面板占位与 WebContents 生命周期归 main process；renderer 只提交经过白名单的意图。
- 打包启用 ASAR、嵌入式 ASAR 完整性校验、`OnlyLoadAppFromAsar`、禁用 RunAsNode 与 Node CLI 调试参数。

Electron 官方安全指南同样要求远程内容不得启用 Node.js integration，并建议使用 context isolation、sandbox、导航限制与有限 IPC：[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)。

## 跨平台 UI/UX 结论

- Windows/Linux 的窗口菜单默认自动隐藏，按 `Alt` 临时显示；macOS 使用系统全局菜单。
- 界面遵循平台字体、快捷键和窗口行为，不模拟 WinUI、AppKit 或 GNOME 的全部视觉外观。
- 共同视觉主题是“九站响应墙”：真实网页占据绝大部分面积，PolyAsk chrome 保持安静，以标题轨道表达提交状态。
- Grid 与 Focus 共用一套密度和命令栏，不建立两套互相漂移的界面。
- 高频且跨平台含义稳定的动作可用 Lucide 图标；完整名称必须保留在 tooltip、`aria-label` 和菜单中。
- 应用身份由系统标题栏、任务栏/Dock 图标和应用菜单承担，不在高密度命令栏重复放品牌标记。
- 键盘焦点、读屏播报、高对比度、reduced motion 和中文输入法合成态属于功能要求，不是装饰性优化。

## 本地数据层决定

Electron 43 携带 Node 24，能够直接使用 `node:sqlite`。桌面端采用 main-process SQLite 存储历史、归档、设置、同步 outbox、Drive 文件映射和元数据：

- 不引入 `better-sqlite3` 等原生第三方依赖，降低 Windows/macOS/Linux 打包差异。
- 数据库位于 `app.getPath("userData")`，使用 WAL、事务和参数化语句。
- 归档与历史删除继续写 tombstone，不物理删除；本地重置与清空 Drive 保持两个独立动作。
- 数据记录和 Drive `appProperties` 继续使用扩展的 schema 1，使桌面与扩展可合并同一批历史、分组和归档。
- OAuth token 不进入普通 SQLite 明文字段；仅存储 `safeStorage` 加密结果。Linux 无安全 secret backend 时不持久化 refresh token，并在界面明确说明本次会话结束后需重新连接。

`node:sqlite` 自 Node 22.5 提供，Electron 43 使用 Node 24；当前 API 状态与用法见 [Node SQLite](https://nodejs.org/api/sqlite.html)。令牌存储的平台差异见 [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

## Google Drive 与 OAuth 决定

- 保持扩展使用的最小非敏感 scope：`https://www.googleapis.com/auth/drive.appdata`。
- OAuth 使用 Desktop app client、Authorization Code + PKCE S256、随机 `state` 和 `127.0.0.1` 随机端口回调。
- 授权页面必须用系统默认浏览器打开，不在 Electron 内嵌页或任一 AI 站点 view 中打开。
- 不使用已废弃的 OOB 手工复制验证码，也不使用容易被其他应用劫持的自定义 URI scheme。
- access token 只驻留内存；refresh token 通过 `safeStorage` 保存，断开连接时撤销并删除。
- 生产发行前需要单独创建 Google OAuth “Desktop app” client；Chrome Extension 类型 client 不能直接承担 loopback 回调。
- Drive 中继续使用隐藏的 `appDataFolder`，用户主动断开不删除云端数据；“清空云端”必须二段确认。

依据：[Google OAuth for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)、[Google OAuth Policies](https://developers.google.com/identity/protocols/oauth2/policies)、[Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)、[Drive Scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。

## 自动化与稳定性

- 生产包移除远程调试开关；测试不依赖对外开放 CDP 端口。
- Electron smoke 通过受环境变量保护的一次性诊断文件，验证 1 个 Shell、9 个 site view、共同 partition、安全偏好、导航策略和有效 bounds。
- 60 分钟稳定性探测使用 `app.getAppMetrics()` 周期采集各进程 CPU、内存、类型和 PID，并记录 `render-process-gone`、`unresponsive` 与加载失败。
- 截图回归覆盖 Grid、宽屏 Focus、窄屏 Focus、100%—200% 系统缩放、亮暗色、高对比度和三语。
- Windows 是首个原生验收平台；WSLg 只证明 Linux/X11 路径，不能替代 Windows 或 macOS 结论。

Electron 的进程指标入口见 [`app.getAppMetrics()`](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics)。

## 当前结论

Electron M0 的容器、九站登录、群发、安全基线、Grid/Focus 与密度布局已经成立。继续产品化的正确顺序是：先收敛命令栏和集成门禁，再迁移范围/分组、新会话、图片、汇总、归档、辅助综合和 Drive，最后进行全面缺陷与 UI/UX 审查。功能迁移不得重新引入 Chrome popup、九个外部 tab 或 iframe。
