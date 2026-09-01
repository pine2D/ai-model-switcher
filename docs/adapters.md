# 站点适配（`content/`）

改 `content/core.js` 或任一 `adapters-*.js` 前读这份。**适配器契约全表、加新站点步骤、图片载荷限额、注入/提交/切档/汇总机理、九张站点卡都在这里**；`CLAUDE.md` 只留一句协议摘要（必需成员、只读不开菜单、`false` vs `throw`）。两边说法冲突时以 `CLAUDE.md` 的硬约束为准，然后回来把这份改对。

选择子、模型正则、档位标签随站点改版失效，**代码是唯一权威**；本文记的是「上次真机确认的形态 + 致命坑」。

## 加新站点

1. `manifest.json` 的 `content_scripts.matches`（当前 9 条）。
2. 适配器：`content/adapters-intl.js` / `adapters-intl2.js`（国际）或 `adapters-cn.js` / `adapters-cn2.js`（国内）。**分卷只因 300 行上限而存在，按站切，不按职责切**：当前 `intl` = Claude + Gemini、`intl2` = ChatGPT、`cn` = DeepSeek + 豆包 + 千问、`cn2` = Kimi + 元宝 + 智谱。
   **新开一卷要登记五处**（漏哪处都是静默失效）：① `manifest.json` 的 `content_scripts.js`（排在其它适配器之后、**`content/diag.js` 之前**）；② `desktop/src/preload/site.ts` 的 `require` 列表（`scripts/test-desktop-shared-runtime.js` 对账两边集合，只改一边会红）；③ `scripts/test-desktop-shared-runtime.js` 末尾加一行 `adapterMustResolveTranslation(<新卷>, <某 host>, <某 diag key>)`；④ `scripts/test-probe-drift.js` 与 `scripts/test-image.js` 里各有一份写死的适配器文件清单，要把新卷加进去；⑤ 本文的分卷说明 + `CLAUDE.md` 架构段 + `docs/console-windows.md` 的注入顺序串。`scripts/test-site-selection.js` 的适配器清单从 manifest 派生，**不用改**；`scripts/package.sh` 的 `RUNTIME` 收整个 `content/` 目录，也不用改。
3. `console/sites.js` 的 `SITES`：`{host,label,url,on?,image?,intl?}`。`on` 决定首次使用的默认勾选；`image` 决定「图片站」预置分组与图片群发可用性（必须与适配器是否实现 `attach` 一致）；`intl` 决定「国外/国内」两个预置分组（`scope.js` 由这三个标志现算 `PRESET_SIGNATURES` 区分预置与用户自建分组）。
4. **Desktop 三处**：`desktop/src/main/sites.ts` 的站点表、`desktop/src/shared/contracts.ts` 的 `SITE_KEYS`（两者顺序必须一致，否则 `diagnostics.ts` 的 `site_order` 判红）、`content/generation.js` 的停止键表（不补 = Desktop 永远观测不到该站的「生成中/已完成」）。漏这三处只有 Desktop 静默缺席，扩展侧一切正常。
5. `bg/synthesis.js` 的 `SYNTHESIS_ALLOWED_SITES`：辅助综合的目标站白名单，不补则该站不能当综合目标（返回 `invalid_request`）。
6. 按下方契约表补可选钩子。不补 = 该能力静默降级，不是报错。
7. 测试：
   - **不用再补断言，要会读它的红**：`scripts/test-site-selection.js`（`verify.sh` 已调）双向对账**四处登记**（扩展 `manifest.matches` / `SITES` / 适配器注册键，加 `desktop/src/main/sites.ts`）——正向查每个 `SITES[].host` 是否被某条 `matches` 覆盖、是否能被某个 `S.adapters` 键以 `includes` 命中（`pickAdapter` 的真实语义，键是 host 子串不必相等）；反向查僵尸适配器键与孤儿匹配。适配器文件清单从 `manifest.content_scripts[].js` 派生，**新开一卷（如 `adapters-cn3.js`）只要挂进 manifest 就自动纳入**，不必改测试。
   - 站点实现了 `submit` / `inject` / `attach` 时，才另加 `scripts/test-site-send-runtime.js` 用例。该文件只用 `vm` 执行 `adapters-cn.js` / `adapters-cn2.js`，针对 deepseek / kimi / qianwen 三站验发送与附件语义，**不是站点登记表**，加站点不改它不会红。**档位切换的回归不放这里**：国际站在 `scripts/test-intl-runtime.js`（Claude/Gemini）与 `scripts/test-intl2-runtime.js`（ChatGPT 滑块），国内站在 `scripts/test-cn-tier-runtime.js`（智谱/元宝/Kimi），三份与本文件互不重叠。

**适配器注册键是 hostname 子串**：`pickAdapter()` 用 `location.hostname.includes(key)` 匹配，所以 `S.adapters` 的键是 `deepseek.com` / `doubao.com` / `qianwen.com` / `kimi.com`，与 `sites.js` 的完整 host（`chat.deepseek.com` / `www.doubao.com` / `www.qianwen.com` / `www.kimi.com`）**故意不同**（9 站里有 4 站如此）。照抄 sites.js 的 host 当适配器键会静默匹配不上。子串匹配也意味着同域新子域会被同一适配器接管（如 `platform.deepseek.com`），加子域前先想清楚。

## 适配器契约（全表）

**绝大多数站只要 `think` / `fast` / `state` / `diagnose` 四个必需项，其余都不用写。** `state`/`diagnose`/`answer`/`submitted` 一律**只读同步，不得开菜单**。

| 成员 | 必需 | 签名 | 返回值与异常语义 |
| --- | --- | --- | --- |
| `think` / `fast` | ✓ | `async ()` | 切到目标档。**关键控件缺失一律 `throw`**——静默 `return` 会让 `runMode` 误报「已切到」并弹假成功 toast（例外见下一节） |
| `state()` | ✓ | 同步 | `"think"` / `"fast"` / `null`。只表示粗档位，不能证明模型版本/强度/开关精确 |
| `diagnose()` | ✓ | 同步 | 锚点命中报告，供巡检标芯片。只列**常驻**控件，会随对话阶段消失的控件不许列（否则巡检恒红误报）。**每条检查必须带 `kind`**，见下方「检查项的 `kind`」 |
| `submit(el, deadline)` | | `async` | `false` = 发送键此刻不可用 → 落回通用链；**抛异常 = core 直接 `code:"error"` 终止、不回退**，所以内部必须自行判空返回 false。点击成功也要过 `confirmSubmitted` 才算成功 |
| `inject(el, text)` | | 同步 | `false` = 交回通用注入链（beforeinput→execCommand→textContent）；**抛异常 = 通用链对本站不安全**（Kimi），core 直接报 `inject_failed` 不回退 |
| `answer()` | | 同步 | 最后一条 AI 回答的**根节点**（或字符串）或 null；core 用 `content/md.js` 统一序列化为 Markdown，**逐站不维护 markdown 规则** |
| `submitted(text)` | | 同步 | 「末条用户消息是不是我刚发的」。实现了它的站，bg 才敢在页面重挂后自动重试一次 |
| `attach(files, el, deadline)` | | `async` | 真值 = 已确认附件；`false` = 失败（按是否已过 deadline 归 `attachment_timeout` / `attachment_failed`）；**返回字符串 = 直接当错误码用**；抛异常 = `attachment_failed`。不实现就整个不写（core 如实报 `attachment_unsupported`），不要写半吊子上传 |
| `generation()` | | 同步 | **仅 Desktop 消费**（`desktop/src/preload/site.ts` 的 `readGeneration`）。返回 `"generating"` / `"complete"` / `"idle"` / `null`。九站都不自己写：`content/generation.js` 在注册表填好后，按 host→停止键选择子表**统一挂上默认实现**（停止键可见且挨着 composer → generating，否则看 `answer()` 有无内容）；适配器若已自带同名方法则跳过不覆盖。加站点要补那张表，否则 Desktop 卡片永远停在「已提交」 |
| `thinkImage()` / `fastImage()` | | `async` | 有图时替代 `think`/`fast`（仅 DeepSeek，走 Vision 模式） |
| `stop()` | | `async` | 仅 ChatGPT。**全仓无调用方，当前是死代码**——要么补 UI（如控制台「停止全部」），要么删 |
| `sendSel` | | 字符串 | 发送键选择子，**仅 DeepSeek/Kimi/元宝 3 站声明**（都需要站点级点击且锚点常驻），供 `content/diag.js` 巡检做只读存在性检查。**与本站 `submit` 的选择子同步维护**——`scripts/test-diag-runtime.js` 按字面量对账，脱钩会红。豆包**有意不声明**：其发送键空输入框时不在 DOM（非常驻，真机 2026-08-18），列进巡检会恒红 |

