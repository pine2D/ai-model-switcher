# PolyAsk Desktop 产品化审计

最后核对：2026-08-26。本文是桌面端产品化的持续审计台账，记录可复现现象、根因、修复和验证证据。架构与验收边界见 `docs/desktop-m0.md`，执行顺序见 `docs/desktop-productization-plan.md`。

## 审计口径

| 等级 | 含义 | 处置要求 |
| --- | --- | --- |
| Blocker | 登录、安全、数据损坏或核心群发无法继续 | 修复并完成自动化与真机回归后才能进入下一阶段 |
| P0 | 主要流程不可用、重复提交、视图丢失或不可恢复状态 | 当前阶段内修复 |
| P1 | 明显影响高频使用、可访问性或跨平台一致性 | 产品化完成前修复 |
| P2 | 视觉一致性、微交互或低频边界 | 有证据且不增加无关复杂度时修复 |

一项结论只有在对应范围内具备自动化输出、运行时快照、截图或原生平台记录时才算通过。“代码看起来正确”“未发现错误”和 WSLg 单机结果不能证明跨平台完成。

## 审计范围

- 九站 WebContents 生命周期、登录持久化、导航和权限。
- Grid、宽屏 Focus、窄屏 Focus、抽屉与全屏工作区切换。
- 档位切换、文字/图片群发、取消、重试边界和提交状态。
- 回答汇总、历史、归档、删除 tombstone 与辅助综合。
- SQLite、Google OAuth、Drive 同步、离线/限流/版本冲突与本地重置。
- 三语、键盘、中文输入法、读屏、高对比度、粗指针和 reduced motion。
- Windows、macOS、原生 Ubuntu 的安装、升级、系统缩放和 60 分钟稳定性。

## 当前基线

2026-08-24 的桌面 M0 已具备一个 Shell 和 9 个持久 `WebContentsView`、共享站点登录 session、绝对 deadline/epoch 群发、Grid/Focus、密度与页面缩放、三语状态、单站重载和安全 IPC。WSLg 真机确认九站可登录，除 Kimi 当时的付费业务限制外其余 8 站可提交并实时显示回答。

当前自动化基线包括桌面 TypeScript/React 与运行器测试、TypeScript 检查、Linux x64 package、运行依赖审计和扩展 `scripts/verify.sh`。打包产物 smoke 进一步证明 1 个 Shell、9 个唯一且同 Session 的安全站点视图；3 分钟短时 soak 完成 4 次采样且无 renderer crash/unresponsive。SQLite schema 1、WAL、事务 outbox、历史/归档 tombstone 与重开持久化已有自动化证据。站点范围、图片群发、回答采集、结果库、辅助综合和 Drive schema 1 同步均已迁移；归档 detach/reattach 不销毁站点视图，Drive 对 401、429/5xx、410、未来 schema、远端身份和断开竞态均有测试。

发行基线包括 Windows Squirrel 安装包和程序/数据分离的便携 ZIP、Linux deb、macOS x64/arm64 ZIP maker，扩展和 Desktop 共用版本。便携版固定使用 `App` 与 `PolyAsk Data` 分目录，首次可复制旧版设置和站点会话，升级只替换 `App`。实际 Linux x64 `.deb` 已生成并检查包元数据、可执行链接和 OAuth 资源；归档脚本会验证 OAuth Client ID、统一文件名并生成 SHA-256。只有对应 tag 的 Release workflow 成功后，原生 runner 产物才算发布证据。

## 已知未完成证据

- 正式 60 分钟稳定性报告尚未执行；3 分钟短测不能替代。
- Windows、macOS、原生 Ubuntu 尚未完成同版本原生验收。
- 六个兼容站点的真实附件上传尚未在同一版本逐站人工回归；自动化只能证明图片校验、协议、范围拦截和发行产物加载。
- 九站真实回答采集与结果库打开/关闭后的页面进度保持尚未在同一版本逐站人工回归。
- Windows Narrator、macOS VoiceOver、Ubuntu Orca、高对比度和完整缩放矩阵尚无证据。
- Google Desktop OAuth Client ID 已配置并证明进入 Linux `.deb`；系统浏览器授权、refresh token 持久化和 Drive 联网同步尚无真实账号证据。
- Windows `.exe` 安装包和便携 ZIP、macOS x64/arm64 ZIP、Linux `.deb` 尚未完成同版本原生安装、升级与卸载；所有包仍未签名，macOS 未公证。

这些项目保持未通过，直至 `docs/desktop-productization-plan.md` 的对应任务完成并在本文记录证据。

## 发现与处置

2026-08-25 已完成一轮静态缺陷与 UI/UX 审查，补齐串行写入、删除确认时效、同步中断、异步安全存储降级、表单语义、键盘焦点、Windows 高对比度和三语日期格式。发布链路实跑又发现并修复两项只在 maker 阶段出现的问题：`productName` 与 Deb 可执行文件名不一致，以及 OAuth 资源以 root-only `0600` 进入 `.deb`。两项均有回归测试和实际包内容复核。

2026-08-26 收紧群发、重试、新会话、采集和辅助综合之间的并发边界，并修复结果库筛选竞态与启动失败恢复。Windows x64 便携 ZIP 已改为程序/数据分离结构，并补齐旧数据复制、升级保留和 ZIP 解包审计。自动化覆盖任意站点数量、原发送范围重试、双 Windows 产物收集和真实 Windows package 的便携归档校验；Linux 打包应用另以真实 `App`/`PolyAsk Data` 结构通过首次启动冒烟，但仍需 Windows 原生运行验收。

后续发现仍需记录复现步骤和影响范围；每个代码修复先有失败测试，无法自动化的视觉或平台问题必须附运行环境与截图。静态审查和 WSLg 证据不替代原生平台验收。
