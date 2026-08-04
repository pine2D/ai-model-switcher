# PolyAsk · AI 众答

Chrome MV3 扩展。两大能力：①**群发对比**——一个问题群发到多个 AI、真实窗口同屏平铺对比，各站最新回答可一键**汇总复制为 Markdown**（核心）；②在 9 个 AI 站点**独立访问**时一键切换「深度思考/快速模型」。另提供 Google Drive 数据同步、迁移包和统一设置页。

## 加新站点

加站点改三处（漏一处=该站静默缺席）：`manifest.json` 的 `matches` + 对应适配器（intl 或 cn/cn2）+ `console/sites.js` 的 `SITES` 清单。群发的发送/切档复用 `content/core.js` 的通用 `submitPrompt`/`runMode`，多数站点无需在适配器写 `submit`；仅当发送键不带 `send/发送` 标签、且 Enter 提交不灵时，加可选 `submit(el)`（原生点真实发送键）。要进「汇总复制」需加可选 `answer()`（返回最后一条回答的根节点）。

## 架构

```
background.js               Service Worker 入口：快捷键转发并加载 bg/ 模块
bg/                         窗口/面板/群发编排 + IndexedDB 数据 + Google Drive 同步/迁移
content/core.js             helpers + toast + __AMS 注册表 + runMode/switchTier + submitPrompt + onMessage
content/md.js               可见 DOM→Markdown 通用序列化（汇总复制用，挂 __AMS.toMarkdown；隐藏节点/按钮剔除）
content/adapters-intl.js    Claude/ChatGPT/Gemini
content/adapters-cn.js      DeepSeek/豆包/千问
content/adapters-cn2.js     Kimi/元宝/智谱清言（cn 触及 300 行上限后按站拆分）
content/pill.js             三态悬浮控件(handle/always/hidden, storage.local displayMode, Shadow DOM)
content/upload.js           图片选择、校验与站点附件注入
console/console.html|css|js 群发指挥台(固定 96px 单行专业紧凑条 popup；档位/发送/平铺/汇总复制/联动)
console/scope.html|js       站点范围伴侣窗(连续多选/分组管理/站点巡检；失焦关闭，不改变主 console 高度)
console/status.js           群发进度/结果状态(圆点状态机/错误码翻译/失败汇总/汇总复制拼装/aria-live；console.js 之后加载共享其全局)
console/compose.html|js     提示词工作区(长文本编辑/模板管理/历史/发送)
console/archive.html|js     结果工作区(采集当前结果/归档列表/复制/导出/删除)
console/sites|theme.js      站点清单(console/伴侣窗共享)、主题
popup/                      🧠/⚡按钮 + 快捷键展示 + 🩺诊断 + 打开控制台/设置
options/                    统一设置页：常规 + Google Drive 同步 + 迁移包 + 数据与隐私
```
- 权限：`storage`、`tabs`、`system.display`、`identity`、`alarms`（群发窗口、Google OAuth 与定时同步；无 host_permissions）。
- 适配器契约：每站 `{think, fast, state(), diagnose()}`（可选 `submit(el)`、`answer()`、`inject(el,text)`）；state/diagnose/answer **只读不开菜单**。`inject` 返回 false=交回通用注入链（beforeinput→execCommand→textContent）；**抛异常=通用链对本站不安全**（如 Kimi），core 直接报 `inject_failed` 不回退。

## 群发控制台（console）编排 —— 实战沉淀

控制台是贴顶、占满屏宽、固定高 96px(`STRIP_H`) 的独立 `type:"popup"` 窗口；下方平铺各 AI 站点窗口。`background.js` 是入口，具体编排按职责拆在 `bg/`。