**能力由钩子决定，不由清单决定**：`answer()` 决定该站能否进「汇总复制」（九站全实现）；`attach()` 决定能否收图（6 站实现：Claude / ChatGPT / DeepSeek / 豆包 / Kimi 走 `S.setInputFiles`，元宝走 `S.dropFiles`；Gemini / 千问 / 智谱**有意不实现**，真机实测三站都拒绝合成 drop/paste/change，报 `attachment_unsupported` 是正确行为）。这 6 站必须与 `console/sites.js` 里带 `image:true` 的 6 站完全一致。

**巡检通用检查（`content/diag.js`）**：在全部适配器分卷之后注入，按已填充的注册表统一包装每站 `diagnose()`，前置两条只读检查——「输入框」（`findComposer()`，九站全部）与「发送键」（仅声明了 `sendSel` 的站）。新站/新分卷自动获得，无需自己写这两条；**有意不做全站发送键检查**：ChatGPT 等站空输入框时发送键被语音键替换，通用检查会在巡检（输入框常为空）时恒红误报。新开适配器分卷（如 `adapters-cn3.js`）挂 manifest 时**必须排在 `content/diag.js` 之前**，否则该卷站点拿不到通用检查（注册晚于包装，静默缺席不报错）。

### 检查项的 `kind`（机器字段，不产用户可见文案）

每条 `{ name, ok }` 都要再带一个 `kind`。**不能按 `name` 分类**——`name` 在源头就已本地化（`i18n.js` 的 `diag_*` 词条），按显示名匹配在非英文界面下必然失效，也撞 CLAUDE.md「绝不正则匹配文案」。

| `kind` | 含义 | 红了意味着 |
| --- | --- | --- |
| `reach` | 站点可达性（输入框在不在）。`content/diag.js` 统一前置，每站**恰有一条** | 整条群发链必然 `composer_not_found` |
| `control` | 切档控件在不在 | 多半是站点改版，要修适配器 |
| `tier` | 当前档位读不读得出（`state() != null`） | **不代表站点坏了**，见下 |
| `probe` | 探测本身出错（适配器缺席 / `diagnose` 抛异常） | 适配器层面出问题 |

**为什么 `tier` 单独一档**：各站 `state()` 是**刻意的偏函数**，只认自己 `think()`/`fast()` 能产出的那两档；用户手动停在任何其它合法档位都返回 `null`——千问「Qwen3.7-千问 + 快速」（think 的模型配 fast 的模式）、Kimi「Instant」（非 K3）、元宝「Expert」（工具执行档）都是如此。真机 2026-08-31 实测：九站里这三站因此**常态**被判「发现异常」，反而把真正的改版信号淹掉了。现在 Desktop 的 `buildSiteHealth` 只让非 `tier` 的红项决定可用性，`tier` 红项在详情页显示成「提示」，扩展侧巡检把它降为 `note`、popup 用提示色且不再弹「站点可能已改版」。

**金丝雀没有丢**：`scripts/probe-drift.js` 逐项比对 `ok`（不看 `kind`），标签集真漂移时仍会报警。

**漏标的后果**：`normalizeDiagnosticChecks` 把缺省与未知值一律归成 `control`——方向是安全的（保留「红即告警」的现状，绝不制造假绿），但等于没修。`scripts/test-diag-runtime.js` 有一条九站不变量断言守着：每条检查必须带合法 `kind`，且每站恰有一条 `reach`。

### 通用发送键定位（`content/send.js`）

`submitPromptNow` 的按钮路径不自己找发送键，统一走 `__AMS.sendBtn(el)`。**该文件必须排在 `content/core.js` 之后**（它读 `window.__AMS`），两端都要登记：`manifest.json` 的 `content_scripts[0].js` 与 `desktop/src/preload/site.ts` 的 `require` 列表。漏登记是**静默**的——九站按钮路径全部退化成纯 Enter 兜底，没有任何报错；`scripts/test-desktop-shared-runtime.js` 的顺序断言与运行期断言守着。

两个真机坑决定了它的写法（改之前先读源码注释）：

- **纵向锚点取输入框的裁剪祖先，不取编辑节点本身**。Claude 的 ProseMirror 随行数无限长高并溢出裁剪容器，而发送键贴的是容器下沿。按编辑节点 `top` 作锚，`|send.top − composer.top|` 随行数线性增长（真机 2026-08-31：空框 57 / 8 行 189 / **15 行 343**），越过 240 带后整条按钮路径失效。Desktop 的三宫格 tile 只有全宽的约 1/3，同样字数折行多 2~3 倍，比浏览器里早得多就触发。
- **横向按「离输入区最近」择优，不设绝对像素阈值**。`claude.ai` 侧栏每条会话一个 `More options for <会话标题>` 按钮，标题含 send/发送 时就匹配同一选择器，且文档序在输入框之前、纵向也落在带内（真机 2026-08-31 带内 9 个）。它在另一列、差着整个栏宽。**不写死远近阈值**——窗口越窄各列挨得越近，任何固定像素数都会在某个宽度上翻车。
- 簇内优先可用项（`disabled` 与 `aria-disabled` 都算不可用）；全簇不可用时仍返回首个，由调用点的 `btn && !btn.disabled` 拦下并落到 Enter 兜底。

**什么时候才写 `submit`**：群发的发送/切档复用 `content/core.js` 的通用 `submitPrompt`/`runMode`，多数站点无需写 `submit`；**仅当通用 button 选择子或 Enter 提交覆盖不了本站时**才加。当前实现分布：`submit` 4 站（DeepSeek / 豆包 / Kimi / 元宝）、`inject` 1 站（Kimi）、`submitted` 1 站（Kimi）、`stop` 1 站（ChatGPT）、`thinkImage`/`fastImage` 1 站（DeepSeek）。

## 九站发送路径

