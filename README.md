# PolyAsk · AI 众答

PolyAsk 是一款 Chrome MV3 扩展。它可以把同一个问题发送给多个 AI 网站，在真实浏览器窗口中并排展示回答；单独访问支持的站点时，也可以切换深度思考和快速模式。

PolyAsk 不使用 iframe。每个 AI 都在已登录的真实标签页或窗口中运行，因此会沿用原有登录状态和站点提供的模型。

## 功能

### 群发与对比

点击扩展图标，再选择「打开群发控制台」，即可使用顶部细条控制台：

- 选择站点并查看状态：灰色表示待命，黄色表示发送中，绿色表示完成，红色表示失败。
- 在范围面板中连续选择站点，使用全部、清空、图片兼容、国外和国内等预设，或保存自己的分组。范围面板也可以只读巡检站点适配器。
- 输入问题后按 Enter。PolyAsk 会打开或复用各站窗口，并自动排列。4 个及以下站点使用单排，5 个及以上使用网格。
- 发送前可统一选择深度思考、快速或保持当前档位。
- 最多可随问题附加 4 张 PNG 或 JPEG 图片，总大小不超过 10 MiB。图片只会发送到兼容的站点。
- 提示词工作区支持多行编辑、命名模板和提问历史，内容与控制台同步。
- 发送进度按站点更新。失败后可只重试失败站点，并查看具体原因。
- 可将所选站点的最新回答汇总为 Markdown。表格、链接和代码块会保留，只采集界面中可见的内容，并标注采集时的档位。
- 结果可保存到归档窗口，再复制为 Markdown 或导出为 `.md` 文件。
- 可以为所选站点开启新会话，也可以关闭由控制台创建的全部窗口。控制台最小化、恢复或回到前台时，受管窗口会一起响应。

PolyAsk 只管理扩展创建或明确登记的弹出窗口。日常浏览窗口以及从回答中另开的普通窗口不会被纳入平铺、群发或批量关闭。新开的站点窗口从空白会话开始，已有的受管窗口则继续当前对话。

### 模型档位切换

访问支持的 AI 站点时，页面顶部会显示 `[🧠 思考 | ⚡ 快速]` 悬浮控件。点击控件或使用快捷键，即可切换模型或思考档位。

## 支持站点与映射

| 站点 | 🧠 深度思考 | ⚡ 快速 |
|---|---|---|
| Claude (claude.ai) | Fable 5（Thinking 开 + Effort High） | Sonnet 5（默认设置） |
| ChatGPT (chatgpt.com) | Intelligence 最高档（超高 / Pro 扩展） | Intelligence 最低档（极速 Instant） |
| Gemini (gemini.google.com) | 3.1 Pro + Thinking: Extended | 3.6 Flash |
| DeepSeek (chat.deepseek.com) | Expert + DeepThink 开 | Instant + DeepThink 关 |
| 豆包 (doubao.com) | 专家 | 快速 |
| 千问 (qianwen.com) | Qwen3.8-Max + 思考开 | Qwen3.8-Max + 思考关 |
| Kimi (kimi.com) | K3 + Thinking Max | K3 + Thinking Standard |
| 元宝 (yuanbao.tencent.com) | Deep Thinking 开 | Deep Thinking 关 |
| 智谱清言 (chatglm.cn) | 深度思考：深度 | 快速 |

> Claude 手动选择 Opus 5 时，High / Extra / Max 识别为深度思考，Low 或无 effort 后缀识别为快速；悬浮按钮的主动映射仍按上表执行。
> 站点 UI 改版可能导致个别适配失效。适配逻辑集中在 `content/adapters-intl.js`、`content/adapters-cn.js` 和 `content/adapters-cn2.js`，支持站点的中英文界面；其他语言不作保证。
> 如需检查当前站点，可打开扩展弹窗并选择「诊断」。诊断只读取控件状态，不会切换模型。

## 安装

### 从 Release 安装