- **popup-only 铁律（安全核心）**：所有「host→窗口」解析收敛到 `popupWindowForHost(host,wins)`，**只返回 `type:"popup"`，绝不碰用户日常浏览窗口(`type:"normal"`)**；关窗经 `removeIfPopup(id)`（get 校验 type 再 remove）。openTile/sendAll/focusAll/minimizeAll/newSession 全走它。曾因裸 `tabs.query({url})` 误把用户日常窗口收编进平铺/广播/新会话（清空对话），故铁律不可破。
- **登记表 `amsWindows` host→{id,owned}**：owned=true 仅 `windows.create(popup)` 新建（closeAll 可自动关）；复用/收编窗口 owned=false（不擅自关）。
- **sendAll（发送到全部 / Enter）**：有站点没窗口先 `openTile(sites, false)` 开窗——**隐式开窗不 prune 不重排**（追问少数站不关不动其他窗口与手调布局；显式「平铺」按钮才全量重排）→ 各站**并行轮询**页面就绪再提交（content 未注入 / `composer_not_found` 都视为还没好、继续等，~22s）。**初次使用无需先点平铺**（勾选→输入→Enter）。每站完成即 `pushSiteResult` 推单站结果（`{from:"AMS_BG",type:"siteResult"}`），圆点逐个变色、不等最慢站。
- **错误码协议**：失败原因走 `code`（timeout/composer_not_found/inject_failed/submit_unconfirmed/tier_unconfirmed/no_window/not_ready/no_answer…），bg/content **不产出用户可见文案**，console/status.js 的 `ERR_KEYS` 按界面语言翻译；bg 轮询判定认 `r.code`，绝不正则匹配文案。另有只读编排消息：`checkup`（巡检→逐站 diagnose 标芯片）、`collect`（汇总→逐站 answer→Markdown）。
- **联动**（弃用 `onFocusChanged`——Windows 上常不派发也不唤醒 SW）：由 console **页面 DOM 事件**驱动——window `focus` → `consoleFocused` 消息经 ~180ms 去抖抬整组工作区；`visibilitychange` hidden → `consoleHidden`，后台核实 `state==="minimized"` 才联动 `minimizeAllManaged`（区分最小化 vs 被遮挡）。`onRemoved`==console 窗口 → `closeAll`(仅 owned)。console 窗口 id 存 `amsConsoleWin`。
- **平铺基准与保留高度**：基准工作区取 `consoleWorkArea()`（console 中心点所在显示器——拖到哪屏铺哪屏，也根治副屏 reserve 混坐标系）；保留高度用控制台**实际底边 `c.top+c.height`**（非硬编码 96）——WSL2/X410 给每个窗口套 ~30px 标题栏（Chrome 如实报告在 `top`），只用 height 会漏掉上移、致平铺压住控制台。
- **薄弹窗限制**：96px 窗口里的自定义 DOM 浮层会被裁切；需要纵向空间的历史/模板、站点范围/巡检、归档/导出分别进入 `compose.html`、`scope.html`、`archive.html` 独立 popup，主 console 不使用原生下拉且始终保持 96px。
- 数据位置：常规设置、模板、分组和同步状态在 `storage.local`；受管站点窗口表 `amsWindows` 在 `storage.session`；问题历史、归档、同步 outbox 和远端文件索引在 IndexedDB。历史与归档不设 PolyAsk 条数上限，但本地仅缓存近期正文，较旧正文按需从 Google Drive 读取。`amsConsoleWin`、`amsComposeWin`、`amsScopeWin`、`amsArchiveWin` 等窗口 id 在 `onStartup` 清空（id 跨重启失效）；每个新建平铺窗都使用站点新会话 URL，只有既有受管 popup 延续当前对话。

## 注入与提交（submitPrompt / switchTier）—— 实战沉淀

- **受控编辑器**（Lexical/ProseMirror/Slate，如千问/Kimi）**无视 `execCommand` 的 DOM 写入**（写进 DOM 但编辑器 model 不注册 → 发送键禁用）：contenteditable 改用**合成 `beforeinput`**（`inputType:"insertText", data`）注入，编辑器才注册；没进去再退回 execCommand。textarea/input 仍用原生 value setter。
- **提交优先原生点击发送键**（`button[aria-label*=send/发送]`，国产站拒合成事件、且避免对受控编辑器发 Enter 产生多余换行），`!disabled` 防误触；无匹配按钮再退回合成 Enter+`confirmSubmitted` 校验。真机审计（2026-07）：千问/Claude/ChatGPT/Gemini 发送键带标签走通用原生点；**DeepSeek/豆包/Kimi/元宝已各自 `submit(el)` 原生点真实发送键**（`.ds-button--primary.ds-button--circle`、`#flow-end-msg-send`、`.send-button-container`、`span.icon-send`）；chatglm 靠 Enter（textarea 可发）。
- **切档位要验证**：`switchTier(mode)` 静默重试 `runMode` 直到 `state()` 确认切到目标档再提交（~10s 兜底）。新开页面切换器渲染晚于输入框，旧逻辑"没抛错就算切了"会"切换失败仍直接提交"。`runMode(mode, silent?)` 返回成功布尔供其重试。
- **adapter.submit 契约**：返回 `false`=发送键此刻不可用 → 落回通用路径；点击成功也必须过 `confirmSubmitted`（输入框清空/变化=已发出）再判成功。**submit() 内部须自行判空兜底、缺件返回 false 而非抛异常**——core 对 submit 抛异常直接终止（code:error），不会落回通用路径，漏判空=丢掉本可成功的兜底。已知限制（真机证实）：聊天站流式生成期间普遍把发送键复用为「停止」（class/id 不变仅换图标），流式中对同站二次群发会点成停止、截断上一条——诚实报失败可 retry，图标判别脆弱故不做守卫。
- **adapter.answer 契约**（汇总复制用）：只读同步，返回最后一条 AI 回答的**根节点**（或字符串）或 null；core 经 `content/md.js` 通用序列化为 Markdown（表格→GFM、链接/代码围栏保留、隐藏水印与按钮/svg 剔除）——**逐站不维护 markdown 规则**，九站回答都是 md 渲染的标准 HTML 故一个串行器通吃。快照以点击时刻为准（不等流式），档位标注取收集时刻 `state()`。