| 站点 | 路径 | 关键选择子 / 说明 |
| --- | --- | --- |
| Claude | core 通用链 | 无 `submit`；发送键锚点是 `button[data-testid="chat-input-send"]`（同族 `chat-input` / `chat-input-attach` 一并核实，真机 2026-08-31），原生 `btn.click()` 一点就发。其 `aria-label="Send message"` 由 react-intl 产出、随界面语言变，**只作现象描述，不可当锚点**。注入后约 80ms 解禁（core 等 250ms，余量充足）|
| ChatGPT | core 通用链 | 无 `submit`（先试 `send`/`发送` 标签按钮，点不动再 Enter） |
| Gemini | core 通用链 | 无 `submit` |
| DeepSeek | `submit(el, deadline)` | `[role="button"].ds-button--primary.ds-button--circle` 取最后一个，`waitFor` 到既无 `ds-button--disabled` 类也无 `aria-disabled="true"` 才原生 `click()`；超时（deadline 剩余，无 deadline 则 10s）返回 false |
| 豆包 | `submit()` | `#flow-end-msg-send`；缺失或 disabled/aria-disabled/data-disabled 为真时返回 false 落回通用链（textarea Enter 可发） |
| 千问 | core 通用链 | 无 `submit`；受控编辑器靠合成 `beforeinput` 注入 |
| Kimi | `submit()` | `.send-button-container`（无 role 的 div，Enter 只插换行）；用 `clickEl(b)` 合成 pointer 序列 + `detail:1` 拟真，**不是原生 `click()`** |
| 元宝 | `submit()` | `[aria-label="Send"], [aria-label="发送"]`（非 button），排除 disabled 后用 `clickEl()` |
| 智谱 | core 通用链 / Enter | 无 `submit`；通用链先试 `send`/`发送` 标签按钮，点不动才发 Enter（textarea 可发） |

Claude / ChatGPT / Gemini / 千问 究竟命中通用链的哪一步（原生点按钮 vs 合成 Enter），只有 Claude 有真机结论；其余三站代码里没有站点级证据，别断言。

## 「控件缺失一律 throw」的 3 处例外（2 个站）

例外全部在 `adapters-*.js` 里。`core.js` 没有这条规则，它只负责把适配器抛出的异常转成 `runMode` 返回 false 或 `submitPrompt` 的 `code:"error"`。

1. **DeepSeek `_selectMode`** 找不到模式 radio → 静默跳过。radio 仅空对话首屏存在，聊天中缺失属正常态，档位真值由 DeepThink 开关兜底。
2. **Gemini `_setThinking`** 没有直达开关且 `on === false` → 静默 return（关思考时没有开关可关）。
3. **Gemini `_setThinking`** 找不到「thinking level / 思考等级」子菜单入口 → 静默 return（窄屏或该模型无此项，属合法缺席）。反例：**子菜单在但目标等级缺失必须 throw**，静默会漏设等级。

**已撤销的例外**：原第 2 条「Claude `_setThinking` 连裸 Thinking 开关也缺失 → 静默结束」于 2026-08-31 删除。当时的理由是「思考控件整个缺席在旧布局属合法态」，但真机复核发现控件一直在、只是 `effort-menu-trigger` / `effort-option-*` 两个 testid 改没了；静默让 `think()` 一路假成功、弹绿 toast 而档位纹丝不动（本次事故里最难发现的一站）。现在 Claude 的 effort 入口缺失、档位为空一律 throw。**加新例外前先想清楚：它是「站点本就没有这个能力」，还是「我们的选择子过期了」——后者永远不该静默。**

**智谱 `think()` 的「极致找不到就点深度」不是例外**：那是有序降级表 `_TIERS` 的正常取值（同 ChatGPT `_pickEdge` 的「取在场端点」、Claude `_setEffort` 的「取在场最高档」），点完照样复读校验、不生效照样 throw。

另有 5 处「先读后点」的幂等 `return`，**不属于例外，别混为一谈**：豆包 `_select` 已是目标模式、千问 `_selectModel` 已是目标模型、千问 `_setThink` 状态已对、Kimi `_setEffort` 强度已对、ChatGPT `_selectModel` 目标模型已 `aria-checked`。

## 切档（`runMode` / `switchTier`）

- `switchTier(mode)` 静默重试 `runMode` 直到 `state()` 确认切到目标档再提交（~10s 兜底）。新开页面的档位切换器渲染晚于输入框，旧逻辑「没抛错就算切了」会「切换失败仍直接提交」。`runMode(mode, silent?)` 返回成功布尔供其重试；`runMode` 自身对站点渲染抖动静默重试一次（间隔 150ms / 600ms，每轮先 `escMenus()` 从干净态开始）。
- **`sawReadable` 守卫**：「连续两次 `state()==null` 就认账」这条捷径只在**该站从头到尾都读不出 state** 时才触发，避免瞬时 null 让本可读的站提前放行。
- **先等输入框出现再切档**：未就绪返回 `composer_not_found` 让 `sendAll` 轮询重试；提交成功但档位未确认时回 `tier_unconfirmed`（绿点带警示，不谎报全绿）。
- `state()` 只表示粗档位，不能证明模型版本/强度/开关精确，所以每次群发至少跑一次幂等适配器。

## 汇总复制（`answer` + `content/md.js`）

序列化入口是 `content/md.js` 挂在 `__AMS.toMarkdown(root)` 上的函数，由 `content/core.js` 的 collect 分支调用（`content/core.js:265`）——grep 这个符号名找真入口。

- `answer()` 返回最后一条回答的根节点；快照**以点击时刻为准（不等流式）**，档位标注取收集时刻 `state()`；无回答的站如实标出，别让用户把错误占位贴给别人而不自知。
- **可见文本必须用 `innerText` 不用 `textContent`**（`visText`）：`textContent` 会把站内/第三方扩展注入的隐藏节点（水印 UUID、翻译克隆）一并带出，所见即所得只能靠 `innerText`（`textContent` 仅兜底）。
- **`answer` 必须排除思考段**，否则思考全文淹没正文。七站显式过滤后取最后一个，逐站排除锚点见站点卡。**例外两站待取证**：ChatGPT 与 Gemini 目前是「末条回答容器 → 第一个 `.markdown`」，没有任何思考段过滤——依赖「思考段不带 `.markdown`」这个未经真机确认的假设（F098）。改这两站的 `answer()` 前先真机看一眼开了思考的那轮回答里有几个 `.markdown`。
- `md.js` 是**一个串行器通吃九站**（九站回答都是 md 渲染的标准 HTML），逐站不维护 markdown 规则。它的**四条输出契约**（下游依赖，改前先想清楚谁在用）：
  1. 表格 → GFM 管道表。
  2. 链接保留为 `[文本](href)`——引用 chip 因此带回来源 URL，去掉链接等于丢掉出处。href 里的圆括号做 `%28`/`%29` 百分号编码（只编码链接目标，可见文本保持原样）：CommonMark 的括号配平会把带右括号的 URL（查询参数里很常见）截断。实现同 `console/archive-detail.js` 的 `markdownUrl`。
  3. `IMG` 节点保留 alt 文本占位（`[alt文本]`，无 alt 用 `[图片]` 兜底），**不贴 src**——九站生图的 src 多是签名/临时短效 URL，还原成 `![alt](src)` 只会产出死链或过期图。保留占位是为了让纯图回答的序列化结果非空，否则一次成功作答会被上报成 `no_answer`。
  4. SKIP 集剔除 `BUTTON` / `SVG` / `STYLE` / `SCRIPT` / `NOSCRIPT` / `SELECT` / `TEXTAREA` / `AUDIO` / `VIDEO`，以及 `aria-hidden="true"` 与 `role="button"` 的节点。
