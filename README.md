# PolyAsk · AI 众答

PolyAsk 将同一问题发送到 9 个真实 AI 站点，并让回答保持实时可见。项目提供两种形态：Chrome 扩展用 9 个独立窗口沿用浏览器登录；跨平台 Desktop 预览版用一个 Electron 窗口集中承载全部站点，并使用独立登录会话。两者都不使用 iframe。

## 核心功能

除特别标注外，下列能力同时适用于 Chrome 扩展和 Desktop 预览版。

- 群发对比：选择多个 AI 站点，统一设置模型档位后发送问题。支持最多 4 张 PNG 或 JPEG 图片，总大小不超过 10 MiB。
- 网页上下文（Chrome 扩展）：通过右键菜单将所选文字或页面正文带入提示词工作区，核对来源后再发送到所选 AI 站点。
- 模型切换：通过悬浮控件、扩展弹窗或快捷键切换深度思考和快速模式。
- 回答整理：将各站最新回答汇总为 Markdown 后复制或导出；保存到结果库后，可搜索、收藏、添加标签和备注，并标记最佳答案。
- 辅助综合：从一条已保存结果中选择多个回答，预览组合提示词后交给指定 AI 在新会话中综合，再将综合结果采集回原记录。
- 数据同步：两端可通过 Google Drive 合并站点范围、分组、提问历史和结果库；扩展另同步设置与模板。
- 迁移与本机数据控制（Chrome 扩展）：支持迁移包导入/导出，可分别清空提问历史或结果库，也可重置全部本机数据。重置会断开 Google Drive，但不会删除云端数据。

## 支持站点与映射

| 站点 | 🧠 深度思考 | ⚡ 快速 |
|---|---|---|
| Claude (claude.ai) | Fable 5（Thinking 开 + Effort High） | Sonnet 5（默认设置） |
| ChatGPT (chatgpt.com) | 最高 Intelligence 档（Extra High 或 Pro） | Instant |
| Gemini (gemini.google.com) | 3.1 Pro + Thinking: Extended | 3.6 Flash |
| DeepSeek (chat.deepseek.com) | Expert + DeepThink 开 | Instant + DeepThink 关 |
| 豆包 (doubao.com) | 专家 | 快速 |
| 千问 (qianwen.com) | Qwen3.7-千问 + 思考研究 | Qwen3.8-Max + 快速 |
| Kimi (kimi.com) | K3 + Thinking Max | K3 + Thinking Standard |
| 元宝 (yuanbao.tencent.com) | Deep Thinking 开 | Deep Thinking 关 |
| 智谱清言 (chatglm.cn) | 深度思考：深度 | 快速 |

> AI 站点改版后，模型切换可能暂时失效。可在扩展弹窗中运行只读诊断，或在控制台的站点选择窗里巡检所选站点并「复制诊断报告」，通过设置页的反馈入口提交问题。结果库的「站点健康统计」会按站点汇总历次收集失败，帮助发现某站是否已改版。

## 安装

### 安装 Chrome 扩展

