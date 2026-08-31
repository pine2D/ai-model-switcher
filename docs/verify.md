# 验证：离线回归 + 真机（chrome-dbg）

**离线回归清单、测试写法（源码字符串断言 / `XXX_START` 标记块）、chrome-dbg 真机流程、探针工具与坑都在这里**；`CLAUDE.md` 只留两条门禁命令和「改适配器/切档/发送必须真机复现」一句硬约束。冲突以 `CLAUDE.md` 为准。

**顺序不能反：先离线（`bash scripts/verify.sh`），再真机。** 反过来会得到「真机试通了但 CI 红」的返工。

## 离线回归

**两端有两条互不重叠的门禁**：`bash scripts/verify.sh` 只覆盖扩展侧（外加 Desktop OAuth 凭据卫生这一段）；Desktop 的 `npm test` / `npm run typecheck` 一条都不在里面，要单独跑（`cd desktop`，命令与验收边界见 `docs/desktop-m0.md`）。本节其余内容讲的都是扩展侧那条。

- `scripts/` 下的 `test-*.js` 都是**对源码字符串做断言的 node 脚本**（`fs.readFileSync` + 正则 / `indexOf` / `vm`），无构建无框架。改 UI 的 class/id/顺序/CSS 数值都可能打断看似无关的测试。`verify.sh` 另跑 `node --check`、JSON parse、300 行上限、Desktop OAuth 凭据卫生、三语检查、文档引用与测试登记检查、workflow YAML 解析、`git diff --check`。
- **workflow YAML 检查**优先用 `actionlint`（连 `runs-on` 拼错、`needs` 指向不存在的 job 都查），没装则退化到 python3 + PyYAML 的纯语法解析，两者都缺时打印警告跳过（不阻断 verify）。本机想拿最强校验就装一个 actionlint（apt/brew 都有）——YAML 错误只能在推 tag 后由 GitHub 暴露，而 tag 不可覆盖 = 烧掉一个版本号。
- 需要在 node 里跑纯逻辑时，用 `// XXX_START` / `// XXX_END` 标记块让测试 `slice` 出源码片段执行（`console/scope.js` 是现例）。**不要为了测试给 classic script 加 module 导出。**
- **每个 fix 必须留一个可离线跑的回归。** 适配器和 SW 改动无法在 CI 复现真机，所以回归的形式是：把出事那一刻的 DOM / 消息流做成假对象喂给源码。模板：`test-site-send-runtime.js`、`test-submit-recovery.js`、`test-intl-runtime.js`、`test-image-runtime.js`、`test-md-runtime.js`（自带最小 DOM 桩，是 `content/md.js` 这类纯序列化逻辑的现例）。真机验证**不能替代**它——只有它能防住下一个人改回去。
- **`test-multi-image.js` 的虚拟时钟在「布防」时就推进 now**（`setTimeout: (fn, ms) => { now += ms || 0; queueMicrotask(fn); … }`，不是在触发时推进）。任何在 `content/core.js` 里新布防定时器的改动都会被它误杀——看到这个测试红而改动本身与图片无关时，先怀疑它。
- **新测试写完必须加进 `verify.sh` 的清单，否则永远不会被执行**——现在 `verify.sh` 会自查：`scripts/test-*.js` 每个文件都必须在脚本里有一行 `node scripts/test-xxx.js`，否则直接红。确属被别的用例 `require` 的模块、不该单独跑的，在 `verify.sh` 里加一行 `# verify-skip: scripts/test-<名字>.js <理由>` 声明豁免——**理由不能省**，脚本按 `verify-skip: <路径> `（含尾空格）匹配，只写文件名等于没声明。
- `scripts/test-sync-engine.js` 是唯一的豁免项：它 `module.exports` 一个函数，由 `scripts/test-sync-runtime.js` 末尾 `require` 后执行，**直接 `node scripts/test-sync-engine.js` 只定义不执行、静默退出 0**。它的断言有覆盖，跑 `test-sync-runtime.js` 即可（实测：改坏它的断言，`test-sync-runtime.js` 变红）。
- **`CLAUDE.md` 路由过去的 `docs/*.md` 少一份是纯静默事故**（读文件失败不报错，下个会话空手上阵）。`verify.sh` 从 `CLAUDE.md`、`README.md`、`CHANGELOG.md`、**已入库的** `docs/*.md` 正文里正则提取所有 `docs/*.md` 形式的引用，逐个断言存在且非空、**且已被 Git 跟踪**——只判「工作区存在」会让本机留着未 `git add` 的同名文件时假绿，而 CI 走干净 checkout 才红，卡在一个本机复现不出的失败上。新增引用自动纳入，不用维护清单；反过来，正文里别写 `docs/` 加真实文件名样式的占位符，会被当成真引用（占位用 `docs/<名字>.md`）。
- **站点四处登记已有防线**：`scripts/test-site-selection.js` 双向对账 `manifest.matches` / `console/sites.js` 的 `SITES` / 适配器注册键 / `desktop/src/main/sites.ts`，并反查僵尸适配器与孤儿匹配；适配器文件清单从 manifest 派生（漏挂某一卷会红）。同一份测试还循环断言九站 `think/fast/state/diagnose` 均为 function。加站点漏一处 `verify.sh` 直接红，读断言消息即知补哪份文件。
- **平铺安全回归**：`scripts/test-tile-reflow.js` ⑥a 把登记污染成用户日常 `type:"normal"` 窗（跨浏览器重启 id 重排就会发生），断言全链路下该窗不被重排/关闭、并自愈成新 popup；⑥b 断言 `removeIfPopup`/`updateIfPopup` 对 `type:"normal"` 的类型校验（popup 正向各一条）。这是 popup-only 铁律三根支柱里唯一能离线跑的那两根。