- 五条实现硬规则：① 文本节点必须转义 `\` `` ` `` `*` `_` `[` `]`（同段的 `a_i` 与 `b_j` 会被下游渲染成强调/链接）；② 代码块语言名前瞻绝不吸收语义标签（ChatGPT 的 `h3` 直邻 `pre`，旧逻辑把「### Example」吞成语言名）；③ `firstTextNode` 要跳过空白垫片文本节点（Kimi 头部条首个文本节点是纯空白）；④ `PRE` 常被再包一层透明 `DIV`（Claude `overflow-x-auto` / Kimi syntax-highlighter）；⑤ 内容含反引号用双反引号 + 空格包裹，围栏代码含三个反引号时升级为四反引号。

## 图片载荷（`content/upload.js`）

最多 **4 张**、仅 `image/png` 与 `image/jpeg`、单批总计 **≤10 MiB**（`MAX_BYTES`）。`dataUrl` 要过严格 base64 正则 + 解码后长度必须等于声明 `size` + PNG/JPEG 魔数校验 + `createImageBitmap` 真解码，任一不过报 `image_invalid`；`console/images.js` 的 `chooseImages` 在**选图当下**先做一轮同样的魔数 + `createImageBitmap` 深度校验（早于 `upload.js` 的权威校验，让用户当场知道选错了），数值不变。附件就绪靠「composer 锚点附近可见节点快照 diff + 400ms 稳定 + `role=alert` 错误文案检测」判定，**不是 sleep 等**；未给 deadline 时默认 15s 上限。

**这三个数字有九处落点，改一个就要全改**（`scripts/test-image-limits.js` 按锚点对账，找不到锚点即红）：扩展 `content/upload.js`（`MAX_COUNT`/`MAX_BYTES`/`TYPES`）、`console/images.js`（`MAX_IMAGE_COUNT`/`MAX_IMAGE_BYTES`/`IMAGE_TYPES`）、`console/console.html` 的 `accept`；Desktop `src/shared/images.ts`（同名三常量）、`src/renderer/image-picker.tsx` 的 `accept`、`src/shared/copy.ts` 的三语 `imageCountError`/`imageSizeError`；再加 `i18n.js` 的 `con_imageAdd`/`con_imageCount`/`con_imageSize`、`README.md` 两处（核心功能与桌面段）、`docs/desktop-m0.md` 的叙述。

## 悬浮控件（`content/pill.js`）

Shadow DOM 三态控件，状态名 **`handle`（贴边把手，默认）/ `always`（常显）/ `hidden`（隐藏，仅快捷键）**，真值在 `chrome.storage.local` 的 **`displayMode`** 键。popup 与设置页改动经 `storage.onChanged` **实时生效**，这是跨页面契约，不要改成只在页面加载时读一次。该键同时出现在 `bg/sync.js` 的 `LOCAL_KEYS` 与 `bg/data-admin.js` 的重置清单——新增持久化键要同时登记多处，它是现成范例。

## 通用编写原则

- **模型名匹配语言无关**（Fable / Qwen / K3 / GLM…），**UI 词必须中英双写**（`/Expert|专家/`、`/^(high|高)$/i`）；zh/en 之外不承诺，靠诊断兜底。
- 锚点优先级：`data-testid` / 稳定 `data-*` > `aria-*` 语义（role、aria-label、aria-checked/pressed）> 中英双写文本 > 结构位置。**禁止**用生成类名、`nth-child`、父子链。CSS-module 类名（元宝 `ThinkSelector_selected`、千问 `thinkingContent`）只能用 `[class*=]` 前缀匹配。
- **国产站常拒绝合成事件**（`isTrusted=false` 被忽略）：菜单项/radio/toggle 用**原生 `el.click()`**；国际站 Radix/Material 菜单用 pointer 事件序列 `openMenu()`。
- **`clickEl` 用 `detail:1` 拟真**：真实点击 `detail=1`，`el.click()` 与裸构造是 0——Kimi 新首页按 `detail===0` 过滤机器人点击（真机 2026-07-21）。
- **控件正在下沉到二级子菜单**（2026-08 两轮改版的共同形态）：顶层只留当前值，完整列表进子菜单。写新逻辑默认「顶层找不到 → 找子菜单入口 → 展开 → 再找」，别假设一层列表。
- **同一页面里不同语义的列表可能共用同一个 role**：ChatGPT 的 Model 与 Effort 子菜单都是 `[role=menuitemradio]`。取档位必须校验文本属于**档位标签集**，且整份列表只要带模型名就判定为模型菜单并拒绝使用——否则「最高档」会被点成末位模型。
- **每个菜单动作自己收尾**：菜单不关会罩住输入框，也会让后续动作点空（选完模型再点 Effort 只是把它关掉）。**但 `escMenus()` 不是万能的**——2026-08-31 真机实测：Claude(Base UI) / ChatGPT(Radix) / 元宝 / 豆包 的菜单 Escape 有效；**Gemini、智谱、Kimi 三站 Escape 关不掉**（Gemini 连点 backdrop 都没用；Kimi 只收得掉 effort 子菜单、收不掉根菜单），这三站各自实现了 `_close()`：先 `escMenus()`，仍开着就**再点一次触发器/入口**。给新站写收尾时先真机验一次「Escape 到底关不关得掉」，别默认。
- **档位控件不一定是列表**：ChatGPT 2026-08-31 把 radio 列表换成了滑块（键盘左右方向键驱动，`End`/`Home` 无效）。遇到「菜单开着但一个可选项都找不到」，先找 `[role=slider]` / `aria-keyshortcuts` / `data-*-slider`，再断定控件消失。
- **有状态控件先读后点**（幂等）；菜单可能一次打不开，`openMenu` 要允许重试第二次；开关切换会重渲染，重渲染后的选项必须 `waitFor` 重取。
- **站点常有宽窄两种布局**：Claude 窄屏是 Adaptive thinking 开关、宽屏是 effort 子菜单；Gemini 窄屏模型按钮无 `aria-haspopup`。适配器须双布局兼容。
- **文案可能含零宽字符**（Claude 的 "Max" 实为 4 字符）：用 contains 匹配，别用 `^...$` 配长度。Kimi 适配器专门有 `_zap()` 去零宽字符。

## 站点卡（改某站只读这一张）

### Claude（`claude.ai`，`content/adapters-intl.js`）

