# PolyAsk · AI 众答

PolyAsk 是一款 Chrome 扩展，可将同一问题发送到 9 个 AI 站点，并在独立窗口中并排比较回答。它也支持在单独访问站点时切换深度思考和快速模式。

每个站点都在真实浏览器窗口中运行，沿用现有登录状态，不使用 iframe。

## 核心功能

- 群发对比：选择多个 AI 站点，统一设置模型档位后发送问题。支持最多 4 张 PNG 或 JPEG 图片，总大小不超过 10 MiB。
- 模型切换：通过悬浮控件、扩展弹窗或快捷键切换深度思考和快速模式。
- 回答整理：将各站最新回答汇总为 Markdown 后复制或导出；保存到结果库后，可搜索、收藏、添加标签和备注，并标记最佳答案。
- 数据同步：通过 Google Drive 同步设置、模板、分组、提问历史和 AI 回答。结果库中的收藏、标签和备注，以及哪个回答被标为最佳，也会同步。支持迁移包导入与导出。

## 支持站点与映射

| 站点 | 🧠 深度思考 | ⚡ 快速 |
|---|---|---|
| Claude (claude.ai) | Fable 5（Thinking 开 + Effort High） | Sonnet 5（默认设置） |
| ChatGPT (chatgpt.com) | 最高 Intelligence 档（Extra High 或 Pro） | Instant |
| Gemini (gemini.google.com) | 3.1 Pro + Thinking: Extended | 3.6 Flash |
| DeepSeek (chat.deepseek.com) | Expert + DeepThink 开 | Instant + DeepThink 关 |
| 豆包 (doubao.com) | 专家 | 快速 |
| 千问 (qianwen.com) | Qwen3.8-Max + 思考开 | Qwen3.8-Max + 思考关 |
| Kimi (kimi.com) | K3 + Thinking Max | K3 + Thinking Standard |
| 元宝 (yuanbao.tencent.com) | Deep Thinking 开 | Deep Thinking 关 |
| 智谱清言 (chatglm.cn) | 深度思考：深度 | 快速 |

> AI 站点改版后，模型切换可能暂时失效。可在扩展弹窗中运行只读诊断。

## 安装

### 从 Release 安装

1. 从 [Releases](https://github.com/pine2D/polyask/releases) 下载最新的 `polyask-vX.Y.Z.zip` 并解压。
2. 打开 `chrome://extensions`，启用「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的目录。

### 从源码目录安装

1. 打开 `chrome://extensions`，启用「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本仓库目录。

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
