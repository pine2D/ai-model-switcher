# PolyAsk · AI 众答

一个问题，群发给多个 AI，**真实窗口同屏并排**对比答案；并能在每个站点一键切换「深度思考 / 快速模型」。Chrome 扩展（MV3）。

> 不是 iframe 聚合：每个 AI 都在你**已登录的真实标签页/窗口**里运行，不受站点反内嵌限制、不丢登录态、不被降级模型。

## 两大功能

### 🗂 统一对话多个 AI（群发控制台）

点扩展图标 →「🗂 打开群发控制台」，弹出顶部细条控制台：

- **状态色芯片选站**：每个 AI 一枚芯片，点击即选/取消；芯片边框/圆点的颜色就是该站实时状态（灰=待命 / 黄=发送中 / 绿=完成 / 红=失败）
- **范围面板**：一次展开即可连续勾选多个 AI；支持「全部 / 清空」、命名分组及只读站点巡检
- **一步开窗群发**：勾选 → 输入 → Enter，自动为每站开（或复用）真实窗口并同屏等分并排（≤4 站单排、≥5 站网格），各站填入并提交；控制台条始终置顶
- **发送前统一设档**：🧠 深度思考 / ⚡ 快速 / 不变
- **提示词工作区**：点 `✎` 在独立窗口多行编辑，并通过自定义列表管理命名模板与历史；内容与细条双向同步
- **进度与重试**：发送键聚合「发送中 d/总」，失败站一键 `↻` 只重发失败的那几家；全部结果回齐后失败站在细条内联汇总
- **一键巡检**：在范围窗口只读诊断所选站点的适配是否失效（模型入口/档位可读等），逐站显示结果
- **汇总复制**：所选站点的最新回答一键转成 Markdown 复制（表格/链接/代码块保真、只取界面可见内容），各站段落自动标注当时档位
- **结果归档**：独立归档窗口采集当前回答，并提供自定义归档列表、Markdown 复制与 `.md` 导出
- **批量窗口管理**：顶栏独立按钮开启所选站点的新会话，并可关闭全部；**前后台联动**——console 最小化/恢复/被带到前台时，平铺窗整组自动跟随（最小化/恢复/置顶无需手动按钮）

> 窗口按 id 绑定且只认扩展自建的 popup：从平铺窗口点链接另开到主浏览器窗口、或你日常的浏览窗口，都不会被误纳入平铺/群发/关闭。「全部新会话」对已在新会话入口的窗口跳过重载（不闪、不丢草稿）。
> 每次新开的平铺窗口都从空白新会话开始；已存在的受管窗口会继续当前对话。

### 🧠⚡ 模型档位切换

访问支持的 AI 站点时，页面顶部居中出现悬浮胶囊 `[🧠 思考 | ⚡ 快速]`，点击或按快捷键即可切换模型/思考档，无需在层层菜单中手动选择。

## 支持站点与映射

| 站点 | 🧠 深度思考 | ⚡ 快速 |
|---|---|---|
| Claude (claude.ai) | Fable 5（Thinking 开 + Effort High） | Sonnet 5（默认设置） |
| ChatGPT (chatgpt.com) | Intelligence 最高档（超高 / Pro 扩展） | Intelligence 最低档（极速 Instant） |
| Gemini (gemini.google.com) | 3.1 Pro + Thinking: Extended | 3.6 Flash |
| DeepSeek (chat.deepseek.com) | Expert + DeepThink 开 | Instant + DeepThink 关 |
| 豆包 (doubao.com) | 专家 | 快速 |
| 千问 (qianwen.com) | Qwen3.8-Max-Preview + 思考开 | Qwen3.8-Max-Preview + 思考关 |
| Kimi (kimi.com) | K3 + Thinking Max | K2.6 |
| 元宝 (yuanbao.tencent.com) | Deep Thinking 开 | Deep Thinking 关 |
| 智谱清言 (chatglm.cn) | 深度思考：深度 | 快速 |

> Claude 手动选择 Opus 5 时，High / Extra / Max 识别为深度思考，Low 或无 effort 后缀识别为快速；悬浮按钮的主动映射仍按上表执行。
> 站点 UI 改版可能导致个别适配失效；适配逻辑集中在 `content/adapters-intl.js`（国际站）与 `content/adapters-cn.js`+`adapters-cn2.js`（国内站），按文本/语义属性匹配，UI 词支持中英双语界面（其他语言不保证）。
> 怀疑失效时：扩展图标 →「🩺 诊断当前站点」，逐项检查控件是否仍能找到（只读、零副作用）。

