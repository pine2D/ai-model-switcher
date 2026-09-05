# 发版与用户可见文案

Desktop 是唯一发布物：一个版本号、一个 tag、一个 GitHub Release。本文记录发布门禁、打包边界、Desktop OAuth 注入、人工核查项、三语文案与 Git/CHANGELOG 惯例；桌面端验收边界见 `docs/desktop.md`。冲突以 `CLAUDE.md` 为准。

**版本真源是 `desktop/package.json`。** `scripts/release.sh` 从它读出版本推出 `vX.Y.Z`，tag 必须与之一致（tag 触发的 workflow 里对不上直接 exit 1）；`scripts/prepare-release.sh` 只改三个文件：`CHANGELOG.md`、`desktop/package.json`、`desktop/package-lock.json`。

## 流程

```bash
# 0. 「未发布」段已记录所有用户可感知变更（发版前持续维护，不要临发版补）
bash scripts/prepare-release.sh auto   # 晋升 CHANGELOG，同步 Desktop package/lock 与比较链接（只改文件，不 commit）
# 1. 人工审阅发版 diff，做下面的「脚本查不出的人工项」
bash scripts/verify.sh
cd desktop && npm test && npm run typecheck && npm audit --omit=dev && node scripts/audit-runtime.mjs
cd .. && bash scripts/release.sh --build-only   # 本机跑 verify.sh + Release notes 提取 + CHANGELOG 三条校验
# 2. commit 并 push main
bash scripts/release.sh --publish      # 推 v* tag；Release workflow 构建并发布全部资产
```

`prepare-release.sh` 的用法是 `<auto|patch|minor|major|X.Y.Z> [--dry-run]`。`auto` 只读取当前版本 tag 之后**已经提交**的 Conventional Commits；待发布改动尚未提交时，应按 `[未发布]` 内容显式传 `patch`、`minor` 或 `major`，不要让 `auto` 猜尚未进入 Git 历史的改动。

`npm test` 自身第一步就是 `tsc --noEmit`，后面单跑 `npm run typecheck` 是同一件事跑第二遍；留着只为让本机命令行与 CI 的作业名逐条对得上，不是额外覆盖面。

两条 audit 都要跑：`npm audit --omit=dev` 覆盖 react / react-dom / electron-squirrel-startup 这三项真正的运行时 npm 依赖，`node scripts/audit-runtime.mjs` 补上前者结构性看不到的 electron 本身（按 npm 惯例它总是 devDependency，却随每个发行包分发）。CI 的 verify 作业已把两者都接进去，这里是让本机发版前流程口径一致。

`--build-only` 是本机与 CI 共用的那条：跑 `scripts/verify.sh`、从 `CHANGELOG.md` 抠出本版段落写进 `dist/release-notes.md`、做三条 CHANGELOG 校验（版本段确有 `- ` 条目、`[未发布]` 比较链接从本次 tag 起算、本版链接存在），最后把固定信任尾段追加进正文。`.github/workflows/ci.yml` 的 verify 作业检出源码后先用 `actions/setup-node` 钉住 `desktop/.nvmrc` 的 Node（当前 24），紧接着就跑它——所以这三条校验每个 PR 都会过一遍，不是只在发版那天才生效。

`--publish` 在此之上多一层 preflight：工作区干净、分支是 main 且跟踪 origin/main、`gh` 已登录、HEAD 已完整推送到 origin/main、exact-HEAD 的 CI 为 `completed:success`、本地与远端都不存在该 tag、`[未发布]` 段无遗留条目。打 tag 之前还会复查一次 HEAD 与 origin/main 在构建期间没有变过。**已发布 tag 不覆盖；要改内容必须升新版本。** 脚本用法跑 `-h`。

## Release 资产与正文

每个 Release 恰好包含 5 个主包和 5 个同名 `.sha256`：