1. 从 [Releases](https://github.com/pine2D/polyask/releases) 下载最新的 `polyask-vX.Y.Z.zip` 并解压。
2. 打开 `chrome://extensions`，启用「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的目录。

也可以直接从源码目录安装：打开 `chrome://extensions`，启用「开发者模式」，点击「加载已解压的扩展程序」，选择本仓库目录。

### 安装 Desktop 预览版

从 [Releases](https://github.com/pine2D/polyask/releases) 下载与系统和架构匹配的文件：

| 系统 | 文件 | 安装方式 |
| --- | --- | --- |
| Windows x64 | `polyask-desktop-vX.Y.Z-windows-x64.exe` | 运行安装程序 |
| Windows x64（免安装） | `polyask-desktop-vX.Y.Z-windows-x64-portable.zip` | 解压后运行 `polyask-desktop.exe` |
| Ubuntu/Debian x64 | `polyask-desktop-vX.Y.Z-linux-x64.deb` | 执行 `sudo apt install ./polyask-desktop-vX.Y.Z-linux-x64.deb` |
| macOS Apple Silicon | `polyask-desktop-vX.Y.Z-macos-arm64.zip` | 解压后打开 `PolyAsk.app` |
| macOS Intel | `polyask-desktop-vX.Y.Z-macos-x64.zip` | 解压后打开 `PolyAsk.app` |

Desktop 当前是未签名预览包，不提供自动更新。Windows SmartScreen 或 macOS Gatekeeper 可能拦截首次启动；macOS 可在 Finder 中右键应用并选择「打开」。请先核对同名 `.sha256` 文件，再决定是否运行。

### 从源码运行 Desktop

桌面端使用独立登录会话，不会读取或复制 Chrome 的 Cookie。首次运行后，需要分别登录各个 AI 站点。

```bash
cd desktop
npm install
npm test
npm run typecheck
npm start
```

Desktop 只显示当前勾选的站点。1 个站点铺满，2 个左右并排，3 个横向三分，4 个为 2×2，5 个为上 2 下 3，6 个为 3×2；选择 7–9 个站点时按每页最多 6 个分页。聚焦模式在当前页放大一个主站，其余站点保留为实时次要视图；空间不足时会自动采用聚焦模式。换页、切换布局或主站都不会销毁、重载页面或中断回答。

「视图」菜单可切换紧凑/舒适界面密度，以及 90%/100% 站点页面缩放。默认的「适应」缩放在九宫格和次要站使用 90%，聚焦主站保持 100%。Windows 和 Linux 默认隐藏菜单栏，按 `Alt` 可临时显示。

桌面端可用 `Cmd/Ctrl+Shift+P` 将焦点从站点页面送回提问框，`Cmd/Ctrl+PageUp` / `Cmd/Ctrl+PageDown` 在已选站点间切换聚焦，`Cmd/Ctrl+Shift+PageUp` / `Cmd/Ctrl+Shift+PageDown` 切换上一组或下一组站点。页签也支持方向键移动焦点、`Enter` 或空格确认，键盘换页不播放位移动画。

桌面端命令栏可选择或粘贴最多 4 张 PNG/JPEG 图片（总计不超过 10 MiB），并将同一批图片群发到 Claude、ChatGPT、DeepSeek、豆包、Kimi 和元宝。若当前范围包含 Gemini、千问或智谱，发送前会明确列出不兼容站点并引导调整范围，不会静默漏发。

桌面端可从命令栏汇总复制已选站点的当前回答，并自动定格到单窗口结果库。结果库打开时只临时隐藏当前挂载的原生站点视图，全部 9 个页面会话和回答进度仍然保留；支持搜索、收藏、标签、备注、最佳答案、安全 Markdown 预览/复制/导出和二段删除，删除记录会保留可同步 tombstone。

桌面端结果库也支持辅助综合：从一条结果中选择至少两条成功回答，并从当前已勾选的站点中指定目标 AI；核对完整综合载荷与档位后，只向该站点的新会话发送。发送后应用回到该原生站点并保持实时可见；生成完成后可从命令栏采集结果并回写原记录，替换已有综合结果前必须再次确认。

桌面端设置页支持与扩展共用同一套 schema 1 Google Drive 数据：站点范围、分组、提问历史和结果库可在两种客户端之间合并，删除标记与新版本只读保护同样生效。断开连接只撤销授权并清理本机同步索引，不删除本机或云端记录；「删除云端数据」需输入 `DELETE`，且只删除 Drive 应用专属目录内标记为 PolyAsk 的文件。

Desktop 使用 Google 的 Desktop app OAuth 客户端、系统浏览器、PKCE 和 `127.0.0.1` 随机端口回调，不能复用 Chrome 扩展客户端 ID。只有用户点击“连接 Google Drive”才会打开授权页；启动和周期同步不会在未连接时擅自发起授权。浏览器回调页只表示已收到授权，应用完成首次 Drive 访问验证后才显示“已连接”；令牌交换和 Drive 请求超时后会保持未连接并提示检查网络或代理。Release 产物由 CI 从 GitHub Actions Repository Variable 注入 Client ID；Client ID 是公开标识，项目不使用也不需要 `client_secret`。本地开发可复制 `desktop/resources/oauth.example.json` 为 `desktop/resources/oauth.json` 并填入 `clientId`，也可设置 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID` 后执行 `npm run configure-oauth`。

Gemini 完成 Google 两步验证并返回站点后，Desktop 会自动重载一次 Gemini，为验证后页面停滞提供受控恢复路径；该机制仍待 Windows 真机复测。若 DeepSeek 提示“当前设备环境异常”，请先用同一账号和网络在最新版 Edge/Chrome 复测；PolyAsk 不通过伪装 User-Agent、关闭网页安全机制或复制浏览器 Cookie 绕过站点登录策略。详细诊断边界见 `docs/desktop-m0.md`。

刷新令牌使用 Electron 异步 `safeStorage` 写入操作系统凭据保护层。Linux 若只能使用 `basic_text` 或安全存储不可用，桌面端不会把令牌写入磁盘，只在本次进程内保留并在设置页明确提示；重启后需重新登录。

执行 `npm run package` 可生成当前平台应用目录，执行 `npm run make` 可生成当前平台的可分发包。CI 在 Linux、Windows 和 macOS 上运行测试与类型检查；Release workflow 另构建 Windows x64 安装版和免安装 ZIP、Linux x64、macOS x64/arm64 预览包，并为每个包生成 SHA-256。自动化不能替代真实账号登录与原生 UI 验收：Gemini 已在 WSLg 完成首次登录与群发，真实 Desktop OAuth/Drive 联网同步、Windows/macOS/原生 Ubuntu 安装体验和签名仍待验证。详细边界见 `docs/desktop-m0.md`。

## 快捷键

| 默认键 | 功能 |
|---|---|
| `Alt+T` | 切换到深度思考 |
| `Alt+Y` | 切换到快速模型 |
| `Alt+Q` | 打开或聚焦群发控制台（已打开时会连同平铺窗口一起移到前台） |

可在 `chrome://extensions/shortcuts` 中修改以上快捷键。

控制台窗口内的固定键位：

| 默认键 | 功能 |
|---|---|
| `Alt+C` | 汇总复制当前勾选站点的最新回答 |
| `Alt+L` | 平铺当前勾选站点 |
| `Alt+N` | 为当前勾选站点开启新会话 |
| `Alt+P` | 聚焦问题输入框 |
| `Alt+R` | 重试当前勾选的失败站点 |

## Google Drive 同步与迁移

在扩展设置页连接 Google Drive 后，可同步设置、模板、分组、提问历史、AI 回答，以及结果库中的收藏、标签和备注；哪个回答被标为最佳也会同步。未发送的草稿和窗口布局不会同步。此功能不使用 Chrome Sync。

- 扩展只申请 Google Drive 应用专属目录（`drive.appdata`）权限，不会读取或修改 Google Drive 中的其他文件。
- 所有同步到 Google Drive 的数据均为明文。迁移包中的全部导出数据也均为明文，包含上述数据。PolyAsk 不提供端到端加密。
- PolyAsk 不限制提问历史和结果库的记录条数，但仍受 Google Drive 存储配额和 API 限制。
- 导入迁移包时按记录合并，不会覆盖整个数据库。

## License

MIT