- 档位：think = `_selectModel(/fable\s*5/i)` + `_setEffort()`（**取在场最高档**，当前是 Max）；fast = **只跑 `_selectModel(/sonnet\s*5/i)`**，不碰 effort（用该模型自身默认设置，别把 Fable 的最高档强加给快档）。`state()` 读 `[data-testid="model-selector-dropdown"]` 的 aria-label：嵌入锁定或空 → null；含 `sonnet|haiku` → fast；不含 `fable|opus` → null；命中 `_THINK`（`adaptive|high|extra|max|高|最大`）→ think；含 `\blow\b|低` → fast；形如 `(fable|opus)\s*[\d.]+$`（窄屏思考关、无后缀）→ fast；其余 null。aria-label 现为 **`Model: Fable 5 · Max`**（分隔符 U+00B7，真机 2026-08-31）。Anthropic 换代时同步 `fast()`/`think()` 的模型正则。
- **effort 的两个 testid 已消失（2026-08-31 真机）**：`effort-menu-trigger` / `effort-option-*` 全没了，Base UI 菜单只剩自动生成 id（`base-ui-_r_*`），全菜单只剩 `chat-input` 一个 data-testid。入口退化成文本为 **`EffortMax`**（`Effort` + 当前档）的 `[role=menuitem][aria-haspopup=menu]`，按 `/^(effort|强度|思考强度|努力)/i` 找；档位项是子菜单里的 `menuitemradio`，精确文本 **`Low` / `MediumDefault` / `High` / `Extra` / `Max`**（Extra、Max 是本次新增的两档）。
- **档位项与模型项同为 `menuitemradio` 且同时在 DOM**（顶层 4 个模型 + 子菜单 5 个档位），`_effortItems()` 做**两层语义校验**：① 所属 `[role=menu]` 的 `aria-labelledby` 必须指回 effort 入口的 `id`；② 文本须命中 `_EFFORT` 档位标签集（由低到高的有序表）。少一层都会把「最高档」点成模型——一个叫「Max Preview」的模型就能骗过纯文本校验。`_setEffort()` 取 rank 最高的一项（撤掉 Max 自动退 Extra，再撤退 High），点完 `waitFor` 复读 `_label()` 命中 `_THINK` 才算成功，否则抛「Claude: 目标 effort 未生效」。
- **「无 effort 入口静默 return」的例外已撤销（2026-08-31）**：控件仍在，只是选择子变了；入口缺失 / 档位为空一律 throw。旧的 `_thinkSwitch()` 裸开关分支同时删除（真机已无该开关）。
- **模型菜单已下沉（2026-08）**：顶层保留 Fable 5 / Opus 5 / Sonnet 5 / Haiku 4.5，其余进「more models / 更多模型」子菜单，`_selectModel` 顶层等 900ms 找不到才展开子菜单；选中后 `sleep(700)` + **`escMenus()`**（子菜单不关会罩住输入框并让后续动作点空；Base UI 菜单 Escape 有效，与 Gemini/智谱/Kimi 三站不同）。
- 发送键 `button[data-testid="chat-input-send"]`（真机 2026-08-31；`aria-label="Send message"` 随界面语言变，只当兜底），原生 click 有效；此前「拒绝合成点击」的结论是误判——当时点的是侧栏同名假按钮（见发送路径表）。**两个已知坑**：侧栏每条会话的 `More options for <标题>` 按钮标题含 send/发送 时会匹配同一选择器且纵向落在带内（真机带内 9 个）；长提示词把 ProseMirror 撑高后发送键会跌出旧的 240 纵向带（15 行即失效）。两者都由 `content/send.js` 处理。停止键 testid 是 `chat-input-stop`（`stop-button` 是 ChatGPT 的形状，Claude 上零命中）。`answer()` 取末条 `.font-claude-response` → `.row-start-2`（折叠的思考头在 `.row-start-1`），取不到回退整块。`attach` 走 `input[data-testid="file-upload"]` + `S.setInputFiles`。

### ChatGPT（`chatgpt.com`，**`content/adapters-intl2.js`**）

- **本站单独一卷**：`adapters-intl.js` 触及 300 行上限后按站分卷，ChatGPT 移到 `adapters-intl2.js`（Claude / Gemini 留在 `adapters-intl.js`）。分卷的五处登记见本文「加新站点」与文末分卷说明。
- 档位：think = `_selectModel(/^GPT-5\.6\s*Sol$/i)` + `_pickEdge(true)`（滑块推到**最右端** = 最高档）；fast = 同模型 + `_pickEdge(false)`（推到最左端）。**不写死档位标签**，站点加减档自适应。`state()`：pill 为空或命中 `_OPEN_PILL`（`thinking effort|思考(强度|力度)?`）→ null（**菜单开着时 pill 显示的是控件名，不是档位，属非终态**）；`_tier()`（先剥版本前缀 `/^(?:gpt-?)?5\.[3456](?:\s*sol)?/i`）命中 `instant|medium|极速|即时|均衡|中` → fast；原始文本命中旧模型 `(?:gpt-?)?5\.[345](?!\d)|\bo3\b` → null（不许冒充 5.6 的 think）；命中 `high|pro|高` → think；其余 null。
- **2026-08-31 改版：档位从 radio 列表换成一根滑块**。菜单是 Radix popper `[data-testid="composer-intelligence-picker-content"]`，里面**没有任何 `aria-haspopup` 子菜单入口**——旧的 `_openEffort()`/`_tiers()` 因此永远找不到档位列表，think/fast 双双抛错而 `diagnose()` 全绿（本次事故的表象）。现结构：① `[role=menuitem][aria-label="Select model"]`（文本是当前档名）；② `[role=menuitem][aria-label="Power"]`，`aria-keyshortcuts="ArrowLeft ArrowRight"`，内含 `[data-model-reasoning-effort-slider]` 与一个 `[role=slider]`（`aria-valuenow/min/max` = 当前位次 / 0 / 4）。
- **档位真值只认位次「X of N」，不认档名**：0–3 档的档名不在任何可选中节点上，只出现在 Power 项 `aria-describedby` 指向的朗读文本里（`Pro, 5 of 5.` / `Use Left and Right arrow keys to adjust power.`）。`_level()` 先读 `[role=slider]` 的三个 aria 数值，读不出才回退正则解析那句朗读文本。位次映射（真机实测全表）：0=Instant / 1=Medium / 2=High / 3=Extra High / 4=Pro。
- **切档靠键盘，且只有左右方向键有效**：`_pickEdge` 聚焦 Power 项后逐格发 `ArrowRight`/`ArrowLeft`（`KeyboardEvent` 必须 `bubbles:true`），每格 220ms、循环上界 = 档位数，端点会饱和不越界。**`End` / `Home` 真机实测无效**（值纹丝不动），不要拿它们省循环。收尾比对 `lv.now === goal`，不等就抛「ChatGPT: 档位未到端点」。
- **模型 radio 常驻菜单**：Advanced 视图（`composer-model-picker-slider-advanced-view`）不必展开也在 DOM，`GPT-5.6 Sol`(checked) / `GPT-5.5` 两项随时可取。`_selectModel` 先直接找，找不到才点 `aria-label="Select model"` 入口；**已 `aria-checked=true` 就直接返回不点**（点了会连带把菜单收掉）。
- 档位锚点 `_anchor()` 改成**纯选择子** `button.__composer-pill[aria-haspopup="menu"]`（真机实测全页精确 1 个）。**不许再做文本前置校验**：新 UI 的 pill 在菜单开着时是控件名，带文本校验的 `_anchor` 会当场返回 undefined。`diagnose()` 两项因此天然独立——「入口项红」= 按钮真没了，「档位项红」= 标签集漂移或 pill 读不出。
- `answer()` 取 `[data-turn="assistant"]` 末条 → `.markdown`（旧内层 `[data-message-author-role="assistant"]` 兜底）。`attach` 走 `#upload-photos`。唯一实现 `stop()` 的站（`[data-testid="stop-button"]`，回退 aria-label 含 stop answering/streaming/generating 的按钮）——**目前无调用方**。
- **改中文档位词前必须先真机确认**：`_OPEN_PILL` 与 `_power()` 里的中文候选（思考强度 / 强度 / 力度）都是直译，未经中文界面真机验证。

### Gemini（`gemini.google.com`，`content/adapters-intl.js`）

