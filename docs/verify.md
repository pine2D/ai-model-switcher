# 验证：离线回归 + Desktop 真机

**离线回归清单、测试写法（源码字符串断言 / 模块相对路径 / 共享夹具）、Desktop 开发态真机流程、工具与坑都在这里**；`CLAUDE.md` 只留门禁命令和「改适配器/切档/发送必须真机复现」一句硬约束。冲突以 `CLAUDE.md` 为准。

**顺序不能反：先离线（`bash scripts/verify.sh` + `cd desktop && npm test && npm run typecheck`），再真机。** 反过来会得到「真机试通了但 CI 红」的返工。

## 离线回归

**两条互不重叠的门禁，顺序与职责写死**：`bash scripts/verify.sh` 是零 node_modules 依赖的仓库级卫生（`.js/.mjs` 语法、JSON、`.js` 300 行、`desktop/src` 的 `.ts/.tsx` 400 行棘轮、OAuth 凭据卫生、文档与 `.github` 引用、workflow YAML、根 `scripts/` 的五个跨端测试）；`cd desktop && npm test` 是 Desktop 门禁（首段 `tsc --noEmit`，其后 `tsx --test` 跑 `test/**/*.test.ts(x)`、`node --test` 跑 `scripts/*.test.{js,mjs}`——九站适配器那 **12 份**离线回归就在后者里）。`verify.sh` 不跑 `npm test`，两条都要过；`npm test` 首段虽已含 typecheck，仍单跑一次 `npm run typecheck`（CI 也分两步，失败点更清楚）。动窗口/视图/preload 的改动另加 `xvfb-run -a npm run smoke -- --skip-package`。

