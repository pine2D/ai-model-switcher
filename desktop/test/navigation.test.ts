import assert from "node:assert/strict";
import test from "node:test";

import { navigationDisposition } from "../src/main/navigation";
import { SITES } from "../src/main/sites";

const chatgpt = SITES.find((site) => site.key === "chatgpt")!;

test("navigation policy keeps sites and explicit login domains inside", () => {
  assert.equal(navigationDisposition(chatgpt, "https://chatgpt.com/c/123"), "site");
  assert.equal(navigationDisposition(chatgpt, "https://auth.openai.com/login"), "auth");
  assert.equal(navigationDisposition(chatgpt, "https://accounts.google.com/o/oauth2"), "auth");
});

test("navigation policy recognizes one-party transit hosts distinctly from external", () => {
  const gemini = SITES.find((site) => site.key === "gemini")!;
  assert.equal(navigationDisposition(gemini, "https://www.google.com/sorry/index?continue=x"), "transit");
  assert.equal(navigationDisposition(gemini, "https://consent.google.com/ml"), "transit");
  assert.equal(navigationDisposition(gemini, "https://www.google.com.evil.com/"), "external");
  const deepseek = SITES.find((site) => site.key === "deepseek")!;
  assert.equal(navigationDisposition(deepseek, "https://www.google.com/sorry"), "external", "无 transit 登记的站不放行");
});

test("navigation policy blocks insecure URLs and isolates unrelated HTTPS", () => {
  assert.equal(navigationDisposition(chatgpt, "http://chatgpt.com/"), "block");
  assert.equal(navigationDisposition(chatgpt, "javascript:alert(1)"), "block");
  assert.equal(navigationDisposition(chatgpt, "https://example.com/"), "external");
  assert.equal(navigationDisposition(chatgpt, "https://preview.chatgpt.com/"), "external");
});
