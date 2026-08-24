# PolyAsk Desktop 产品化审计

最后核对：2026-08-25。本文是桌面端产品化的持续审计台账，记录可复现现象、根因、修复和验证证据。架构与验收边界见 `docs/desktop-m0.md`，执行顺序见 `docs/desktop-productization-plan.md`。

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

当前自动化基线为 62 项桌面 TypeScript/React 测试、1 项运行器测试、TypeScript 检查、Linux x64 package、运行依赖审计和扩展 `scripts/verify.sh` 全绿。打包产物 smoke 进一步证明 1 个 Shell、9 个唯一且同 Session 的安全站点视图；3 分钟短时 soak 完成 4 次采样且无 renderer crash/unresponsive。SQLite schema 1、WAL、事务 outbox、历史/归档 tombstone 与重开持久化已有自动化证据。站点范围、快捷范围、用户分组和已选站点新会话已迁移；抽屉占位同时覆盖 Grid 与 Focus。

## 已知未完成证据

- 正式 60 分钟稳定性报告尚未执行；3 分钟短测不能替代。
- Windows、macOS、原生 Ubuntu 尚未完成同版本原生验收。
- 图片、汇总、归档、辅助综合和 Drive 尚未迁移到桌面端。
- Windows Narrator、macOS VoiceOver、Ubuntu Orca、高对比度和完整缩放矩阵尚无证据。
- Google Desktop OAuth client 尚未配置；Chrome Extension 类型 client 不可替代。

这些项目保持未通过，直至 `docs/desktop-productization-plan.md` 的对应任务完成并在本文记录证据。

## 发现与处置

当前尚未进入迁移完成后的全面缺陷审查阶段。本节只接收有复现步骤和影响范围的发现；每个代码修复必须先有失败测试，无法自动化的视觉或平台问题必须附运行环境与截图。
