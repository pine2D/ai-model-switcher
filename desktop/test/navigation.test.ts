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

test("navigation policy blocks insecure URLs and isolates unrelated HTTPS", () => {
  assert.equal(navigationDisposition(chatgpt, "http://chatgpt.com/"), "block");
  assert.equal(navigationDisposition(chatgpt, "javascript:alert(1)"), "block");
  assert.equal(navigationDisposition(chatgpt, "https://example.com/"), "external");
  assert.equal(navigationDisposition(chatgpt, "https://preview.chatgpt.com/"), "external");
});
