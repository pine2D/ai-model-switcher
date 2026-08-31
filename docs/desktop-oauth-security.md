# Desktop OAuth 安全运营

本文供 PolyAsk 维护者使用，记录 Google Desktop OAuth 的安全边界、监控基线和事故处置。普通用户需要了解的是授权范围、令牌保存方式和数据流向，不需要承担 Client Secret 的实现细节。

## 安全边界

- Desktop 是 OAuth 公开客户端。Google 当前要求 Desktop 客户端在授权码交换和刷新时提交 Client Secret，但该值会随安装包分发，不能用于证明请求来自正版 PolyAsk。
- Client Secret 单独不能读取用户数据。攻击者仍需诱导用户授权或取得 Access Token / Refresh Token；因此令牌保护比隐藏静态 Secret 更重要。
- Desktop 固定使用 PKCE S256、随机 `state`、系统浏览器、`127.0.0.1` 随机端口回调和 `drive.appdata` 最小权限。Refresh Token 只通过 Electron `safeStorage` 持久化。
- Chrome 扩展使用独立的 Chrome Extension OAuth Client，并由 `chrome.identity` 管理令牌，不使用 Desktop Client Secret。

### 已知并接受的风险：打包版仍读诊断环境变量

`desktop/src/main/runtime-gates.ts` 对 `POLYASK_DIAGNOSTICS_FILE` 与 `POLYASK_SOAK_REPORT` **没有 `app.isPackaged` 门禁**，正式安装包同样认这两个变量。`POLYASK_SOAK_REPORT` 命中时会对该路径建目录、覆写清空已有内容、每 60 秒追加采样，超时后自动退出应用。

危害边界：攻击前提已经是「同用户代码执行 / 能持久化环境变量」，能造成的是以应用身份截断任意可写路径的文件、外加定时自退出这一级别的同用户骚扰性拒绝服务；**不涉及凭据，也不提权**。不修的原因是 `desktop/scripts` 下的 smoke、soak、runtime-runner 三个脚本依赖这两个变量对打包后产物做自动化验收，`docs/desktop-m0.md` 已写成既定口径并被 CI 依赖，照搬门禁会打断该验证链。

这与已经收紧的 `sync-runtime.ts`（打包版不再优先读环境变量凭据，`environment: app.isPackaged ? undefined : process.env`）是同一种模式的两处实例——一处已收紧、一处未收紧，是权衡后的现状而非疏漏。要动它，得先给三个验收脚本换一条不依赖环境变量的通道。

## 凭据与环境隔离

| 环境 | OAuth Client | 凭据入口 | 约束 |
| --- | --- | --- | --- |
| Desktop 正式版 | Production Desktop Client | GitHub Actions Variable + Secret | 只用于 tag 对应的 Release workflow |
| Desktop 本地开发/测试 | Development Desktop Client | 被 Git 忽略的 `desktop/resources/oauth.json` 或本机环境变量 | 不得复用 Production Secret |
| Chrome 扩展 | Chrome Extension Client | `manifest.json` 的 Client ID | 与 Desktop Client 分离，不存在 Client Secret |

正式客户端平时只保留一个启用的 Secret；第二个只在轮换窗口中启用。Client ID 可以公开，Client Secret 不得进入 Git、CI 日志、问题附件、崩溃报告或诊断快照。正式安装包必须包含它不属于泄露事件，但不得把安装包中的值复制到其它公开渠道。

`scripts/verify.sh` 会执行以下门禁：

- `desktop/resources/oauth.json` 必须继续被 Git 忽略且不得进入版本控制；
- 将进入版本控制的文本文件不得包含当前格式的 Google Desktop Secret；
- 失败日志只列出文件路径和行号，不回显匹配内容；
- Release workflow 继续通过 GitHub Actions Secret 注入正式凭据，归档脚本继续拒绝无完整凭据的 Desktop 产物。

## 监控基线

Google 不提供具体 Secret 的使用日志，也不向普通应用开发者展示 Token Endpoint 请求的来源 IP。下面的信号只能发现异常，不能单独证明 Secret 已被提取。

### Google Auth Platform

进入 **Google Cloud Console → Google Auth Platform → Overview**，查看每日 OAuth 请求、错误和 Token 授予速率。预览期每周检查一次；稳定期至少每月及每次发版前检查一次。先保留不少于 14 天的正常基线，再调查无法由发布、用户增长或集中测试解释的阶跃变化。