- 三处的测试都是**对源码字符串做断言的 node 脚本**（`readFileSync` + 正则 / `indexOf` / `vm.runInNewContext`），无构建无框架；`desktop/test/` 只是同一套手法走 TypeScript。改 UI 的 class/id/顺序/CSS 数值都可能打断看似无关的测试。`verify.sh` 另跑 `node --check`、JSON parse、两档行数门禁、Desktop OAuth 凭据卫生、文档引用与测试登记检查、workflow YAML 解析、`git diff --check`。
- **workflow YAML 检查**优先用 `actionlint`（连 `runs-on` 拼错、`needs` 指向不存在的 job 都查），没装则退化到 python3 + PyYAML 的纯语法解析，两者都缺时打印警告跳过（不阻断 verify）。本机想拿最强校验就装一个 actionlint（apt/brew 都有）——YAML 错误只能在推 tag 后由 GitHub 暴露，而 tag 不可覆盖 = 烧掉一个版本号。
- **读源码一律走模块相对路径，禁止 cwd 相对**：`desktop/test/` 的守卫测试用 `test/fixtures.ts` 导出的 `readSource("src/main/view-manager.ts")`（内部按 `__dirname` 拼出 `desktop/` 根）；`desktop/scripts/*.test.js` 用同形状的 `source()` helper 指向 `../src/site-runtime`。裸 `readFileSync("…")` 会让同一份测试从仓库根跑绿、从 `desktop/` 跑红，是历史上最费时间的一类假绿。
- **共享夹具放 `desktop/test/fixtures.ts`，不要从 `*.test.ts` 里 import 夹具**：`tsx --test` 每个用例文件一进程，从别的 `*.test.ts` 取夹具会把那个文件的 `test()` 在每个引用方各注册一遍（曾让 4 例跑 5 遍）。`fixtures.ts` 故意不以 `.test.ts` 命名，就是为了不被 glob 捡走；`readSource` / `archiveFixture` 都在那里。
- **站点表与注入清单只有两处真源**，由 `desktop/scripts/lib/desktop-anchors.js` 的 `desktopSites()` / `preloadRequires()` 统一抽取，根 `scripts/` 与 `desktop/scripts/` 共用——**别各自写正则**，抽错了两边会一起假绿。
- **每个 fix 必须留一个可离线跑的回归。** 适配器与主进程改动无法在 CI 复现真机，所以回归的形式是：把出事那一刻的 DOM / 消息流做成假对象喂给源码。站点侧模板看 `desktop/scripts/` 的 `site-send-runtime.test.js`、`send-runtime.test.js`、`intl-runtime.test.js`、`image-runtime.test.js`、`md-runtime.test.js`（自带最小 DOM 桩）；主进程侧看 `desktop/test/broadcast-submit-recovery.test.ts`。真机验证**不能替代**它——只有它能防住下一个人改回去。
- **新测试的登记口径两端不同，别串**：根 `scripts/` 的五个跨端测试仍走 `verify.sh` 的登记自查（每个 `scripts/test-*.js` 都要在脚本里有一行 `node scripts/test-<名字>.js`，否则直接红；确属被别的用例 `require` 的，加一行 `# verify-skip: <路径> <理由>`——理由不能省，脚本按 `verify-skip: <路径> `（含尾空格）匹配）。`desktop/scripts/*.test.js` 与 `desktop/test/*.test.ts(x)` 由 `npm test` 的 glob 自动收，**不需要也不能**登记进 `verify.sh`——登记了会因为路径不在根 `scripts/` 而直接红。
- **`CLAUDE.md` 路由过去的 `docs/*.md` 少一份是纯静默事故**（读文件失败不报错，下个会话空手上阵）。`verify.sh` 从 `CLAUDE.md`、`README.md`、`CHANGELOG.md`、**已入库的** `docs/*.md` 正文里正则提取所有 `docs/*.md` 形式的引用，逐个断言存在且非空、**且已被 Git 跟踪**——只判「工作区存在」会让本机留着未 `git add` 的同名文件时假绿，而 CI 走干净 checkout 才红，卡在一个本机复现不出的失败上。新增引用自动纳入，不用维护清单；反过来，正文里别写 `docs/` 加真实文件名样式的占位符，会被当成真引用（占位用 `docs/<名字>.md`）。
- **站点两处登记已有防线**：`scripts/test-site-selection.js` 双向对账 `desktop/src/main/sites.ts` 的九站 `{key, host, label}` 与 `desktop/src/preload/site.ts` 的 require 列表（适配器分卷清单从后者派生，漏 require 一卷会红），并反查僵尸适配器与孤儿站点；同一份测试还循环断言九站 `think/fast/state/diagnose` 均为 function。加站点漏一处直接红，读断言消息即知补哪份文件。

## 负向对拍

**离线测试写完必须先证明它真的在检查**：改一处真源 → 跑测试 → 必须红 → revert。已验过的模板：

- 把结果库归档校验的 label 上限从 256 收紧到 64 → fixture 校验必须红并**指名被拒的样本**，且归档列表断言仍绿（证明读路径不再二次过滤，收紧只红在显式关口上、不会静默吞记录）。
- 往 `SITE_CODES` 加一个不映射的码 → `npm run typecheck` 必须红；往文案表加一个源码里不存在的 case → 反向断言必须红。
- 从 `desktop/src/main/sites.ts` 删掉一站、或从 `desktop/src/preload/site.ts` 删掉一条 adapters require → `node scripts/test-site-selection.js` 必须红（仍绿 = 锚点没接上，测的是两个空集合相等）。
- 任一 `.ts` 写 `const n: number = "x"` → `npm test` 必红；在 `desktop/test/` 新建子目录放一个 `.test.ts` → 用例总数不得下降（证明 glob 真收得到——文件没被捡到时运行器照样 exit 0）。
- 行数门禁：给越界文件加一行空行必须红（棘轮只降不升）；同一 commit 里连基线一起改才不红。

## 真机环境（Desktop 开发态）

