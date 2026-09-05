import assert from "node:assert/strict";
import test from "node:test";

import { COPY, formatCopy, getCopy, resolveLocale } from "../src/shared/copy";
import { describeCollectionCode, describeStatus, describeSynthesisSendCode, errorCode, visibleStatus } from "../src/shared/status-copy";
import { describeSync } from "../src/renderer/sync-status";

test("desktop shell keeps complete English, Simplified Chinese and Traditional Chinese copy", () => {
  const sourceKeys = Object.keys(COPY.en).sort();
  assert.deepEqual(Object.keys(COPY.zhCN).sort(), sourceKeys);
  assert.deepEqual(Object.keys(COPY.zhTW).sort(), sourceKeys);
  assert.ok(sourceKeys.every((key) => COPY.en[key as keyof typeof COPY.en].length > 0));
  assert.equal(sourceKeys.includes("brandSub"), false);
});

test("portable migration copy preserves the import choice and recovery action", () => {
  const messages = Object.values(COPY).map((copy) => copy as unknown as Record<string, string>);
  assert.deepEqual(messages.map((copy) => copy.portableImport), ["Import data", "导入数据", "匯入資料"]);
  assert.deepEqual(messages.map((copy) => copy.portableStartFresh), ["Start fresh", "全新开始", "全新開始"]);
  assert.deepEqual(messages.map((copy) => copy.portableImportMessage), [
    "PolyAsk found existing settings and site sign-ins. Copy them into this portable version? The originals will stay where they are.",
    "检测到现有 PolyAsk 的设置和站点登录状态。是否复制到当前便携版？原有数据仍会保留在原位置。",
    "偵測到現有 PolyAsk 的設定與網站登入狀態。是否複製到目前的可攜版？原有資料仍會保留在原位置。"
  ]);
  assert.ok(messages.every((copy) => copy.portableImportFailedMessage.length > 20));
  assert.deepEqual(messages.map((copy) => copy.portableLegacyInUseTitle), [
    "Close PolyAsk before continuing",
    "请先完全退出 PolyAsk",
    "請先完全結束 PolyAsk"
  ]);
  assert.ok(messages.every((copy) => copy.portableLegacyInUseMessage.includes("polyask-desktop.exe")));
  assert.ok(messages.every((copy) => copy.portableDataConflictMessage.includes("polyask-desktop.exe")));
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
    assert.deepEqual([...locale.sitePageLabel.matchAll(/\{[A-Za-z]+\}/g)].map(String), ["{page}", "{range}"]);
    assert.deepEqual([...locale.sitePageChanged.matchAll(/\{[A-Za-z]+\}/g)].map(String), ["{page}", "{total}"]);
    assert.deepEqual([...locale.sitePageMenu.matchAll(/\{[A-Za-z]+\}/g)].map(String), ["{page}"]);
  }
});

test("dynamic layouts use overview wording instead of a fixed nine-site grid", () => {
  assert.deepEqual(
    [COPY.en.overview, COPY.zhCN.overview, COPY.zhTW.overview],
    ["Overview", "总览", "總覽"]
  );
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
    assert.deepEqual([...locale.syncStateLocalOnly.matchAll(/\{[A-Za-z]+\}/g)].map(String), []);
    assert.deepEqual([...locale.closeSettings.matchAll(/\{[A-Za-z]+\}/g)].map(String), []);
  }
});

test("Drive setup copy requires the complete Desktop OAuth credential pair", () => {
  assert.deepEqual(
    [COPY.en.syncOauthMissing, COPY.zhCN.syncOauthMissing, COPY.zhTW.syncOauthMissing],
    [
      "This build is missing its Google Desktop OAuth credentials. Before packaging, add both clientId and clientSecret to resources/oauth.json, or set POLYASK_GOOGLE_DESKTOP_CLIENT_ID and POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET.",
      "当前构建缺少 Google 桌面 OAuth 凭据。打包前，请在 resources/oauth.json 中同时配置 clientId 和 clientSecret，或设置 POLYASK_GOOGLE_DESKTOP_CLIENT_ID 与 POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET。",
      "目前組建缺少 Google 桌面 OAuth 憑證。封裝前，請在 resources/oauth.json 中同時設定 clientId 和 clientSecret，或設定 POLYASK_GOOGLE_DESKTOP_CLIENT_ID 與 POLYASK_GOOGLE_DESKTOP_CLIENT_SECRET。"
    ]
  );
});

