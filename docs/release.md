# 发版与用户可见文案

**Chrome 扩展与 Desktop 预览包共用同一个版本号、tag 和 GitHub Release。** 本文记录发布门禁、两套打包边界、Desktop OAuth 注入、人工核查项、三语文案与 Git/CHANGELOG 惯例；桌面端验收边界见 `docs/desktop-m0.md`。冲突以 `CLAUDE.md` 为准。

## 流程

```bash
# 0. 「未发布」段已记录所有用户可感知变更（发版前持续维护，不要临发版补）
bash scripts/prepare-release.sh auto   # 晋升 CHANGELOG，同步 manifest、Desktop package/lock 与比较链接（只改文件，不 commit）
# 1. 人工审阅发版 diff，做下面的「脚本查不出的人工项」
bash scripts/verify.sh
cd desktop && npm test && npm run typecheck && npm audit --omit=dev
cd .. && bash scripts/release.sh --build-only   # 本机校验 Chrome ZIP 与 Release notes
# 2. commit 并 push main
bash scripts/release.sh --publish      # 推 v* tag；Release workflow 构建并发布全部资产
```

`--publish` 只在**工作区干净、分支为 main 且跟踪 origin/main、HEAD 已完整推送、exact-HEAD 的 CI 成功、tag 不存在**时才推 tag。Release workflow 再校验同一提交确实位于 `origin/main` 且 CI 成功，之后并行构建各平台。**已发布 tag 不覆盖；要改内容必须升新版本。** 脚本用法跑 `-h`。

每个 Release 应包含：

- Chrome：`polyask-vX.Y.Z.zip` 及 SHA-256。
- Windows x64：`polyask-desktop-vX.Y.Z-windows-x64.exe` 及 SHA-256。
- Linux x64：`polyask-desktop-vX.Y.Z-linux-x64.deb` 及 SHA-256。
- macOS：`polyask-desktop-vX.Y.Z-macos-x64.zip`、`polyask-desktop-vX.Y.Z-macos-arm64.zip` 及各自 SHA-256。
- `CHANGELOG.md` 对应版本段作为 Release 正文。

Desktop 当前按预览版发布，不签名、不公证、不自动更新。Windows、macOS、Linux 产物必须在对应原生 runner 上生成；不得从 Linux 交叉伪造 macOS 包。等证书和平台账号就绪后，再把签名与公证加入同一矩阵，不能在文案里提前声称已签名。

## Desktop OAuth 与产物门禁

GitHub Actions Repository Variable `POLYASK_GOOGLE_DESKTOP_CLIENT_ID` 必须保存 Google Cloud 的 `Desktop app` Client ID。它是公开标识，不是密码；仓库和 CI 均不接收 `client_secret`。可用以下命令配置：

```bash
gh variable set POLYASK_GOOGLE_DESKTOP_CLIENT_ID --body '<client-id>.apps.googleusercontent.com'
```

Release workflow 在每个 Desktop runner 上执行 `npm run configure-oauth`，生成被 Git 忽略的 `desktop/resources/oauth.json`。Forge 将其复制到应用 `resources`；`npm run collect-release` 会拒绝 OAuth 文件缺失或格式无效的产物，再统一命名并生成 SHA-256。Linux `.deb` 中该公开文件必须是普通用户可读的 `0644`，不能沿用凭据文件的 `0600`。

`desktop/package.json`、`desktop/package-lock.json` 根版本和 `manifest.json` 必须一致。`scripts/prepare-release.sh` 同步更新三处；`scripts/test-release-flow.js` 和 Desktop release tests 负责阻止版本、maker、矩阵或 OAuth 产物契约静默漂移。

## 打包白名单（`scripts/package.sh`）

新增扩展运行时顶层文件或目录必须加进 `RUNTIME` 数组（当前：`manifest.json _locales i18n.js background.js bg icons content console popup options`）。`desktop/` 有独立工具链和产物，禁止加入扩展 `RUNTIME` 或 ZIP。

`package.sh` 的产物对账把 manifest、各 HTML 的 `src`/`href`、`background.js` 的 `importScripts` 引用到的每个文件与 zip 条目逐一比对，缺一即打包失败并删掉半成品 zip。**v0.5.0 / v0.6.0 坏包事故根因**：白名单漏了 `i18n.js` 与 `_locales`，本地 unpacked 一切正常，只有在干净机器装 zip 才炸。对账只能校验能从 manifest/HTML/importScripts 推导出的引用——运行时动态拼路径的资源仍会漏。

## 脚本查不出的人工项