- 档位：think = `_selectModel(/3\.1\s*pro\b/i)` + `_setThinking(/^(extended|扩展)/i)`（开）；fast = `_selectModel(/\b\d+(?:\.\d+)?\s*flash\b(?!\s*-?\s*lite)/i)` + 同项**关**。
- **快档模型正则必须版本无关**（2026-08-31 事故）：菜单从 `3.6 Flash` 换成 `3.7 Flash`，写死版本号的旧正则当天让整站 `fast()` 抛「未找到模型」。现按「任意版本号 + Flash、且不是 Flash-Lite」匹配，后瞻同时挡住 `Flash-Lite` 与 `Flash Lite` 两种写法——**Lite 是更弱的另一档，绝不能被当成快档选中**。think 侧的 `3.1 Pro` 与 Extended thinking 开关不动。
- 菜单项实测（2026-08-31）：`3.5 Flash-Lite Fastest answers` / `3.7 Flash All-around helpNew` / `3.1 Pro Advanced reasoning`(selected) / `Extended thinking Complex problem solving`。当前选中项带 `.selected` 类，鼠标高亮项带 `.active` 类——**判选中只能看 `.selected`**。
- **`escMenus()` 对本站无效**（2026-08-31 真机：Escape 与点 `.cdk-overlay-backdrop` 都关不掉，`aria-expanded` 一直是 `true`），**只有再点一次触发器才收**。所有收尾一律走 `_close()`：先 `escMenus()`，仍开着就 `clickEl(_modelBtn())`。菜单不关会罩住输入框、让随后的注入点空。`_selectModel` / `_setThinking` 的每条出口（含 throw 前）都已改走它。
- 模型按钮 `_modelBtn()`：先找 aria-label 含 `mode picker` 的 button，回退 `button[class*="input-area-swi"]`（窄屏模型按钮无 `aria-haspopup`）。菜单项选择子常量 `_MI = "button.mat-mdc-menu-item, [role=menuitem]"`；菜单可能要 `openMenu` 两次。
- **`_MI` 必须过 `_items()` 只取可见项**（2026-08-14 真机）：页面常驻一个隐藏的导出菜单（`gv-pm-saved-export-menu gv-hidden`，含 JSON / Markdown 两个 `[role=menuitem]`）。老写法 `if (!document.querySelector(this._MI)) openMenu(btn)` 因此恒判「菜单已展开」，**模型按钮从来没被点开过**，随后在 `[JSON, Markdown]` 里找 Flash 自然抛「未找到模型」。开菜单改用 `aria-expanded !== "true" || !this._items().length` 判定，找项一律走 `this._find(re)`。
- **`state()` 按模式名判粗档位，不是复合条件**：aria-label 现为 `Open mode picker, currently <Mode>`（切到深度思考后是 `currently Pro Extended`）。判定顺序是 `flash` → fast，否则 `\bpro\b|extended|扩展` → think，其余 null——aria-label 不报 Extended thinking 开关状态，所以不能拿它证明思考已开；`think()` 仍会幂等地把 Extended thinking 一并打开。
- `_setThinking` 双布局：当前布局是模型菜单里的直达开关（按 `.selected` 类或 `aria-checked` 幂等点击）；旧布局走 `/thinking level|思考(等级|程度)?/i` 嵌套子菜单，最多重开子菜单（`openMenu(trig)` 指针序列，**不是 hover**——重发 hover 那招是 Kimi 的，两站机理不同别互抄）并重取目标项 6 轮，命中后先 `focus()` + Enter keydown 再 `clickEl`。**子菜单在但目标等级缺失必须抛「Gemini: 思考等级选项未找到」**；整段子菜单缺席才算合法静默跳过。
- **有意不实现 `attach`**（Gemini 忽略合成 drop，附件菜单要求可信点击且不保留 file input）。`answer()` 取末个 `message-content` → `.markdown`，回退整块。
- 中文界面报「切不动」时，先真机核对「扩展」这个标签再改正则——英文 Extended 已真机确认，中文是直译候选。真机探测坑（同 URL 双 page target；**批量刷新站点标签可能触发 Google「unusual traffic」验证码插页**）见 `docs/verify.md`「探测坑」。

### DeepSeek（`chat.deepseek.com` / 适配器键 `deepseek.com`，`content/adapters-cn.js`）

- 档位：think = `_selectMode(/Expert|专家/)` + `_setDeepThink(true)`；fast = `_selectMode(/Instant|快速/)` + `_setDeepThink(false)`；另有图片专用档 `thinkImage`/`fastImage` = `_selectMode(/Vision|视觉/)` + DeepThink 开/关（九站唯一实现图片档的站）。
- **`state()` 优先读常驻 composer 的 DeepThink 开关**（`aria-pressed` true→think / false→fast），开关不在时才回退首屏 radio（`aria-checked` 的那项，`Expert|专家`→think、`Instant|快速`→fast、其余 null）。radio 在首条消息后从 DOM 消失（真机 2026-07-11），只读 radio 会整个对话期恒 null——pill 高亮熄灭、巡检误报红、二轮切档失去真实确认。**`diagnose()` 也有意不列这个 radio**，否则聊天中恒红误报。
- DeepThink 开关锚点：文本含 `deepthink|深度思考` 的 `.ds-toggle-button`，按 `aria-pressed` 幂等；**开关缺失即抛异常**（常驻 composer，静默 return 会让 runMode 误报成功）。点击后**复读 `aria-pressed`**，未生效抛「DeepSeek: DeepThink 未生效」。模式 radio 用 `findByText('[role="radio"]', re)` 且**只能用原生 `el.click()`**（开关走的仍是 `clickEl` 合成序列；「站点拒绝 `isTrusted=false`」这条旧论据其实不成立——`el.click()` 同样是 `isTrusted=false`，要换成原生 click 得先真机验证）。
- 发送键见发送路径表：图片处理期间只加 `ds-button--disabled` 不设 `aria-disabled`，必须等真正可用（`submit(el, deadline)` 的 deadline 就是为此）。
- `answer()` **从后往前遍历** `.ds-message`，直到找到第一条含非思考 `.ds-markdown` 的消息才返回（用户消息容器也是 `.ds-message`，靠这个回退跳过）。**别简化成 `msgs[msgs.length-1]`**。`attach` 走常驻 `input[type="file"][accept*=".png"]`（2026-07-23 真机：接受合成 change，上传后预览 `img.alt` 保留文件名）。

### 豆包（`www.doubao.com` / 键 `doubao.com`，`content/adapters-cn.js`）

- 档位：think = `_select(/专家$/, "think")`、fast = `_select(/快速$/, "fast")`。**锚定的是后缀不是前缀**——菜单项实测带品牌与版本前缀（`豆包 2.1 Turbo 专家`），写成 `/^专家/` 会一项都匹配不上。**只切 composer 模式按钮的菜单项，无独立思考开关、无模型选择。**
- `state()` 读模式按钮文本：`/专家$/` 或 `/^豆包\s+[\d.]/`→think、`/快速$/`→fast、**其余 → null**。「超能模式」是**历史档位**（2026-08-31 真机复核菜单只剩 `豆包 快速` / `豆包 2.1 Turbo专家` 两项），`state()` 里**没有它的判定分支**：它若回归会落进「其余 → null」，表现为 HUD 不亮、`switchTier` 一直重试到超时。`^豆包\s+版本号` 这条分支是因为选中专家档后按钮只回显 `豆包 2.1 Turbo`、后缀被吃掉（真机 2026-08-26）。
- `_select(re, expected)` 的第二参是**幂等短路的判据**：先 `state() === expected` 就直接返回，不开菜单。改档位正则时两个参数要一起对，只改正则会让短路永久失效（每次群发都白开一次菜单）。`_modeBtn()` 从候选中取离 composer 最近者，避免撞到侧栏标题；`_select` 最多 3 轮，`openMenu` 展开后对 `[role="menuitem"]` 用**原生 `item.click()`**，每轮 `escMenus()`；按钮缺失或 3 轮未选中都抛异常。
- `answer()` 从 `[data-message-id]` 中过滤掉自身或子节点带 `justify-end` 的用户消息（AI 消息无右对齐），取末条 → `.md-box-root`。`attach` 走 `input[type="file"][accept*="png"]`。
- 渲染会**在中英文与数字之间插空格**——marker 匹配先去空白再比。

