import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { SettingsWorkspace } from "../src/renderer/settings-workspace";
import { getCopy } from "../src/shared/copy";
import type { SyncStatus } from "../src/shared/sync";

const noop = () => undefined;
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

test("sync settings expose compact connection state and protected cloud deletion", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("zh-CN")}
      locale="zh-CN"
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
    <SettingsWorkspace copy={getCopy("en")} locale="en" status={status({ secureTokenStorage: false })} onStatus={noop} onAnnounce={noop} onClose={noop} />
  );
  assert.match(html, /Linux keyring is unavailable/);
});

test("an expired connected session offers reauthentication instead of a dead-end sync action", () => {
  const html = renderToStaticMarkup(
    <SettingsWorkspace
      copy={getCopy("en")}
      locale="en"
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
