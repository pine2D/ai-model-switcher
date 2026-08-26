import assert from "node:assert/strict";
import test from "node:test";

import { COPY, getCopy } from "../src/shared/copy";
import { describeCollectionCode, describeStatus, visibleStatus } from "../src/shared/status-copy";
import { describeSync } from "../src/renderer/sync-status";

test("desktop shell keeps complete English, Simplified Chinese and Traditional Chinese copy", () => {
  const sourceKeys = Object.keys(COPY.en).sort();
  assert.deepEqual(Object.keys(COPY.zhCN).sort(), sourceKeys);
  assert.deepEqual(Object.keys(COPY.zhTW).sort(), sourceKeys);
  assert.ok(sourceKeys.every((key) => COPY.en[key as keyof typeof COPY.en].length > 0));
  assert.equal(sourceKeys.includes("brandSub"), false);
});

test("site paging copy is concise, localized, and placeholder-compatible", () => {
  assert.deepEqual(
    [COPY.en.sitePages, COPY.zhCN.sitePages, COPY.zhTW.sitePages],
    ["Site pages", "站点分页", "網站分頁"]
  );
  assert.deepEqual(
    [COPY.en.sitePageLabel, COPY.zhCN.sitePageLabel, COPY.zhTW.sitePageLabel],
    ["Page {page}, sites {range}", "第 {page} 页，站点 {range}", "第 {page} 頁，網站 {range}"]
  );
  for (const locale of Object.values(COPY)) {
    assert.deepEqual([...locale.sitePageLabel.matchAll(/\{[a-z]+\}/g)].map(String), ["{page}", "{range}"]);
    assert.deepEqual([...locale.sitePageChanged.matchAll(/\{[a-z]+\}/g)].map(String), ["{page}", "{total}"]);
  }
});

test("Drive local-only state and settings close action stay precise in all locales", () => {
  assert.deepEqual(
    [COPY.en.syncStateLocalOnly, COPY.zhCN.syncStateLocalOnly, COPY.zhTW.syncStateLocalOnly],
    ["Local only", "仅保存在本机", "僅儲存在本機"]
  );
  assert.deepEqual(
    [COPY.en.closeSettings, COPY.zhCN.closeSettings, COPY.zhTW.closeSettings],
    ["Close settings", "关闭设置", "關閉設定"]
  );
  for (const locale of Object.values(COPY)) {
    assert.deepEqual([...locale.syncStateLocalOnly.matchAll(/\{[a-z]+\}/g)].map(String), []);
    assert.deepEqual([...locale.closeSettings.matchAll(/\{[a-z]+\}/g)].map(String), []);
  }
});

test("Drive timeout guidance is explicit and localized", () => {
  assert.deepEqual(
    [COPY.en.syncReasonTimeout, COPY.zhCN.syncReasonTimeout, COPY.zhTW.syncReasonTimeout],
    [
      "Connection timed out. Check your network or proxy, then try again.",
      "连接超时。请检查网络或代理设置后重试。",
      "連線逾時。請檢查網路或代理設定後再試一次。"
    ]
  );
  const status = { state: "offline", connected: false, pending: 0, errorCount: 0, reason: "network_timeout", readOnly: false, oauthConfigured: true, secureTokenStorage: true } as const;
  assert.equal(describeSync(COPY.zhCN, status), COPY.zhCN.syncReasonTimeout);
});

test("Drive connection phases describe browser authorization and Drive verification honestly", () => {
  assert.deepEqual(
    [COPY.en.syncStateAuthorizing, COPY.zhCN.syncStateAuthorizing, COPY.zhTW.syncStateAuthorizing],
    [
      "Waiting for browser authorization…",
      "正在等待浏览器完成授权……",
      "正在等待瀏覽器完成授權……"
    ]
  );
  assert.deepEqual(
    [COPY.en.syncStateConnecting, COPY.zhCN.syncStateConnecting, COPY.zhTW.syncStateConnecting],
    [
      "Checking Google Drive access…",
      "正在检查 Google Drive 访问权限……",
      "正在檢查 Google Drive 存取權限……"
    ]
  );
  const base = { state: "syncing", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: true, secureTokenStorage: true } as const;
  assert.equal(describeSync(COPY.zhCN, { ...base, reason: "oauth" }), COPY.zhCN.syncStateAuthorizing);
  assert.equal(describeSync(COPY.zhCN, { ...base, reason: "drive_check" }), COPY.zhCN.syncStateConnecting);
});