test("Drive connection failures identify the failed stage in every locale", () => {
  assert.deepEqual(
    [COPY.en.syncReasonOauthNetwork, COPY.zhCN.syncReasonOauthNetwork, COPY.zhTW.syncReasonOauthNetwork],
    [
      "Browser authorization completed, but PolyAsk could not reach Google sign-in services. Check your network, then try again.",
      "浏览器授权已完成，但 PolyAsk 无法连接 Google 登录服务。请检查网络后重试。",
      "瀏覽器授權已完成，但 PolyAsk 無法連線至 Google 登入服務。請檢查網路後再試一次。"
    ]
  );
  const base = { connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: true, secureTokenStorage: true } as const;
  assert.equal(describeSync(COPY.zhCN, { ...base, state: "offline", reason: "oauth_network" }), COPY.zhCN.syncReasonOauthNetwork);
  assert.equal(describeSync(COPY.zhCN, { ...base, state: "error", reason: "token_storage" }), COPY.zhCN.syncReasonTokenStorage);
  assert.equal(describeSync(COPY.zhCN, { ...base, state: "offline", reason: "drive_network" }), COPY.zhCN.syncReasonDriveNetwork);
});

test("Drive authorization diagnostics distinguish the safe failure codes", () => {
  const simplified = COPY.zhCN as unknown as Record<string, string>;
  assert.equal(simplified.syncReasonOauthInvalidGrant, "Google 拒绝了本次授权码（invalid_grant）。请重新连接一次；若仍失败，请反馈此错误代码。");
  assert.equal(simplified.syncReasonOauthInvalidClient, "当前版本的 Google OAuth 客户端配置无效（invalid_client），需要更新应用配置。");
  assert.equal(simplified.syncReasonOauthRedirectMismatch, "Google 拒绝了本机回调地址（redirect_uri_mismatch），需要更新应用配置。");
  assert.equal(simplified.syncReasonOauthRefreshMissing, "Google 已签发访问令牌，但未返回持续连接所需的刷新令牌。请先在 Google 账号中撤销 PolyAsk 的访问权限，再重新连接。");
  assert.equal(simplified.syncReasonDriveUnauthorized, "授权已完成，但 Google Drive 拒绝了访问令牌（HTTP 401）。请先撤销 PolyAsk 的访问权限，再重新连接。");

  const base = { connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: true, secureTokenStorage: true } as const;
  for (const [reason, copyKey] of [
    ["oauth_invalid_grant", "syncReasonOauthInvalidGrant"],
    ["oauth_invalid_client", "syncReasonOauthInvalidClient"],
    ["oauth_redirect_mismatch", "syncReasonOauthRedirectMismatch"],
    ["oauth_refresh_missing", "syncReasonOauthRefreshMissing"],
    ["drive_unauthorized", "syncReasonDriveUnauthorized"]
  ] as const) {
    assert.equal(
      describeSync(COPY.zhCN, { ...base, state: "auth", reason }),
      simplified[copyKey]
    );
  }
});