### 千问（`www.qianwen.com` / 键 `qianwen.com`，`content/adapters-cn.js`）

- 档位是**两档各自换模型**，不是只切开关：think = `_selectModel(/Qwen3\.7-千问(?!-Max)/i)` + `_setThink(true)`（思考研究档）；fast = `_selectModel(/Qwen3\.8-Max(?!-Preview)/i)` + `_setThink(false)`（快速档）。
- **`state()` 是复合条件**：思考按钮缺失 → null；开关开且模型文本命中 `/Qwen3\.7-千问(?!-Max)/i` → think；开关关且模型命中 `/Qwen3\.8-Max(?!-Preview)/i` → fast；**开关与模型不匹配的任意组合 → null**。只切开关不换模型会判不出档。
- 模型触发器 `_trigger()`：先找 `[aria-haspopup="dialog"]` 且文本含 `Qwen3` 的节点；找不到回退按可见文本找最内层（文本以 Qwen3 开头、长度 ≤25、子节点 ≤3 的 div/button/span 取最后一个）——**`aria-haspopup` 由前端延迟水合**，新加载页一段时间内只有纯文本节点。
- **`_selectModel` 必须先读后点**：触发器自身的常驻文本会骗过「菜单已开」判定，leaf 又抓到触发器本身，点下去反而打开模型对话框（真机 2026-07-21：fast/think 同模型时每次切档都踩中，靠 Escape 兜底，慢且脆弱）。选中项要沿 `parentElement` 上溯最多 5 层找带 onclick / `role=option|menuitem` / `LI` 的可点祖先，都没有才点 leaf。结尾**复读 `_trigger()` 校验**，文本仍不命中目标正则就抛「千问: 模型未生效」——点击被站点吞掉时静默成功会弹假绿 toast。可见性过滤与对话框容器收窄尚未做（要动先真机）。
- 思考按钮 `_thinkBtn()`：优先可见的 `button[aria-haspopup="menu"]` 且 aria-label/文本命中 `/^(快速|思考研究|Fast|Thinking Research)$/i`；回退到内部 span 或自身文本为 `/^(思考|Thinking)$/i` 的旧版裸按钮。`_setThink(on)` 先读后点，新版派发 pointerdown 后在可见 `[role="menuitemcheckbox"]` 里原生 click 目标项，收尾复读校验，未生效抛「千问: 思考开关未生效」；按钮缺失即抛（常驻 composer）。**三条路径（选项未找到 / 成功点击后 / 复读失败前）都各自 `escMenus()` 收尾**，残留菜单会罩住输入框让随后的注入点空。
- 受控编辑器，走 core 的 `beforeinput` 注入。`answer()` 取末个 `.answer-common-card` 内、排除祖先 `[class*="thinkingContent"]` 后的最后一个 `.qk-markdown`（思考段与正文同为 `.qk-markdown`，祖先类名带 CSS-module 哈希后缀）。**有意不实现 `attach`**（动态 input 需可信菜单点击，合成 drop/paste 被忽略，2026-07-23 真机）。

### Kimi（`www.kimi.com` / 键 `kimi.com`，`content/adapters-cn2.js`）

- 档位（2026-07-21 用户定案）：**think = K3 + Max、fast = K3 + Standard**。模型非 K3 时先 `_select("K3")` 再 `_setEffort`：think 用 `/^(Max|极致|最大|最高|最强)$/i`，fast 用 `/^(Standard|标准)$/i`。**`state()` 要求 `_model()` 严格等于 "K3"**，否则直接 null（K2.6 只有 Standard / High，无 Max 档——这是判断「用户停在 K2.6 时 state() 为何恒 null」的唯一依据）；再看 effort 映射两档，其余 null。中文 UI 的 Max 标签是「极致」（用户实证；chrome-dbg 里站点跟账号语言恒英文，中文标签只能靠用户回报）。effort 切换不导航。
- 锚点：模型入口 `.current-model`（`.name` 读模型名、`.current-effort` 读强度），菜单项 `.model-item`（按 `.name` 精确等值），强度行 `.effort-item`（`.effort-title` 命中 `Thinking|思考|推理`），子菜单项 `.effort-option`（`.effort-name`）。**读到的每一处文本都先过 `_zap()` 剥零宽字符再比**——`_model()` 与 `.model-item` 的比对同样要过（此前只有 effort 两处过，`.name` 带零宽时 `state()` 恒 null、`_select` 抛「目标选项未找到」并把排障误指到 effort）。
- 换模型会 SPA 路由跳 `/agent?chat_enter_method=change_model`（含会话内切换，会离开会话视图）；该面发送**偶发**对真人也失效（真机连可信打字/点击/Enter 都发不出，判断为站点高峰限流禁用对话）。发送失败诚实报 `submit_unconfirmed` 可 retry，**不要因此改掉 K3 映射**。
- **`inject` 必须用 `el.focus()` + 显式 Range 全选 + `execCommand("insertText")`，失败抛异常禁回退**：合成 `beforeinput` 会让 Lexical 的 DOM 与 model 分叉并冻死编辑器（发送键失灵，可信键盘也不再接受）。新开页 focus 后选区未必落进编辑器，要显式设 Range。
- **effort 子菜单的 hover 会丢**：菜单开启动画期间合成 hover 丢失，effort 行节点还会被重挂 → **每轮重新取行、重发 hover（循环 4 次）**，不是单次 hover 后干等；点击被吞时末尾复读 `_effort()` 校验，不许静默成功。
- **K3 档位真机复核（2026-08-31，新开标签验完即关）**：模型项为 `Instant`(checked) / `K3` / `K3 Swarm`；切到 K3 后 `.effort-option` 三项 `Standard` / `High` / `Max`（Max 带「Consumes more credits」）——**现有词表无需改**。K3 下还多出第二个 `.effort-item` 行「Context Length」，合成 hover 打不开它的子菜单、未观察到 `.effort-option` 撞名；即便撞上，末尾复读 `_effort()` 也会拦住错选。
- **`escMenus()` 只收得掉 effort 子菜单，收不掉模型根菜单**（2026-08-31 真机：Escape 后 `.model-item` 仍可见、入口仍带 `.active`），**再点一次入口才整体关掉**。收尾统一走 `_close()`：`escMenus()` → 入口仍带 `.active` → 再 `click()` 一次入口。`_select` / `_setEffort` / `attach` 的每条出口（含 throw 前）都已改走它。
- 唯一实现 `submitted(text)` 的站（比对末条 `.chat-content-item-user` 的 `.user-content`，去零宽 + 折叠空白后与原文等值）——Kimi 发送后会重挂页面/隔离世界，bg 只对它敢自动重试一次。`answer()` 取末个 `.chat-content-item-assistant` 内、排除 `.thinking-container` 后的最后一个 `.markdown`。`attach` 用 `input.hidden-input[type="file"]`，没有就先点 `.toolkit-trigger-btn`，再按 deadline 剩余预算夹取等待（`Math.min(1500, deadline-now)`），**无论取到与否都 `escMenus()` 收尾**。**动 Kimi 图片路径前先真机跑一次 `attach`**——最近一次验证时间未记录，别默认它还能用。

### 元宝（`yuanbao.tencent.com`，`content/adapters-cn2.js`）

