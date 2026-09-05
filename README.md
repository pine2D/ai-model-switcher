# PolyAsk · AI 众答

PolyAsk 是一个桌面应用：把同一问题发送到 9 个真实 AI 站点，让各站回答在同一个窗口里保持实时可见并排比较。它用 Electron 承载各站原生页面（不是 iframe），使用独立于浏览器的登录会话；支持模型档位统一切换、图片群发、回答汇总与结果库、辅助综合，以及通过 Google Drive 在多台设备间同步。

## 核心功能

- 群发对比：选择多个 AI 站点，统一设置模型档位后发送问题。支持最多 4 张 PNG 或 JPEG 图片，总大小不超过 10 MiB；**能接收图片的是 Claude、ChatGPT、DeepSeek、豆包、Kimi、元宝 6 站**，Gemini、千问和智谱清言不支持，发送前会列出不兼容站点并引导调整范围。
- 模型切换：`Alt+T` / `Alt+Y` 在深度思考和快速模式之间切换，命令栏、命令面板与菜单也提供同样入口。
- 回答整理：将各站最新回答汇总为 Markdown 后复制或导出；保存到结果库后，可搜索、收藏、添加标签和备注、标记最佳答案，并逐段对照两份回答。
- 辅助综合：从一条已保存结果中选择多个回答，预览组合提示词后交给指定 AI 在新会话中综合，再将综合结果采集回原记录。
- 数据同步：通过 Google Drive 合并站点范围、分组、提问历史、提示词模板和结果库。
- 本机数据控制：设置页可分别清空提问历史或结果库（以删除标记同步到其它设备），也可重置全部本机数据。重置会断开 Google Drive，但不会删除云端数据，重新连接后会恢复。

## 支持站点与映射

| 站点 | 🧠 深度思考 | ⚡ 快速 |
|---|---|---|
| Claude (claude.ai) | Fable 5 + Effort 最高档（当前为 Max） | Sonnet 5（默认设置） |
| ChatGPT (chatgpt.com) | GPT-5.6 Sol + 思考强度滑块推到最高档（当前为 Pro） | GPT-5.6 Sol + 滑块推到最低档（当前为 Instant） |
| Gemini (gemini.google.com) | 最新 Pro（当前为 3.1 Pro）+ Thinking: Extended | 最新 Flash（当前为 3.7 Flash，不含 Flash-Lite） |
| DeepSeek (chat.deepseek.com) | Expert + DeepThink 开 | Instant + DeepThink 关 |
| 豆包 (doubao.com) | 专家 | 快速 |
| 千问 (qianwen.com) | Qwen3.7-千问 + 思考研究 | Qwen3.8-Max + 快速 |
| Kimi (kimi.com) | K3 + Thinking Max | K3 + Thinking Standard |
| 元宝 (yuanbao.tencent.com) | Thinking（模型菜单；旧版界面为 Deep Thinking 开） | Instant（模型菜单；旧版界面为 Deep Thinking 关） |
| 智谱清言 (chatglm.cn) | 思考：极致（无此档时降级为深度） | 快速 |

元宝的 Expert 属工具执行档，不参与深/快映射；停在 Expert 时读不出当前档位。表中「最高档 / 最低档 / 最新 Pro / 最新 Flash」等说法是**按站点当前在场的档位现取**，不写死档名——站点加减档时映射自动跟随，括号里的具体档名只是当前实测值。