Overview 指标是项目下所有 OAuth Client 的汇总。需要更强隔离时，应把 Desktop 与 Extension 放入不同 Google Cloud 项目；仅创建不同 Client ID 不能获得 Secret 级归因。

### Google Drive API

进入 **APIs & Services → Google Drive API → Metrics / Quotas**，再从 **Monitoring → Alerting** 为请求量、4xx/5xx 错误和配额利用率创建告警。配额利用率可先以 80% 为预警线；请求量和错误率应按正常基线设定，不在缺少真实流量前写死绝对阈值。

以下任一现象都需要调查：

- OAuth 请求或新授权用户数出现无法解释的增长；
- Drive API 请求量、403、429 或持续错误突然上升；
- 用户报告自己未操作却看到 PolyAsk 授权页；
- Google 发出验证、配额、风险或项目限制通知；
- 已退出使用的旧版本仍表现出异常 OAuth 流量。

Google Workspace Token Audit 只覆盖管理员自己组织内的用户，不是 PolyAsk 监控所有 Gmail 用户的全局审计来源。

## 事件分级

| 情况 | 判断 | 处置 |
| --- | --- | --- |
| Secret 仅存在于正式 Desktop 包 | 正常公开客户端行为 | 不轮换，保持监控 |
| Secret 进入 Git 历史、CI 日志或公开问题附件 | 凭据暴露 | 立即开始 Secret 轮换 |
| OAuth/Drive 指标异常或出现仿冒授权反馈 | 疑似滥用 | 保留时间线与指标，轮换 Secret 并调查 |
| Access Token / Refresh Token 泄露 | 用户授权数据风险 | 立即撤销相关 Token；无法定位时升级处置 |
| 持续大规模仿冒、配额滥用或 Google 限制项目 | 严重事件 | 更换整个 Desktop Client ID，要求用户重新连接 |

## Secret 轮换

1. 记录事件开始时间、受影响 Client ID、异常指标和相关版本；记录中不得复制完整 Secret 或 Token。
2. 在 **Google Auth Platform → Clients → PolyAsk Desktop** 中新增一个 Secret。Google 最多允许两个 Secret 并行，旧 Secret 此时仍有效。
3. 更新 GitHub Actions Secret `POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET`，构建并验证新版本；不要把值作为命令行参数或写入日志。
4. 发布新版本并明确旧版需要升级。便携版用户仍替换整个 `App`，保留 `PolyAsk Data`。
5. 达到预定升级窗口后先禁用旧 Secret，观察新版授权、刷新和 Drive 同步。未升级旧版会在重新授权或刷新 Token 时失败。
6. 确认新版工作正常后删除旧 Secret。禁用与删除之间保留短暂回退窗口，不长期同时启用两个 Secret。
7. 若 Secret 轮换仍不能控制异常，创建新的 Production Desktop Client，发布使用新 Client ID 的版本，并要求所有用户重新连接 Google Drive。

Secret 轮换不能永久隐藏新版中的 Secret，它只负责让旧副本失效并缩短事故窗口。没有异常证据时，不因正式安装包可提取而频繁轮换，以免无意义地破坏旧版刷新流程。

## 后续加固边界

- DPoP 可以把 Refresh Token 与设备私钥绑定，降低令牌复制后的重放风险；实施前必须先设计跨平台硬件密钥、备份、迁移和降级行为。
- 服务端 Token Broker 可以真正保住 Client Secret，但会引入服务器可用性、账号体系、隐私和运营责任；在产品明确接受这些变化前不实施。
- Windows 代码签名、macOS 签名/公证和 Release 校验和用于帮助用户识别正版产物，不会使 Desktop Client Secret 变成机密。

## 官方参考

- [OAuth 2.0 for Native Apps（RFC 8252）](https://datatracker.ietf.org/doc/html/rfc8252)
- [Google Auth Platform Overview](https://support.google.com/cloud/answer/15548748?hl=en)
- [Google OAuth Client 管理与轮换](https://support.google.com/cloud/answer/15549257?hl=en)
- [Google OAuth 安全最佳实践](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Google API 使用监控](https://cloud.google.com/apis/docs/monitoring)
- [Google Cloud 配额告警](https://cloud.google.com/monitoring/alerts/using-quota-metrics)
- [Google DPoP 指南](https://developers.google.com/identity/protocols/oauth2/resources/dpop-adoption)
