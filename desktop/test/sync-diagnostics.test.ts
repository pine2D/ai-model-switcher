import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSyncDiagnosticReport,
  createSyncDiagnosticSnapshot,
  firstFailedSyncStage
} from "../src/shared/sync-diagnostics";
import type { SyncStatus } from "../src/shared/sync";

const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({
  state: "idle",
  connected: false,
  pending: 0,
  errorCount: 0,
  readOnly: false,
  oauthConfigured: true,
  secureTokenStorage: true,
  ...patch
});

test("Drive diagnostics always contain the six stable stages", () => {
  const snapshot = createSyncDiagnosticSnapshot(
    status({ connected: true, lastSuccessAt: 2_000 }),
    { version: "0.21.0", distribution: "portable" },
    3_000
  );
  assert.deepEqual(snapshot.stages.map((stage) => stage.id), [
    "oauth-config", "browser-auth", "token-exchange",
    "token-storage", "drive-access", "last-sync"
  ]);
  assert.equal(snapshot.stages.every((stage) => stage.state === "ok"), true);
  assert.equal(firstFailedSyncStage(snapshot), null);
});

test("Drive diagnostic report cannot contain secrets or user data", () => {
  const snapshot = Object.assign(createSyncDiagnosticSnapshot(status({
    state: "auth",
    reason: "oauth_provider_error",
    diagnostic: "invalid_client / client_secret"
  }), { version: "0.21.0", distribution: "portable" }, 3_000), {
    clientSecret: "secret-value",
    accessToken: "ya29.access-token",
    refreshToken: "refresh-token",
    authorizationCode: "authorization-code",
    email: "user@gmail.com",
    dataPath: "/Users/alice/PolyAsk Data",
    prompt: "prompt text"
  });
  const report = buildSyncDiagnosticReport(snapshot);
  for (const forbidden of [
    "secret-value", "ya29.", "refresh-token", "authorization-code",
    "user@gmail.com", "/Users/alice", "prompt text"
  ]) assert.equal(report.includes(forbidden), false, forbidden);
  assert.match(report, /invalid_client \/ client_secret/);
  assert.match(report, /PolyAsk Drive diagnostics/);
});

test("diagnostic stages distinguish secure-storage warnings and exact failures", () => {
  const warning = createSyncDiagnosticSnapshot(status({
    connected: true,
    secureTokenStorage: false,
    lastSuccessAt: 2_000
  }), { version: "0.21.0", distribution: "installed" }, 3_000);
  assert.equal(warning.stages.find((stage) => stage.id === "token-storage")?.state, "warning");

  const failed = createSyncDiagnosticSnapshot(status({
    state: "blocked",
    reason: "oauth_invalid_client"
  }), { version: "0.21.0", distribution: "installed" }, 3_000);
  assert.equal(firstFailedSyncStage(failed)?.id, "token-exchange");
  assert.equal(firstFailedSyncStage(failed)?.code, "oauth_invalid_client");
});

test("unrecognized diagnostics are discarded instead of entering the report", () => {
  const snapshot = createSyncDiagnosticSnapshot(status({
    state: "auth",
    reason: "oauth_provider_error",
    diagnostic: "invalid_client / client_secret\nrefresh-token"
  }), { version: "0.21.0", distribution: "installed" }, 3_000);
  assert.doesNotMatch(buildSyncDiagnosticReport(snapshot), /refresh-token/);
});

test("diagnostic reports replace timestamps outside the JavaScript Date range", () => {
  const snapshot = createSyncDiagnosticSnapshot(
    status({ connected: true, lastSuccessAt: 9_000_000_000_000_000 }),
    { version: "0.21.0", distribution: "portable" },
    9_000_000_000_000_000
  );
  assert.doesNotThrow(() => buildSyncDiagnosticReport(snapshot));
  assert.equal(snapshot.lastSuccessAt, undefined);
  assert.ok(snapshot.generatedAt <= 8_640_000_000_000_000);
});
