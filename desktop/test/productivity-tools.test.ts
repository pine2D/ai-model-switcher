import assert from "node:assert/strict";
import test from "node:test";

import { CompletionNotifier } from "../src/main/completion-notifier";
import { nextSiteForStatus } from "../src/renderer/site-navigation";
import type { SiteStatus } from "../src/shared/protocol";

const statuses: Partial<Record<SiteStatus["site"], SiteStatus>> = {
  claude: { site: "claude", phase: "complete" },
  chatgpt: { site: "chatgpt", phase: "generating" },
  gemini: { site: "gemini", phase: "failed" }
};

test("status navigation wraps in selected-site order", () => {
  const sites = ["claude", "chatgpt", "gemini"] as const;
  assert.equal(nextSiteForStatus(sites, "claude", statuses, "unfinished"), "chatgpt");
  assert.equal(nextSiteForStatus(sites, "gemini", statuses, "unfinished"), "chatgpt");
  assert.equal(nextSiteForStatus(sites, "chatgpt", statuses, "failed"), "gemini");
  assert.equal(nextSiteForStatus(sites, "gemini", statuses, "failed"), "gemini");
});

test("completion notifications are opt-in, unfocused, deduplicated and contain no content", () => {
  const shown: { title: string; body: string }[] = [];
  let focused = false;
  const notifier = new CompletionNotifier({
    copy: {
      title: "PolyAsk",
      complete: (site) => `${site} finished`,
      failed: (site) => `${site} needs attention`
    },
    focused: () => focused,
    show: (notification) => { shown.push(notification); }
  });
  notifier.accept({ site: "claude", phase: "complete", unread: true }, "Claude");
  assert.equal(shown.length, 0);
  notifier.setEnabled(true);
  notifier.accept({ site: "claude", phase: "complete", unread: true }, "Claude");
  notifier.accept({ site: "claude", phase: "complete", unread: true }, "Claude");
  assert.deepEqual(shown, [{ title: "PolyAsk", body: "Claude finished" }]);
  notifier.accept({ site: "claude", phase: "sending" }, "Claude");
  focused = true;
  notifier.accept({ site: "claude", phase: "failed", unread: true }, "Claude");
  assert.equal(shown.length, 1);
});