- **真机 = 开发态 Electron**：`cd desktop && npm start`。**改动要重启进程才生效**（主进程、preload、站点运行时都在启动时加载），别在跑着的实例上等热更新，那是最常见的「改了没反应」。
- 复现只认**目标站点视图里的生产 `__AMS`**：站点运行时挂在站点视图的隔离上下文，`__AMS.getState()` / `_isOn()` 是唯一可信断言源。**不要在临时片段里重写正则**——转义会把 `\s` 变成 `\\s`，产生「幽灵失败」（实战吃过亏）。
- **未挂进视图树的站点视图视口恒 0×0**，`findComposer` 恒返回 null。只对当前页格子里的站点下结论，别拿后台视图的探测结果当证据。
- **判「掉登录」要用强证据**：可见头像 / 会话历史列表非空、**没有可见的**「登录/Sign in」按钮文本；弱类名匹配（`[class*=login]`）只能当线索——登录弹窗容器常驻 DOM，在水合窗口里探测必误判（曾据此错判 Kimi 掉登录）。另：Kimi 停在非预设档（如 Instant）时 `state()` 按既有语义返回 null，属正常态不是故障。
- **开发机与用户机不等价**：开发机是 WSL2 + Linux Electron（实测 `devicePixelRatio=1.5`，**不是无缩放**——缩放类量级问题本机可复现；界面英文），用户机是 Windows（缩放比例可能不同、界面可能非英文），layout 数值不同。本机跑通不构成「已修复」的证据。
- **本机复现不出时先要现象、再猜层次**，四问按序问，答案直接落到四层：① 界面语言与显示缩放各是多少？（→ 词表 / 阈值余量）② 点了什么、屏幕上出现了什么？（→ 入口是否被点到）③ 输入框里有没有出现要发的文字？（→ composer / inject 的分界）④ `Alt+H` 站点状态怎么说、把诊断报告贴一份？（→ submit / state）。**没拿到①②就直接猜第三、四层，是返工的标准起手式。**

## 探测坑

- **批量重载站点视图会触发 Google 反滥用插页**：九个视图同时刷新属于短时间集中请求，Gemini 可能被 302 到「unusual traffic」验证码中转页而不是站点首屏。**认它要看当前 URL，不能看 DOM**——此时 composer 与登录锚点全不在场，极易被误判成掉登录或站点改版（同上面的强证据原则）。同一个反滥用中转也是导航策略必须登记 `transit` 域的原因，见 `docs/desktop.md`。
- 站点级的 DOM/时序坑（豆包中英文间插空格、chatglm 水合期 ~30s、Kimi 换模型跳 `/agent`）写在 `docs/adapters.md` 的站点卡里，本节只记真机环境与工具本身的坑。

## 工具

- `xvfb-run -a npm run smoke -- --skip-package`——真实 Electron 起一次，断言 shell=1、九站全部 attached 且 bounds > 0、同一 session 分区、sandbox + contextIsolation + 无 nodeIntegration。它是「preload 的 require 链仍解析」的唯一离线证据（打包期断链在别处不暴露）。
- `npm run soak -- --minutes=<n>`——长跑稳定性；`node scripts/audit-runtime.mjs`（在 `desktop/` 下跑）——Electron 本体的运行时依赖审计，`npm audit --omit=dev` 结构性看不到它（electron 按 npm 惯例永远是 devDependency）。
- `cd desktop && npm run configure-oauth`——用 Development Desktop Client 写出本地 `desktop/resources/oauth.json`，是涉 Drive 真机项的前置（凭据表见 `docs/desktop-oauth-security.md`）。
- 站点 DOM 取证回到**开发态 DevTools 手工看**：菜单展开前后各看一遍、比对差异，得出「展开后才存在」的锚点候选。隐私硬规则不变：侧栏 / 会话列表 / 消息容器整体排除，**产物外发给任何模型前先人工过目**。

## 快捷键链路