- 档位（2026-08-26 新版）：composer 的 `button[aria-label="Switch model"]` 菜单包含 Instant / Thinking / Expert，映射 **think = Thinking、fast = Instant**；Expert 属工具执行档，`state()` 有意返回 null。`_selectMode` 先读后点，经 `[role="menuitemradio"]` 选择并复读按钮确认，关键控件缺失或切换未生效均抛异常。中文的「切换模型 / 思考 / 深度思考 / 即时 / 快速」只作双语兼容候选，英文标签已真机确认。
- **新增 Models 子菜单（真机 2026-08-31）**：菜单里多了一个 `[role=menuitem]` 「Models」（文本尾缀是当前模型，如 `ModelsHy3`），展开后 `Hy4 preview` / `Hy3`(checked) / `DeepSeek` 三项**与模式项同为 `[role=menuitemradio]`、同时在 DOM**。`_selectMode` 因此加了 `_isMode()` **两层语义校验**：① 模型列表那层菜单带 `aria-label="Model list"`、模式那层没有 aria-label —— 先按容器整个排除模型列表；② 再要求文本命中 `_MODES` 模式标签集。只做文本校验挡不住「模型取名叫深度思考版」，只做容器校验挡不住站点把模型塞进同一层，**两层缺一不可**。适配器**不选模型**，停在哪个用哪个。
- 旧版 `[class*="ThinkSelector"]` 深度思考 toggle 仍作为 A/B 回退（只有新版模式按钮整个不存在时才走），开态判据为 className 含 `ThinkSelector_selected`；点击后**同样复读 `_isOn()`**，未生效抛「元宝: 深度思考未生效」——新版分支本就有复读，旧版此前是全站唯一遗漏的静默成功路径。新版发送键是非 button 的 `[aria-label="Send"]`（中文回退 `[aria-label="发送"]`），disabled 时返回 false；旧 `.icon-send` 已下线。
- `inject` 无（真机实证 `beforeinput` 不生效、`execCommand` 生效，由 core 既有回退链覆盖）。`answer()` 取末个 `.agent-chat__conv--ai__speech_show` 内、排除 `[class*="cot__think"]` 后的最后一个 `.hyc-common-markdown`（**不排除就把思考全文混进汇总复制**）。`attach` 是九站唯一走 `S.dropFiles(el, files, el, deadline)` 拖放路径的站。

### 智谱（`chatglm.cn`，UI 标签「智谱」，站点全名智谱清言，`content/adapters-cn2.js`）

- 档位：think = `_pick("极致", true)`、fast = `_pick("快速", false)`。**「极致」是 2026-08-31 新增的最强档**（描述「全力推理，耗时更长」），think 从「深度」升到它；`_TIERS = ["极致","深度"]` 由强到弱，站点撤掉极致时 `think()` 自动降级点「深度」（不是抛错——深度仍是可用的思考档）。
- **弹层现在分两段**（真机 2026-08-31）：**模型段**（`GLM-5.3` / `GLM-Flash`，后者描述「5.3-Flash，回复速度快」，当前选中）+ **档位段**（`快速` / `深度` / `极致`），两段**同为 `.think-mode-item`**。`.has-submenu` 那一项是档位段的父项，其名随当前档变。
- **适配器不选模型**：当前停在哪个模型就用哪个。`_itemByName` 排除 `.has-submenu` 后按 `.item-name` **精确等值**取项，现有六个名字互不重叠——站点若把某个模型改叫「快速」之类，这里会当场错位，要立刻改。
- `state()` **只读不开菜单**（弹层关闭时菜单项仍在 DOM，只是 rect 归零）：`_TIERS` 里任一项带 `selected` → think（**极致 / 深度都算**）、「快速」带 selected → fast，**其余（含「标准」若回归）→ null**。
- 选档序列（chrome-dbg 实测）：hover + click `.think-mode-trigger` 开弹层 → `sleep 350` →（档位档）hover `.think-mode-item.has-submenu` → `sleep 300` → 原生 click 目标项 → `sleep 500` + `_close()` → **复读只读判据 `_selected(name)`**，未命中抛「智谱: 档位未生效」。触发器缺失直接抛；目标项未找到时先 `_close()` 再抛。`_hover()` 需连发 pointerenter/mouseenter/pointerover/mouseover 四种事件。
- **脆弱点（必读）**：合成 hover 在真机上**并不真的展开子菜单**（档位项 rect 恒 0），只是靠 `.click()` 仍能触发 Vue handler 才碰巧能用。收尾的 `_selected()` 复读是唯一防线，**别把它删了**；哪天站点改成「不可见就不响应点击」，这里会立刻整档失效。
- **`escMenus()` 对本站无效**（2026-08-31 真机：Escape 关不掉 el-tooltip 弹层），**再点一次触发器才收**。收尾走 `_close()`：`escMenus()` → 仍开（按 `.think-mode-item` 的 rect 判）→ hover + click 触发器。弹层不关会罩住输入框让注入点空。
- 无 `submit`，靠通用链（先试标签按钮，实际靠 Enter，textarea 可发）。`answer()` 取末个 `.answer-content` 内、排除 `.text-advance-thinking-content` 后的最后一个 `.markdown-body`。**有意不实现 `attach`**（站点 input 忽略扩展派发的 input/change，且无可复用预览节点）。
- **加载极重**：水合期（~30s）连扩展消息都无响应，安定后正常。真机验证要新开标签 + 长等待。

## 站点改版应对剧本（修复流水线）

触发源按可信度排序：用户诊断报告（scope 窗「复制诊断报告」，自带 dpr/UA）＞ 巡检红 / `scripts/probe-drift.js` 变化提醒 ＞ 哨兵 issue（label `release-watch`——只代表官方发了公告，不代表 UI 已变）。

1. **定层**：真机复现，记下现象与 `code`，先确认坏在哪一层——未注入 / composer / inject / submit / state / answer（用户报障按「四问」问齐）。probe-drift 的可操作信号（`!` 警报）：「检查转红」「composer 消失/尺寸突变」指向 composer/菜单层，「标签串 → ∅」指向 state 层或适配器方法改名；state/标签串的普通变化多是手动切档的使用痕迹（探针已归入 `~` 参考档，别当漂移追）。
2. **取证**：`node scripts/capture-evidence.js <hostSub> base` 抓基线清单；人工在浏览器里展开目标菜单后换个 tag 再抓一份，两份 diff 即得「展开后才存在」的锚点候选（菜单/发送链路类根因必需）。产物在 `scratchpad/`，**外发给任何模型前先人工过目**（隐私规则见脚本头注释）。
3. **提案**（可交给 LLM 生成，人审兜底）：按证据改锚点。硬性护栏逐条过——判定阈值留 ≥20% 余量；锚点优先级 data-testid ＞ aria/role ＞ 中英双写文本（见「通用编写原则」）；同 role 列表先校验语义；缺控件 throw 不静默（例外只有上文 3 处）；不碰 `submitted()`/自动重发铁律；**只改锚点，不动错误码协议与编排契约**——协议稳定性是这个仓库最贵的资产。
4. **离线回归**：补/改对应 `scripts/test-*.js`（改模型正则按惯例配专项测试），`bash scripts/verify.sh` 全绿。
5. **人审 diff → 真机回归**：重载扩展 + 刷新站点标签，生产 `__AMS` 复现，九站巡检（`diagnose` 就是现成的 canary；「入口项」与「档位可读」是两个独立信号，只红后者 = 标签集漂移，别去找按钮）；再跑一次 probe-drift 确认标签串与检查项回到预期。
6. **收尾**：更新本文件对应站点卡 + `CHANGELOG.md` 未发布段；模型正则改了同时检查 `state()` 的判定分支。
