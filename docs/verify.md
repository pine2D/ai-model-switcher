# 验证：离线回归 + 真机（chrome-dbg）

**离线回归清单、测试写法（源码字符串断言 / `XXX_START` 标记块）、chrome-dbg 真机流程、探针工具与坑都在这里**；`CLAUDE.md` 只留 `verify.sh` 一条命令和「改适配器/切档/发送必须真机复现」一句硬约束。冲突以 `CLAUDE.md` 为准。

**顺序不能反：先离线（`bash scripts/verify.sh`），再真机。** 反过来会得到「真机试通了但 CI 红」的返工。

## 离线回归

- `scripts/` 下的 `test-*.js` 都是**对源码字符串做断言的 node 脚本**（`fs.readFileSync` + 正则 / `indexOf` / `vm`），无构建无框架。改 UI 的 class/id/顺序/CSS 数值都可能打断看似无关的测试。`verify.sh` 另跑 `node --check`、JSON parse、300 行上限、三语检查、文档引用与测试登记检查、`git diff --check`。
- 需要在 node 里跑纯逻辑时，用 `// XXX_START` / `// XXX_END` 标记块让测试 `slice` 出源码片段执行（`console/scope.js` 是现例）。**不要为了测试给 classic script 加 module 导出。**
- **每个 fix 必须留一个可离线跑的回归。** 适配器和 SW 改动无法在 CI 复现真机，所以回归的形式是：把出事那一刻的 DOM / 消息流做成假对象喂给源码。模板：`test-site-send-runtime.js`、`test-submit-recovery.js`、`test-intl-runtime.js`、`test-image-runtime.js`。真机验证**不能替代**它——只有它能防住下一个人改回去。
- **新测试写完必须加进 `verify.sh` 的清单，否则永远不会被执行**——现在 `verify.sh` 会自查：`scripts/test-*.js` 每个文件都必须在脚本里有一行 `node scripts/test-xxx.js`，否则直接红。确属被别的用例 `require` 的模块、不该单独跑的，在 `verify.sh` 里加一行 `# verify-skip: scripts/test-<名字>.js <理由>` 声明豁免——**理由不能省**，脚本按 `verify-skip: <路径> `（含尾空格）匹配，只写文件名等于没声明。
- `scripts/test-sync-engine.js` 是唯一的豁免项：它 `module.exports` 一个函数，由 `scripts/test-sync-runtime.js` 末尾 `require` 后执行，**直接 `node scripts/test-sync-engine.js` 只定义不执行、静默退出 0**。它的断言有覆盖，跑 `test-sync-runtime.js` 即可（实测：改坏它的断言，`test-sync-runtime.js` 变红）。
- **`CLAUDE.md` 路由过去的 `docs/*.md` 少一份是纯静默事故**（读文件失败不报错，下个会话空手上阵）。`verify.sh` 从 `CLAUDE.md`、`README.md`、`docs/*.md` 正文里正则提取所有 `docs/*.md` 形式的引用，逐个断言存在且非空——新增引用自动纳入，不用维护清单；反过来，正文里别写 `docs/` 加真实文件名样式的占位符，会被当成真引用（占位用 `docs/<名字>.md`）。
- **站点三处登记已有防线**：`scripts/test-site-selection.js` 双向对账 `manifest.matches` / `SITES` / 适配器注册键，并反查僵尸适配器与孤儿匹配；适配器文件清单从 manifest 派生（漏挂某一卷会红）。加站点漏一处 `verify.sh` 直接红，读断言消息即知补哪份文件。
- **平铺安全回归（核心用例）**：日常 normal 窗口开某站 → 触发 `openTile` → 断言该 normal 窗口 bounds 不变、登记的是新 popup；把登记污染成 normal id 后断言不被关、自愈为 popup。

## 真机环境（本机 chrome-dbg）

- `chrome-dbg` 在 `127.0.0.1:9222`，**已安装本仓扩展且各 AI 站有登录态**（2026-08-18 九站复核）。站点 DOM 适配审计可全程自主完成：开站 → 注入 → 点发送 → 探锚点。
- **判「掉登录」要用强证据**（2026-08-18 误判教训：曾凭「水合中 `.current-model` 缺失 + 页面存在 `[class*=login]` 类名」错判 Kimi 掉登录，实际是探测打在水合窗口里，且登录弹窗容器常驻 DOM）。强证据组合：可见头像/会话历史列表非空、**没有可见的**「登录/Sign in」按钮文本；弱类名匹配只能当线索。另：Kimi 入口当前模型可能停在非 K3（如 Instant），此时 `state()` 按既有语义返回 null，属正常态不是故障。
- **重载扩展**：在 `chrome://extensions` 标签页执行 `chrome.developerPrivate.reload("<本仓 unpacked ID>", {failQuietly:false})`。
- **重载后旧标签的 content script 变孤儿**（抛 `Extension context invalidated`），必须刷新页面重注入。`scratchpad/reload-sites.js` 每个 host **只刷第一个匹配标签**——同站开了多个标签时另一个仍是孤儿，会表现为 `Could not establish connection` 的误判。探测前先数一下同站标签。
- **断言只用生产逻辑**（`__AMS.getState()` / `_isOn()`），**不要在测试 lambda 里重写正则**——shell/python 转义会把 `\s` 变 `\\s`，产生「幽灵失败」（实战吃过亏）。
- `__AMS` 在 content script 隔离世界，主世界 DevTools 控制台默认看不到（要切上下文）。
- **开发机与用户机不等价**：开发机是 WSL2 + Linux chrome-dbg（启动别名带 `--force-device-scale-factor=1.5`，实测 `devicePixelRatio=1.5`——**不是无缩放**，缩放类量级问题本机可复现；扩展干净、界面英文），用户机是 Windows Chrome（缩放比例可能不同、装了多个同类 AI 扩展、界面可能非英文），layout 数值不同。本机跑通不构成「已修复」的证据；本机复现不出时先按 `CLAUDE.md` 的「先要现象再猜层次」定位到 composer / inject / submit / state 哪一层。

## 工具（都在 `scratchpad/`，已 gitignore、克隆后没有）

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

- **模型发布哨兵**：`scripts/watch-releases.js` + `.github/workflows/release-watch.yml`，每周一/四轮询五家官方 changelog/RSS，有新条目自动开 issue（label `release-watch`）。定位是闹钟——公告名 ≠ 网页 UI 标签，**禁止直接抄进适配器正则**（先真机核对）。真机/联网脚本**不得用 `test-` 前缀命名**：verify.sh 会强制把 `test-*.js` 登记进无浏览器无网络的 CI。仓库 60 天无 push 时 GitHub 会停用 scheduled workflow，Actions 页点一下即可重新启用。**`release-watch` label 是去重依据**（脚本按它拉已见标题集），分流整理时不要从旧 issue 上摘掉，否则对应条目会被重复开单。
- **用户报障出口**：scope 窗「复制诊断报告」（巡检结果 + 版本 + 语言，不含对话内容）+ `.github/ISSUE_TEMPLATE/site-breakage.yml`（按 `CLAUDE.md` 四层定位法预置问题）。