Desktop 的加速器分两类：`desktop/src/shared/commands.ts` 的 `COMMANDS` 表（`Alt+K/S/H/Q/T/Y/C/R/N`、`Alt+1..3`、`Alt+←/→`、`CmdOrCtrl+(Shift+)PageUp/Down`、`Control+,`），与**菜单 `role` 项自带的**那批（重新加载、缩放、全屏、撤销/复制/粘贴、退出）——后者不写在模板里、也不在 `COMMANDS` 表里，所以快捷键速查直接从 `Menu.getApplicationMenu()` 读真实菜单，菜单与速查从此不可能漂开。教训：**扫源码字面量的断言全绿 ≠ 用户看到的东西对**。离线由 `desktop/test/menu-shortcuts.test.ts` 与 `keyboard.test.ts` 守；**物理按键仍要人工按一遍**。

## 1.0.0 发版前的真机清单

门禁全绿只是前提。下面每条都在开发态 Electron 上真跑；涉 Drive 的两条先跑 `cd desktop && npm run configure-oauth`。

- **辅助综合**：从结果库发一次辅助综合，目标站应在**数秒内**进入 sending，而不是停在 submitted 走满 44s（终态码按 `timeout` 判读，不是 `composer_not_found`）。
- **本机数据四条**：① 清空提问历史后重启——历史为空、结果库仍在，库里 history 行仍在且 `deleted_at` 非空、outbox 有对应行；② 在一台连了 Drive 的机器上清空后，另一台同账号机器上对应条目也消失（证明 tombstone 真同步过去，不是本机物理删除）；③ 跑一次「重置全部本机数据」，确认 Drive 上的文件未减少、且另一台设备上的未知 host 选择未丢失；④ `Alt+H` 点「复制诊断报告」，粘贴内容含九站 check 的 `name/kind/ok`，不含对话内容与网址。
- **Kimi 提交恢复（最高优先，次序写死不许颠倒）**：第一轮开关 `POLYASK_KIMI_RESUBMIT` 保持默认 `false`，跑下节 F067 的两条硬用例，外加常规①——Kimi 单站发一段长文本，在提交确认窗口（约 3s）内制造 `submit_unconfirmed`，**页面不得出现重复的用户消息**；与常规③——其余八站 `supported:false`，行为不变、原样交用户。两条硬用例通过后，才在**单独一个 commit** 里把开关改成 `true` 并补跑常规②：确实未提交时只重试一次，重试后页面上只有一条该内容的用户消息。未跑或未过 → 开关保持 `false` 发版，`CHANGELOG.md` 不写「自动恢复」。
- **九站带档位群发**：Gemini 深度思考档、千问 / Kimi / 元宝三站的档位切换都成功，且 `Alt+H` 的 `tier` 项可读。
- **界面语言**：系统语言切到 zh-TW 启动一次，`Alt+H` 站点状态面板的 11 条 `diag_*` 检查名必须显示繁体，再切 en 复验；同一轮确认九个站点视图上不再出现横幅。
- **群发主链路**：九站群发一次带档位提问、再一次带图提问（6 个支持图片的站），收尾看一次 `Alt+H` 九站状态（全绿，或只剩 `tier` 提示项）。
- **CI 侧**：推 `v*` tag 前先在 GitHub 上跑通一次 `workflow_dispatch(dry_run=true)`——tag 不可覆盖，流程或 YAML 错一次就烧掉一个版本号。

## 待真机的 23 条

2026-08-31 那轮全仓体检留下 **23 条只能靠真机取证的未闭合项**（9 条「待真机取证后修」+ 14 条「存疑待真机」），编号沿用当时的 `F0xx`。其中一条在原始记录里就没有编号、无从追溯，下面能枚举的是 **22 条**。**每条在 1.0.0 发版前必须落到「已勾掉」或「明确顺延」之一，不留悬空。**

**最高优先——涉「提交不确定 ≠ 可以重发」红线，必须闭合**