- Windows x64 安装版：`polyask-desktop-vX.Y.Z-windows-x64.exe`
- Windows x64 便携版：`polyask-desktop-vX.Y.Z-windows-x64-portable.zip`
- Linux x64：`polyask-desktop-vX.Y.Z-linux-x64.deb`
- macOS：`polyask-desktop-vX.Y.Z-macos-x64.zip` 与 `polyask-desktop-vX.Y.Z-macos-arm64.zip`

命名与校验和统一由 `desktop/scripts/release-artifacts.mjs` 产出，`.sha256` 的内容是「十六进制摘要 + 两个空格 + 文件名」，用户可以直接 `sha256sum -c` / `shasum -c`。publish 作业在发布前先自查一遍：`release-assets/polyask-desktop-*` 里非 `.sha256` 的必须恰好 5 个，且 `release-assets/release-notes.md` 存在且非空；`fail_on_unmatched_files: true` 保持开启。

Release 正文 = `CHANGELOG.md` 对应版本段 + 下面这段固定尾段。

### 固定信任尾段

`scripts/release.sh` 里 `RELEASE_TRUST_TRAILER_START` / `RELEASE_TRUST_TRAILER_END` 之间的标记块负责把尾段追加进正文，内容是四件事：

- **校验和核对命令**：Windows PowerShell `Get-FileHash -Algorithm SHA256`，macOS / Linux `shasum -a 256 -c <文件名>.sha256`；
- **首启放行步骤**：Windows SmartScreen「更多信息 → 仍要运行」，macOS 先把应用移进「应用程序」再打开、被拦后到「系统设置 → 隐私与安全性」底部点「仍要打开」；
- **未签名、无自动更新**：五个包均未签名，升级请回 Release 页下载新包；
- **一句用户可读的信任表述**：PolyAsk 不伪装 User-Agent、不关闭网页安全机制、不复制浏览器 Cookie，只以你已登录的会话操作各站页面；Google Drive 同步只申请应用专属目录（`drive.appdata`）。

尾段**必须**追加在三条 CHANGELOG 校验之后（`scripts/test-release-flow.js` 用两个标记块的相对位置守着）：尾段自带 `- ` 列表，提前追加会让「版本段必须有条目」那条检查假绿。

为什么固定带这一段：五个包全部未签名、macOS 未公证，再叠加不提供自动更新，用户每次升级都要重新过一遍 SmartScreen/Gatekeeper——这恰好是伪装成 AI 工具的恶意程序最容易冒充的位置。校验和本来就已逐包生成，把它连同核对命令渲进 Release 正文是零成本的差异化；「不申请任何 AI 站点权限」也从内部工程纪律升格成用户读得到的一句话，别把它退回成注释。

### 不烧版本号的验证入口（`workflow_dispatch` + `dry_run`）

`.github/workflows/release.yml` 除 `push: tags: ["v*"]` 外还挂了 `workflow_dispatch`，带一个默认 `true` 的 `dry_run` 布尔输入。它会完整走一遍 validate → desktop 四路矩阵 → publish 的汇总核对，只在最后创建 Release 那一步被 `if: inputs.dry_run != true` 挡住。

**推任何 `v*` tag 之前，先在 GitHub 上手动跑一次 `dry_run=true`**，确认三件事：

1. validate 产出了 `release-notes` artifact（`if-no-files-found: error`，缺了会直接红）；
2. 四路矩阵产出 5 个包与各自 `.sha256`，publish 的汇总步骤全部匹配到、计数为 5；
3. `body_path` 指向的 `release-notes.md` 存在且非空。

**tag 一旦推出不可覆盖**——发布链本身必须在推 tag 之前就已经验证过。dry_run 暴露问题就修完重跑，不消耗版本号。改过 `release.yml`、`scripts/release.sh` 或 `desktop/scripts/release-artifacts.mjs` 之后，这一步不是可选项。若 publish 半途失败，`release.yml` 的 concurrency 是 `cancel-in-progress: false`，可以重跑该 job 补齐资产，不必换版本号。

## 签名、公证与自动更新：本次排除