> AI 站点改版后，模型切换可能暂时失效。按 `Alt+H` 打开站点状态可实时检查九站，站点详情里可重新检查、重载或清除该站缓存；「复制诊断报告」会生成一份只含版本、系统、显示缩放、各站状态与逐项检查结果的纯文本（不含对话内容与网址），可直接贴进 [报障 issue](https://github.com/pine2D/polyask/issues/new/choose)。

## 安装

从 [Releases](https://github.com/pine2D/polyask/releases) 下载与系统和架构匹配的文件：

| 系统 | 文件 | 安装方式 |
| --- | --- | --- |
| Windows x64 | `polyask-desktop-vX.Y.Z-windows-x64.exe` | 运行安装程序 |
| Windows x64（便携版） | `polyask-desktop-vX.Y.Z-windows-x64-portable.zip` | 完整解压后运行 `PolyAsk Portable/App/polyask-desktop.exe` |
| Ubuntu/Debian x64 | `polyask-desktop-vX.Y.Z-linux-x64.deb` | 执行 `sudo apt install ./polyask-desktop-vX.Y.Z-linux-x64.deb` |
| macOS Apple Silicon | `polyask-desktop-vX.Y.Z-macos-arm64.zip` | 解压后打开 `PolyAsk.app` |
| macOS Intel | `polyask-desktop-vX.Y.Z-macos-x64.zip` | 解压后打开 `PolyAsk.app` |

**五个包均未签名，也不提供自动更新。** 首次启动会被系统拦截，按下面的方式放行：

- **Windows**：SmartScreen 弹出后点「更多信息」→「仍要运行」。
- **macOS**：先把 `PolyAsk.app` 移到「应用程序」再打开；被拦截后到 **系统设置 → 隐私与安全性**，在页面底部点「仍要打开」。macOS 15 起，对未公证应用右键「打开」这条老路径已经失效。

Release 里每个包都附同名 `.sha256`，运行前建议核对（文件是 `sha256sum -c` / `shasum -c` 能直接吃的格式）。升级请回到 Release 页下载新包；设置页的「检查更新」会打开最新 Release。

### Windows 便携版

Windows 便携版将程序与用户数据分开存放：

```text
PolyAsk Portable/
├─ App/               # 程序文件
├─ PolyAsk Data/      # 首次运行后创建；设置、登录状态和本机数据
├─ README.txt         # 三语启动与升级说明
└─ portable.json      # 便携版标记
```

升级步骤：

1. 完全退出 PolyAsk。
2. 用新压缩包中的整个 `App` 目录替换旧 `App`。旧 `app.asar` 会随之替换；`portable.json` 和 `README.txt` 不含用户数据，可直接覆盖。
3. 保留 `PolyAsk Data`。其中的设置和各站登录状态会继续使用。

首次从 v0.19.0 或更早的免安装包切换时，请先完全退出 PolyAsk，再解压为上述完整结构并启动 `App/polyask-desktop.exe`。应用会询问是否复制现有 PolyAsk 数据；原有设置和登录状态仍保留在原位置，需要时可以继续使用旧版。若 `PolyAsk Data` 中已有无法确认用途的文件，应用会保留该目录并提示先移动或备份，不会直接覆盖。设置页会显示当前版本及「安装版」或「便携版」。

## 功能细节

桌面端使用独立登录会话，不会读取或复制浏览器的 Cookie。首次运行后，需要分别登录各个 AI 站点。

应用只加载并显示当前勾选的站点，每页最多显示 4 个。**没勾的站点不会被加载**，因此少勾几个站就少占内存（实测约 124 MB/站；勾 5 个比勾 9 个约省 27%）；取消勾选会释放该站点视图，登录状态保留、页面上的对话不保留。1 个站点铺满，2 个左右并排，3 个横向三分，4 个为 2×2；选择 5–9 个站点时均衡分页：依次采用 3+2、3+3、4+3、4+4、3+3+3。聚焦模式在当前页放大一个主站，右侧保留最多 3 个实时次要视图；空间不足时会自动采用聚焦模式。换页、切换布局或主站都不会销毁、重载页面或中断回答。

命令栏左侧的「工作区」统一管理站点选择、保存的分组和只读站点状态；站点详情可重新检查、聚焦或单独重载、强制重载（忽略缓存）或清除该站缓存并重载（保留登录），并可复制诊断报告。Google Drive 连接诊断保留在设置页，可分阶段检查授权与同步状态，并复制不含令牌、账号、对话正文或本机路径的诊断报告。

「视图」菜单可切换紧凑/舒适界面密度，以及 90%/100% 站点页面缩放。默认的「适应」缩放在九宫格和次要站使用 90%，聚焦主站保持 100%。Windows 和 Linux 默认隐藏菜单栏，按 `Alt` 可临时显示。

按 `Alt+K` 或 `F1` 可打开命令面板，并搜索全部命令、保存的站点组、提示词模板和最近提问；常用键位见下方「快捷键」，当前平台的全部菜单键位可在命令面板里搜索「快捷键速查」查看。快捷键在焦点位于 AI 页面时仍可使用；不存在的页码和当前不可用的命令会被忽略。页签支持方向键移动焦点、`Enter` 或空格确认。

未发送的提问草稿只保存在本机，发送成功后自动清除，不参与 Google Drive 同步。回答完成或失败时，后台页只更新状态徽标，不自动切页或抢占焦点；系统通知默认关闭，启用后也不会包含提问或回答正文。切档与发送的结果只显示在应用外壳的状态区，站点页面里不会弹出任何提示条。

命令栏可选择或粘贴最多 4 张 PNG/JPEG 图片（总计不超过 10 MiB），并将同一批图片群发到 Claude、ChatGPT、DeepSeek、豆包、Kimi 和元宝。若当前范围包含 Gemini、千问或智谱，发送前会明确列出不兼容站点并引导调整范围，不会静默漏发。

命令栏可汇总复制已选站点的当前回答，并自动定格到单窗口结果库。结果库打开时只临时隐藏原生站点视图，已勾选站点的页面会话和回答进度仍然保留；支持搜索、收藏、标签、备注、最佳答案、安全 Markdown 预览/复制/导出和二段删除，删除记录会保留可同步的删除标记。

结果库也支持辅助综合：从一条结果中选择至少两条成功回答，并从当前已勾选的站点中指定目标 AI；核对完整综合载荷与档位后，只向该站点的新会话发送。发送前应用先回到该原生站点并保持实时可见；生成完成后可从命令栏采集结果并回写原记录，替换已有综合结果前必须再次确认。

设置页的 Google Drive 同步使用应用专属目录里的 schema 1 数据：站点范围、分组、提问历史和结果库可在多台设备间合并，删除标记与新版本只读保护同样生效；早先由已停维的扩展写入的同格式数据也能原样读取。断开连接会撤销授权并清理本机同步索引，不删除本机或云端记录；「删除云端数据」需输入 `DELETE`，且只删除 Drive 应用专属目录内标记为 PolyAsk 的文件。

PolyAsk 使用 Google 的 Desktop app OAuth 客户端、系统浏览器、PKCE 和 `127.0.0.1` 随机端口回调。只有用户点击「连接 Google Drive」才会打开授权页；启动和周期同步不会在未连接时擅自发起授权。浏览器回调页只表示已收到授权，应用完成首次 Drive 访问验证后才显示「已连接」；令牌交换和 Drive 请求超时后会保持未连接并提示检查网络或代理。Release 产物由 CI 注入同一 Desktop 客户端的 Client ID 与 Client Secret，并在授权码交换和刷新令牌时提交完整凭据。桌面应用无法真正保密嵌入的 Client Secret；它不作为安全边界，但仍通过 GitHub Actions Secret 管理，避免进入仓库和构建日志。

Gemini 完成 Google 两步验证并返回站点后，应用会自动重载一次 Gemini；若页面仍未就绪，可在站点状态详情中单独重新加载。若 DeepSeek 提示「当前设备环境异常」，请先用同一账号和网络在最新版 Edge/Chrome 复测；PolyAsk 不通过伪装 User-Agent、关闭网页安全机制或复制浏览器 Cookie 绕过站点登录策略。详细边界见 `docs/desktop.md`。

刷新令牌使用 Electron 异步 `safeStorage` 写入操作系统凭据保护层。Linux 若只能使用 `basic_text` 或安全存储不可用，应用不会把令牌写入磁盘，只在本次进程内保留并在设置页明确提示；重启后需重新登录。钥匙环暂时未解锁时令牌不会被误删。

### 从源码运行

```bash
cd desktop
npm install
npm test
npm start
```

本地开发可复制 `desktop/resources/oauth.example.json` 为 `desktop/resources/oauth.json` 并填入 `clientId` 与 `clientSecret`，也可同时设置 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID` 和 `POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET` 后执行 `npm run configure-oauth`。

执行 `npm run package` 可生成当前平台应用目录，执行 `npm run make` 可生成当前平台的可分发包。仓库级卫生检查是根目录的 `bash scripts/verify.sh`；`npm test` 内含类型检查、渲染层与主进程测试以及九站适配器的离线回归。CI 在 Linux、Windows 和 macOS 上运行这些检查；Release workflow 构建 Windows x64 安装版和便携 ZIP、Linux x64、macOS x64/arm64 五个包并生成 SHA-256，手动触发时默认只做演练、不创建 Release。自动化不能替代真实账号登录与原生 UI 验收：Windows 便携版覆盖升级和系统 150% 缩放已经实机验证；macOS、原生 Ubuntu、Windows 125% 缩放与多显示器仍作为有相应环境时的兼容性抽检。

## 快捷键

| 默认键 | 功能 |
|---|---|
| `Alt+T` | 切换到深度思考 |
| `Alt+Y` | 切换到快速模型 |
| `Alt+Q` | 聚焦提问框 |
| `Alt+K` 或 `F1` | 打开命令面板 |
| `Alt+S` | 打开站点与分组 |
| `Alt+H` | 打开站点状态 |
| `Alt+1` / `Alt+2` / `Alt+3` | 直接切换到对应站点页 |
| `Ctrl+PageDown` / `Ctrl+PageUp` | 聚焦下一个 / 上一个站点 |
| `Ctrl+Shift+PageDown` / `Ctrl+Shift+PageUp` | 下一组 / 上一组站点 |
| `Alt+←` / `Alt+→` | 站内后退 / 前进 |
| `Alt+C` | 收集回答 |
| `Alt+N` | 为当前勾选站点新建会话 |
| `Alt+R` | 重试失败站点 |
| `Ctrl+,` | 打开设置 |

macOS 上表中的 `Ctrl` 一律对应 `Cmd`。此表只列 PolyAsk 自己的命令；重新加载、缩放、全屏、复制粘贴等由系统菜单提供的标准键位，以应用内「快捷键速查」为准。

## 隐私与数据

- **站点页面在受限的视图里运行**：每个站点视图开启 sandbox、contextIsolation 与 webSecurity，只允许导航到该站及其登录域，外部链接交给系统浏览器；打包后的冒烟测试会回读真实的 webPreferences 校验这些开关。
- **PolyAsk 只以你已登录的会话操作各站页面**，不伪装 User-Agent、不关闭网页安全机制、不复制浏览器 Cookie。
- 连接 Google Drive 后，可同步站点范围、分组、提问历史、提示词模板与结果库（含收藏、标签、备注和最佳答案标记）；未发送的草稿和窗口布局不会同步。PolyAsk 只申请 Google Drive 应用专属目录（`drive.appdata`）权限，不会读取或修改 Google Drive 中的其他文件。
- 所有同步到 Google Drive 的数据均为明文，PolyAsk 不提供端到端加密。PolyAsk 不限制提问历史和结果库的记录条数，但仍受 Google Drive 存储配额和 API 限制。
- 「断开连接」会撤销授权并清理本机同步索引；「重置全部本机数据」只清本机、不动云端。

## 当前限制

- 五个包均未签名、未公证，也没有自动更新；升级需要手动下载新包。
- 站点改版是头号故障源：某站切档或发送失效时，先用站点状态里的「复制诊断报告」报障，不要自行重发。
- 只读确认「是否已发送」目前只有 Kimi 实现；其它站点在提交结果不确定时一律交给你手动重试，绝不自动重发。

## 关于 Chrome 扩展

PolyAsk 曾同时提供 Chrome 扩展（最后版本 v0.25.1），自 1.0.0 起停止维护并从仓库删除，代码保留在 tag `archive/extension-v0.25.1`。扩展写入 Google Drive 的数据与桌面应用使用同一格式，连接同一账号即可继续使用；未连接过 Google Drive 的扩展本机数据没有搬迁通道。

## License

MIT，见 [LICENSE](LICENSE)。