- **F067 · Kimi `submitted()` 的空态语义**：新会话（页面无任何用户消息）时 `submitted(text)` 到底返回什么，从未真机确认过；判错就是同一个问题被问两遍。判据是两条硬用例——① 新会话空态下 `submitted(text)` **必须返回 false**；② 末条用户消息是上一轮内容时**必须判「未提交」**（返回 false）。
- **F211 · Desktop 侧 Kimi `wasSubmitted` 恢复**：只读确认已移植进主进程（回包的 `supported` / `ok` 两字段 fail-closed，绝不塌成单个 `ok`——塌了就会对没有 `submitted()` 的八站触发自动重试），重发开关 `POLYASK_KIMI_RESUBMIT` 是模块级常量、**默认 `false`**。判据：关闭态下走完上一节的常规①③；F067 两条硬用例真机通过后，才在**单独一个 commit** 里打开开关并补跑常规②。

**适配器 DOM 取证（8 条；取证手段是开发态 DevTools 手工看 DOM）**

- F049 · intl 三处 `sleep(700)` 是拍脑袋定值：量一次菜单展开实耗，确认 700ms 有 ≥20% 余量，否则改成夹取 `deadline` 的等待。
- F055 / F057 · Gemini 菜单判据缺窄屏证据：把窗口拉到 640px 以下复现窄屏分支，看菜单节点的 `aria-expanded` 是否真的翻转。
- F098 · ChatGPT / Gemini 的 `answer()` 可能把思考段一起收进来：两站各出一次带思考过程的回答，收集结果里不得含思考段。
- F072 / F078 · DeepSeek / 豆包 / Kimi 的停止键锚点未取证：三站各发一次长回答，生成中读停止键节点的 role / aria / 文本，与适配器锚点逐一比对。
- F068 / F077 · 豆包文案与菜单结构未复核：中英文界面各开一次档位菜单，核对词条与层级（控件下沉到二级子菜单是常态）。

**判据取证（3 条）**

- F059 / F047 / F046 · ChatGPT 与 Gemini 的若干判据是从旧 DOM 推来的：真机逐条对照现状，改锚点前先留证据再动手。

**共享运行时阈值（3 条；随迁移只变路径、不变内容，现都在 `desktop/src/site-runtime/`）**

- F095 · upload 阈值、F096 · md 前瞻窗口、F101 · 多图指纹：三条都要真机样本才能确认取值合理，离线用例只锁住了当前行为。

**其它（5 条）**

- F041 · `site-runtime/core.js` 仍 300/300 顶格，`deadline` 没贯通到切档路径，贴近截止线时切档可能被硬截断。**明确顺延**（拆卷后再做），已记为已知偏离。
- F139 · 便携版白名单不对称：发版前跑一次便携版产物解包校验（跨平台 CI 已有该步），据结果勾掉或顺延。
- F089 / F132 · ux 两条、F037 · 存储键序：原始审计报告已不可得，**端别判不出的一律按「与切除无关」顺延**，不得默认已随扩展一起消失。
- F121 · popup ux：随扩展删除消失，就地销号。

## 哨兵与报障

