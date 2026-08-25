import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildAuthorizationRequest,
  loadOAuthClientId,
  type RandomBytes
} from "../src/main/oauth-pkce";

const fixedRandom: RandomBytes = (size) => Buffer.alloc(size, 7);
const execFileAsync = promisify(execFile);

test("desktop OAuth uses S256 PKCE, state and an exact loopback redirect", async () => {
  const request = await buildAuthorizationRequest({
    clientId: "client.apps.googleusercontent.com",
    port: 43_123,
    scope: "https://www.googleapis.com/auth/drive.appdata",
    randomBytes: fixedRandom
  });

  assert.equal(request.url.origin, "https://accounts.google.com");
  assert.equal(request.url.searchParams.get("response_type"), "code");
  assert.equal(request.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(request.url.searchParams.get("redirect_uri"), "http://127.0.0.1:43123");
  assert.equal(request.url.searchParams.get("state"), request.state);
  assert.ok(request.verifier.length >= 43 && request.verifier.length <= 128);
  assert.notEqual(request.url.searchParams.get("code_challenge"), request.verifier);
});

test("desktop OAuth client id never falls back to a Chrome extension client", async () => {
  assert.equal(await loadOAuthClientId({
    environment: { POLYASK_GOOGLE_DESKTOP_CLIENT_ID: "desktop.apps.googleusercontent.com" },
    resourcePath: "/missing/oauth.json",
    readText: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
  }), "desktop.apps.googleusercontent.com");
  assert.equal(await loadOAuthClientId({
    environment: {},
    resourcePath: "/app/oauth.json",
    readText: async () => JSON.stringify({ clientId: "packaged.apps.googleusercontent.com" })
  }), "packaged.apps.googleusercontent.com");
  assert.equal(await loadOAuthClientId({ environment: {}, resourcePath: "/missing/oauth.json", readText: async () => "{}" }), null);
});

test("authorization owns token exchange rejection while delayed receiver close runs", async () => {
  const desktopRoot = resolve(__dirname, "..");
  const moduleUrl = pathToFileURL(resolve(desktopRoot, "src/main/oauth-pkce.ts")).href;
  const script = `
    const { authorizeWithPkce } = await import(${JSON.stringify(moduleUrl)});
    const rejectionEvents = [];
    process.on("unhandledRejection", (reason) => {
      rejectionEvents.push(reason instanceof Error ? reason.message : String(reason));
    });
    process.on("rejectionHandled", () => rejectionEvents.push("handled"));

    let resolveReceive;
    let releaseClose;
    let signalCloseStarted;
    let closeFinished = false;
    const receive = new Promise((resolve) => { resolveReceive = resolve; });
    const closeGate = new Promise((resolve) => { releaseClose = resolve; });
    const closeStarted = new Promise((resolve) => { signalCloseStarted = resolve; });

    const authorization = authorizeWithPkce({
      clientId: "client.apps.googleusercontent.com",
      scope: "https://www.googleapis.com/auth/drive.appdata",
      openExternal: async (url) => {
        resolveReceive({ code: "rejected-code", state: new URL(url).searchParams.get("state") });
      },
      listen: async () => ({
        port: 43_123,
        receive,
        close: async () => {
          signalCloseStarted();
          await closeGate;
          closeFinished = true;
        }
      }),
      fetch: async () => new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    });

    await closeStarted;
    await new Promise((resolve) => setImmediate(resolve));
    releaseClose();
    let outerError = null;
    try { await authorization; }
    catch (error) { outerError = error instanceof Error ? error.message : String(error); }
    await new Promise((resolve) => setImmediate(resolve));
    process.stdout.write(JSON.stringify({ rejectionEvents, outerError, closeFinished }));
  `;

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    { cwd: desktopRoot, encoding: "utf8" }
  );
  const result = JSON.parse(stdout) as {
    readonly rejectionEvents: string[];
    readonly outerError: string | null;
    readonly closeFinished: boolean;
  };

  assert.equal(result.outerError, "auth_failed");
  assert.equal(result.closeFinished, true);
  assert.deepEqual(result.rejectionEvents, []);
  assert.equal(stderr, "");
});