## 安装

**方式一 · 打包版本（推荐）**
1. 到 [Releases](https://github.com/pine2D/polyask/releases) 下载最新 `polyask-vX.Y.Z.zip` 并解压
2. 打开 `chrome://extensions`，开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择解压后的目录

**方式二 · 源码目录**
1. 打开 `chrome://extensions`，开启「开发者模式」
2. 点「加载已解压的扩展程序」，选择本仓库目录

> 自己打包：`bash scripts/package.sh` → 产出 `dist/polyask-v<版本>.zip`。
> 发布流程：持续把用户可感知变更写入 `CHANGELOG.md` 的「未发布」段 → `bash scripts/prepare-release.sh auto` 同步版本号、日期与比较链接 → 审阅并提交、推送 main → `bash scripts/release.sh --publish`。脚本只允许 exact-HEAD CI 已通过的干净 main 推送新 tag；GitHub Actions 复用同一构建入口发布 ZIP、SHA-256 与对应 CHANGELOG 段落。
> ⚠️ v0.6.1 之前的 tag（v0.4.0–v0.6.0）打包脚本有缺陷（漏打 `i18n.js`/`_locales`，Chrome 拒载），勿从这些旧 tag 重新打包或重跑 Release。

## 快捷键

| 默认键 | 功能 |
|---|---|
| `Alt+T` | 切换到深度思考 |
| `Alt+Y` | 切换到快速模型 |
| `Alt+Q` | 打开 / 聚焦群发控制台（已开则连同平铺窗整组带到前台） |

焦点在输入框时同样生效。改键：`chrome://extensions/shortcuts`。
> Chrome 自动列出的“激活扩展程序”只打开设置弹窗；唤起控制台请绑定“打开/聚焦群发控制台”。
> 受 MV3 限制，`Alt+Q` 仅在 Chrome 为前台应用时生效（无法做 OS 级全局热键）。
> `suggested_key` 仅对**新安装**或从未手动改过键的用户生效；已安装用户如需改键，请前往 `chrome://extensions/shortcuts` 手动绑定。

控制台窗口内的固定键位：

| 默认键 | 功能 |
|---|---|
| `Alt+C` | 汇总复制当前勾选站点的最新回答 |
| `Alt+L` | 平铺当前勾选站点 |
| `Alt+N` | 为当前勾选站点开启新会话 |
| `Alt+P` | 聚焦问题输入框 |
| `Alt+R` | 重试当前勾选的失败站点 |

输入框有焦点时同样生效；该键位不在 Chrome 扩展快捷键页配置。

## 悬浮控件（三种显示模式）

点扩展图标打开 popup 可切换，实时生效：

| 模式 | 行为 |
|---|---|
| 贴边把手（默认） | 顶部中央一条细把手，悬停/点击展开胶囊，4 秒后自动收回 |
| 始终显示 | 胶囊常显，闲置 4 秒半透明 |
| 隐藏 | 页面零渲染，仅快捷键与 popup 按钮可用 |

- 展开时高亮当前站点所处档位（🧠 或 ⚡）
- 切换失败自动重试一次；成功后焦点自动回到输入框
- Shadow DOM 隔离，不受站点样式影响；结果以顶部 toast 提示

## popup

扩展图标弹窗：🧠/⚡ 切换按钮、**🗂 打开群发控制台**、发送后自动置顶开关、控制台主题、悬浮控件显示模式、🩺 诊断当前站点、当前快捷键与改键入口。

支持界面语言切换（English / 简体中文 / 繁體中文），在 popup 顶部语言选择器切换，默认随系统语言，实时生效。

## 结构

```
manifest.json            MV3：content_scripts + commands + background
background.js            快捷键转发 + 群发控制台编排（开窗/平铺/群发/窗口管理）
content/core.js          DOM 工具、toast、适配器注册表、runMode、群发注入
content/md.js            可见 DOM→Markdown 序列化（汇总复制）
content/adapters-intl.js 国际站切换逻辑（Claude / ChatGPT / Gemini）
content/adapters-cn.js   国内站切换逻辑（DeepSeek / 豆包 / 千问）
content/adapters-cn2.js  国内站切换逻辑·续（Kimi / 元宝 / 智谱）
content/pill.js          悬浮胶囊 UI
console/                 群发控制台（细条窗口 UI）
popup/                   扩展弹窗
```

## License

MIT