- **模型发布哨兵**：`scripts/watch-releases.js` + `.github/workflows/release-watch.yml`，每周一/四轮询官方 changelog/RSS/状态快照页，有新条目自动开 issue（label `release-watch`）。定位是闹钟——公告名 ≠ 网页 UI 标签，**禁止直接抄进适配器正则**（先真机核对）。真机/联网脚本**不得用 `test-` 前缀命名**：verify.sh 会强制把 `test-*.js` 登记进无浏览器无网络的 CI。仓库 60 天无 push 时 GitHub 会停用 scheduled workflow，Actions 页点一下即可重新启用。**`release-watch` label 是去重依据**（脚本按它拉已见标题集），分流整理时不要从旧 issue 上摘掉，否则对应条目会被重复开单。openai/gemini-blog 两源的宽 filter 混进大量营销/案例稿或月度回顾，标题带 `highSignal` 词表二次分级：未命中的**仍然开 issue**，只是标题加 `/low` 标记（正文首行提示多半非模型公告），不会静默丢条目；bailian 源反过来用 `NEVER_HIGH_SIGNAL`（只匹配空串）让整源恒为低信号，`lowSignalNote` 覆盖成「API 侧上线不代表网页已变」而非 openai 那句「营销/案例文」。claude/gemini/deepseek 三个 `datedSections` 源标题原本只是日期（deepseek 还把「Date: …」与型号名拆成两个独立 heading），现改成「日期 — 摘要」拼接（deepseek 因此天然把两个 heading 并成一条）；改格式前开的旧 issue 是纯日期/无 `/low` 的旧标题形态，去重逻辑对新旧两种形态都测，不会因为改格式而重复开单。
  - **源清单（2026-08 复核）**：openai（`openai.com/news/rss.xml`，rss）、claude（`support.claude.com` 消费端 release notes，datedSections——**2026-08 从 `platform.claude.com` 纠偏**：原源是开发者 Console/API/SDK changelog，窗口内 5 条 issue 全是 API 基建噪音、零命中过消费端变化；新源是服务端渲染的 Intercom 文章页，日期是「月份大标题 H2 + 日期小标题 H3」两级结构，`datedSections` 第四参 `groupHeaderRe` 负责把月份大标题从摘要来源里整条剔除，否则会产出「Aug 6, 2026 — July 2026」这种把下月月份名回收成上月摘要的糊涂账）、gemini（`gemini.google/release-notes/`，datedSections，官方渠道但被证实漏记选择器级变更如 3.7 Flash 换档）、**gemini-blog**（`blog.google` 的 Gemini Models 专栏 `/rss/`，rss，highSignal 抓「Introducing …」标准开头，弥补上一条的漏检）、deepseek（`api-docs.deepseek.com/updates/`，datedSections）、zhipu（`docs.bigmodel.cn` 功能更新页，zhipu 专用解析）、**kimi**（帮助中心「模型与模式怎么选」，**kind `snapshot`**——不是 changelog，是当前 UI 状态的一手快照，见下）、**bailian**（阿里云百炼「模型上线表」，**kind `bailian`**——跨厂商 API 上线信号，Qwen/GLM/Kimi 等经百炼平台上线的型号，表格倒序，`adapter` 字段说明按行内 Model type 对应站点，不是单一文件）。
  - **kind `snapshot` 方法论**：changelog 记录「发布了什么」，但 PolyAsk 真正关心的是「选择器现在长什么样」——两者不总是同步（公告可能没提 UI 变化，UI 变化也可能没有公告）。帮助中心一类「怎么选 / 模式说明」页往往是当前状态的一手快照，比 changelog 更贴合这个需求。`parseSnapshot` 只产 1 条 entry，正文（锁定 `<article>` 容器，防止抓进导航/侧栏噪音）摘要不变则不重复开单，摘要一变就当新条目——首轮自动登记为基线，不需要人工预置。目前只有 kimi 有这类页面；其余站点若发现同类「状态说明」页，同样值得优先于 changelog 纳入。
  - **仍确认没有可轮询官方源**：元宝 / 千问（qianwen.com）/ 豆包官网都是需登录的 React SPA，纯 GET 拿不到渲染后 DOM，UI 变化只能靠巡检 diagnose 与真实群发失败信号兜底；腾讯混元「研究动态」页同样是 SPA（内容是模型动态、不是元宝产品本身），2026-08 复核仍无 RSS 或可穿透的 GET 路径，评估后未纳入哨兵——需要时得走渲染穿透而非本脚本的纯 GET；豆包无任何一手可轮询信号，只能靠真机巡检。openai 官方消费端页面（`openai.com/products/release-notes/`、`help.openai.com/en/articles/6825453-chatgpt-release-notes`）2026-08 复核仍对本环境返回 403（多种 UA 一致），维持现状不纳入。
- **用户报障出口**：`Alt+H` 站点状态里的「复制诊断报告」——内容是版本 / 系统 / 显示缩放、各站的 `phase` 与 `code`、以及逐项 check 的 `name`-`kind`-`ok`，**不含对话内容与网址**；配 `.github/ISSUE_TEMPLATE/site-breakage.yml`（按上面的四问预置问题）。
