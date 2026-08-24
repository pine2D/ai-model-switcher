import assert from "node:assert/strict";
import test from "node:test";

import { COPY, getCopy } from "../src/shared/copy";
import { describeStatus } from "../src/shared/status-copy";

test("desktop shell keeps complete English, Simplified Chinese and Traditional Chinese copy", () => {
  const sourceKeys = Object.keys(COPY.en).sort();
  assert.deepEqual(Object.keys(COPY.zhCN).sort(), sourceKeys);
  assert.deepEqual(Object.keys(COPY.zhTW).sort(), sourceKeys);
  assert.ok(sourceKeys.every((key) => COPY.en[key as keyof typeof COPY.en].length > 0));
});

test("desktop shell resolves exact supported locale and falls back to English", () => {
  assert.equal(getCopy("zh-CN").send, "发送");
  assert.equal(getCopy("zh-TW").send, "傳送");
  assert.equal(getCopy("zh-HK").send, "傳送");
  assert.equal(getCopy("zh-MO").send, "傳送");
  assert.equal(getCopy("en-GB").send, "Send");
  assert.equal(getCopy("fr-FR").send, "Send");
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
});
