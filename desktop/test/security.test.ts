import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedShellUrl, safeExternalUrl } from "../src/main/security";

const entry = "file:///opt/PolyAsk/resources/app.asar/.webpack/renderer/main_window/index.html";

test("shell URL trust allows only the configured local document", () => {
  assert.equal(isTrustedShellUrl(entry, entry), true);
  assert.equal(isTrustedShellUrl(`${entry}#focus`, entry), true);
  assert.equal(isTrustedShellUrl("https://chatgpt.com/", entry), false);
  assert.equal(isTrustedShellUrl("file:///opt/PolyAsk/resources/app.asar/package.json", entry), false);
  assert.equal(isTrustedShellUrl("not a url", entry), false);
});

test("external links allow explicit HTTP(S) destinations without credentials", () => {
  assert.equal(safeExternalUrl("https://example.com/a b"), "https://example.com/a%20b");
  assert.equal(safeExternalUrl("http://example.com/"), "http://example.com/");
  assert.equal(safeExternalUrl("https://user:secret@example.com/"), null);
  assert.equal(safeExternalUrl("file:///etc/passwd"), null);
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
});
