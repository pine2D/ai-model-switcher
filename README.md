# PolyAsk · AI 众答

PolyAsk 是一款 Chrome 扩展，可将同一问题发送到 9 个 AI 站点，并在独立窗口中并排比较回答。它也支持在单独访问站点时切换深度思考和快速模式。

每个站点都在真实浏览器窗口中运行，沿用现有登录状态，不使用 iframe。

仓库同时包含跨平台桌面端 M0。它用一个 Electron 窗口承载 9 个真实站点页面，提供九宫格与主次聚焦布局，当前用于验证集中管理、实时可见群发和站点登录兼容性，尚不是正式发布版本。

## 核心功能

- 群发对比：选择多个 AI 站点，统一设置模型档位后发送问题。支持最多 4 张 PNG 或 JPEG 图片，总大小不超过 10 MiB。
- 网页上下文：通过右键菜单将所选文字或页面正文带入提示词工作区，核对来源后再发送到所选 AI 站点。
- 模型切换：通过悬浮控件、扩展弹窗或快捷键切换深度思考和快速模式。
- 回答整理：将各站最新回答汇总为 Markdown 后复制或导出；保存到结果库后，可搜索、收藏、添加标签和备注，并标记最佳答案。
- 辅助综合：从一条已保存结果中选择多个回答，预览组合提示词后交给指定 AI 在新会话中综合，再将综合结果采集回原记录。
- 数据同步：通过 Google Drive 同步设置、模板、分组、提问历史和 AI 回答。结果库中的收藏、标签和备注，以及哪个回答被标为最佳，也会同步。支持迁移包导入与导出。
- 本机数据控制：可分别清空提问历史或结果库，也可重置全部本机数据。重置会断开 Google Drive，但不会删除云端数据。

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

### 从 Release 安装

1. 从 [Releases](https://github.com/pine2D/polyask/releases) 下载最新的 `polyask-vX.Y.Z.zip` 并解压。
2. 打开 `chrome://extensions`，启用「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的目录。

### 从源码目录安装

1. 打开 `chrome://extensions`，启用「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本仓库目录。

### 运行桌面端 M0

桌面端使用独立登录会话，不会读取或复制 Chrome 的 Cookie。首次运行后，需要分别登录各个 AI 站点。

```bash
cd desktop
npm install
npm test
npm run typecheck
npm start
```

九宫格按固定顺序同时显示 9 个页面。聚焦模式让主站占 2×2，其余 8 站继续实时运行；宽屏采用 4×3，窄屏采用 3×4。空间不足以容纳 3×3 时，应用会自动切到聚焦模式。切换主站只交换两个站点的位置，不会重载页面或中断回答。

「视图」菜单可切换紧凑/舒适界面密度，以及 90%/100% 站点页面缩放。默认的「适应」缩放在九宫格和次要站使用 90%，聚焦主站保持 100%。Windows 和 Linux 默认隐藏菜单栏，按 `Alt` 可临时显示。

桌面端可用 `Cmd/Ctrl+Shift+P` 将焦点从站点页面送回提问框，`Cmd/Ctrl+PageUp` / `Cmd/Ctrl+PageDown` 在九个站点间切换聚焦。提问框获得焦点时会临时展开，失焦或按 `Esc` 后恢复单行命令栏。

桌面端命令栏可选择或粘贴最多 4 张 PNG/JPEG 图片（总计不超过 10 MiB），并将同一批图片群发到 Claude、ChatGPT、DeepSeek、豆包、Kimi 和元宝。若当前范围包含 Gemini、千问或智谱，发送前会明确列出不兼容站点并引导调整范围，不会静默漏发。

桌面端可从命令栏汇总复制已选站点的当前回答，并自动定格到单窗口结果库。结果库打开时只临时隐藏 9 个原生站点视图，不销毁页面或回答进度；支持搜索、收藏、标签、备注、最佳答案、安全 Markdown 预览/复制/导出和二段删除，删除记录会保留可同步 tombstone。

执行 `npm run package` 可生成当前平台的未签名应用目录。Gemini 已在 WSLg 中完成首次登录与群发；Windows、macOS 和原生 Ubuntu 的登录与安装包验证仍属于 M0 验收范围。详细边界见 `docs/desktop-m0.md`。

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