test("result-library loading copy stays complete and localized", () => {
  const messages = [COPY.en.archiveLoading, COPY.zhCN.archiveLoading, COPY.zhTW.archiveLoading];
  assert.deepEqual(messages, ["Loading results…", "正在加载结果…", "正在載入結果…"]);
  assert.ok(messages.every((message) => message.endsWith("…") && !message.includes("...")));
  assert.deepEqual(
    messages.map((message) => [...message.matchAll(/\{[a-z]+\}/g)].map(String)),
    [[], [], []]
  );
});

test("fatal startup copy keeps matching keys and a localized Simplified Chinese title", () => {
  const startupKeys = ["startupFailedMessage", "startupFailedTitle"];
  for (const locale of Object.values(COPY)) {
    assert.deepEqual(Object.keys(locale).filter((key) => key.startsWith("startupFailed")).sort(), startupKeys);
  }
  assert.equal(COPY.zhCN.startupFailedTitle, "PolyAsk 无法启动");
});

test("renderer bootstrap recovery copy stays complete and localized", () => {
  const expected = {
    en: [
      "Starting PolyAsk…",
      "PolyAsk could not load the workspace.",
      "Try again",
      "Could not apply display preferences"
    ],
    zhCN: [
      "正在启动 PolyAsk……",
      "PolyAsk 工作区加载失败。",
      "重试",
      "无法应用显示偏好设置"
    ],
    zhTW: [
      "正在啟動 PolyAsk……",
      "PolyAsk 工作區載入失敗。",
      "重試",
      "無法套用顯示偏好設定"
    ]
  } as const;

  for (const locale of Object.keys(expected) as Array<keyof typeof expected>) {
    const copy = COPY[locale];
    const messages = [
      copy.shellLoading,
      copy.shellLoadFailed,
      copy.retryShellLoad,
      copy.displayPreferencesFailed
    ];
    assert.deepEqual(messages, expected[locale]);
    assert.ok(messages.every((message) => !message.includes("...")));
    assert.deepEqual(
      messages.map((message) => [...message.matchAll(/\{[a-z]+\}/g)].map(String)),
      [[], [], [], []]
    );
  }
});

