import assert from "node:assert/strict";
import test from "node:test";

import { COPY, getCopy } from "../src/shared/copy";
import { describeStatus, visibleStatus } from "../src/shared/status-copy";

test("desktop shell keeps complete English, Simplified Chinese and Traditional Chinese copy", () => {
  const sourceKeys = Object.keys(COPY.en).sort();
  assert.deepEqual(Object.keys(COPY.zhCN).sort(), sourceKeys);
  assert.deepEqual(Object.keys(COPY.zhTW).sort(), sourceKeys);
  assert.ok(sourceKeys.every((key) => COPY.en[key as keyof typeof COPY.en].length > 0));
  assert.equal(sourceKeys.includes("brandSub"), false);
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
    "Sent with warning"
  );
  assert.equal(
    visibleStatus(copy, { site: "claude", phase: "failed", code: "submit_unconfirmed" }),
    "Failed"
  );
  assert.equal(visibleStatus(copy, { site: "claude", phase: "crashed" }), "Stopped");
});
