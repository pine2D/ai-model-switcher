import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { SettingsWorkspace } from "../src/renderer/settings-workspace";
import { getCopy } from "../src/shared/copy";
import type { SyncStatus } from "../src/shared/sync";

const noop = () => undefined;
const runtime = { version: "0.19.0", distribution: "installed" } as const;
const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({
  state: "idle",
  connected: false,
  pending: 2,
  errorCount: 0,
  readOnly: false,
  oauthConfigured: true,
  secureTokenStorage: true,
  ...patch
});

const renderSettings = (value: SyncStatus): string => renderToStaticMarkup(
  <SettingsWorkspace
    copy={getCopy("en")}
    locale="en"
    runtime={runtime}
    status={value}
    onStatus={noop}
    onAnnounce={noop}
    onClose={noop}
  />
);

test("settings identify the running version and portable profile", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("zh-CN")}
      locale="zh-CN"
      runtime={{ version: "0.20.0", distribution: "portable" }}
      status={status()}
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /PolyAsk 0\.20\.0 · 便携版/);
});

test("idle Drive status distinguishes local-only data from an up-to-date connection", () => {
  const disconnected = renderSettings(status({ connected: false, state: "idle" }));
  assert.match(disconnected, /data-state="idle" data-connected="false"/);
  assert.match(disconnected, />Local only</);
  assert.doesNotMatch(disconnected, />Up to date</);
  assert.match(disconnected, /title="Close settings" aria-label="Close settings"/);
  assert.equal([...disconnected.matchAll(/aria-live="polite"/g)].length, 1);
  assert.equal([...disconnected.matchAll(/>Local only</g)].length, 1);
  assert.match(disconnected, /<footer class="archive-status" role="status" aria-live="polite"><\/footer>/);

  const connected = renderSettings(status({ connected: true, state: "idle" }));
  assert.match(connected, /data-state="idle" data-connected="true"/);
  assert.match(connected, />Up to date</);
  assert.doesNotMatch(connected, />Local only</);
  assert.equal([...connected.matchAll(/>Up to date</g)].length, 1);
  assert.equal([...connected.matchAll(/aria-live="polite"/g)].length, 1);
});

test("disconnected Drive keeps actionable states and reasons visible", () => {
  const states = [
    ["offline", "Offline; local changes are queued"],
    ["auth", "Sign in again to continue"],
    ["blocked", "Google Drive access is blocked"],
    ["waiting", "Google is busy; retry scheduled"],
    ["schema", "Read-only compatibility mode"],
    ["error", "Sync failed"]
  ] as const;
  for (const [state, message] of states) {
    const html = renderSettings(status({ connected: false, state }));
    assert.match(html, new RegExp(`>${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`));
    assert.doesNotMatch(html, />Local only</);
  }

  const reason = renderSettings(status({ connected: false, state: "idle", reason: "oauth_not_configured" }));
  assert.match(reason, />OAuth is not configured</);
  assert.doesNotMatch(reason, />Local only</);
});

test("syncing settings disable close and state-changing actions", () => {
  const html = renderSettings(status({ connected: true, state: "syncing" }));
  assert.match(html, /<button type="button" title="Close settings" aria-label="Close settings" disabled="">/);
  assert.match(html, /<button type="button" class="primary" disabled="">Sync now<\/button>/);
  assert.match(html, /<button type="button" disabled="">Disconnect<\/button>/);
});

test("sync settings expose compact connection state and protected cloud deletion", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("zh-CN")}
      locale="zh-CN"
      runtime={runtime}
      status={status({ connected: true, state: "waiting" })}
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /Google Drive 同步/);
  assert.match(html, /已连接/);
  assert.match(html, /2 项待同步/);
  assert.match(html, /立即同步/);
  assert.match(html, /断开连接/);
  assert.match(html, /输入 DELETE 后启用/);
  assert.match(html, /<button type="button" disabled=""[^>]*>删除云端数据<\/button>/);
  assert.match(html, /drive\.appdata/);
});

test("sync settings surfaces missing OAuth without irrelevant storage warnings", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("en")}
      locale="en"
      runtime={runtime}
      status={status({ oauthConfigured: false, secureTokenStorage: false })}
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /no Google desktop OAuth client ID/);
  assert.doesNotMatch(html, /Linux keyring is unavailable/);
  assert.match(html, /<button type="button" class="primary" disabled="">Connect Google Drive<\/button>/);
});

test("a configured Linux build reports insecure token storage", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace copy={getCopy("en")} locale="en" runtime={runtime} status={status({ secureTokenStorage: false })} onStatus={noop} onAnnounce={noop} onClose={noop} />
  );
  assert.match(html, /Linux keyring is unavailable/);
});

test("an expired connected session offers reauthentication instead of a dead-end sync action", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("en")}
      locale="en"
      runtime={runtime}
      status={status({ connected: true, state: "auth" })}
      onStatus={noop}
      onAnnounce={noop}
      onClose={noop}
    />
  );
  assert.match(html, /Connect Google Drive/);
  assert.match(html, /Disconnect/);
  assert.doesNotMatch(html, />Sync now<\/button>/);
});