## 真机环境（本机 chrome-dbg）

- `chrome-dbg` 在 `127.0.0.1:9222`，**已安装本仓扩展且各 AI 站有登录态**（2026-08-18 九站复核）。站点 DOM 适配审计可全程自主完成：开站 → 注入 → 点发送 → 探锚点。
- **判「掉登录」要用强证据**（2026-08-18 误判教训：曾凭「水合中 `.current-model` 缺失 + 页面存在 `[class*=login]` 类名」错判 Kimi 掉登录，实际是探测打在水合窗口里，且登录弹窗容器常驻 DOM）。强证据组合：可见头像/会话历史列表非空、**没有可见的**「登录/Sign in」按钮文本；弱类名匹配只能当线索。另：Kimi 入口当前模型可能停在非 K3（如 Instant），此时 `state()` 按既有语义返回 null，属正常态不是故障。
- **重载扩展**：在 `chrome://extensions` 标签页执行 `chrome.developerPrivate.reload("<本仓 unpacked ID>", {failQuietly:false})`。
- **重载后旧标签的 content script 变孤儿**（抛 `Extension context invalidated`），必须刷新页面重注入。`scratchpad/reload-sites.js` 每个 host **只刷第一个匹配标签**——同站开了多个标签时另一个仍是孤儿，会表现为 `Could not establish connection` 的误判。探测前先数一下同站标签。
- **断言只用生产逻辑**（`__AMS.getState()` / `_isOn()`），**不要在测试 lambda 里重写正则**——shell/python 转义会把 `\s` 变 `\\s`，产生「幽灵失败」（实战吃过亏）。
- `__AMS` 在 content script 隔离世界，主世界 DevTools 控制台默认看不到（要切上下文）。
- **开发机与用户机不等价**：开发机是 WSL2 + Linux chrome-dbg（启动别名带 `--force-device-scale-factor=1.5`，实测 `devicePixelRatio=1.5`——**不是无缩放**，缩放类量级问题本机可复现；扩展干净、界面英文），用户机是 Windows Chrome（缩放比例可能不同、装了多个同类 AI 扩展、界面可能非英文），layout 数值不同。本机跑通不构成「已修复」的证据；本机复现不出时先按 `CLAUDE.md` 的「先要现象再猜层次」定位到 composer / inject / submit / state 哪一层。

## 工具（本节的在 `scratchpad/`，已 gitignore、克隆后没有；**入库的 CDP 工具**见文末「哨兵与报障」：`scripts/probe-drift.js`、`scripts/capture-evidence.js`，共用 `scripts/lib/cdp-min.js`）