Windows 代码签名、macOS 签名与公证、应用内自动更新**本次全部不做**，产物按未签名分发。Windows、macOS、Linux 产物必须在对应原生 runner 上生成；不得从 Linux 交叉伪造 macOS 包。文案里不得提前声称已签名或已公证。

重启条件写死为两条，满足任一条再议：**出现真实的第三方用户**（不再只有作者本机在装），或**已经拿到付费证书**。在那之前，签名是长期组织性工作而不是一次提交，而且证书私钥泄漏比未签名更糟——一旦开始就得按与 OAuth Secret 同级的卫生标准对待。自动更新还额外意味着应用第一次在 Google Drive 之外主动联网，须同改 README 与设置页隐私文案并提供关闭开关，排在签名之后拍板。

同一批押后的还有「Desktop 本机漂移哨兵」：把站点漂移检测的覆盖率从开发机提升到每个用户，这个论证押在装机量上，而误报一次就直接侵蚀信任。等发布信任基建落地、桌面确实有用户基数之后再评估，不要在零用户时先把它建起来。

## 1.0.0：停维分界版本的发版口径

1.0.0 是产品分界——Desktop 成为唯一发布物、扩展形态终结。工程侧的事实一条不变：仍未签名、仍无自动更新，README 的诚实限制段必须同时在场，不能借版本号暗示成熟度。

- **用 `bash scripts/prepare-release.sh major`，不要用 `auto`。** `auto` 的 rank 表只认 Conventional Commits，而删除扩展的那批提交刻意没带 `!:` 或 `BREAKING CHANGE`，`auto` 只会推出 patch 或 minor。`major` 由 `desktop/package.json` 的当前版本直接算出 `{major + 1}.0.0`。
- CHANGELOG 段落晋升为 `## [1.0.0]`，底部两条比较链接（`[未发布]` 与 `[1.0.0]`）由 `release.sh` 的三条校验守着。
- **发版当天**：先确认本机的 Chrome 扩展已经卸载，再到 Google Cloud 停用扩展那个 Chrome-extension 类型的 OAuth 客户端，并把实际停用日期记进 `docs/desktop-oauth-security.md`。顺序不能反，否则自己会先撞一次 `invalid_client`。停用的依据是「已无任何消费者」：没有其它装着扩展的机器，本机也会卸载。

## Windows 便携 ZIP

便携 ZIP 不使用 Forge 的扁平 `maker-zip` 结果。Release workflow 必须将原生 Windows package 放入以下结构，再压缩最外层 `PolyAsk Portable`：

```text
PolyAsk Portable/
├─ App/
├─ README.txt
└─ portable.json
```

发布包不得包含 `PolyAsk Data`。应用首次运行后在同级创建该目录；后续升级替换整个 `App`，避免旧 `app.asar` 残留，同时保留设置、Cookie、站点登录状态和 SQLite 数据。`portable.json` 与 `README.txt` 不含用户数据，可以随新包覆盖；`README.txt` 用 English、简体中文和繁體中文说明启动入口与升级边界。CI 与 Release 都调用 `desktop/scripts/archive-portable.ps1`：先从真实 Windows package 准备目录，再压缩并解包，确认 `portable.json`、`README.txt`、`App/polyask-desktop.exe` 和 `App/resources/app.asar` 均存在且 `PolyAsk Data` 不存在，最后交给归档脚本统一命名并生成 SHA-256。

## Desktop OAuth 与产物门禁

GitHub Actions Repository Variable `POLYASK_GOOGLE_DESKTOP_CLIENT_ID` 与 Repository Secret `POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET` 必须来自 Google Cloud 中同一个 `Desktop app` 客户端。Desktop 应用无法真正保密嵌入的 Client Secret，因此它不作为安全边界；仍用 Actions Secret 管理，避免进入仓库、命令行参数和构建日志。可用以下命令配置：

```bash
gh variable set POLYASK_GOOGLE_DESKTOP_CLIENT_ID --body '<client-id>.apps.googleusercontent.com'
gh secret set POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET
```