test("run recovery and new-session copy keeps matching keys and placeholders", () => {
  assert.deepEqual(
    [
      COPY.en.failedSummary,
      COPY.en.cancelledSummary,
      COPY.en.mixedFailureSummary,
      COPY.en.retryFailedSites,
      COPY.en.retryCancelledSites,
      COPY.en.retryFailedOrCancelledSites,
      COPY.en.newSessionDone,
      COPY.en.newSessionPartial
    ],
    [
      "{count} selected sites failed",
      "Sending was cancelled for {count} selected sites",
      "Selected sites: {failed} failed, {cancelled} cancelled",
      "Retry {count} failed sites",
      "Retry {count} cancelled sites",
      "Retry {count} failed or cancelled sites",
      "New sessions opened for {count} selected sites",
      "New sessions opened for {ok} sites; {failed} failed"
    ]
  );
  assert.deepEqual(
    [
      COPY.zhCN.failedSummary,
      COPY.zhCN.cancelledSummary,
      COPY.zhCN.mixedFailureSummary,
      COPY.zhCN.retryFailedSites,
      COPY.zhCN.retryCancelledSites,
      COPY.zhCN.retryFailedOrCancelledSites,
      COPY.zhCN.newSessionDone,
      COPY.zhCN.newSessionPartial
    ],
    [
      "{count} 个已选站点失败",
      "{count} 个已选站点已取消发送",
      "已选站点：{failed} 个失败，{cancelled} 个已取消发送",
      "重试 {count} 个失败站点",
      "重试 {count} 个已取消站点",
      "重试 {count} 个失败或已取消站点",
      "已为 {count} 个已选站点新建会话",
      "已为 {ok} 个站点新建会话，{failed} 个失败"
    ]
  );
  assert.deepEqual(
    [
      COPY.zhTW.failedSummary,
      COPY.zhTW.cancelledSummary,
      COPY.zhTW.mixedFailureSummary,
      COPY.zhTW.retryFailedSites,
      COPY.zhTW.retryCancelledSites,
      COPY.zhTW.retryFailedOrCancelledSites,
      COPY.zhTW.newSessionDone,
      COPY.zhTW.newSessionPartial
    ],
    [
      "{count} 個已選網站失敗",
      "{count} 個已選網站已取消傳送",
      "已選網站：{failed} 個失敗，{cancelled} 個已取消傳送",
      "重試 {count} 個失敗網站",
      "重試 {count} 個已取消網站",
      "重試 {count} 個失敗或已取消網站",
      "已為 {count} 個已選網站新增對話",
      "已為 {ok} 個網站新增對話，{failed} 個失敗"
    ]
  );
  for (const locale of Object.values(COPY)) {
    assert.deepEqual([...locale.failedSummary.matchAll(/\{[a-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual([...locale.cancelledSummary.matchAll(/\{[a-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual(
      [...locale.mixedFailureSummary.matchAll(/\{[a-z]+\}/g)].map(String),
      ["{failed}", "{cancelled}"]
    );
    assert.deepEqual([...locale.retryFailedSites.matchAll(/\{[a-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual([...locale.retryCancelledSites.matchAll(/\{[a-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual(
      [...locale.retryFailedOrCancelledSites.matchAll(/\{[a-z]+\}/g)].map(String),
      ["{count}"]
    );
    assert.deepEqual([...locale.newSessionDone.matchAll(/\{[a-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual([...locale.newSessionPartial.matchAll(/\{[a-z]+\}/g)].map(String), ["{ok}", "{failed}"]);
  }
});

test("desktop shell resolves exact supported locale and falls back to English", () => {
  assert.equal(getCopy("zh-CN").send, "发送");
  assert.equal(getCopy("zh-TW").send, "傳送");
  assert.equal(getCopy("zh-HK").send, "傳送");
  assert.equal(getCopy("zh-MO").send, "傳送");
  assert.equal(getCopy("en-GB").send, "Send");
  assert.equal(getCopy("fr-FR").send, "Send");
});

test("display preferences have complete localized menu labels", () => {
  assert.deepEqual(
    [
      getCopy("en").densityMenu,
      getCopy("en").compactDensity,
      getCopy("en").comfortableDensity,
      getCopy("en").siteScaleMenu,
      getCopy("en").fitSiteScale,
      getCopy("en").actualSiteScale
    ],
    ["Interface density", "Compact", "Comfortable", "Site scale", "Fit (90%)", "Actual size (100%)"]
  );
  assert.equal(getCopy("zh-CN").compactDensity, "紧凑");
  assert.equal(getCopy("zh-TW").actualSiteScale, "原始大小（100%）");
});

test("desktop status details never expose raw adapter reasons", () => {
  assert.equal(getCopy("zh-CN").tierUnconfirmed, "已发送，回答档位未确认");
  assert.equal(getCopy("zh-TW").submitUnconfirmed, "是否送出尚未確認");
  assert.equal(getCopy("en").composerNotFound, "Prompt box not found");
  assert.equal(
    describeStatus(getCopy("zh-CN"), {
      site: "claude",
      phase: "failed",
      code: "submit_unconfirmed"
    }),
    "是否发送成功尚未确认"
  );
  assert.equal(
    describeStatus(getCopy("en"), {
      site: "claude",
      phase: "failed",
      code: "private_adapter_reason"
    }),
    "Failed"
  );
  assert.equal(
    describeStatus(getCopy("zh-CN"), {
      site: "claude",
      phase: "failed",
      code: "attachment_unsupported"
    }),
    "该站点不支持图片群发"
  );
  assert.equal(
    describeStatus(getCopy("zh-TW"), {
      site: "claude",
      phase: "failed",
      code: "attachment_timeout"
    }),
    "等待圖片附件逾時"
  );
  assert.equal(
    describeStatus(getCopy("zh-CN"), {
      site: "claude",
      phase: "failed",
      code: "attachment_action_required"
    }),
    "请在该站点完成图片附件操作"
  );
});

test("dense tiles show short text only for statuses that need attention", () => {
  const copy = getCopy("en");
  assert.equal(visibleStatus(copy, { site: "claude", phase: "ready" }), null);
  assert.equal(visibleStatus(copy, { site: "claude", phase: "sending" }), null);
  assert.equal(
    visibleStatus(copy, { site: "claude", phase: "warning", code: "tier_unconfirmed" }),
    "Sent; response mode not confirmed"
  );
  assert.equal(
    visibleStatus(copy, { site: "claude", phase: "failed", code: "submit_unconfirmed" }),
    "Whether it was sent is unconfirmed"
  );
  assert.equal(
    visibleStatus(copy, { site: "claude", phase: "failed", code: "composer_not_found" }),
    "Prompt box not found"
  );
  assert.equal(
    visibleStatus(copy, { site: "claude", phase: "failed", code: "private_reason" }),
    "Failed"
  );
  assert.equal(visibleStatus(copy, { site: "claude", phase: "crashed" }), "Stopped");
});

test("archive collection placeholders use localized stable codes", () => {
  const copy = getCopy("zh-CN");
  assert.equal(describeCollectionCode(copy, "no_answer"), "暂无回答");
  assert.equal(describeCollectionCode(copy, "not_ready"), "站点尚未就绪");
  assert.equal(describeCollectionCode(copy, "private_reason"), "失败");
});