test("Drive authorization shows a localized message around a protected Google diagnostic", () => {
  const simplified = COPY.zhCN as unknown as Record<string, string>;
  assert.equal(
    simplified.syncReasonOauthProvider,
    "Google 拒绝了令牌请求（错误代码：{code}）。反馈问题时请附上此代码，以便定位 OAuth 配置问题。"
  );
  const base = { connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: true, secureTokenStorage: true } as const;
  assert.equal(
    describeSync(COPY.zhCN, {
      ...base,
      state: "auth",
      reason: "oauth_provider_error",
      diagnostic: "invalid_request / client_secret"
    }),
    "Google 拒绝了令牌请求（错误代码：invalid_request / client_secret）。反馈问题时请附上此代码，以便定位 OAuth 配置问题。"
  );
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
    messages.map((message) => [...message.matchAll(/\{[A-Za-z]+\}/g)].map(String)),
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
      messages.map((message) => [...message.matchAll(/\{[A-Za-z]+\}/g)].map(String)),
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
    assert.deepEqual([...locale.failedSummary.matchAll(/\{[A-Za-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual([...locale.cancelledSummary.matchAll(/\{[A-Za-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual(
      [...locale.mixedFailureSummary.matchAll(/\{[A-Za-z]+\}/g)].map(String),
      ["{failed}", "{cancelled}"]
    );
    assert.deepEqual([...locale.retryFailedSites.matchAll(/\{[A-Za-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual([...locale.retryCancelledSites.matchAll(/\{[A-Za-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual(
      [...locale.retryFailedOrCancelledSites.matchAll(/\{[A-Za-z]+\}/g)].map(String),
      ["{count}"]
    );
    assert.deepEqual([...locale.newSessionDone.matchAll(/\{[A-Za-z]+\}/g)].map(String), ["{count}"]);
    assert.deepEqual([...locale.newSessionPartial.matchAll(/\{[A-Za-z]+\}/g)].map(String), ["{ok}", "{failed}"]);
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

test("resolveLocale is the single locale authority for the shell and the site runtime (F223)", () => {
  // shared/locale.ts is the only locale resolver: the shell reads it through getCopy, and
  // preload/site.ts injects the same result into site-runtime/i18n.js via setLang, so the
  // site pane and the surrounding shell can no longer disagree. This table locks the
  // prefix semantics (no `.includes()` substring matching, no fallback to Simplified).
  assert.equal(resolveLocale("zh-MO"), "zhTW");
  assert.equal(resolveLocale("zh-SG"), "en");
  assert.equal(resolveLocale("zh-yue-HK"), "en");
  assert.equal(resolveLocale("zh-CHS"), "en");
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
  assert.equal(describeSynthesisSendCode(copy, errorCode(new Error("timeout"))), copy.timedOut);
  assert.equal(describeSynthesisSendCode(copy, errorCode("not an error")), copy.synthesisSendFailed);
});

test("images-busy-while-broadcasting and answer-truncated copy are localized in all three locales", () => {
  assert.deepEqual(
    [COPY.en.imagesBusy, COPY.zhCN.imagesBusy, COPY.zhTW.imagesBusy],
    [
      "Broadcasting is in progress; images can't be added right now",
      "群发进行中，暂时无法添加图片",
      "群發進行中，暫時無法加入圖片"
    ]
  );
  assert.deepEqual(
    [COPY.en.answerTruncated, COPY.zhCN.answerTruncated, COPY.zhTW.answerTruncated],
    [
      "This answer was too long and has been truncated",
      "该回答过长，已被截断",
      "該回答過長，已被截斷"
    ]
  );
});

test("formatCopy can substitute every placeholder that appears in any locale table", () => {
  // 字典与格式化函数曾共用同一个小写字符类：{signIn} 在三语里都原样裸露到站点状态面板。
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const copy = getCopy(locale) as unknown as Record<string, string>;
    for (const [key, value] of Object.entries(copy)) {
      const tokens = [...value.matchAll(/\{([A-Za-z_]+)\}/g)].map((m) => m[1]);
      if (!tokens.length) continue;
      const rendered = formatCopy(value, Object.fromEntries(tokens.map((token) => [token, "X"])));
      assert.doesNotMatch(rendered, /\{[A-Za-z_]+\}/, `${locale}.${key} 的占位符没有被 formatCopy 替换：${rendered}`);
    }
  }
  assert.equal(formatCopy(getCopy("en").healthScopeSummary, { ready: 3, signIn: 2, error: 1, unknown: 3 }).includes("{signIn}"), false);
});