## 适配器编写原则（实战沉淀）

- **模型名匹配语言无关**（Fable/Qwen/K3/GLM…），**UI 词必须中英双写**（`/Expert|专家/`、`/^(high|高)$/i`）；zh/en 之外不承诺，靠诊断兜底。
- 优先**结构/语义锚点**（data-testid、稳定 class、aria-label、aria-checked/pressed），文本是次选。
- **国产站常拒绝合成事件**（isTrusted=false 被忽略）：菜单项/radio/toggle 用**原生 `el.click()`**；国际站 Radix/Material 菜单用 pointer 事件序列 `openMenu()`。
- 站点常有**宽窄两种布局**（窗口宽窄不同）：Claude 窄屏是 Adaptive thinking 开关、宽屏是 effort 子菜单；Gemini 窄屏模型按钮无 aria-haspopup。适配器须双布局兼容。
- **Claude 档位映射**：think=Fable 5 + Thinking 开 + effort High；fast=**Sonnet 5 默认设置**（只选模型，不把 Fable 的 High effort 强加给快档；state() 见模型名带 sonnet 恒判 fast）。Anthropic 换代时同步 `fast()`/`think()` 里的模型正则。
- **Kimi 档位映射（2026-07-21 用户定案）**：think=K3+Max、fast=K3+Standard。换模型会 SPA 路由跳 `/agent?chat_enter_method=change_model`（含会话内切换，会离开会话视图）；该面发送**偶发**对真人也失效（2026-07-21 真机连可信打字/点击/Enter 都发不出，用户判断为站点高峰限流禁用对话）——发送失败诚实报 `submit_unconfirmed` 可 retry，不要因此改掉 K3 映射。effort 切换不导航；K2.6 无 Max 档（仅 Standard/High）。中文 UI 的 effort 标签与英文不同：Max=「极致」（用户实证）；chrome-dbg 站点跟账号语言恒英文，中文标签只能靠用户回报。Kimi 编辑器（Lexical）被合成 beforeinput 写死（DOM/model 分叉、编辑器冻结）→ 用适配器 `inject`（execCommand+显式 Range，失败抛异常禁回退）。
- 有状态控件**先读后点**（幂等）；Gemini Thinking 需兼容当前模型菜单直达项与旧版 Thinking level 嵌套子菜单。
- 文案可能含**零宽字符**（Claude "Max" 实为 4 字符）：用 contains 匹配，别用 `^...$` 配长度。

## 测试与调试（chrome-dbg 实战）