Release workflow 在每个 Desktop runner 上执行 `npm run configure-oauth`，生成被 Git 忽略的 `desktop/resources/oauth.json`。Forge 将其复制到应用 `resources`；`npm run collect-release` 会拒绝缺少 Client ID、Client Secret 或格式无效的产物，再统一命名并生成 SHA-256。Linux `.deb` 中该文件必须是普通用户可读的 `0644`；这是桌面客户端随包分发的凭据，不应被误述为发行包能够保密的服务端密钥。

正式 Release 只使用 Production Desktop Client；本地开发和测试使用独立的 Development Desktop Client，不得复用 Production Secret。Secret 出现在正式 Desktop 包中属于公开客户端的预期行为，不写入用户界面或 README；监控基线、异常判定和轮换步骤见 `docs/desktop-oauth-security.md`。

`desktop/package.json` 与 `desktop/package-lock.json` 的根版本必须一致。`scripts/prepare-release.sh` 同步更新这两处；`scripts/test-release-flow.js` 和 Desktop release tests 负责阻止版本、maker、矩阵或 OAuth 产物契约静默漂移。

## 脚本查不出的人工项

- 在 English / 简体中文 / 繁體中文下逐面看工作台、站点状态、结果库、综合、设置与命令面板：切换语言后无截断、异常换行或缺失的 `aria-label`。
- 核对 `README.md`、`CHANGELOG.md` 与设置页是否覆盖本版新增功能、限制、**权限**与隐私行为；删除已失效的入口与描述。改过权限或数据流向的版本必须同时看设置页里同步与本机数据两块的隐私文案。
- **模型映射逐站勾选**：拿 `README.md` 的映射表对着 `desktop/src/site-runtime/adapters-*.js` 的 `think()`/`fast()`/`state()` 九站过一遍（站点 A/B 灰度期要写清两条路径，不能只写新的）。
- **破坏性操作、明文存储、权限范围、不可撤销后果、数据保留规则不得弱化**；按钮、确认文案与实际动作必须一致。特别是「本机重置不删 Drive 数据」「删除是 tombstone」这两条承诺语义。
- 报障链路依赖两个 GitHub label：`release-watch` 由 `scripts/watch-releases.js` 自建；**`site-breakage` 必须在仓库里手工建过一次**（`gh label create site-breakage --color d73a4a --description "站点适配失灵"`），issue 模板引用不存在的 label 会静默丢弃、无任何报错。换仓库/fork 后要重建。
- 更新 `CLAUDE.md` 顶部的「最后与代码核对」日期与版本。
- 确认 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID` 与 `POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET` 来自同一个 Desktop 客户端，OAuth consent screen 的 Audience/测试用户或 Production 状态符合本次发布对象；凭据已打包不等于公众账号一定能完成授权。
- 按 `docs/desktop-oauth-security.md` 检查 Google Auth Platform 与 Drive API 指标；无法由发版、用户增长或集中测试解释的异常先调查再发布。
- 在能取得原生机器时，至少运行一次本版 Windows `.exe` 安装包和便携 ZIP，并安装 Linux `.deb` 和两种 macOS 架构包；未完成的原生验收必须写进 Release 限制，不得用 CI 构建成功替代。
- 核对 Release 资产恰好包含 5 个主包、5 个 `.sha256` 和版本说明；下载后抽查 SHA-256。Windows Squirrel 的 `.nupkg`/`RELEASES` 是更新元数据，当前不作为用户下载资产发布。
- **对 `CLAUDE.md` 与全部入库 docs（以 `git ls-files docs/` 为准，当前 6 份）逐条做「一小时测试」**：删掉它，接下来一小时我的行为会变吗？不会就删。重点扫五类——解释性长文、已失效的工具/站点说明、软性叮嘱、偶发流程、同一规则的重复措辞。**入库 docs 一起过，只查常驻文件会让专题文档单向膨胀。** 真删掉一整份 docs 时，`CLAUDE.md`/`README.md`/`CHANGELOG.md`/其它 docs 里指向它的引用要一并删——`verify.sh` 见到悬空引用会直接红。

## 用户可见文案

- 改任何用户可见文案，用 `content-l10n` skill 检查三语语义、术语、占位符、快捷键、URL、文件格式与长度限制。**不得只改一种语言。**
- 英文散文用 `humanizer` 自查，中文散文用 `humanizer-zh` 自查：清理破折号群、广告腔、三连套式、空泛总结与宣传性强化，**不改写技术事实**。
- 三语门禁是 `desktop/test/copy.test.ts`（`cd desktop && npm test` 覆盖）：`COPY.zhCN` / `COPY.zhTW` 的 key 必须与 `COPY.en` 逐字对齐、且英文文案不得为空。少一个键就红，多一个孤儿键同样红。

### i18n 落点（挑错文件 = 在别的界面拿不到 key）

| 落点 | 覆盖范围 |
| --- | --- |
| `desktop/src/shared/copy.ts` | 主表。`en` / `zhCN` / `zhTW` 三档，外壳通用词条直接写在这里，并把下面各分表 `...` 展开合并 |
| `desktop/src/shared/*-copy.ts` 分表 | 按领域拆的词条：archive / command / data-admin / productivity / prompt-library / sync / synthesis / workspace，各自导出 `{ en, zhCN, zhTW }` 供主表合并 |

`desktop/src/shared/status-copy.ts` **不是**第三张词条表，它是 `SiteCode → keyof DesktopCopy` 的映射（`STATUS_COPY_KEY`），把机器码翻译成主表里的某个键。

- **新增用户可见错误码要动三处**：`desktop/src/shared/protocol.ts` 的 `SITE_CODES` 数组（码的真源）、`status-copy.ts` 的 `STATUS_COPY_KEY`（码 → 文案键）、`copy.ts` 或对应分表的三语词条。漏任一处，`desktop/test/status-copy-coverage.test.ts`（源码里产出的每个码都要有文案、文案表里的每个码都要真有产出方，双向覆盖）与 `desktop/test/copy.test.ts`（三语 key 对齐）会红。错误码全表见 `docs/desktop.md`。
- **locale 解析只有一份**：`desktop/src/shared/locale.ts` 的 `resolveLocale`，外壳（`copy.ts` 的 `getCopy`）与站点运行时（preload 注入 `__AMS_I18N__.setLang`）共用它。前缀匹配（不是 `includes`）：`zh` / `zh-cn` / `zh-hans` → `zhCN`，`zh-tw` / `zh-hk` / `zh-mo` / `zh-hant` → `zhTW`，未命中的一律落 `en`（**不兜底成简体**）。想改档位映射只改这一处，别在调用点各自判断。
- **`document.documentElement.lang` 只在一处设置**：`desktop/src/renderer/index.tsx:719`（挂载 React 之前），按 `resolveLocale(navigator.language)` 归一成 `zh-CN` / `zh-TW` / `en`，供 CSS 选择器与读屏使用。
- **日期/时间格式化统一走 `desktop/src/shared/format.ts` 的 `formatDateTime(value, locale)`**，locale 由渲染层显式传入（`index.tsx` 的结果库与设置两处都传 `navigator.language`）。调用点不要留空让 `Intl` 取默认 locale，也不要各写一个 `Intl.DateTimeFormat` 配置。

## Git 惯例

- 发版前**持续维护** `CHANGELOG.md` 的「未发布」分类条目，所有用户可感知变更都要记——`prepare-release.sh` 直接晋升这一段，临发版补写必漏，而且 `release.sh --publish` 会因为「未发布段仍有条目」直接拒绝发布。
- CHANGELOG 只写**用户可感知**的变更，按用户读得懂的口径写。内部门禁与工具链调整（测试怎么串、行数限制盖到哪些目录）不是安全修复，也不要写成安全修复。
- 文档只描述**现状与陷阱**；待办一律落 `CHANGELOG.md`「未发布」或代码 `// TODO:`——文档里的待办没人跑，也不会红。
