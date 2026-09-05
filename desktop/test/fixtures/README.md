# Drive schema 1 线格式 fixture

`schema1-*.json` 是 Google Drive appDataFolder 里 **schema 1** 记录的冻结样本，每个文件 = `{ file, body }`：
`file` 是 Drive 文件元数据（`appProperties` 按上传口径），`body` 是下载得到的正文。

来源：2026-09-05 用扩展侧真实实现生成——归档记录出自 `bg/archive-model.js` 的 `normalize()` / `update()`
（入口形状取 `console/status.js` 的 `archiveSummary`）、历史与 tombstone 按 `bg/data.js` 的
`addHistory` / `deleteHistory` / `writeArchiveDelete`、state fragment 按 `deviceState` + `noteStorageChanges`、
文件元数据按 `bg/sync.js` 的上传分支。扩展代码已删除（代码保留在 tag `archive/extension-v0.25.1`），这些文件就是线格式的唯一真源。

规则：**不要重新生成、不要按新校验「修正」它们**。`schema1-wire-format.test.ts` 会把全部样本喂给
同步下行链路并要求逐条接收；任何一次校验收紧命中了存量形状，会先红在那里，而不是在用户的结果库里静默少几条。
只有 `SYNC_SCHEMA` 真的升版时才新增 `schema2-*.json`，schema 1 样本保留。