- 在 English / 简体中文 / 繁體中文下逐页看 popup、console、scope、compose、archive、options：切换语言后无截断、异常换行或缺失的 `aria-label`。
- 核对 `README.md`、`CHANGELOG.md`、扩展说明和设置页是否覆盖本版新增功能、限制、**权限**、隐私行为及最新模型映射；删除已失效的入口与描述。改过权限的版本必须同时看 options 的 `#privacy` 区。
- **破坏性操作、明文存储、权限范围、不可撤销后果、数据保留规则不得弱化**；按钮、确认文案与实际动作必须一致。特别是「本机重置不删 Drive 数据」「删除是 tombstone」这两条承诺语义。
- 发版前跑 `node scripts/probe-drift.js`（后台标签冻结时加 `--activate`），要求**覆盖 9/9 站**且 `!` 警报逐条处置；复核用 `--dry`（警报会被本轮落盘的快照消费，直接复跑只会看到绿）。
- 报障链路依赖两个 GitHub label：`release-watch` 由 `scripts/watch-releases.js` 自建；**`site-breakage` 必须在仓库里手工建过一次**（`gh label create site-breakage --color d73a4a --description "站点适配失灵"`），issue 模板引用不存在的 label 会静默丢弃、无任何报错。换仓库/fork 后要重建。
- 更新 `CLAUDE.md` 顶部的「最后与代码核对」日期与版本。
- 确认 `POLYASK_GOOGLE_DESKTOP_CLIENT_ID` 存在，OAuth consent screen 的 Audience/测试用户或 Production 状态符合本次发布对象；Client ID 已打包不等于公众账号一定能完成授权。
- 在能取得原生机器时，至少安装一次本版 Windows `.exe`、Linux `.deb` 和两种 macOS 架构包；未完成的原生验收必须写进 Release 限制，不得用 CI 构建成功替代。
- 核对 Release 资产恰好包含 5 个主包、5 个 `.sha256` 和版本说明；下载后抽查 SHA-256。Windows Squirrel 的 `.nupkg`/`RELEASES` 是更新元数据，当前不作为用户下载资产发布。
- **对 `CLAUDE.md` 与四份专题文档（`docs/adapters.md`、`docs/console-windows.md`、`docs/verify.md`、`docs/release.md`）逐条做「一小时测试」**：删掉它，接下来一小时我的行为会变吗？不会就删。重点扫五类——解释性长文、已失效的工具/站点说明、软性叮嘱、偶发流程、同一规则的重复措辞。**四份 docs 一起过，只查常驻文件会让专题文档单向膨胀。** 真删掉一整份 docs 时，`CLAUDE.md`/`README.md`/其它 docs 里指向它的引用要一并删——`verify.sh` 见到悬空引用会直接红。

## 用户可见文案

- 改任何用户可见文案，用 `content-l10n` skill 检查三语语义、术语、占位符、快捷键、URL、文件格式与长度限制。**不得只改一种语言。**
- 英文散文用 `humanizer` 自查，中文散文用 `humanizer-zh` 自查：清理破折号群、广告腔、三连套式、空泛总结与宣传性强化，**不改写技术事实**。
- `node scripts/test-content-l10n.js`（`verify.sh` 已包含）：三语键覆盖、占位符一致、HTML i18n 引用有效、英文用户文案不含长破折号。

### i18n 落点（挑错文件 = 在别的页面拿不到 key）

| 落点 | 覆盖范围 |
| --- | --- |
| 根目录 `i18n.js` 的 `MSG` 同步字典 | 真身。en / zh_CN / zh_TW，popup + console + content 共用 |
| `console/workspace-i18n.js` | compose / archive 专属词条，`Object.assign(MSG, …)` 追加 |
| `options/options-i18n.js` | 设置页专属词条，同样是追加 |
| `bg/page-context.js` 的 `MENU_COPY` | 右键菜单标题，按 `storage.local.amsLang` 三语手写，**不走 i18n.js** |
| `_locales/*/messages.json` | 只有 manifest 用的 5 条：`extName`、`extDescription`、`cmdThink`、`cmdFast`、`cmdOpenConsole` |

加错文件的后果：别的页面拿不到 key，而 `test-content-l10n.js` 要么报缺键、要么根本不覆盖；右键菜单还会不跟随用户选的语言。

新增用户可见错误码除三语词条外，还要补四张翻译表（见 `docs/console-windows.md` 错误码全表）。

## Git 惯例

- 发版前**持续维护** `CHANGELOG.md` 的「未发布」分类条目，所有用户可感知变更都要记——`prepare-release.sh auto` 直接晋升这一段，临发版补写必漏。
- 文档只描述**现状与陷阱**；待办一律落 `CHANGELOG.md`「未发布」或代码 `// TODO:`——文档里的待办没人跑，也不会红。