- **`ams-eval.js <urlSub> <jsFile|-e expr>` 是首选**：只在 PolyAsk 自己的隔离世界执行表达式。
- `iso-eval.js` 会在全部 ~37 个 world 重复执行，**对有副作用的代码不可用**（会重复点击/重复发送），只在「找不到 `__AMS`、需要排查它在哪个 world」时才用。多扩展环境有多个 isolated world，且同名 world 可能有多个（导航后旧 context 未回收）——要挑真正挂着 `__AMS` 的那个，别只看最后一个。
- **`cdp.js list|open|activate|eval|shot`**（node≥22 全局 WebSocket）。`activate` 必用：**后台标签 eval 可能挂起，且后台页会冻结菜单动画**，切档实测前必须先激活。
- `reload-sites.js` 并行刷新九站（注意上面的「只刷第一个标签」限制）。
- 仿真窄窗：`Emulation.setDeviceMetricsOverride {width:639}`——Claude / Gemini 的窄屏布局分支只能这样覆盖。

## 探测坑

- **Gemini 会 prerender 出同 URL 双 page target**：按 `urlSub` 匹配会打到影子页，发送与探测对不上。探前先 `/json/list` 数同站 target 数、关掉多余的再操作。
- 站点级的 DOM/时序坑（豆包中英文间插空格、chatglm 水合期 ~30s、Kimi 换模型跳 `/agent`）写在 `docs/adapters.md` 的站点卡里，本节只记 CDP 与探针工具本身的坑。

## 快捷键链路

三条 manifest 快捷键 **`switch-think` Alt+T / `switch-fast` Alt+Y / `open-console` Alt+Q** 由 `background.js` 的 `chrome.commands.onCommand` 转发。MV3 SW 会休眠：reload 唤醒后 30s 内用 CDP `Target.attachToTarget` 执行 `onCommand` 等价代码可验后半段链路；**物理按键 → `onCommand` 无法合成，这三条必须留人工按一遍**。console 内的 Alt+C/L/N/P/R 是页面级 keydown，可在页面上下文里合成事件验证。

## 其它浏览器工具的限制

- `chrome-devtools-mcp` 默认自启一个 `--disable-extensions` 的全新 Chrome（about:blank、无登录态、无扩展）；要连本机 chrome-dbg 须给其 MCP server 配 `--browserUrl http://127.0.0.1:9222` 再重启。
- `claude-in-chrome` 进不了 `chrome://` / `chrome-extension://`（被拦），需逐站授权，多浏览器要先 `select_browser`。
- 两者都不如直连 `127.0.0.1:9222`。

## 哨兵与报障