1. 从 [Releases](https://github.com/pine2D/polyask/releases) 下载最新的 `polyask-vX.Y.Z.zip` 并解压。
2. 打开 `chrome://extensions`，启用「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的目录。

### 从源码目录安装

1. 打开 `chrome://extensions`，启用「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本仓库目录。

运行 `bash scripts/package.sh` 可在 `dist/` 中生成 `polyask-v<版本>.zip`。

发布时，先把用户可见的变更写入 `CHANGELOG.md` 的「未发布」段，再运行 `bash scripts/prepare-release.sh auto` 更新版本号、日期和比较链接。审阅并提交后，将 `main` 推送到远端，再运行 `bash scripts/release.sh --publish`。脚本仅允许从工作区干净、与 `origin/main` 一致且当前提交已通过 CI 的 `main` 创建新标签。GitHub Actions 随后发布 ZIP、SHA-256 和对应的更新日志。

> 注意：v0.4.0 至 v0.6.0 的打包脚本遗漏了 `i18n.js` 和 `_locales`，Chrome 无法加载这些版本的重打包文件。请勿从这些旧标签重新打包或重跑 Release。

## 快捷键

| 默认键 | 功能 |
|---|---|
| `Alt+T` | 切换到深度思考 |
| `Alt+Y` | 切换到快速模型 |
| `Alt+Q` | 打开或聚焦群发控制台（已打开时会连同平铺窗口一起移到前台） |

焦点在输入框时同样生效。可在 `chrome://extensions/shortcuts` 中修改快捷键。

> Chrome 自动列出的「激活扩展程序」只会打开扩展弹窗。若要唤起控制台，请绑定「打开或聚焦群发控制台」。
> 受 MV3 限制，`Alt+Q` 仅在 Chrome 为前台应用时生效（无法做 OS 级全局热键）。
> `suggested_key` 仅对新安装或从未手动修改过快捷键的用户生效。其他用户需要在 `chrome://extensions/shortcuts` 中手动绑定。

控制台窗口内的固定键位：

| 默认键 | 功能 |
|---|---|
| `Alt+C` | 汇总复制当前勾选站点的最新回答 |
| `Alt+L` | 平铺当前勾选站点 |
| `Alt+N` | 为当前勾选站点开启新会话 |
| `Alt+P` | 聚焦问题输入框 |
| `Alt+R` | 重试当前勾选的失败站点 |

输入框有焦点时同样生效。这些键位不在 Chrome 扩展快捷键页中配置。

## 悬浮控件（三种显示模式）

在扩展设置页中选择显示模式，修改会立即生效：

| 模式 | 行为 |
|---|---|
| 贴边把手（默认） | 顶部中央一条细把手，悬停/点击展开胶囊，4 秒后自动收回 |
| 始终显示 | 胶囊常显，闲置 4 秒半透明 |
| 隐藏 | 页面不显示控件，仅快捷键和扩展弹窗中的切换按钮可用 |

- 展开后会高亮当前站点的档位（🧠 或 ⚡）。
- 切换失败时自动重试一次；成功后焦点会回到输入框。
- 控件使用 Shadow DOM 隔离，不受站点样式影响。操作结果显示在页面顶部。

## 扩展弹窗与设置

扩展弹窗用于查看当前站点状态、切换 🧠/⚡ 档位、打开群发控制台、查看快捷键、诊断当前站点和进入设置页。

设置页包含常规、数据同步、迁移包和数据与隐私四个区域。主题、界面语言、悬浮控件显示模式和发送后自动置顶均在「常规」中配置。界面支持 English、简体中文和繁體中文，默认跟随浏览器语言。

## Google Drive 同步与迁移

在扩展设置页连接 Google Drive 后，可同步设置、模板、分组、问题历史和结果归档。未发送的草稿、窗口布局、窗口 ID 和仅在运行期间使用的状态不会同步。此功能不使用 Chrome Sync。

扩展只申请 Google Drive 应用专属目录（`drive.appdata`）权限，不会读取或修改普通的 Google Drive 文件。

- 问题历史、AI 回答和迁移包均为明文，不提供端到端加密。
- PolyAsk 不限制历史与归档条数，但仍受 Google Drive 存储配额和 API 限制。
- 导出的迁移包包含明文数据。导入时按记录合并，不会直接覆盖整库；冲突按更新时间和既定规则处理。
- 固定扩展 ID 的新构建不会自动读取旧动态 ID 扩展的数据。

## 结构

```
manifest.json            MV3 配置、权限、快捷键和入口
background.js            后台脚本入口
bg/                      窗口编排、数据、Google Drive 同步和迁移
content/core.js          DOM 工具、提示、适配器注册和群发注入
content/md.js            可见 DOM 到 Markdown 的序列化
content/adapters-intl.js Claude、ChatGPT 和 Gemini 适配器
content/adapters-cn.js   DeepSeek、豆包和千问适配器
content/adapters-cn2.js  Kimi、元宝和智谱清言适配器
content/pill.js          站点悬浮控件
console/                 群发控制台、范围、提示词和归档窗口
popup/                   扩展弹窗
options/                 设置、Google Drive 同步和迁移
```

## License

MIT