- **用户实测环境（2026-07-14 确认）**：`chrome-dbg` 中已安装本仓扩展，相关 AI 网站均有登录态；修适配器、切档或发送 bug 时，默认必须先重载扩展并新开/刷新站点，再通过生产 `__AMS` 真机复现和回归，不得只凭静态代码或官方文案推断。
- 重载扩展：在 `chrome://extensions` 标签页执行 `chrome.developerPrivate.reload("<本仓unpacked ID>",{failQuietly:false})`；**重载后旧标签的 content script 变孤儿**，需刷新页面重注入。
- **直连 chrome-dbg 最灵活**：本机 chrome-dbg 在 `127.0.0.1:9222`，**装有本扩展且各 AI 站已登录**（2026-07 实证）——站点 DOM 适配审计可全程自主完成（开站→注入→点发送→探锚点）。工具：`scratchpad/cdp.js`(list/open/eval，node≥22 全局 WebSocket)、`scratchpad/iso-eval.js`（隔离世界遍历——多扩展环境有多个 isolated world，须逐个找 `__AMS`，别只看最后一个）。坑：豆包渲染在中英文与数字间插空格（marker 匹配先去空白再比）；后台标签 eval 可能挂起，先 `/json/activate` 激活再探；Gemini 会 prerender 出**同 URL 双 page target**（按 urlSub 匹配会打到影子页、发送与探测对不上），探前先 `/json/list` 数一下同站 target 数、关掉多余的再操作。
- **chrome-devtools-mcp 默认自启一个 `--disable-extensions` 的全新 Chrome**（about:blank、无登录态、无扩展）；要连本机 chrome-dbg 须给其 MCP server 配 `--browserUrl http://127.0.0.1:9222` 再重启。
- **claude-in-chrome** 进不了 `chrome://` / `chrome-extension://`（被拦），且需逐站授权、多浏览器要先 `select_browser`；适合驱动已授权的普通站点，但逐站授权慢。
- 验证快捷键链路：MV3 SW 休眠，reload 唤醒后 30s 内 CDP `Target.attachToTarget` 执行 onCommand 等价代码；物理按键→onCommand 无法合成，留人工。
- 平铺安全回归（核心）：日常 normal 窗口开某站 → 触发 openTile → 断言该 normal 窗口 bounds 不变、登记的是新 popup；污染登记为 normal id 后断言不被关、自愈为 popup。
- 仿真窄窗：`Emulation.setDeviceMetricsOverride {width:639}`。
- **断言用生产逻辑**（`__AMS.getState()`/`_isOn()`），不要在测试 lambda 里重写正则——shell/python 转义会把 `\s` 变 `\\s`，产生"幽灵失败"（实战吃过亏）。注意 `__AMS` 在 content script 隔离世界，主世界 DevTools 控制台默认看不到（要切上下文）。
- chatglm.cn 加载极重：水合期（~30s）连扩展消息都无响应，安定后正常；新开标签+长等待。

## Git

- 提交用 git-commit skill（Conventional Commits、可带 AI 署名 trailer）；仓库无 user 配置，用内联身份提交。
- 发版前持续维护 `CHANGELOG.md` 的「未发布」分类条目；`bash scripts/prepare-release.sh auto` 按 Conventional Commits 推导语义版本，并一次性晋升 CHANGELOG、同步 manifest 与比较链接（只改文件，不自动 commit）。
- 审阅发版变更、commit 并 push main 后，运行 `bash scripts/release.sh --publish`：本地与 CI 共用 `--build-only` 验证链路，只有工作区干净、`main == origin/main`、exact-HEAD CI 成功且 tag 不存在时才推送 `v*`。Release workflow 随后发布 ZIP、SHA-256 与本版 CHANGELOG 正文。
- 已发布 tag 不覆盖；若需改内容必须升新版本。仅验包可运行 `bash scripts/release.sh --build-only`。
- `docs/superpowers/`、`.superpowers/`、`.spec-workflow/` 与 `.codegraph/` 已 gitignore（本地工作文档不入库）。
- 单文件 ≤300 行（JS）；超了按 intl/cn 之类职责拆分。

### 发布前文案与文档核查

- 核对 `README.md`、`CHANGELOG.md`、扩展说明和设置页是否覆盖本版新增功能、限制、权限、隐私行为及最新模型映射；删除已经失效的入口或描述。
- 凡修改用户可见文案，必须使用 `content-l10n` skill 检查三语语义、术语、占位符、快捷键、URL、文件格式和长度限制。不得只改一种语言。
- 英文散文用 `humanizer` 自查，中文散文用 `humanizer-zh` 自查。重点清理破折号群、广告腔、三连套式、空泛总结和宣传性强化，不改写技术事实。
- 破坏性操作、明文存储、权限范围、不可撤销后果和数据保留规则不得弱化；按钮、确认文案与实际动作必须一致。
- 运行 `node scripts/test-content-l10n.js`，确认三语键覆盖、占位符一致、HTML i18n 引用有效，且英文用户文案不含长破折号。
- 在 English、简体中文和繁體中文下检查 popup、控制台、范围、提示词、归档和设置页，确认切换语言后无截断、异常换行或缺失的 aria-label。
- 确认 `CHANGELOG.md` 的「未发布」段已记录所有用户可感知变更，再运行 `bash scripts/verify.sh` 和 `bash scripts/release.sh --build-only`。