- **模型发布哨兵**：`scripts/watch-releases.js` + `.github/workflows/release-watch.yml`，每周一/四轮询官方 changelog/RSS/状态快照页，有新条目自动开 issue（label `release-watch`）。定位是闹钟——公告名 ≠ 网页 UI 标签，**禁止直接抄进适配器正则**（先真机核对）。真机/联网脚本**不得用 `test-` 前缀命名**：verify.sh 会强制把 `test-*.js` 登记进无浏览器无网络的 CI。仓库 60 天无 push 时 GitHub 会停用 scheduled workflow，Actions 页点一下即可重新启用。**`release-watch` label 是去重依据**（脚本按它拉已见标题集），分流整理时不要从旧 issue 上摘掉，否则对应条目会被重复开单。openai/gemini-blog 两源的宽 filter 混进大量营销/案例稿或月度回顾，标题带 `highSignal` 词表二次分级：未命中的**仍然开 issue**，只是标题加 `/low` 标记（正文首行提示多半非模型公告），不会静默丢条目；bailian 源反过来用 `NEVER_HIGH_SIGNAL`（只匹配空串）让整源恒为低信号，`lowSignalNote` 覆盖成「API 侧上线不代表网页已变」而非 openai 那句「营销/案例文」。claude/gemini/deepseek 三个 `datedSections` 源标题原本只是日期（deepseek 还把「Date: …」与型号名拆成两个独立 heading），现改成「日期 — 摘要」拼接（deepseek 因此天然把两个 heading 并成一条）；改格式前开的旧 issue 是纯日期/无 `/low` 的旧标题形态，去重逻辑对新旧两种形态都测，不会因为改格式而重复开单。
  - **源清单（2026-08 复核）**：openai（`openai.com/news/rss.xml`，rss）、claude（`support.claude.com` 消费端 release notes，datedSections——**2026-08 从 `platform.claude.com` 纠偏**：原源是开发者 Console/API/SDK changelog，窗口内 5 条 issue 全是 API 基建噪音、零命中过消费端变化；新源是服务端渲染的 Intercom 文章页，日期是「月份大标题 H2 + 日期小标题 H3」两级结构，`datedSections` 第四参 `groupHeaderRe` 负责把月份大标题从摘要来源里整条剔除，否则会产出「Aug 6, 2026 — July 2026」这种把下月月份名回收成上月摘要的糊涂账）、gemini（`gemini.google/release-notes/`，datedSections，官方渠道但被证实漏记选择器级变更如 3.7 Flash 换档）、**gemini-blog**（`blog.google` 的 Gemini Models 专栏 `/rss/`，rss，highSignal 抓「Introducing …」标准开头，弥补上一条的漏检）、deepseek（`api-docs.deepseek.com/updates/`，datedSections）、zhipu（`docs.bigmodel.cn` 功能更新页，zhipu 专用解析）、**kimi**（帮助中心「模型与模式怎么选」，**kind `snapshot`**——不是 changelog，是当前 UI 状态的一手快照，见下）、**bailian**（阿里云百炼「模型上线表」，**kind `bailian`**——跨厂商 API 上线信号，Qwen/GLM/Kimi 等经百炼平台上线的型号，表格倒序，`adapter` 字段说明按行内 Model type 对应站点，不是单一文件）。
  - **kind `snapshot` 方法论**：changelog 记录「发布了什么」，但 PolyAsk 真正关心的是「选择器现在长什么样」——两者不总是同步（公告可能没提 UI 变化，UI 变化也可能没有公告）。帮助中心一类「怎么选 / 模式说明」页往往是当前状态的一手快照，比 changelog 更贴合这个需求。`parseSnapshot` 只产 1 条 entry，正文（锁定 `<article>` 容器，防止抓进导航/侧栏噪音）摘要不变则不重复开单，摘要一变就当新条目——首轮自动登记为基线，不需要人工预置。目前只有 kimi 有这类页面；其余站点若发现同类「状态说明」页，同样值得优先于 changelog 纳入。
  - **仍确认没有可轮询官方源**：元宝 / 千问（qianwen.com）/ 豆包官网都是需登录的 React SPA，纯 GET 拿不到渲染后 DOM，UI 变化只能靠巡检 diagnose 与真实群发失败信号兜底；腾讯混元「研究动态」页同样是 SPA（内容是模型动态、不是元宝产品本身），2026-08 复核仍无 RSS 或可穿透的 GET 路径，评估后未纳入哨兵——需要时得走渲染穿透而非本脚本的纯 GET；豆包无任何一手可轮询信号，只能靠真机巡检。openai 官方消费端页面（`openai.com/products/release-notes/`、`help.openai.com/en/articles/6825453-chatgpt-release-notes`）2026-08 复核仍对本环境返回 403（多种 UA 一致），维持现状不纳入。
- **用户报障出口**：scope 窗「复制诊断报告」（巡检结果 + 版本 + 语言，不含对话内容）+ `.github/ISSUE_TEMPLATE/site-breakage.yml`（按 `CLAUDE.md` 四层定位法预置问题）。
- **漂移探针**：`node scripts/probe-drift.js`——只读 chrome-dbg 里**已经开着**的标签（关着即 skip，不导航不登录不等水合），采集 diagnose/state/标签原文串/composer 尺寸/dpr 快照，逐站即时追加进 `scratchpad/probe-log.jsonl`（gitignored，自动建目录，超 2000 行自动轮转留 1000）。与上次快照 diff 后**双轨输出**：`!` 警报 = 可操作漂移（检查转红、composer 消失/尺寸 ≥20% 突变、标签串→∅、登录墙出现）；`~` 参考 = 环境与使用痕迹（手动切档导致的 state/标签变化、dpr、界面语言切换、登录墙在场的锚点差异）。默认不激活标签，后台 eval 超时（逐请求 8s）时加 `--activate`；复核已看过的提醒用 `--dry`（不落盘——警报会被本轮快照消费，落盘后复跑即绿）。检查项按**下标**对齐而非名字（名字是 t() 界面语言串）。标签探针的登记与方法名由 `scripts/test-probe-drift.js` 静态对账（加站/改名 CI 会红）。
- **取证脚本**：`node scripts/capture-evidence.js <hostSub> [tag]`——只读、人工监督下使用：composer 祖先链 + 全页可见交互控件清单（role/testid/aria/40 字截断文本/几何）。菜单展开前后各抓一份、diff 两份清单即得「展开后才存在」的锚点候选。隐私硬规则：侧栏/会话列表/消息容器整体排除，**产物外发给任何模型前先人工过目**。
